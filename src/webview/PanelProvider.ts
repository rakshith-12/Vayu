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
import type { ModelSwitcher } from '../trueforge/modelSwitcher';
import { buildInlineEditContext } from '../context/budgetAssembler';

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private isGenerating = false;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: TrueForgeClient,
    private readonly stagingBuffer: StagingBuffer,
    private readonly undoStack: UndoCheckpointStack,
    private readonly ledgerTracker: ContextLedgerTracker,
    private readonly onStartTurn: (prompt: string, mode: ExecutionMode) => Promise<void>,
    private readonly modelSwitcher?: ModelSwitcher,
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

    // Listen to model switches
    this.modelSwitcher?.onDidChangeModel(() => {
      this.broadcastStatus().catch(() => {});
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

    webviewView.onDidDispose(() => {
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = undefined;
      }
    });

    // Send initial states
    this.sendQueueUpdate();
    this.postMessage({
      type: 'ledger:updated',
      ledger: this.ledgerTracker.getSnapshot(),
    });

    // Broadcast initial server and model health
    this.broadcastStatus().catch(() => {});

    // Polling server & model health check every 8 seconds
    if (!this.healthCheckTimer) {
      this.healthCheckTimer = setInterval(() => {
        this.broadcastStatus().catch(() => {});
      }, 8000);
    }
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

      case 'user:switch_model':
        if (msg.modelId && this.modelSwitcher) {
          this.modelSwitcher.setActiveModel(msg.modelId);
          await this.broadcastStatus();
        } else if (this.modelSwitcher) {
          const chosen = await this.modelSwitcher.promptModelQuickPick();
          if (chosen) {
            await this.broadcastStatus();
          }
        }
        break;

      case 'user:refresh_status':
        await this.broadcastStatus();
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

  /**
   * Broadcast live Server and Model health status to the webview UI.
   */
  async broadcastStatus(): Promise<void> {
    const config = vscode.workspace.getConfiguration('trueforge');
    const serverUrl = config.get<string>('serverUrl') || 'http://localhost:3000';
    let serverOnline = false;
    let modelOnline = false;
    let availableModels: Array<{ id: string; name: string }> = [
      { id: 'google-gemini/gemini-3-5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
      { id: 'google-gemini/gemini-3-1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
    ];

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1800);
      const res = await fetch(`${serverUrl}/api/v1/sessions`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok || res.status === 401 || res.status === 403) {
        serverOnline = true;
      }
    } catch {
      serverOnline = false;
    }

    try {
      if (serverOnline) {
        const models = await this.client.listModels();
        if (models && models.length > 0) {
          availableModels = models;
          modelOnline = true;
        } else {
          modelOnline = true;
        }
      }
    } catch {
      modelOnline = serverOnline;
    }

    const rawModel = this.modelSwitcher?.getActiveModel() || 'gemini-3.5-flash-lite';
    const activeModel = rawModel.includes('/') ? rawModel.split('/').pop()! : rawModel;

    this.postMessage({
      type: 'status:updated',
      serverOnline,
      serverUrl,
      modelOnline: serverOnline && modelOnline,
      activeModel,
      availableModels,
    });
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
      --bg: var(--vscode-sideBar-background, #141418);
      --surface-1: color-mix(in srgb, var(--vscode-editorWidget-background, #1c1c23) 90%, rgba(255, 255, 255, 0.03));
      --surface-2: color-mix(in srgb, var(--vscode-input-background, #22222b) 94%, transparent);
      --surface-hover: rgba(255, 255, 255, 0.06);
      --glass-bg: color-mix(in srgb, var(--vscode-sideBar-background, #141418) 82%, rgba(28, 30, 42, 0.72));
      --fg: var(--vscode-sideBar-foreground, #f4f4f5);
      --fg-muted: var(--vscode-descriptionForeground, #a1a1aa);
      --fg-subtle: color-mix(in srgb, var(--fg-muted) 72%, transparent);
      --border: var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
      --border-subtle: var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
      --border-highlight: rgba(255, 255, 255, 0.14);
      --border-focus: rgba(59, 130, 246, 0.55);
      --input-bg: var(--vscode-input-background, #1a1a22);
      --input-fg: var(--vscode-input-foreground, #fafafa);
      --card-bg: var(--surface-1);
      --card-border: var(--border-subtle);
      --btn-primary-bg: var(--vscode-button-background, #3b82f6);
      --btn-primary-fg: var(--vscode-button-foreground, #ffffff);
      --btn-primary-hover: var(--vscode-button-hoverBackground, #2563eb);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.07));
      --btn-sec-fg: var(--vscode-button-secondaryForeground, #e4e4e7);
      --btn-sec-hover: rgba(255, 255, 255, 0.13);
      --accent-primary: #3b82f6;
      --accent-indigo: #6366f1;
      --accent-blue: #3b82f6;
      --accent-blue-bg: rgba(59, 130, 246, 0.14);
      --accent-green: #10b981;
      --accent-green-bg: rgba(16, 185, 129, 0.14);
      --accent-red: #ef4444;
      --accent-red-bg: rgba(239, 68, 68, 0.14);
      --accent-amber: #f59e0b;
      --accent-amber-bg: rgba(245, 158, 11, 0.14);
      --diff-del-bg: rgba(239, 68, 68, 0.12);
      --diff-del-fg: #fca5a5;
      --diff-add-bg: rgba(16, 185, 129, 0.12);
      --diff-add-fg: #6ee7b7;
      --inner-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.05);
      --radius-xs: 4px;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 12px;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.22), 0 1px 4px rgba(0, 0, 0, 0.14);
      --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.34), 0 2px 6px rgba(0, 0, 0, 0.22);
      --shadow-glow: 0 0 0 3px rgba(59, 130, 246, 0.16);
    }

    body.vscode-light {
      --surface-1: color-mix(in srgb, var(--vscode-editorWidget-background, #ffffff) 92%, rgba(0, 0, 0, 0.02));
      --surface-2: color-mix(in srgb, var(--vscode-input-background, #f4f4f5) 96%, transparent);
      --surface-hover: rgba(0, 0, 0, 0.045);
      --glass-bg: color-mix(in srgb, var(--vscode-sideBar-background, #f8fafc) 88%, rgba(255, 255, 255, 0.85));
      --border-subtle: var(--vscode-widget-border, rgba(15, 23, 42, 0.1));
      --border-highlight: rgba(15, 23, 42, 0.18);
      --btn-sec-bg: rgba(15, 23, 42, 0.05);
      --btn-sec-fg: #1e293b;
      --btn-sec-hover: rgba(15, 23, 42, 0.09);
      --diff-del-bg: rgba(239, 68, 68, 0.1);
      --diff-del-fg: #b91c1c;
      --diff-add-bg: rgba(16, 185, 129, 0.1);
      --diff-add-fg: #047857;
      --inner-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.7);
      --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04);
      --shadow-md: 0 8px 20px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06);
    }

    body.vscode-high-contrast {
      --border-subtle: var(--vscode-contrastBorder, rgba(255, 255, 255, 0.45));
      --border-highlight: var(--vscode-contrastActiveBorder, #ffffff);
      --shadow-sm: none;
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
      -webkit-font-smoothing: antialiased;
    }

    /* Header Bar */
    .app-header {
      position: relative;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--glass-bg);
      border-bottom: 1px solid var(--border-subtle);
      box-shadow: var(--inner-highlight);
      backdrop-filter: blur(10px);
      flex-shrink: 0;
      z-index: 10;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }

    .brand-icon-box {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-indigo));
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .brand-logo {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: #ffffff;
      stroke-width: 2.1;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .brand-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 1px;
    }

    .brand-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .brand-name {
      font-weight: 650;
      font-size: 12.5px;
      letter-spacing: -0.02em;
      color: var(--fg);
      line-height: 1.15;
    }

    .brand-subtitle {
      font-size: 10px;
      color: var(--fg-subtle);
      letter-spacing: 0.01em;
      line-height: 1.15;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 1px 7px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 500;
      background: var(--accent-green-bg);
      color: var(--accent-green);
      border: 1px solid color-mix(in srgb, var(--accent-green) 26%, transparent);
    }

    body.vscode-light .status-pill {
      color: #047857;
    }

    .status-dot {
      position: relative;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-green);
      box-shadow: 0 0 6px var(--accent-green);
      flex-shrink: 0;
    }

    .status-dot.pulsing::after {
      content: '';
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      border: 1.5px solid var(--accent-green);
      opacity: 0;
      animation: pulse-ring 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
    }

    .status-dot.generating {
      background: var(--accent-primary);
      box-shadow: 0 0 8px var(--accent-primary);
    }

    .status-dot.generating::after {
      border-color: var(--accent-primary);
      animation-duration: 1.1s;
    }

    @keyframes pulse-ring {
      0% { transform: scale(0.75); opacity: 0.7; }
      70% { transform: scale(1.75); opacity: 0; }
      100% { transform: scale(1.75); opacity: 0; }
    }

    .model-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 160px;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      font-size: 10.5px;
      font-weight: 550;
      background: var(--accent-blue-bg);
      color: #93c5fd;
      border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
      box-shadow: var(--inner-highlight);
      cursor: pointer;
      transition: all 0.16s ease;
      flex-shrink: 0;
    }

    body.vscode-light .model-chip {
      color: #1d4ed8;
    }

    .model-chip:hover {
      background: color-mix(in srgb, var(--accent-primary) 22%, transparent);
      border-color: color-mix(in srgb, var(--accent-primary) 50%, transparent);
      transform: translateY(-0.5px);
    }

    .model-chip:active {
      transform: translateY(0);
    }

    #model-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ui-toast {
      position: absolute;
      top: 52px;
      right: 12px;
      left: 12px;
      padding: 7px 10px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      border: 1px solid var(--border-highlight);
      box-shadow: var(--shadow-md);
      color: var(--fg);
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-6px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      z-index: 25;
    }

    .ui-toast.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    /* Main Scrollable Canvas */
    #main-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    #main-content::-webkit-scrollbar {
      width: 5px;
    }
    #main-content::-webkit-scrollbar-track {
      background: transparent;
    }
    #main-content::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.22);
      border-radius: 9999px;
    }
    #main-content::-webkit-scrollbar-thumb:hover {
      background: rgba(148, 163, 184, 0.36);
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius-md);
      padding: 11px 12px;
      box-shadow: var(--shadow-sm), var(--inner-highlight);
      backdrop-filter: blur(8px);
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }

    .card:hover {
      border-color: var(--border-highlight);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 9px;
      flex-wrap: wrap;
    }

    .card-title {
      font-weight: 650;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.055em;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .title-icon {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .title-icon.indigo {
      background: rgba(99, 102, 241, 0.16);
      color: #818cf8;
    }

    .title-icon.blue {
      background: var(--accent-blue-bg);
      color: #60a5fa;
    }

    .title-icon.emerald {
      background: var(--accent-green-bg);
      color: #34d399;
    }

    body.vscode-light .title-icon.indigo { color: #4f46e5; }
    body.vscode-light .title-icon.blue { color: #2563eb; }
    body.vscode-light .title-icon.emerald { color: #059669; }

    /* Context Ledger Progress */
    .ledger-meta {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .ledger-stats {
      font-size: 10.5px;
      font-weight: 500;
      color: var(--fg-muted);
      font-variant-numeric: tabular-nums;
    }

    .pct-pill {
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      padding: 1px 6px;
      border-radius: 9999px;
      background: var(--surface-hover);
      border: 1px solid var(--border-subtle);
      color: var(--fg-muted);
    }

    .progress-track {
      height: 6px;
      background: rgba(148, 163, 184, 0.14);
      border-radius: 9999px;
      overflow: hidden;
      margin: 2px 0 9px;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.22);
    }

    .progress-fill {
      height: 100%;
      width: 0%;
      border-radius: 9999px;
      background: linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6);
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.45);
      transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease;
    }

    .progress-fill.warn {
      background: linear-gradient(90deg, #f59e0b, #f97316);
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.45);
    }

    .progress-fill.danger {
      background: linear-gradient(90deg, #ef4444, #f43f5e);
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
    }

    .ledger-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 11px;
      color: var(--fg-muted);
    }

    .empty-inline {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 7px 9px;
      border-radius: var(--radius-sm);
      background: rgba(148, 163, 184, 0.05);
      border: 1px dashed var(--border-subtle);
      color: var(--fg-subtle);
      font-size: 11px;
    }

    .slice-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      border: 1px solid var(--border-subtle);
      transition: border-color 0.15s ease, background 0.15s ease;
    }

    .slice-row:hover {
      border-color: var(--border-highlight);
    }

    .slice-row.pinned {
      border-color: color-mix(in srgb, var(--accent-primary) 38%, transparent);
      background: color-mix(in srgb, var(--accent-primary) 7%, var(--surface-2));
    }

    .slice-main {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      flex: 1;
    }

    .slice-rationale {
      font-size: 11px;
      font-weight: 500;
      color: var(--fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .slice-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
    }

    .meta-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 5px;
      border-radius: var(--radius-xs);
      font-size: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      background: rgba(148, 163, 184, 0.1);
      color: var(--fg-muted);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta-pill.tokens {
      font-family: inherit;
      font-variant-numeric: tabular-nums;
      color: #93c5fd;
      background: var(--accent-blue-bg);
    }

    body.vscode-light .meta-pill.tokens {
      color: #1d4ed8;
    }

    .btn-pin {
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 600;
      border-radius: var(--radius-xs);
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
      border: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }

    .btn-pin:hover {
      background: var(--btn-sec-hover);
      border-color: var(--border-highlight);
    }

    .btn-pin.active {
      background: var(--accent-blue-bg);
      color: #93c5fd;
      border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
    }

    body.vscode-light .btn-pin.active {
      color: #1d4ed8;
    }

    .toc-section {
      margin-top: 6px;
      padding-top: 8px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .toc-heading {
      font-size: 10.5px;
      font-weight: 650;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .toc-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-radius: var(--radius-sm);
      background: rgba(245, 158, 11, 0.06);
      border: 1px solid rgba(245, 158, 11, 0.16);
    }

    .toc-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 2px;
    }

    .toc-symbol {
      font-size: 11px;
      font-weight: 600;
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .btn-promote {
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 600;
      border-radius: var(--radius-xs);
      background: var(--accent-green-bg);
      color: #34d399;
      border: 1px solid color-mix(in srgb, var(--accent-green) 35%, transparent);
      flex-shrink: 0;
    }

    body.vscode-light .btn-promote {
      color: #047857;
    }

    .btn-promote:hover {
      background: color-mix(in srgb, var(--accent-green) 24%, transparent);
    }

    /* Diff Review Drawer */
    #diff-card {
      border-left: 3px solid var(--accent-primary);
      box-shadow: var(--shadow-sm), 0 0 18px rgba(59, 130, 246, 0.08), var(--inner-highlight);
      animation: slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slide-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .hunks-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .hunk-item {
      background: var(--surface-2);
      border: 1px solid var(--border-subtle);
      border-left: 3px solid var(--accent-primary);
      border-radius: var(--radius-sm);
      padding: 9px 10px;
      transition: all 0.16s ease;
    }

    .hunk-item:hover {
      border-color: var(--border-highlight);
      border-left-color: var(--accent-primary);
    }

    .hunk-item.accepted {
      border-left-color: var(--accent-green);
      background: color-mix(in srgb, var(--accent-green) 8%, var(--surface-2));
    }

    .hunk-item.rejected {
      border-left-color: var(--accent-red);
      background: color-mix(in srgb, var(--accent-red) 7%, var(--surface-2));
      opacity: 0.68;
    }

    .hunk-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 5px;
    }

    .hunk-loc-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--fg);
      padding: 2px 5px;
      margin-left: -5px;
      font-size: 11px;
      font-weight: 600;
      border-radius: var(--radius-xs);
    }

    .hunk-loc-btn:hover {
      background: var(--surface-hover);
      border-color: var(--border-subtle);
      color: #93c5fd;
    }

    body.vscode-light .hunk-loc-btn:hover {
      color: #1d4ed8;
    }

    .hunk-lines-pill {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      font-weight: 500;
      color: var(--fg-muted);
      padding: 1px 5px;
      border-radius: var(--radius-xs);
      background: rgba(148, 163, 184, 0.12);
    }

    .hunk-badges {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }

    .lsp-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 6px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 600;
    }

    .lsp-pill.ok {
      background: var(--accent-green-bg);
      color: #34d399;
      border: 1px solid color-mix(in srgb, var(--accent-green) 28%, transparent);
    }

    .lsp-pill.warn {
      background: var(--accent-amber-bg);
      color: #fbbf24;
      border: 1px solid color-mix(in srgb, var(--accent-amber) 30%, transparent);
    }

    body.vscode-light .lsp-pill.ok { color: #047857; }
    body.vscode-light .lsp-pill.warn { color: #b45309; }

    /* Shared Badge Utility Classes */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 7px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
      background: rgba(148, 163, 184, 0.14);
      color: var(--fg-muted);
      border: 1px solid var(--border-subtle);
    }

    .badge.green {
      background: var(--accent-green-bg);
      color: #34d399;
      border-color: color-mix(in srgb, var(--accent-green) 32%, transparent);
    }

    .badge.red {
      background: var(--accent-red-bg);
      color: #f87171;
      border-color: color-mix(in srgb, var(--accent-red) 32%, transparent);
    }

    .badge.amber {
      background: var(--accent-amber-bg);
      color: #fbbf24;
      border-color: color-mix(in srgb, var(--accent-amber) 32%, transparent);
    }

    .badge.blue {
      background: var(--accent-blue-bg);
      color: #93c5fd;
      border-color: color-mix(in srgb, var(--accent-primary) 32%, transparent);
    }

    body.vscode-light .badge.green { color: #047857; }
    body.vscode-light .badge.red { color: #b91c1c; }
    body.vscode-light .badge.amber { color: #b45309; }
    body.vscode-light .badge.blue { color: #1d4ed8; }

    .hunk-rationale {
      font-size: 11px;
      color: var(--fg-muted);
      margin-bottom: 7px;
      line-height: 1.4;
    }

    .hunk-diff-preview {
      border-radius: var(--radius-xs);
      border: 1px solid var(--border-subtle);
      background: var(--input-bg);
      font-family: var(--vscode-editor-font-family, 'Fira Code', 'Consolas', monospace);
      font-size: 10.5px;
      line-height: 1.45;
      overflow-x: auto;
      margin-bottom: 8px;
    }

    .diff-line {
      padding: 1px 8px;
      white-space: pre;
      display: block;
    }

    .diff-line.del {
      background: var(--diff-del-bg);
      color: var(--diff-del-fg);
    }

    .diff-line.add {
      background: var(--diff-add-bg);
      color: var(--diff-add-fg);
    }

    .diff-line.more {
      color: var(--fg-subtle);
      font-style: italic;
      font-size: 10px;
      border-top: 1px solid var(--border-subtle);
    }

    .hunk-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* Agent Stream Terminal */
    .stream-card {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 160px;
    }

    .stream-header-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stream-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 600;
      border: 1px solid var(--border-subtle);
      background: rgba(148, 163, 184, 0.1);
      color: var(--fg-muted);
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stream-status-pill::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.7;
      flex-shrink: 0;
    }

    .stream-status-pill.status-running {
      background: var(--accent-blue-bg);
      border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
      color: #60a5fa;
    }

    .stream-status-pill.status-running::before {
      width: 8px;
      height: 8px;
      background: transparent;
      border: 1.5px solid currentColor;
      border-top-color: transparent;
      opacity: 1;
      animation: spin 0.75s linear infinite;
    }

    .stream-status-pill.status-done {
      background: var(--accent-green-bg);
      border-color: color-mix(in srgb, var(--accent-green) 32%, transparent);
      color: #34d399;
    }

    .stream-status-pill.status-error {
      background: var(--accent-red-bg);
      border-color: color-mix(in srgb, var(--accent-red) 34%, transparent);
      color: #f87171;
    }

    body.vscode-light .stream-status-pill.status-running { color: #2563eb; }
    body.vscode-light .stream-status-pill.status-done { color: #047857; }
    body.vscode-light .stream-status-pill.status-error { color: #b91c1c; }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .icon-btn {
      width: 24px;
      height: 24px;
      padding: 0;
      border-radius: var(--radius-xs);
      background: transparent;
      border: 1px solid transparent;
      color: var(--fg-muted);
    }

    .icon-btn:hover {
      background: var(--surface-hover);
      border-color: var(--border-subtle);
      color: var(--fg);
    }

    .icon-btn.copied {
      color: var(--accent-green);
      border-color: color-mix(in srgb, var(--accent-green) 35%, transparent);
      background: var(--accent-green-bg);
    }

    .stream-shell {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--input-bg);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.16);
      overflow: hidden;
      min-height: 112px;
    }

    .stream-empty {
      padding: 14px 12px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 9px;
      color: var(--fg-muted);
    }

    .stream-empty.hidden {
      display: none;
    }

    .stream-empty-title {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11.5px;
      font-weight: 500;
      color: var(--fg);
    }

    .stream-empty-hint {
      font-size: 11px;
      color: var(--fg-subtle);
      line-height: 1.4;
    }

    .quick-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .quick-chip {
      padding: 4px 9px;
      font-size: 10.5px;
      font-weight: 500;
      border-radius: 9999px;
      background: var(--surface-1);
      color: var(--fg-muted);
      border: 1px solid var(--border-subtle);
    }

    .quick-chip:hover {
      background: var(--accent-blue-bg);
      color: var(--fg);
      border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
    }

    .stream-container {
      flex: 1;
      padding: 10px 12px;
      max-height: 300px;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family, 'Fira Code', 'Consolas', monospace);
      font-size: 11.5px;
      line-height: 1.55;
      color: var(--fg);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .stream-container:empty {
      display: none;
    }

    .stream-container::-webkit-scrollbar {
      width: 4px;
    }
    .stream-container::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.22);
      border-radius: 9999px;
    }

    /* Buttons */
    button {
      font-family: inherit;
      font-size: 11px;
      font-weight: 550;
      border: 1px solid transparent;
      padding: 5px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
    }

    button:focus-visible {
      outline: 2px solid var(--accent-primary);
      outline-offset: 1px;
    }

    button:active {
      transform: scale(0.98);
    }

    .btn-sm {
      padding: 4px 9px;
      font-size: 10.5px;
    }

    .btn-xs {
      padding: 3px 8px;
      font-size: 10.5px;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-indigo));
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.22);
    }

    .btn-primary:hover {
      filter: brightness(1.08);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .btn-sec,
    .secondary {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
      border: 1px solid var(--border-subtle);
    }

    .btn-sec:hover,
    .secondary:hover {
      background: var(--btn-sec-hover);
      border-color: var(--border-highlight);
    }

    .btn-green {
      background: #059669;
      color: #ffffff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }

    .btn-green:hover {
      background: #047857;
    }

    .btn-red {
      background: #dc2626;
      color: #ffffff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
    }

    .btn-red:hover {
      background: #b91c1c;
    }

    .btn-stop {
      background: var(--accent-red-bg);
      color: #f87171;
      border: 1px solid color-mix(in srgb, var(--accent-red) 38%, transparent);
    }

    body.vscode-light .btn-stop {
      color: #b91c1c;
    }

    .btn-stop:hover {
      background: color-mix(in srgb, var(--accent-red) 24%, transparent);
    }

    /* Composer Dock */
    #input-section {
      position: relative;
      padding: 10px 12px 12px;
      background: var(--glass-bg);
      border-top: 1px solid var(--border-subtle);
      backdrop-filter: blur(10px);
      flex-shrink: 0;
    }

    .mention-popover {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: calc(100% - 4px);
      max-height: 190px;
      overflow-y: auto;
      background: var(--surface-2);
      border: 1px solid var(--border-highlight);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      padding: 4px;
      display: none;
      flex-direction: column;
      gap: 2px;
      z-index: 30;
    }

    .mention-popover.open {
      display: flex;
    }

    .mention-header {
      padding: 3px 7px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--fg-subtle);
    }

    .mention-item {
      width: 100%;
      justify-content: space-between;
      text-align: left;
      padding: 5px 8px;
      border-radius: var(--radius-xs);
      background: transparent;
      color: var(--fg);
      font-size: 11px;
    }

    .mention-item:hover,
    .mention-item.selected {
      background: var(--accent-blue-bg);
      color: var(--fg);
    }

    .mention-item-name {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 550;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mention-item-path {
      font-size: 10px;
      color: var(--fg-subtle);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 55%;
    }

    .composer-box {
      display: flex;
      flex-direction: column;
      background: var(--input-bg);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      box-shadow: var(--inner-highlight), var(--shadow-sm);
      transition: border-color 0.16s ease, box-shadow 0.16s ease;
      overflow: hidden;
    }

    .composer-box:focus-within {
      border-color: var(--border-focus);
      box-shadow: var(--shadow-glow), var(--inner-highlight);
    }

    textarea#prompt-input {
      width: 100%;
      background: transparent;
      color: var(--input-fg);
      border: none;
      padding: 10px 12px 6px;
      resize: none;
      min-height: 54px;
      max-height: 160px;
      font-family: inherit;
      font-size: 12px;
      line-height: 1.45;
      outline: none;
    }

    textarea#prompt-input::placeholder {
      color: var(--fg-subtle);
    }

    .composer-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 6px 8px 7px;
      border-top: 1px solid rgba(148, 163, 184, 0.08);
      background: rgba(148, 163, 184, 0.03);
    }

    .composer-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .composer-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .icon-btn-pill {
      padding: 3px 7px;
      border-radius: var(--radius-xs);
      font-size: 11px;
      font-weight: 600;
      background: var(--surface-1);
      color: var(--fg-muted);
      border: 1px solid var(--border-subtle);
    }

    .icon-btn-pill:hover {
      color: var(--fg);
      border-color: var(--border-highlight);
      background: var(--surface-hover);
    }

    .select-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    select#mode-select {
      appearance: none;
      background: var(--surface-1);
      color: var(--input-fg);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xs);
      padding: 4px 22px 4px 8px;
      font-size: 11px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      outline: none;
      transition: border-color 0.15s ease, background 0.15s ease;
    }

    select#mode-select:hover,
    select#mode-select:focus {
      border-color: var(--border-highlight);
    }

    .select-chevron {
      position: absolute;
      right: 6px;
      pointer-events: none;
      color: var(--fg-muted);
    }

    .shortcut-hint {
      font-size: 10px;
      color: var(--fg-subtle);
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    kbd {
      background: rgba(148, 163, 184, 0.12);
      border: 1px solid var(--border-subtle);
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 9.5px;
      font-family: inherit;
      color: var(--fg-muted);
    }

    @media (max-width: 310px) {
      .shortcut-hint,
      .brand-subtitle {
        display: none;
      }
      .model-chip {
        max-width: 115px;
      }
    }
  </style>
</head>
<body>
  <header class="app-header">
    <div class="brand">
      <div class="brand-icon-box" aria-hidden="true">
        <svg class="brand-logo" viewBox="0 0 24 24">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div class="brand-text">
        <div class="brand-title-row">
          <span class="brand-name">TrueForge</span>
          <div class="status-pill">
            <span class="status-dot pulsing" id="status-dot"></span>
            <span id="session-badge">Connected</span>
          </div>
        </div>
        <span class="brand-subtitle">Editor-Native Coding Agent</span>
      </div>
    </div>
    <button id="model-badge" type="button" class="model-chip" title="Active model • Run 'Forge: Switch Active Model' in Command Palette">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <span id="model-label">gemini-3.5-flash</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <div id="ui-toast" class="ui-toast" role="status" aria-live="polite"></div>
  </header>

  <main id="main-content">
    <!-- Context Ledger Card -->
    <section class="card" id="ledger-card">
      <div class="card-header">
        <div class="card-title">
          <span class="title-icon indigo" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </span>
          Context Ledger
        </div>
        <div class="ledger-meta">
          <span class="ledger-stats" id="token-usage">0 / 16,000 tokens</span>
          <span class="pct-pill" id="token-pct">0%</span>
        </div>
      </div>
      <div class="progress-track">
        <div id="token-bar" class="progress-fill"></div>
      </div>
      <div id="ledger-slices" class="ledger-list">
        <div class="empty-inline">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>No active context slices yet</span>
        </div>
      </div>
    </section>

    <!-- Active Diff Review Drawer -->
    <section class="card" id="diff-card" style="display: none;">
      <div class="card-header">
        <div class="card-title" style="color: var(--fg);">
          <span class="title-icon blue" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>
            </svg>
          </span>
          <span id="review-title">Staged Edits</span>
        </div>
        <div class="header-actions">
          <button id="btn-accept-all" class="btn-green btn-sm">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Accept All
          </button>
          <button id="btn-reject-all" class="btn-red btn-sm">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Reject All
          </button>
        </div>
      </div>
      <div id="hunks-list" class="hunks-list"></div>
    </section>

    <!-- Agent Output & Streaming -->
    <section class="card stream-card">
      <div class="card-header">
        <div class="card-title">
          <span class="title-icon emerald" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </span>
          Agent Stream
        </div>
        <div class="stream-header-right">
          <span id="stream-status" class="stream-status-pill status-idle">Idle</span>
          <button id="btn-copy-stream" class="icon-btn" type="button" title="Copy stream output" aria-label="Copy stream output">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button id="btn-clear-stream" class="icon-btn" type="button" title="Clear stream output" aria-label="Clear stream output">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="stream-shell">
        <div id="stream-empty" class="stream-empty">
          <div class="stream-empty-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" aria-hidden="true">
              <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/>
            </svg>
            <span>Ready for instructions</span>
          </div>
          <p class="stream-empty-hint">
            Describe an edit or ask about your workspace. Use <code>@file</code> or <code>@symbol</code> to target context.
          </p>
          <div class="quick-chips">
            <button type="button" class="quick-chip" data-prompt="Explain the active selection and edge cases">Explain selection</button>
            <button type="button" class="quick-chip" data-prompt="Add unit tests covering edge cases for ">Add unit tests</button>
            <button type="button" class="quick-chip" data-prompt="Refactor for readability without changing behavior">Refactor cleanly</button>
          </div>
        </div>
        <div id="chat-stream" class="stream-container"></div>
      </div>
    </section>
  </main>

  <footer id="input-section">
    <div id="mention-popover" class="mention-popover" role="listbox" aria-label="Workspace file mentions"></div>
    <div class="composer-box">
      <textarea id="prompt-input" rows="2" placeholder="Ask anything or describe changes... (type @ for files)"></textarea>
      <div class="composer-footer">
        <div class="composer-left">
          <button id="btn-mention" type="button" class="icon-btn-pill" title="Mention workspace file (@)">@</button>
          <div class="select-wrap">
            <select id="mode-select" title="Execution Mode">
              <option value="inline-edit">Inline Edit (Mode 1)</option>
              <option value="agent-mode">Agent Mode (Mode 2)</option>
            </select>
            <svg class="select-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        <div class="composer-right">
          <span class="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>↵</kbd></span>
          <button id="btn-stop" type="button" class="btn-stop" style="display: none;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
            Stop
          </button>
          <button id="btn-submit" type="button" class="btn-primary">
            <span>Send</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </footer>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
