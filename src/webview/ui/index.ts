/**
 * @file index.ts
 * @description Frontend logic for TrueForge Webview UI.
 *              Handles state rendering for Context Ledger, Diff Review Drawer,
 *              Streaming Agent Output, and Prompt dispatch.
 */

import type {
  HostToWebviewMessage,
  ContextLedgerSnapshot,
  StagedFileReview,
  StagedHunk,
} from '../../types/contracts';

// Declare VS Code API acquisition
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// DOM Elements
const streamEl = document.getElementById('chat-stream') as HTMLDivElement;
const streamStatus = document.getElementById('stream-status') as HTMLSpanElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const modeSelect = document.getElementById('mode-select') as HTMLSelectElement;
const btnSubmit = document.getElementById('btn-submit') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const diffCard = document.getElementById('diff-card') as HTMLDivElement;
const hunksList = document.getElementById('hunks-list') as HTMLDivElement;
const reviewTitle = document.getElementById('review-title') as HTMLSpanElement;
const btnAcceptAll = document.getElementById('btn-accept-all') as HTMLButtonElement;
const btnRejectAll = document.getElementById('btn-reject-all') as HTMLButtonElement;
const tokenUsage = document.getElementById('token-usage') as HTMLSpanElement;
const tokenBar = document.getElementById('token-bar') as HTMLDivElement;
const ledgerSlices = document.getElementById('ledger-slices') as HTMLDivElement;
const modelBadge = document.getElementById('model-badge') as HTMLDivElement;
const serverStatusPill = document.getElementById('server-status-pill') as HTMLDivElement | null;
const serverStatusDot = document.getElementById('server-status-dot') as HTMLSpanElement | null;
const serverStatusText = document.getElementById('server-status-text') as HTMLSpanElement | null;
const modelStatusDot = document.getElementById('model-status-dot') as HTMLSpanElement | null;
const modelName = document.getElementById('model-name') as HTMLSpanElement | null;
const modelStatusTag = document.getElementById('model-status-tag') as HTMLSpanElement | null;
const btnRefresh = document.getElementById('btn-refresh-status') as HTMLButtonElement | null;
const modelDrawer = document.getElementById('model-drawer') as HTMLDivElement | null;
const modelDrawerList = document.getElementById('model-drawer-list') as HTMLDivElement | null;

let currentReview: StagedFileReview | null = null;
let cachedModels: Array<{ id: string; name: string }> = [];

function doSubmit() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  vscode.postMessage({
    type: 'user:submit_turn',
    prompt,
    mode: modeSelect.value as 'inline-edit' | 'agent-mode',
  });

  promptInput.value = '';
  if (streamEl) streamEl.textContent = '';
  if (btnSubmit) btnSubmit.style.display = 'none';
  if (btnStop) btnStop.style.display = 'inline-flex';
  if (streamStatus) streamStatus.textContent = 'Generating...';
}

// Event Listeners
btnSubmit?.addEventListener('click', doSubmit);

promptInput?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doSubmit();
  }
});

// Model switcher drawer toggle
modelBadge?.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  if (!modelDrawer) return;
  const isHidden = modelDrawer.style.display === 'none' || !modelDrawer.style.display;
  modelDrawer.style.display = isHidden ? 'block' : 'none';
});

// Close model drawer on outside click
document.addEventListener('click', (e: MouseEvent) => {
  if (modelDrawer && modelDrawer.style.display === 'block') {
    if (!modelDrawer.contains(e.target as Node) && !modelBadge?.contains(e.target as Node)) {
      modelDrawer.style.display = 'none';
    }
  }
});

// Refresh button trigger
btnRefresh?.addEventListener('click', () => {
  btnRefresh.style.transform = 'rotate(180deg)';
  setTimeout(() => {
    btnRefresh.style.transform = '';
  }, 400);
  vscode.postMessage({ type: 'user:refresh_status' });
});

btnStop?.addEventListener('click', () => {
  vscode.postMessage({ type: 'user:stop_generation' });
  if (btnStop) btnStop.style.display = 'none';
  if (btnSubmit) btnSubmit.style.display = 'inline-flex';
  if (streamStatus) streamStatus.textContent = 'Stopped';
});

btnAcceptAll?.addEventListener('click', () => {
  if (currentReview) {
    vscode.postMessage({
      type: 'user:file_decision',
      fileId: currentReview.fileId,
      decision: 'accept_all',
    });
  }
});

btnRejectAll?.addEventListener('click', () => {
  if (currentReview) {
    vscode.postMessage({
      type: 'user:file_decision',
      fileId: currentReview.fileId,
      decision: 'reject_all',
    });
  }
});

// Incoming messages from Extension Host
window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'stream:text_delta':
      if (streamEl) {
        if (streamEl.textContent === 'Awaiting instruction...') {
          streamEl.textContent = '';
        }
        streamEl.textContent += msg.delta;
        streamEl.scrollTop = streamEl.scrollHeight;
      }
      break;

    case 'stream:event':
      handleStreamEvent(msg.event);
      break;

    case 'ledger:updated':
      updateLedger(msg.ledger);
      break;

    case 'diff:queue_updated':
      updateDiffQueue(msg.activeReview, msg.queuedCount);
      break;

    case 'status:updated':
      updateStatus(msg);
      break;
  }
});

function handleStreamEvent(event: { type: string; [key: string]: unknown }) {
  if (event.type === 'tool_call_start') {
    if (streamEl) {
      streamEl.textContent += `\n\n[Tool: ${event.toolName}]...\n`;
    }
  } else if (event.type === 'turn_complete') {
    if (streamStatus) streamStatus.textContent = 'Complete';
    if (btnStop) btnStop.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'inline-flex';
  } else if (event.type === 'error') {
    if (streamStatus) streamStatus.textContent = `Error: ${event.message}`;
    if (btnStop) btnStop.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'inline-flex';
  }
}

function updateLedger(ledger: ContextLedgerSnapshot) {
  if (!ledger) return;

  if (tokenUsage) {
    tokenUsage.textContent = `${ledger.totalTokensUsed.toLocaleString()} / ${ledger.budgetCap.toLocaleString()} tokens`;
  }

  if (tokenBar) {
    const pct = Math.min(100, Math.round((ledger.totalTokensUsed / ledger.budgetCap) * 100));
    tokenBar.style.width = `${pct}%`;
  }

  if (ledgerSlices) {
    const sliceHtml =
      ledger.slices && ledger.slices.length > 0
        ? ledger.slices
            .map(
              (s) => `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <span>${s.pinned ? '📌 ' : '• '}${escapeHtml(s.rationale)} (${s.tokens} tok)</span>
            <button class="secondary" style="padding: 1px 5px; font-size: 10px;" data-slice-id="${s.id}" data-pinned="${s.pinned ? 'true' : 'false'}" data-action="toggle_pin">
              ${s.pinned ? 'Unpin' : 'Pin'}
            </button>
          </div>
        `,
            )
            .join('')
        : '<div>No active slices</div>';

    const tocHtml =
      ledger.overflowToc && ledger.overflowToc.length > 0
        ? `
        <div style="margin-top: 8px; border-top: 1px solid var(--border); padding-top: 6px;">
          <strong style="font-size: 11px;">Overflow TOC (${ledger.overflowToc.length} symbols):</strong>
          ${ledger.overflowToc
            .map(
              (t) => `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 11px;">
              <span>⚡ ${escapeHtml(t.symbolName)} (~${t.tokens} tok)</span>
              <button class="btn-green" style="padding: 1px 5px; font-size: 10px;" data-toc-id="${t.id}" data-action="promote_toc">
                + Promote
              </button>
            </div>
          `,
            )
            .join('')}
        </div>
      `
        : '';

    ledgerSlices.innerHTML = sliceHtml + tocHtml;

    // Attach pin & promote listeners
    ledgerSlices.querySelectorAll<HTMLButtonElement>('button[data-action="toggle_pin"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sliceId = btn.dataset.sliceId;
        const wasPinned = btn.dataset.pinned === 'true';
        if (sliceId) {
          vscode.postMessage({
            type: 'user:pin_slice',
            sliceId,
            pinned: !wasPinned,
          });
        }
      });
    });

    ledgerSlices.querySelectorAll<HTMLButtonElement>('button[data-action="promote_toc"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tocEntryId = btn.dataset.tocId;
        if (tocEntryId) {
          vscode.postMessage({
            type: 'user:promote_toc',
            tocEntryId,
          });
        }
      });
    });
  }
}

function updateDiffQueue(activeReview: StagedFileReview | null, queuedCount: number) {
  currentReview = activeReview;
  if (!diffCard || !reviewTitle || !hunksList) return;

  if (!activeReview) {
    diffCard.style.display = 'none';
    return;
  }

  diffCard.style.display = 'block';
  diffCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const filename = activeReview.filePath.split(/[/\\]/).pop() || activeReview.filePath;
  reviewTitle.textContent = `${filename}${queuedCount > 0 ? ` (+${queuedCount} queued)` : ''}`;

  hunksList.innerHTML = activeReview.hunks
    .map((hunk: StagedHunk) => {
      const statusBadge =
        hunk.status === 'accepted'
          ? '<span class="badge green">Accepted</span>'
          : hunk.status === 'rejected'
            ? '<span class="badge red">Rejected</span>'
            : '<span class="badge">Pending</span>';

      const lspBadge = hunk.shadowDiagnostics?.zeroRegression
        ? '<span style="color: #388a34; font-size: 11px;">✓ LSP: 0 errors</span>'
        : '<span style="color: #fce100; font-size: 11px;">⚠️ LSP issues</span>';

      const actions =
        hunk.status === 'pending'
          ? `
        <div class="hunk-actions">
          <button class="btn-green" data-hunk-id="${hunk.id}" data-action="accept">Accept</button>
          <button class="btn-red" data-hunk-id="${hunk.id}" data-action="reject">Reject</button>
          <button class="secondary" data-file-id="${activeReview.fileId}" data-hunk-index="${hunk.index}" data-action="diff">Diff</button>
        </div>
      `
          : '';

      return `
        <div class="hunk-item ${hunk.status}">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span><strong>Hunk #${hunk.index + 1}</strong> (lines ${hunk.oldStart}-${hunk.oldStart + hunk.oldLines})</span>
            <div>${lspBadge} ${statusBadge}</div>
          </div>
          <div style="font-size: 11px; opacity: 0.9;">${escapeHtml(hunk.rationale || 'Proposed edit')}</div>
          ${actions}
        </div>
      `;
    })
    .join('');

  // Attach dynamic button handlers
  hunksList.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const hunkId = btn.dataset.hunkId;
      const fileId = btn.dataset.fileId;
      const hunkIndex = btn.dataset.hunkIndex ? parseInt(btn.dataset.hunkIndex, 10) : undefined;

      if (action === 'accept' && hunkId) {
        vscode.postMessage({
          type: 'user:hunk_decision',
          hunkId,
          decision: 'accepted',
        });
      } else if (action === 'reject' && hunkId) {
        vscode.postMessage({
          type: 'user:hunk_decision',
          hunkId,
          decision: 'rejected',
        });
      } else if (action === 'diff' && fileId) {
        vscode.postMessage({
          type: 'user:toggle_native_diff',
          fileId,
          hunkIndex,
        });
      }
    });
  });
}

function updateStatus(status: {
  serverOnline: boolean;
  serverUrl?: string;
  modelOnline: boolean;
  activeModel: string;
  availableModels?: Array<{ id: string; name: string }>;
}) {
  // Update Server Status Pill
  if (serverStatusDot && serverStatusText) {
    if (status.serverOnline) {
      serverStatusDot.className = 'status-dot pulsing online';
      serverStatusText.textContent = 'Server: Online';
      if (serverStatusPill) {
        serverStatusPill.title = `Server: ${status.serverUrl || 'http://localhost:3000'} (Healthy)`;
      }
    } else {
      serverStatusDot.className = 'status-dot offline';
      serverStatusText.textContent = 'Server: Offline';
      if (serverStatusPill) {
        serverStatusPill.title = `Server: ${status.serverUrl || 'http://localhost:3000'} (Unreachable)`;
      }
    }
  }

  // Update Model Chip & Status Tag
  if (modelName) {
    modelName.textContent = status.activeModel;
  }
  if (modelStatusDot && modelStatusTag) {
    if (status.modelOnline) {
      modelStatusDot.className = 'status-dot-mini online';
      modelStatusTag.className = 'model-tag online';
      modelStatusTag.textContent = 'ONLINE';
    } else {
      modelStatusDot.className = 'status-dot-mini offline';
      modelStatusTag.className = 'model-tag offline';
      modelStatusTag.textContent = 'OFFLINE';
    }
  }

  // Populate/Refresh Model Dropdown Drawer
  if (status.availableModels && status.availableModels.length > 0) {
    cachedModels = status.availableModels;
    renderModelDrawer(status.activeModel, cachedModels);
  }
}

function renderModelDrawer(activeModel: string, models: Array<{ id: string; name: string }>) {
  if (!modelDrawerList) return;
  modelDrawerList.innerHTML = '';

  for (const m of models) {
    const item = document.createElement('div');
    const isActive = m.id === activeModel || m.name === activeModel || m.id.endsWith(activeModel);
    item.className = `model-option ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 500; font-size: 11px;">${escapeHtml(m.name || m.id)}</span>
        ${isActive ? '<span style="color: var(--accent-blue); font-size: 10px;">✓ Active</span>' : ''}
      </div>
      <span style="font-size: 9.5px; color: var(--fg-muted);">${escapeHtml(m.id)}</span>
    `;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({
        type: 'user:switch_model',
        modelId: m.id,
      });
      if (modelDrawer) modelDrawer.style.display = 'none';
    });
    modelDrawerList.appendChild(item);
  }

  // QuickPick option at the bottom
  const qpItem = document.createElement('div');
  qpItem.className = 'model-option';
  qpItem.style.borderTop = '1px solid var(--border)';
  qpItem.style.marginTop = '4px';
  qpItem.style.paddingTop = '6px';
  qpItem.innerHTML = `
    <span style="font-size: 10.5px; color: var(--accent-blue); display: flex; align-items: center; gap: 4px;">
      <span>🔍</span> Browse all models (QuickPick)...
    </span>
  `;
  qpItem.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'user:switch_model' });
    if (modelDrawer) modelDrawer.style.display = 'none';
  });
  modelDrawerList.appendChild(qpItem);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
