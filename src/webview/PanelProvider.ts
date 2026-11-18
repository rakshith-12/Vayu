/**
 * @file PanelProvider.ts
 * @description WebviewViewProvider and typed postMessage IPC bridge connecting
 *              the React / HTML webview UI to the extension host.
 */

import * as vscode from 'vscode';
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
  StagedFileReview,
  ExecutionMode,
  ContextLedgerSnapshot,
} from '../types/contracts';
import type { TrueForgeClient } from '../trueforge/client';
import type { StagingBuffer } from '../diff/stagingBuffer';
import type { UndoCheckpointStack } from '../diff/undoStack';
import type { ContextLedgerTracker } from '../context/ledgerTracker';
import { buildInlineEditContext } from '../context/budgetAssembler';

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private isGenerating = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: TrueForgeClient,
    private readonly stagingBuffer: StagingBuffer,
    private readonly undoStack: UndoCheckpointStack,
    private readonly ledgerTracker: ContextLedgerTracker,
    private readonly onStartTurn: (prompt: string, mode: ExecutionMode) => Promise<void>,
  ) {
    // Forward staging buffer queue updates to webview
    this.stagingBuffer.onDidChangeQueue(() => {
      this.sendQueueUpdate();
    });

    // Forward ledger updates to webview
    this.ledgerTracker.onDidUpdateLedger((snapshot: ContextLedgerSnapshot) => {
      this.postMessage({
        type: 'ledger:updated',
        ledger: snapshot,
      });
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewToHostMessage) => {
      await this.handleWebviewMessage(msg);
    });

    // Send initial states
    this.sendQueueUpdate();
    this.postMessage({
      type: 'ledger:updated',
      ledger: this.ledgerTracker.getSnapshot(),
    });
  }

  private async handleWebviewMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'user:submit_turn':
        await this.onStartTurn(msg.prompt, msg.mode);
        break;

      case 'user:stop_generation':
        await vscode.commands.executeCommand('trueforge.stopGeneration');
        break;

      case 'user:hunk_decision':
        if (msg.decision === 'accepted') {
          await this.stagingBuffer.acceptHunk(msg.hunkId);
        } else {
          await this.stagingBuffer.rejectHunk(msg.hunkId);
        }
        break;

      case 'user:file_decision':
        if (msg.decision === 'accept_all') {
          await this.stagingBuffer.acceptAllInAllQueued();
        } else {
          this.stagingBuffer.clearAllPendingWithCancelledStatus();
        }
        break;

      case 'user:toggle_native_diff':
        await vscode.commands.executeCommand('trueforge.toggleNativeDiff', msg.fileId, msg.hunkIndex);
        break;

      case 'user:pin_slice':
        this.ledgerTracker.pinSlice(msg.sliceId, msg.pinned);
        break;

      case 'user:promote_toc': {
        const entry = this.ledgerTracker.getTocEntry(msg.tocEntryId);
        if (entry) {
          try {
            const uri = vscode.Uri.file(entry.filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const startLine = Math.max(0, entry.startLine - 1);
            const endLine = Math.min(doc.lineCount - 1, entry.endLine - 1);
            const content = doc.getText(
              new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).range.end.character),
            );
            this.ledgerTracker.promoteToc(msg.tocEntryId, content);
          } catch {
            // ignore
          }
        }
        break;
      }

      case 'user:reveal_hunk':
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.filePath));
          const editor = await vscode.window.showTextDocument(doc, { preview: false });
          const targetLine = Math.max(0, msg.line - 1);
          editor.revealRange(
            new vscode.Range(targetLine, 0, targetLine, 0),
            vscode.TextEditorRevealType.InCenter,
          );
        } catch {
          // ignore
        }
        break;

      case 'user:query_mentions':
        // Return files and symbols matching prefix
        try {
          const files = await vscode.workspace.findFiles(`**/*${msg.prefix}*`, '**/node_modules/**', 10);
          const results = files.map((f) => ({
            label: vscode.workspace.asRelativePath(f),
            filePath: f.fsPath,
            kind: 'file',
          }));
          this.postMessage({
            type: 'mentions:results',
            items: results,
          });
        } catch {
          // ignore
        }
        break;
    }
  }

  postMessage(message: HostToWebviewMessage): void {
    this.view?.webview.postMessage(message);
  }

  sendQueueUpdate(): void {
    this.postMessage({
      type: 'diff:queue_updated',
      activeReview: this.stagingBuffer.getActiveReview(),
      queuedCount: this.stagingBuffer.getQueuedCount(),
      canUndo: this.undoStack.canUndo(),
    });
  }

  setGenerating(isGenerating: boolean): void {
    this.isGenerating = isGenerating;
    vscode.commands.executeCommand('setContext', 'trueforge.isGenerating', isGenerating);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'index.js'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TrueForge Agent</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #18181b);
      --fg: var(--vscode-sideBar-foreground, #f4f4f5);
      --fg-muted: var(--vscode-descriptionForeground, #a1a1aa);
      --border: var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
      --input-bg: var(--vscode-input-background, #27272a);
      --input-fg: var(--vscode-input-foreground, #fafafa);
      --card-bg: var(--vscode-editorWidget-background, rgba(39, 39, 42, 0.65));
      --card-border: rgba(255, 255, 255, 0.08);
      --btn-primary-bg: var(--vscode-button-background, #3b82f6);
      --btn-primary-fg: var(--vscode-button-foreground, #ffffff);
      --btn-primary-hover: var(--vscode-button-hoverBackground, #2563eb);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
      --btn-sec-fg: var(--vscode-button-secondaryForeground, #e4e4e7);
      --btn-sec-hover: rgba(255, 255, 255, 0.14);
      --accent-green: #10b981;
      --accent-green-bg: rgba(16, 185, 129, 0.15);
      --accent-red: #ef4444;
      --accent-red-bg: rgba(239, 68, 68, 0.15);
      --accent-amber: #f59e0b;
      --accent-blue: #3b82f6;
      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.25);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 12px);
      color: var(--fg);
      background-color: var(--bg);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      line-height: 1.45;
    }

    /* Header Bar */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px 10px;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .brand-logo {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: var(--accent-blue);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .brand-name {
      font-weight: 600;
      font-size: 13px;
      letter-spacing: -0.2px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10.5px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.06);
      color: var(--fg-muted);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-green);
      box-shadow: 0 0 6px var(--accent-green);
    }

    .status-dot.pulsing {
      animation: pulse-glow 1.5s infinite;
    }

    @keyframes pulse-glow {
      0% { opacity: 0.4; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.1); }
      100% { opacity: 0.4; transform: scale(0.9); }
    }

    .model-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      background: rgba(59, 130, 246, 0.12);
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.25);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .model-chip:hover {
      background: rgba(59, 130, 246, 0.2);
      border-color: rgba(59, 130, 246, 0.4);
    }

    /* Main Scrollable Canvas */
    #main-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    #main-content::-webkit-scrollbar {
      width: 5px;
    }
    #main-content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 3px;
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius-md);
      padding: 12px;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(8px);
      transition: border-color 0.15s ease;
    }

    .card:hover {
      border-color: rgba(255, 255, 255, 0.14);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .card-title {
      font-weight: 600;
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Context Ledger Progress */
    .ledger-stats {
      font-size: 11px;
      font-weight: 500;
      color: var(--fg-muted);
    }

    .progress-track {
      height: 5px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      overflow: hidden;
      margin: 6px 0 8px;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #6366f1);
      width: 0%;
      border-radius: 9999px;
      transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .slice-tag {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.04);
      margin-top: 4px;
      font-size: 11px;
    }

    /* Diff Review Drawer */
    #diff-card {
      border-left: 3px solid var(--accent-blue);
      animation: slide-in 0.2s ease-out;
    }

    @keyframes slide-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .hunk-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-left: 3px solid #3b82f6;
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      margin-top: 8px;
      transition: all 0.15s ease;
    }

    .hunk-item.accepted {
      border-left-color: var(--accent-green);
      background: var(--accent-green-bg);
    }

    .hunk-item.rejected {
      border-left-color: var(--accent-red);
      background: var(--accent-red-bg);
      opacity: 0.65;
    }

    .hunk-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    /* Agent Stream Terminal */
    .stream-container {
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      min-height: 90px;
      max-height: 280px;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family, 'Fira Code', 'Consolas', monospace);
      font-size: 11.5px;
      line-height: 1.5;
      color: var(--fg);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .stream-container::-webkit-scrollbar {
      width: 4px;
    }
    .stream-container::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 2px;
    }

    /* Buttons */
    button {
      font-family: inherit;
      font-size: 11.5px;
      font-weight: 500;
      border: none;
      padding: 5px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    }

    button:focus-visible {
      outline: 2px solid var(--accent-blue);
      outline-offset: 1px;
    }

    .btn-primary {
      background: var(--btn-primary-bg);
      color: var(--btn-primary-fg);
    }
    .btn-primary:hover {
      background: var(--btn-primary-hover);
    }

    .btn-sec {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .btn-sec:hover {
      background: var(--btn-sec-hover);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .btn-green {
      background: #059669;
      color: #ffffff;
    }
    .btn-green:hover {
      background: #047857;
    }

    .btn-red {
      background: #dc2626;
      color: #ffffff;
    }
    .btn-red:hover {
      background: #b91c1c;
    }

    /* Input Section */
    #input-section {
      padding: 12px 14px;
      background: var(--bg);
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    .input-wrapper {
      position: relative;
    }

    textarea {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 10px 12px;
      resize: vertical;
      min-height: 64px;
      box-sizing: border-box;
      font-family: inherit;
      font-size: 12px;
      line-height: 1.4;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    textarea:focus {
      outline: none;
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .input-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    select {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 5px 8px;
      font-size: 11.5px;
      font-family: inherit;
      cursor: pointer;
      outline: none;
      transition: border-color 0.15s ease;
    }

    select:focus {
      border-color: var(--accent-blue);
    }

    .shortcut-hint {
      font-size: 10.5px;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 3px;
    }

    kbd {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 9.5px;
      font-family: inherit;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <svg class="brand-logo" viewBox="0 0 24 24">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
      <span class="brand-name">TrueForge</span>
      <div class="status-pill">
        <span class="status-dot pulsing" id="status-dot"></span>
        <span id="session-badge">Connected</span>
      </div>
    </div>
    <div id="model-badge" class="model-chip" title="Click to switch active model">
      <span>gemini-3.5-flash-lite</span>
    </div>
  </header>

  <div id="main-content">
    <!-- Context Ledger Card -->
    <div class="card" id="ledger-card">
      <div class="card-header">
        <div class="card-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          Context Ledger
        </div>
        <span class="ledger-stats" id="token-usage">0 / 16,000 tokens</span>
      </div>
      <div class="progress-track">
        <div id="token-bar" class="progress-fill"></div>
      </div>
      <div id="ledger-slices" style="font-size: 11px; color: var(--fg-muted);">
        No active context slices
      </div>
    </div>

    <!-- Active Diff Review Drawer -->
    <div class="card" id="diff-card" style="display: none;">
      <div class="card-header">
        <div class="card-title" style="color: var(--fg);">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>
          </svg>
          <span id="review-title">Staged Edits</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button id="btn-accept-all" class="btn-green">Accept All</button>
          <button id="btn-reject-all" class="btn-red">Reject All</button>
        </div>
      </div>
      <div id="hunks-list"></div>
    </div>

    <!-- Agent Output & Streaming -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
          Agent Stream
        </div>
        <span id="stream-status" class="ledger-stats">Idle</span>
      </div>
      <div id="chat-stream" class="stream-container">Awaiting instruction...</div>
    </div>
  </div>

  <div id="input-section">
    <div class="input-wrapper">
      <textarea id="prompt-input" placeholder="Ask question or describe changes... (supports @file and @symbol)"></textarea>
    </div>
    <div class="input-controls">
      <select id="mode-select" title="Execution Mode">
        <option value="inline-edit">Inline Edit (Mode 1)</option>
        <option value="agent-mode">Agent Mode (Mode 2)</option>
      </select>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span>
        <button id="btn-stop" class="btn-sec" style="display: none;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
          </svg>
          Stop
        </button>
        <button id="btn-submit" class="btn-primary">
          <span>Send</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;;
  }
}
