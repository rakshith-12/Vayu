/**
 * @file index.ts
 * @description Frontend logic for TrueForge Webview UI.
 *              Handles state rendering for Context Ledger, Diff Review Drawer,
 *              Streaming Agent Output, Mention Autocomplete, and Prompt dispatch.
 */

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
  ContextLedgerSnapshot,
  StagedFileReview,
  StagedHunk,
} from '../../types/contracts';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function postToHost(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

// DOM Elements
const streamEl = document.getElementById('chat-stream') as HTMLDivElement | null;
const streamEmpty = document.getElementById('stream-empty') as HTMLDivElement | null;
const streamStatus = document.getElementById('stream-status') as HTMLSpanElement | null;
const btnCopyStream = document.getElementById('btn-copy-stream') as HTMLButtonElement | null;
const btnClearStream = document.getElementById('btn-clear-stream') as HTMLButtonElement | null;

const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement | null;
const modeSelect = document.getElementById('mode-select') as HTMLSelectElement | null;
const btnSubmit = document.getElementById('btn-submit') as HTMLButtonElement | null;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement | null;
const btnMention = document.getElementById('btn-mention') as HTMLButtonElement | null;
const mentionPopover = document.getElementById('mention-popover') as HTMLDivElement | null;
const inputSection = document.getElementById('input-section') as HTMLElement | null;

const diffCard = document.getElementById('diff-card') as HTMLElement | null;
const hunksList = document.getElementById('hunks-list') as HTMLDivElement | null;
const reviewTitle = document.getElementById('review-title') as HTMLSpanElement | null;
const btnAcceptAll = document.getElementById('btn-accept-all') as HTMLButtonElement | null;
const btnRejectAll = document.getElementById('btn-reject-all') as HTMLButtonElement | null;

const tokenUsage = document.getElementById('token-usage') as HTMLSpanElement | null;
const tokenPct = document.getElementById('token-pct') as HTMLSpanElement | null;
const tokenBar = document.getElementById('token-bar') as HTMLDivElement | null;
const ledgerSlices = document.getElementById('ledger-slices') as HTMLDivElement | null;

const modelBadge = document.getElementById('model-badge') as HTMLElement | null;
const modelLabel = document.getElementById('model-label') as HTMLSpanElement | null;
const statusDot = document.getElementById('status-dot') as HTMLSpanElement | null;
const sessionBadge = document.getElementById('session-badge') as HTMLSpanElement | null;
const uiToast = document.getElementById('ui-toast') as HTMLDivElement | null;

type MentionItem = { label: string; filePath: string; kind: string };

let currentReview: StagedFileReview | null = null;
let mentionDebounceTimer: number | undefined;
let toastTimer: number | undefined;
let mentionItems: MentionItem[] = [];
let mentionSelectedIndex = 0;
let activeMentionRange: { start: number; end: number } | null = null;
let mentionRequestActive = false;

function resizePromptInput(): void {
  if (!promptInput) return;
  promptInput.style.height = 'auto';
  const nextHeight = Math.min(Math.max(promptInput.scrollHeight, 54), 160);
  promptInput.style.height = `${nextHeight}px`;
}

function showToast(message: string): void {
  if (!uiToast) return;
  uiToast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  uiToast.classList.add('visible');
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    uiToast.classList.remove('visible');
  }, 2800);
}

function setStreamStatus(text: string, state: 'idle' | 'running' | 'done' | 'error'): void {
  if (streamStatus) {
    streamStatus.textContent = text;
    streamStatus.className = `stream-status-pill status-${state}`;
  }
  if (statusDot) {
    statusDot.classList.toggle('generating', state === 'running');
  }
  if (sessionBadge) {
    sessionBadge.textContent = state === 'running' ? 'Generating' : 'Connected';
  }
}

function setStreamEmptyVisible(visible: boolean): void {
  if (!streamEmpty) return;
  streamEmpty.classList.toggle('hidden', !visible);
}

function closeMentionPopover(): void {
  mentionRequestActive = false;
  activeMentionRange = null;
  mentionItems = [];
  mentionSelectedIndex = 0;
  if (mentionPopover) {
    mentionPopover.classList.remove('open');
    mentionPopover.innerHTML = '';
  }
}

function insertMention(item: MentionItem): void {
  if (!promptInput) return;
  const val = promptInput.value;
  const range = activeMentionRange ?? {
    start: promptInput.selectionStart ?? val.length,
    end: promptInput.selectionEnd ?? val.length,
  };
  const insertion = `@file:${item.label} `;
  promptInput.value = val.slice(0, range.start) + insertion + val.slice(range.end);
  const caret = range.start + insertion.length;
  promptInput.focus();
  promptInput.setSelectionRange(caret, caret);
  resizePromptInput();
  closeMentionPopover();
}

function renderMentionPopover(): void {
  if (!mentionPopover) return;
  if (!mentionRequestActive) {
    mentionPopover.classList.remove('open');
    return;
  }

  if (mentionItems.length === 0) {
    mentionPopover.innerHTML = `
      <div class="mention-header">Workspace Files</div>
      <div class="empty-inline" style="margin: 2px 4px 4px;">No matching files found</div>
    `;
    mentionPopover.classList.add('open');
    return;
  }

  const rowsHtml = mentionItems
    .map((item, idx) => {
      const base = basename(item.label);
      const selectedClass = idx === mentionSelectedIndex ? ' selected' : '';
      return `
        <button type="button" class="mention-item${selectedClass}" data-mention-idx="${idx}" role="option" aria-selected="${idx === mentionSelectedIndex ? 'true' : 'false'}">
          <span class="mention-item-name">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
            </svg>
            ${escapeHtml(base)}
          </span>
          <span class="mention-item-path">${escapeHtml(item.label)}</span>
        </button>
      `;
    })
    .join('');

  mentionPopover.innerHTML = `<div class="mention-header">Workspace Files</div>${rowsHtml}`;
  mentionPopover.classList.add('open');

  mentionPopover.querySelectorAll<HTMLButtonElement>('button[data-mention-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.mentionIdx);
      const chosen = mentionItems[idx];
      if (chosen) {
        insertMention(chosen);
      }
    });
  });
}

function detectAndQueryMention(): void {
  if (!promptInput) return;
  const caret = promptInput.selectionStart ?? promptInput.value.length;
  const beforeCaret = promptInput.value.slice(0, caret);
  const match = beforeCaret.match(/(?:^|\s)(@([^\s@]*))$/);

  if (!match) {
    closeMentionPopover();
    return;
  }

  const fullToken = match[1];
  const rawQuery = match[2];
  // Do not keep re-opening if user already typed an explicit @file:path or @symbol:name token with colon unless still editing file:
  if (rawQuery.startsWith('symbol:')) {
    closeMentionPopover();
    return;
  }

  const start = caret - fullToken.length;
  activeMentionRange = { start, end: caret };
  mentionRequestActive = true;

  const prefix = rawQuery.startsWith('file:') ? rawQuery.slice(5) : rawQuery;

  if (mentionDebounceTimer !== undefined) {
    window.clearTimeout(mentionDebounceTimer);
  }
  mentionDebounceTimer = window.setTimeout(() => {
    postToHost({
      type: 'user:query_mentions',
      prefix,
    });
  }, 130);
}

function doSubmit(): void {
  if (!promptInput || !modeSelect) return;
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  postToHost({
    type: 'user:submit_turn',
    prompt,
    mode: modeSelect.value as 'inline-edit' | 'agent-mode',
  });

  promptInput.value = '';
  resizePromptInput();
  closeMentionPopover();

  if (streamEl) streamEl.textContent = '';
  setStreamEmptyVisible(false);
  if (btnSubmit) btnSubmit.style.display = 'none';
  if (btnStop) btnStop.style.display = 'inline-flex';
  setStreamStatus('Generating...', 'running');
}

// Composer & Header Event Listeners
btnSubmit?.addEventListener('click', doSubmit);

promptInput?.addEventListener('input', () => {
  resizePromptInput();
  detectAndQueryMention();
});

promptInput?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (mentionRequestActive && mentionPopover?.classList.contains('open')) {
    if (e.key === 'ArrowDown' && mentionItems.length > 0) {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionItems.length;
      renderMentionPopover();
      return;
    }
    if (e.key === 'ArrowUp' && mentionItems.length > 0) {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionItems.length) % mentionItems.length;
      renderMentionPopover();
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey && mentionItems.length > 0) {
      e.preventDefault();
      const chosen = mentionItems[mentionSelectedIndex];
      if (chosen) {
        insertMention(chosen);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMentionPopover();
      return;
    }
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doSubmit();
  }
});

btnMention?.addEventListener('click', () => {
  if (!promptInput) return;
  const start = promptInput.selectionStart ?? promptInput.value.length;
  const end = promptInput.selectionEnd ?? promptInput.value.length;
  const val = promptInput.value;
  const needsSpace = start > 0 && !/\s/.test(val[start - 1]);
  const inserted = needsSpace ? ' @' : '@';
  promptInput.value = val.slice(0, start) + inserted + val.slice(end);
  const caret = start + inserted.length;
  promptInput.focus();
  promptInput.setSelectionRange(caret, caret);
  resizePromptInput();
  activeMentionRange = { start: caret - 1, end: caret };
  mentionRequestActive = true;
  postToHost({ type: 'user:query_mentions', prefix: '' });
});

document.addEventListener('click', (e: MouseEvent) => {
  if (inputSection && e.target instanceof Node && !inputSection.contains(e.target)) {
    closeMentionPopover();
  }
});

document.querySelectorAll<HTMLButtonElement>('.quick-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    if (!promptInput) return;
    const starter = chip.dataset.prompt || '';
    promptInput.value = starter;
    resizePromptInput();
    promptInput.focus();
    const len = promptInput.value.length;
    promptInput.setSelectionRange(len, len);
  });
});

modelBadge?.addEventListener('click', () => {
  showToast('Switch model via Command Palette: Forge: Switch Active Model');
});

btnCopyStream?.addEventListener('click', async () => {
  const text = streamEl?.textContent?.trim() || '';
  if (!text) {
    showToast('Nothing in Agent Stream to copy yet');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const tmp = document.createElement('textarea');
    tmp.value = text;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
  }

  btnCopyStream.classList.add('copied');
  btnCopyStream.title = 'Copied!';
  window.setTimeout(() => {
    btnCopyStream.classList.remove('copied');
    btnCopyStream.title = 'Copy stream output';
  }, 1500);
});

btnClearStream?.addEventListener('click', () => {
  if (streamEl) streamEl.textContent = '';
  setStreamEmptyVisible(true);
  setStreamStatus('Idle', 'idle');
});

btnStop?.addEventListener('click', () => {
  postToHost({ type: 'user:stop_generation' });
  if (btnStop) btnStop.style.display = 'none';
  if (btnSubmit) btnSubmit.style.display = 'inline-flex';
  setStreamStatus('Stopped', 'idle');
  if (!streamEl?.textContent?.trim()) {
    setStreamEmptyVisible(true);
  }
});

btnAcceptAll?.addEventListener('click', () => {
  if (currentReview) {
    postToHost({
      type: 'user:file_decision',
      fileId: currentReview.fileId,
      decision: 'accept_all',
    });
  }
});

btnRejectAll?.addEventListener('click', () => {
  if (currentReview) {
    postToHost({
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
        setStreamEmptyVisible(false);
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

    case 'mentions:results':
      if (mentionRequestActive) {
        mentionItems = msg.items || [];
        mentionSelectedIndex = 0;
        renderMentionPopover();
      }
      break;
  }
});

function handleStreamEvent(event: { type: string; [key: string]: unknown }): void {
  if (event.type === 'tool_call_start') {
    if (streamEl) {
      setStreamEmptyVisible(false);
      streamEl.textContent += `\n\n[Tool: ${String(event.toolName ?? 'tool')}]...\n`;
      streamEl.scrollTop = streamEl.scrollHeight;
    }
  } else if (event.type === 'model_failover') {
    const toModel = typeof event.toModel === 'string' ? event.toModel : '';
    const fromModel = typeof event.fromModel === 'string' ? event.fromModel : '';
    if (toModel && modelLabel) {
      modelLabel.textContent = toModel;
    }
    if (toModel) {
      showToast(`Model failover: ${fromModel || 'primary'} → ${toModel}`);
    }
  } else if (event.type === 'turn_complete') {
    setStreamStatus('Complete', 'done');
    if (btnStop) btnStop.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'inline-flex';
    if (!streamEl?.textContent?.trim()) {
      setStreamEmptyVisible(true);
    }
  } else if (event.type === 'error') {
    const errMsg = typeof event.message === 'string' ? event.message : 'Unknown error';
    setStreamStatus('Error', 'error');
    if (streamStatus) {
      streamStatus.title = errMsg;
    }
    if (streamEl && !streamEl.textContent?.trim()) {
      setStreamEmptyVisible(false);
      streamEl.textContent = `Error: ${errMsg}`;
    }
    showToast(`Error: ${errMsg}`);
    if (btnStop) btnStop.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'inline-flex';
  }
}

function updateLedger(ledger: ContextLedgerSnapshot): void {
  if (!ledger) return;

  const pct =
    ledger.budgetCap > 0
      ? Math.min(100, Math.round((ledger.totalTokensUsed / ledger.budgetCap) * 100))
      : 0;

  if (tokenUsage) {
    tokenUsage.textContent = `${ledger.totalTokensUsed.toLocaleString()} / ${ledger.budgetCap.toLocaleString()} tokens`;
  }

  if (tokenPct) {
    tokenPct.textContent = `${pct}%`;
  }

  if (tokenBar) {
    tokenBar.style.width = `${pct}%`;
    tokenBar.classList.toggle('warn', pct >= 75 && pct < 90);
    tokenBar.classList.toggle('danger', pct >= 90);
  }

  if (ledgerSlices) {
    const hasSlices = Boolean(ledger.slices && ledger.slices.length > 0);
    const hasToc = Boolean(ledger.overflowToc && ledger.overflowToc.length > 0);

    if (!hasSlices && !hasToc) {
      ledgerSlices.innerHTML = `
        <div class="empty-inline">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>No active context slices yet</span>
        </div>
      `;
      return;
    }

    const sliceHtml = hasSlices
      ? ledger.slices
          .map((s) => {
            const fileName = basename(s.filePath);
            const pinClass = s.pinned ? ' pinned' : '';
            const pinBtnClass = s.pinned ? 'btn-pin active' : 'btn-pin';
            const pinLabel = s.pinned ? 'Pinned' : 'Pin';
            return `
              <div class="slice-row${pinClass}">
                <div class="slice-main">
                  <div class="slice-rationale" title="${escapeAttr(s.rationale)}">
                    ${s.pinned ? '📌 ' : ''}${escapeHtml(s.rationale)}
                  </div>
                  <div class="slice-meta">
                    <span class="meta-pill" title="${escapeAttr(s.filePath)}">${escapeHtml(fileName)} · L${s.startLine}–${s.endLine}</span>
                    <span class="meta-pill tokens">${s.tokens.toLocaleString()} tok</span>
                  </div>
                </div>
                <button type="button" class="${pinBtnClass}" data-slice-id="${escapeAttr(s.id)}" data-pinned="${s.pinned ? 'true' : 'false'}" data-action="toggle_pin">
                  ${pinLabel}
                </button>
              </div>
            `;
          })
          .join('')
      : '';

    const tocHtml = hasToc
      ? `
        <div class="toc-section">
          <div class="toc-heading">
            <span>Overflow TOC</span>
            <span class="badge amber">${ledger.overflowToc.length}</span>
          </div>
          ${ledger.overflowToc
            .map((t) => {
              const fileName = basename(t.filePath);
              return `
                <div class="toc-row">
                  <div class="toc-info">
                    <span class="toc-symbol" title="${escapeAttr(t.symbolName)}">⚡ ${escapeHtml(t.symbolName)}</span>
                    <div class="slice-meta">
                      <span class="meta-pill" title="${escapeAttr(t.filePath)}">${escapeHtml(fileName)} · L${t.startLine}–${t.endLine}</span>
                      <span class="meta-pill">~${t.tokens.toLocaleString()} tok</span>
                    </div>
                  </div>
                  <button type="button" class="btn-promote" data-toc-id="${escapeAttr(t.id)}" data-action="promote_toc">
                    + Promote
                  </button>
                </div>
              `;
            })
            .join('')}
        </div>
      `
      : '';

    ledgerSlices.innerHTML = sliceHtml + tocHtml;

    ledgerSlices.querySelectorAll<HTMLButtonElement>('button[data-action="toggle_pin"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sliceId = btn.dataset.sliceId;
        const wasPinned = btn.dataset.pinned === 'true';
        if (sliceId) {
          postToHost({
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
          postToHost({
            type: 'user:promote_toc',
            tocEntryId,
          });
        }
      });
    });
  }
}

function renderDiffPreview(hunk: StagedHunk): string {
  const oldLines = hunk.oldText ? hunk.oldText.split(/\r?\n/) : [];
  const newLines = hunk.newText ? hunk.newText.split(/\r?\n/) : [];
  if (oldLines.length === 0 && newLines.length === 0) return '';

  const maxLinesPerSide = 4;
  const delShown = oldLines.slice(0, maxLinesPerSide);
  const addShown = newLines.slice(0, maxLinesPerSide);
  const hiddenCount =
    Math.max(0, oldLines.length - maxLinesPerSide) + Math.max(0, newLines.length - maxLinesPerSide);

  const delHtml = delShown
    .map((line) => `<span class="diff-line del">- ${escapeHtml(line)}</span>`)
    .join('');
  const addHtml = addShown
    .map((line) => `<span class="diff-line add">+ ${escapeHtml(line)}</span>`)
    .join('');
  const moreHtml =
    hiddenCount > 0
      ? `<span class="diff-line more">… ${hiddenCount} more line${hiddenCount === 1 ? '' : 's'} (open Side-by-Side Diff)</span>`
      : '';

  return `<div class="hunk-diff-preview">${delHtml}${addHtml}${moreHtml}</div>`;
}

function updateDiffQueue(activeReview: StagedFileReview | null, queuedCount: number): void {
  currentReview = activeReview;
  if (!diffCard || !reviewTitle || !hunksList) return;

  if (!activeReview) {
    diffCard.style.display = 'none';
    hunksList.innerHTML = '';
    return;
  }

  diffCard.style.display = 'block';
  diffCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const filename = basename(activeReview.filePath);
  reviewTitle.textContent = `${filename}${queuedCount > 0 ? ` (+${queuedCount} queued)` : ''}`;
  reviewTitle.title = activeReview.filePath;

  hunksList.innerHTML = activeReview.hunks
    .map((hunk: StagedHunk) => {
      const statusBadge =
        hunk.status === 'accepted'
          ? '<span class="badge green">Accepted</span>'
          : hunk.status === 'rejected'
            ? '<span class="badge red">Rejected</span>'
            : '<span class="badge amber">Pending</span>';

      const lspBadge =
        hunk.shadowDiagnostics === undefined
          ? ''
          : hunk.shadowDiagnostics.zeroRegression
            ? '<span class="lsp-pill ok">✓ LSP: 0 errors</span>'
            : `<span class="lsp-pill warn">⚠ LSP: ${hunk.shadowDiagnostics.newErrors} issue${hunk.shadowDiagnostics.newErrors === 1 ? '' : 's'}</span>`;

      const endLine = hunk.oldStart + Math.max(0, hunk.oldLines - 1);
      const previewHtml = renderDiffPreview(hunk);

      const actions =
        hunk.status === 'pending'
          ? `
            <div class="hunk-actions">
              <button type="button" class="btn-green btn-xs" data-hunk-id="${escapeAttr(hunk.id)}" data-action="accept">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Accept
              </button>
              <button type="button" class="btn-red btn-xs" data-hunk-id="${escapeAttr(hunk.id)}" data-action="reject">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Reject
              </button>
              <button type="button" class="btn-sec secondary btn-xs" data-file-id="${escapeAttr(activeReview.fileId)}" data-hunk-index="${hunk.index}" data-action="diff">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>
                </svg>
                Diff
              </button>
            </div>
          `
          : '';

      return `
        <div class="hunk-item ${escapeAttr(hunk.status)}">
          <div class="hunk-top">
            <button type="button" class="hunk-loc-btn" data-action="reveal" data-file-path="${escapeAttr(activeReview.filePath)}" data-line="${hunk.oldStart}" title="Reveal in editor">
              <span>Hunk #${hunk.index + 1}</span>
              <span class="hunk-lines-pill">L${hunk.oldStart}–${endLine}</span>
            </button>
            <div class="hunk-badges">${lspBadge}${statusBadge}</div>
          </div>
          <div class="hunk-rationale">${escapeHtml(hunk.rationale || 'Proposed edit')}</div>
          ${previewHtml}
          ${actions}
        </div>
      `;
    })
    .join('');

  hunksList.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const hunkId = btn.dataset.hunkId;
      const fileId = btn.dataset.fileId;
      const hunkIndex = btn.dataset.hunkIndex ? parseInt(btn.dataset.hunkIndex, 10) : undefined;

      if (action === 'accept' && hunkId) {
        postToHost({
          type: 'user:hunk_decision',
          hunkId,
          decision: 'accepted',
        });
      } else if (action === 'reject' && hunkId) {
        postToHost({
          type: 'user:hunk_decision',
          hunkId,
          decision: 'rejected',
        });
      } else if (action === 'diff' && fileId) {
        postToHost({
          type: 'user:toggle_native_diff',
          fileId,
          hunkIndex,
        });
      } else if (action === 'reveal') {
        const filePath = btn.dataset.filePath;
        const line = btn.dataset.line ? parseInt(btn.dataset.line, 10) : 1;
        if (filePath) {
          postToHost({
            type: 'user:reveal_hunk',
            filePath,
            line,
          });
        }
      }
    });
  });
}

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
