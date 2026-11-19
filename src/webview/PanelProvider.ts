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

    // Broadcast initial server & model status
    this.broadcastStatus().catch(() => {});

    // Periodic telemetry ping every 8s
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

      case 'user:switch_model':
        await vscode.commands.executeCommand('trueforge.switchActiveModel');
        await this.broadcastStatus();
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
      --bg: var(--vscode-sideBar-background, #12131a);
      --fg: var(--vscode-sideBar-foreground, #f3f4f6);
      --fg-muted: var(--vscode-descriptionForeground, #9ca3af);
      --border: var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
      --border-subtle: rgba(255, 255, 255, 0.05);
      --input-bg: var(--vscode-input-background, #1e2029);
      --input-fg: var(--vscode-input-foreground, #f9fafb);
      --card-bg: rgba(30, 32, 42, 0.65);
      --card-border: rgba(255, 255, 255, 0.08);
      --btn-primary-bg: #2563eb;
      --btn-primary-fg: #ffffff;
      --btn-primary-hover: #1d4ed8;
      --btn-sec-bg: rgba(255, 255, 255, 0.06);
      --btn-sec-fg: #e5e7eb;
      --btn-sec-hover: rgba(255, 255, 255, 0.12);
      --accent-green: #10b981;
      --accent-green-bg: rgba(16, 185, 129, 0.12);
      --accent-green-border: rgba(16, 185, 129, 0.35);
      --accent-red: #ef4444;
      --accent-red-bg: rgba(239, 68, 68, 0.12);
      --accent-red-border: rgba(239, 68, 68, 0.35);
      --accent-amber: #f59e0b;
      --accent-blue: #3b82f6;
      --accent-indigo: #6366f1;
      --radius-sm: 5px;
      --radius-md: 9px;
      --radius-lg: 14px;
      --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 14px 0 rgba(0, 0, 0, 0.35);
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

    /* ─── Header Section ─────────────────────────────────────────────── */
    header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px 10px;
      background: rgba(18, 19, 26, 0.95);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      backdrop-filter: blur(10px);
    }

    .header-main {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .logo-box {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: linear-gradient(135deg, #2563eb, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
    }

    .brand-logo {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: #ffffff;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .brand-text {
      display: flex;
      flex-direction: column;
    }

    .brand-name {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: -0.2px;
      color: #ffffff;
      line-height: 1.2;
    }

    .brand-sub {
      font-size: 9.5px;
      color: var(--fg-muted);
      letter-spacing: 0.3px;
      text-transform: uppercase;
      font-weight: 500;
    }

    .icon-btn {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--fg-muted);
      width: 24px;
      height: 24px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--fg);
      border-color: rgba(255, 255, 255, 0.16);
    }

    /* Status Bar Row */
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 9999px;
      font-size: 10.5px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.05);
      color: var(--fg-muted);
      border: 1px solid rgba(255, 255, 255, 0.07);
    }

    .status-dot {
      width: 6.5px;
      height: 6.5px;
      border-radius: 50%;
      background: var(--accent-green);
      box-shadow: 0 0 8px var(--accent-green);
    }

    .status-dot.offline {
      background: var(--accent-red);
      box-shadow: 0 0 8px var(--accent-red);
    }

    .status-dot.pulsing {
      animation: pulse-glow 1.6s infinite ease-in-out;
    }

    @keyframes pulse-glow {
      0% { opacity: 0.45; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.15); }
      100% { opacity: 0.45; transform: scale(0.9); }
    }

    .status-dot-mini {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--accent-green);
    }

    .status-dot-mini.online {
      background: #34d399;
      box-shadow: 0 0 5px #34d399;
    }

    .status-dot-mini.offline {
      background: #f87171;
      box-shadow: 0 0 5px #f87171;
    }

    /* Model Chip & Switcher */
    .model-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px 3px 7px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 500;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(99, 102, 241, 0.15));
      color: #bfdbfe;
      border: 1px solid rgba(59, 130, 246, 0.28);
      cursor: pointer;
      transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .model-chip:hover {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.22), rgba(99, 102, 241, 0.28));
      border-color: rgba(59, 130, 246, 0.5);
      transform: translateY(-0.5px);
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
    }

    .model-sparkle {
      font-size: 10px;
    }

    .model-tag {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.4px;
      padding: 1px 5px;
      border-radius: 4px;
      text-transform: uppercase;
      line-height: 1.2;
    }

    .model-tag.online {
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }

    .model-tag.offline {
      background: rgba(239, 68, 68, 0.18);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.35);
    }

    .switch-icon {
      font-size: 10px;
      opacity: 0.7;
      margin-left: 1px;
    }

    /* ─── Main Content Canvas ─────────────────────────────────────────── */
    #main-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 11px;
    }

    #main-content::-webkit-scrollbar {
      width: 5px;
    }
    #main-content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.12);
      border-radius: 9999px;
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius-md);
      padding: 12px;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(10px);
      transition: all 0.18s ease;
    }

    .card:hover {
      border-color: rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .card-title {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Context Ledger Progress */
    .ledger-stats {
      font-size: 10.5px;
      font-weight: 500;
      color: var(--fg-muted);
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .progress-track {
      height: 6px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 9999px;
      overflow: hidden;
      margin: 6px 0 8px;
      border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6);
      width: 0%;
      border-radius: 9999px;
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.45);
      transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Diff Review Drawer */
    #diff-card {
      border-left: 3.5px solid #3b82f6;
      animation: slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      background: linear-gradient(135deg, rgba(30, 32, 42, 0.8), rgba(24, 26, 36, 0.9));
    }

    @keyframes slide-in {
      from { opacity: 0; transform: translateY(-5px); }
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
      border-color: var(--accent-green-border);
    }

    .hunk-item.rejected {
      border-left-color: var(--accent-red);
      background: var(--accent-red-bg);
      border-color: var(--accent-red-border);
      opacity: 0.6;
    }

    .hunk-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    .badge {
      font-size: 9.5px;
      padding: 1px 5px;
      border-radius: 4px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.08);
      color: var(--fg-muted);
    }
    .badge.green {
      background: var(--accent-green-bg);
      color: #34d399;
      border: 1px solid var(--accent-green-border);
    }
    .badge.red {
      background: var(--accent-red-bg);
      color: #f87171;
      border: 1px solid var(--accent-red-border);
    }

    /* Agent Stream Terminal */
    .terminal-dots {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-right: 2px;
    }
    .dot-red { width: 7px; height: 7px; border-radius: 50%; background: #ef4444; opacity: 0.8; }
    .dot-yellow { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; opacity: 0.8; }
    .dot-green { width: 7px; height: 7px; border-radius: 50%; background: #10b981; opacity: 0.8; }

    .stream-container {
      background: rgba(15, 16, 22, 0.85);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      min-height: 90px;
      max-height: 280px;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', 'Consolas', monospace);
      font-size: 11.5px;
      line-height: 1.55;
      color: #e5e7eb;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .stream-container::-webkit-scrollbar {
      width: 4px;
    }
    .stream-container::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.12);
      border-radius: 9999px;
    }

    /* ─── Buttons & Controls ─────────────────────────────────────────── */
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
      background: linear-gradient(135deg, #2563eb, #4f46e5);
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #1d4ed8, #4338ca);
      box-shadow: 0 3px 10px rgba(37, 99, 235, 0.45);
      transform: translateY(-0.5px);
    }

    .btn-sec {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .btn-sec:hover {
      background: var(--btn-sec-hover);
      border-color: rgba(255, 255, 255, 0.16);
    }

    .btn-green {
      background: linear-gradient(135deg, #059669, #047857);
      color: #ffffff;
      box-shadow: 0 1px 4px rgba(5, 150, 105, 0.3);
    }
    .btn-green:hover {
      background: linear-gradient(135deg, #047857, #065f46);
      box-shadow: 0 2px 8px rgba(5, 150, 105, 0.45);
    }

    .btn-red {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      color: #ffffff;
      box-shadow: 0 1px 4px rgba(220, 38, 38, 0.3);
    }
    .btn-red:hover {
      background: linear-gradient(135deg, #b91c1c, #991b1b);
      box-shadow: 0 2px 8px rgba(220, 38, 38, 0.45);
    }

    /* ─── Input Section ──────────────────────────────────────────────── */
    #input-section {
      padding: 12px 14px;
      background: rgba(18, 19, 26, 0.95);
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
      backdrop-filter: blur(12px);
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
      line-height: 1.45;
      transition: all 0.16s ease;
      user-select: text;
    }

    textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
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
      padding: 5px 9px;
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
      font-size: 10px;
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
      font-size: 9px;
      font-family: inherit;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-main">
      <div class="brand">
        <div class="logo-box">
          <svg class="brand-logo" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="brand-text">
          <span class="brand-name">TrueForge</span>
          <span class="brand-sub">Coding Agent</span>
        </div>
      </div>
      <button id="btn-refresh-status" class="icon-btn" title="Refresh Server & Model Status">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
        </svg>
      </button>
    </div>

    <!-- Live Telemetry Status Row -->
    <div class="status-bar">
      <!-- Server Status Badge -->
      <div class="status-pill" id="server-status-pill" title="Server: http://localhost:3000">
        <span class="status-dot pulsing" id="server-status-dot"></span>
        <span id="server-status-text">Server: Online</span>
      </div>

      <!-- Model Status & Switcher Badge -->
      <div id="model-badge" class="model-chip" title="Click to switch active model">
        <span class="model-sparkle">✨</span>
        <span class="status-dot-mini online" id="model-status-dot"></span>
        <span id="model-name">gemini-3.5-flash-lite</span>
        <span class="model-tag online" id="model-status-tag">ONLINE</span>
        <span class="switch-icon">⇄</span>
      </div>
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
          <button id="btn-accept-all" class="btn-green">✓ Accept All</button>
          <button id="btn-reject-all" class="btn-red">✕ Reject All</button>
        </div>
      </div>
      <div id="hunks-list"></div>
    </div>

    <!-- Agent Output & Streaming -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <span class="terminal-dots">
            <span class="dot-red"></span>
            <span class="dot-yellow"></span>
            <span class="dot-green"></span>
          </span>
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
</html>`;
  }
}
