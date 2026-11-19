/**
 * @file extension.ts
 * @description Main extension entry point for TrueForge VS Code Coding Agent.
 */

import * as vscode from 'vscode';
import { McpServerManager } from './mcp/server';
import { TrueForgeClient } from './trueforge/client';
import { ModelSwitcher } from './trueforge/modelSwitcher';
import { ConfigValidator } from './trueforge/configValidator';
import { StagingBuffer } from './diff/stagingBuffer';
import { VirtualDiffProvider } from './diff/virtualDiffProvider';
import { InlineDecorator } from './diff/inlineDecorator';
import { ShadowDiagnosticsChecker } from './diff/shadowDiagnostics';
import { UndoCheckpointStack } from './diff/undoStack';
import { ContextLedgerTracker } from './context/ledgerTracker';
import { ContextRetriever } from './context/retriever';
import { buildInlineEditContext } from './context/budgetAssembler';
import { decomposeIntoHunks, extractMultiFileReviews } from './diff/hunkExtractor';
import { PanelProvider } from './webview/PanelProvider';
import type { ExecutionMode, TextDeltaEvent } from './types/contracts';

let currentTurnId = `turn-${Date.now()}`;

export async function activate(context: vscode.ExtensionContext) {
  console.log('[TrueForge] Activating extension...');

  // 1. Initialize core state & diff pipeline
  const stagingBuffer = new StagingBuffer();
  const undoStack = new UndoCheckpointStack();
  const virtualDiffProvider = new VirtualDiffProvider();
  const shadowDiagnostics = new ShadowDiagnosticsChecker(virtualDiffProvider);
  const inlineDecorator = new InlineDecorator(stagingBuffer);
  const ledgerTracker = new ContextLedgerTracker();
  const contextRetriever = new ContextRetriever();

  // Register Virtual Diff schemes & CodeLens
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('trueforge-diff', virtualDiffProvider),
    vscode.workspace.registerTextDocumentContentProvider('trueforge-shadow', virtualDiffProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, inlineDecorator),
  );

  // 2. Start embedded MCP server
  const mcpServer = new McpServerManager(context, {
    stagingBuffer,
    shadowDiagnostics,
    virtualDiffProvider,
    undoStack,
    getCurrentTurnId: () => currentTurnId,
  });

  let mcpPort = 0;
  try {
    mcpPort = await mcpServer.start();
    console.log(`[TrueForge] Embedded MCP server listening on 127.0.0.1:${mcpPort}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to start TrueForge MCP server: ${err}`);
  }

  // 3. Initialize TrueForge Client & Model Switcher
  const config = vscode.workspace.getConfiguration('trueforge');
  const serverUrl = config.get<string>('serverUrl') || 'http://localhost:3000';
  const client = new TrueForgeClient(serverUrl, 'forge-coding-agent');
  const modelSwitcher = new ModelSwitcher(client);

  // Status Bar Item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = `$(rocket) TrueForge: ${modelSwitcher.getActiveModel()}`;
  statusBarItem.tooltip = `TrueForge Server: ${serverUrl} | MCP Port: ${mcpPort}\nClick to switch model`;
  statusBarItem.command = 'trueforge.switchActiveModel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  modelSwitcher.onDidChangeModel((newModel) => {
    statusBarItem.text = `$(rocket) TrueForge: ${newModel}`;
  });

  // Pre-flight health check
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  ConfigValidator.runPreflight(serverUrl, workspaceRoot).then((preflight) => {
    if (!preflight.serverReachable) {
      statusBarItem.text = `$(warning) TrueForge: Offline`;
      statusBarItem.tooltip = `Cannot reach ${serverUrl}\nRun 'start-server.cmd' to launch TrueForge`;
    }
  });

  // 4. Turn execution coordinator
  async function runTurn(prompt: string, mode: ExecutionMode, editor?: vscode.TextEditor): Promise<void> {
    currentTurnId = `turn-${Date.now()}`;
    panelProvider.setGenerating(true);

    try {
      let assembledPrompt = prompt;
      let systemDirective: string | undefined;

      if (mode === 'inline-edit' && (editor || vscode.window.activeTextEditor)) {
        const targetEditor = editor || vscode.window.activeTextEditor!;
        const inlineCtx = await buildInlineEditContext(
          targetEditor,
          prompt,
          currentTurnId,
          ledgerTracker,
        );
        assembledPrompt = inlineCtx.assembledPrompt;
        systemDirective = inlineCtx.systemDirective;
      } else if (mode === 'agent-mode') {
        ledgerTracker.resetForTurn(currentTurnId, 'agent-mode');

        // Multi-signal codebase retrieval
        const { slices, overflowToc } = await contextRetriever.retrieveSlices(
          prompt,
          10000,
          editor?.document.uri.fsPath,
        );

        for (const s of slices) {
          ledgerTracker.addSlice(s);
        }
        for (const t of overflowToc) {
          ledgerTracker.addOverflow(t);
        }

        if (slices.length > 0) {
          const contextBlock = slices
            .map((s) => `--- File: ${s.filePath} (lines ${s.startLine}-${s.endLine}) ---\n${s.content}`)
            .join('\n\n');
          assembledPrompt = `${prompt}\n\nRelevant Codebase Context:\n${contextBlock}`;
        }

        systemDirective = `You are TrueForge Coding Agent operating in Mode 2 (Agent Mode).
You must implement the requested feature across all relevant files in the codebase.
CRITICAL FORMATTING INSTRUCTIONS:
1. Touch all required files (including implementation, tests, and documentation).
2. Do NOT output whole files. Output ONLY the concise new code snippet/function for each file.
3. Do NOT output conversational filler, internal monologues, or speculative thoughts.
4. For EVERY file touched, you MUST use markdown sections in this exact format:

### \`path/to/file\`
\`\`\`<language>
<code snippet or function here>
\`\`\`

Example:
### \`src/flask/cli.py\`
\`\`\`python
@click.command("config", short_help="Show configuration.")
@with_appcontext
def config_command():
    ...
\`\`\`

### \`tests/test_cli.py\`
\`\`\`python
def test_config_command(runner, app):
    ...
\`\`\`

### \`docs/cli.rst\`
\`\`\`rst
flask config
~~~~~~~~~~~~
Show the application configuration as JSON.
\`\`\`
`;
      }

      // Ensure session exists
      let sessionId = client.currentSessionId;
      if (!sessionId || mode === 'agent-mode') {
        sessionId = await client.createSession({ mcpPort });
      }

      // Stream turn
      let collectedOutput = '';
      const stream = client.submitTurn(sessionId, assembledPrompt, systemDirective);

      for await (const event of stream) {
        panelProvider.postMessage({
          type: 'stream:event',
          event,
        });

        if (event.type === 'text_delta') {
          const delta = (event as TextDeltaEvent).delta || '';
          collectedOutput += delta;
          panelProvider.postMessage({
            type: 'stream:text_delta',
            delta,
          });
        }

        const ev = event as Record<string, unknown>;
        const state = ev.state as Record<string, unknown> | undefined;
        const output = state?.output as Record<string, unknown> | undefined;
        if (output?.content && typeof output.content === 'string') {
          collectedOutput = output.content;
        }

        if (ev.type === 'error' || (ev.state as Record<string, unknown> | undefined)?.status === 'error') {
          const errMsg =
            (ev.message as string | undefined) ||
            ((ev.state as Record<string, unknown> | undefined)?.message as string | undefined) ||
            'TrueForge turn failed with an error.';
          vscode.window.showErrorMessage(`TrueForge turn error: ${errMsg}`);
        }
      }

      // If mode is inline-edit and no review was staged via MCP yet, stage directly from model output
      if (mode === 'inline-edit' && !stagingBuffer.getActiveReview() && collectedOutput.trim()) {
        const targetEditor = editor || vscode.window.activeTextEditor;
        if (targetEditor) {
          const absPath = targetEditor.document.uri.fsPath;
          const origDoc = targetEditor.document.getText();
          const targetText = targetEditor.selection.isEmpty
            ? targetEditor.document.lineAt(targetEditor.selection.active.line).text
            : targetEditor.document.getText(targetEditor.selection);

          const fileId = `review-${Date.now()}`;
          const reviewData = decomposeIntoHunks(origDoc, collectedOutput, absPath, fileId, targetText);
          if (reviewData && reviewData.hunks.length > 0) {
            await undoStack.ensureFileSnapshotted(currentTurnId, absPath);

            // Run shadow diagnostics
            const shadowDiags = await shadowDiagnostics.verifyHunksInShadowDoc(
              absPath,
              reviewData.proposedFullContent,
              reviewData.hunks,
            );
            for (const h of reviewData.hunks) {
              h.shadowDiagnostics = shadowDiags;
            }

            virtualDiffProvider.setContent(
              vscode.Uri.parse(`trueforge-diff:${absPath}`),
              reviewData.proposedFullContent,
            );

            // Enqueue review into staging buffer for human review
            stagingBuffer.enqueueFileReview({
              fileId,
              turnId: currentTurnId,
              filePath: absPath,
              isNewFile: false,
              isDeleteFile: false,
              originalContent: origDoc,
              proposedFullContent: reviewData.proposedFullContent,
              hunks: reviewData.hunks,
              resolveGate: () => {},
            });

            // Automatically open native side-by-side diff view
            const originalUri = vscode.Uri.file(absPath);
            const proposedUri = vscode.Uri.parse(`trueforge-diff:${absPath}`);
            await vscode.commands.executeCommand(
              'vscode.diff',
              originalUri,
              proposedUri,
              `${vscode.workspace.asRelativePath(originalUri)} (Proposed Diff)`,
            );

            // Actionable banner to accept or reject immediately
            vscode.window
              .showInformationMessage(
                `TrueForge: Staged ${reviewData.hunks.length} diff hunk(s). Click Accept All to apply changes.`,
                'Accept All',
                'Reject All',
              )
              .then(async (action) => {
                if (action === 'Accept All') {
                  await stagingBuffer.acceptAllInActive();
                  vscode.window.showInformationMessage('TrueForge: Changes accepted and applied.');
                } else if (action === 'Reject All') {
                  await stagingBuffer.rejectAllInActive();
                  vscode.window.showInformationMessage('TrueForge: Changes rejected.');
                }
              });
          }
        }
      } else if (mode === 'agent-mode' && !stagingBuffer.getActiveReview() && collectedOutput.trim()) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const multiReviews = extractMultiFileReviews(collectedOutput, workspaceRoot);

        if (multiReviews.length > 0) {
          let firstDiffOpened = false;
          let totalHunks = 0;

          for (const reviewItem of multiReviews) {
            totalHunks += reviewItem.hunks.length;
            await undoStack.ensureFileSnapshotted(currentTurnId, reviewItem.filePath);

            virtualDiffProvider.setContent(
              vscode.Uri.parse(`trueforge-diff:${reviewItem.filePath}`),
              reviewItem.proposedFullContent,
            );

            stagingBuffer.enqueueFileReview({
              fileId: reviewItem.fileId,
              turnId: currentTurnId,
              filePath: reviewItem.filePath,
              isNewFile: false,
              isDeleteFile: false,
              originalContent: reviewItem.originalContent,
              proposedFullContent: reviewItem.proposedFullContent,
              hunks: reviewItem.hunks,
              resolveGate: () => {},
            });

            if (!firstDiffOpened) {
              firstDiffOpened = true;
              const originalUri = vscode.Uri.file(reviewItem.filePath);
              const proposedUri = vscode.Uri.parse(`trueforge-diff:${reviewItem.filePath}`);
              await vscode.commands.executeCommand(
                'vscode.diff',
                originalUri,
                proposedUri,
                `${vscode.workspace.asRelativePath(originalUri)} (Proposed Diff)`,
              );
            }
          }

          panelProvider.sendQueueUpdate();

          vscode.window
            .showInformationMessage(
              `TrueForge: Staged ${totalHunks} diff hunk(s) across ${multiReviews.length} file(s). Review in diff view or click Accept All.`,
              'Accept All',
              'Reject All',
            )
            .then(async (action) => {
              if (action === 'Accept All') {
                await stagingBuffer.acceptAllInAllQueued();
                vscode.window.showInformationMessage('TrueForge: All changes accepted and applied.');
              } else if (action === 'Reject All') {
                stagingBuffer.clearAllPendingWithCancelledStatus();
                vscode.window.showInformationMessage('TrueForge: Changes rejected.');
              }
            });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`TrueForge turn error: ${msg}`);
      panelProvider.postMessage({
        type: 'stream:event',
        event: { type: 'error', message: msg },
      });
    } finally {
      panelProvider.setGenerating(false);
      panelProvider.postMessage({
        type: 'stream:event',
        event: { type: 'turn_complete' },
      });
      panelProvider.broadcastStatus().catch(() => {});
    }
  }

  // 5. Initialize Webview Provider
  const panelProvider = new PanelProvider(
    context,
    client,
    stagingBuffer,
    undoStack,
    ledgerTracker,
    async (prompt, mode) => {
      await runTurn(prompt, mode);
    },
    modelSwitcher,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('trueforge.agentPanel', panelProvider),
  );

  // 6. Register Commands
  context.subscriptions.push(
    // Inline Edit (Ctrl+K)
    vscode.commands.registerCommand('trueforge.inlineEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor to perform inline edit on.');
        return;
      }

      const instruction = await vscode.window.showInputBox({
        prompt: 'Forge Inline Edit: Describe the change (supports @file and @symbol)',
        placeHolder: 'e.g. Treat the values "off" and "n" as false as well, case-insensitively...',
        ignoreFocusOut: true,
      });

      if (!instruction || !instruction.trim()) {
        return;
      }

      await runTurn(instruction.trim(), 'inline-edit', editor);
    }),

    // Stop Generation
    vscode.commands.registerCommand('trueforge.stopGeneration', async () => {
      const sessionId = client.currentSessionId;
      if (sessionId) {
        await client.cancelSession(sessionId);
      }
      stagingBuffer.clearAllPendingWithCancelledStatus();
      panelProvider.setGenerating(false);
      vscode.window.showInformationMessage('TrueForge generation cancelled.');
    }),

    // Undo Last Turn
    vscode.commands.registerCommand('trueforge.undoLastTurn', async () => {
      const success = await undoStack.undoLastTurn();
      if (success) {
        vscode.window.showInformationMessage('Reverted last TrueForge turn.');
        panelProvider.sendQueueUpdate();
      } else {
        vscode.window.showWarningMessage('No TrueForge turn checkpoints to undo.');
      }
    }),

    // Accept Hunk
    vscode.commands.registerCommand('trueforge.acceptHunk', async (hunkId: string) => {
      await stagingBuffer.acceptHunk(hunkId);
    }),

    // Reject Hunk
    vscode.commands.registerCommand('trueforge.rejectHunk', async (hunkId: string) => {
      await stagingBuffer.rejectHunk(hunkId);
    }),

    // Accept File
    vscode.commands.registerCommand('trueforge.acceptFile', async () => {
      await stagingBuffer.acceptAllInActive();
    }),

    // Reject File
    vscode.commands.registerCommand('trueforge.rejectFile', async () => {
      await stagingBuffer.rejectAllInActive();
    }),

    // Toggle Native Diff
    vscode.commands.registerCommand(
      'trueforge.toggleNativeDiff',
      async (fileId: string, hunkIndex?: number) => {
        const review = stagingBuffer.getActiveReview();
        if (!review) return;

        const originalUri = vscode.Uri.file(review.filePath);
        const proposedUri = vscode.Uri.parse(`trueforge-diff:${review.filePath}`);

        await vscode.commands.executeCommand(
          'vscode.diff',
          originalUri,
          proposedUri,
          `${vscode.workspace.asRelativePath(originalUri)} (Proposed Changes)`,
        );
      },
    ),

    // Switch Active Model QuickPick
    vscode.commands.registerCommand('trueforge.switchActiveModel', async () => {
      await modelSwitcher.promptModelQuickPick();
    }),
  );

  console.log('[TrueForge] Extension successfully activated.');
}

export async function deactivate() {
  console.log('[TrueForge] Deactivating extension...');
}
