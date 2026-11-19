"use strict";
(() => {
  // src/webview/ui/index.ts
  var vscode = acquireVsCodeApi();
  function postToHost(message) {
    vscode.postMessage(message);
  }
  var streamEl = document.getElementById("chat-stream");
  var streamEmpty = document.getElementById("stream-empty");
  var streamStatus = document.getElementById("stream-status");
  var btnCopyStream = document.getElementById("btn-copy-stream");
  var btnClearStream = document.getElementById("btn-clear-stream");
  var promptInput = document.getElementById("prompt-input");
  var modeSelect = document.getElementById("mode-select");
  var btnSubmit = document.getElementById("btn-submit");
  var btnStop = document.getElementById("btn-stop");
  var btnMention = document.getElementById("btn-mention");
  var mentionPopover = document.getElementById("mention-popover");
  var inputSection = document.getElementById("input-section");
  var diffCard = document.getElementById("diff-card");
  var hunksList = document.getElementById("hunks-list");
  var reviewTitle = document.getElementById("review-title");
  var btnAcceptAll = document.getElementById("btn-accept-all");
  var btnRejectAll = document.getElementById("btn-reject-all");
  var tokenUsage = document.getElementById("token-usage");
  var tokenPct = document.getElementById("token-pct");
  var tokenBar = document.getElementById("token-bar");
  var ledgerSlices = document.getElementById("ledger-slices");
  var modelBadge = document.getElementById("model-badge");
  var modelLabel = document.getElementById("model-label");
  var modelStatusTag = document.getElementById("model-status-tag");
  var statusDot = document.getElementById("status-dot");
  var sessionBadge = document.getElementById("session-badge");
  var serverStatusPill = document.getElementById("server-status-pill");
  var btnRefresh = document.getElementById("btn-refresh-status");
  var modelDrawer = document.getElementById("model-drawer");
  var modelDrawerList = document.getElementById("model-drawer-list");
  var uiToast = document.getElementById("ui-toast");
  var currentReview = null;
  var mentionDebounceTimer;
  var toastTimer;
  var mentionItems = [];
  var mentionSelectedIndex = 0;
  var activeMentionRange = null;
  var mentionRequestActive = false;
  var isGeneratingStream = false;
  function resizePromptInput() {
    if (!promptInput) return;
    promptInput.style.height = "auto";
    const nextHeight = Math.min(Math.max(promptInput.scrollHeight, 54), 160);
    promptInput.style.height = `${nextHeight}px`;
  }
  function showToast(message) {
    if (!uiToast) return;
    uiToast.innerHTML = `<span>${escapeHtml(message)}</span>`;
    uiToast.classList.add("visible");
    if (toastTimer !== void 0) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      uiToast.classList.remove("visible");
    }, 2800);
  }
  function setStreamStatus(text, state) {
    isGeneratingStream = state === "running";
    if (streamStatus) {
      streamStatus.textContent = text;
      streamStatus.className = `stream-status-pill status-${state}`;
    }
    if (statusDot) {
      statusDot.classList.toggle("generating", isGeneratingStream);
    }
  }
  function setStreamEmptyVisible(visible) {
    if (!streamEmpty) return;
    streamEmpty.classList.toggle("hidden", !visible);
  }
  function closeMentionPopover() {
    mentionRequestActive = false;
    activeMentionRange = null;
    mentionItems = [];
    mentionSelectedIndex = 0;
    if (mentionPopover) {
      mentionPopover.classList.remove("open");
      mentionPopover.innerHTML = "";
    }
  }
  function insertMention(item) {
    if (!promptInput) return;
    const val = promptInput.value;
    const range = activeMentionRange ?? {
      start: promptInput.selectionStart ?? val.length,
      end: promptInput.selectionEnd ?? val.length
    };
    const insertion = `@file:${item.label} `;
    promptInput.value = val.slice(0, range.start) + insertion + val.slice(range.end);
    const caret = range.start + insertion.length;
    promptInput.focus();
    promptInput.setSelectionRange(caret, caret);
    resizePromptInput();
    closeMentionPopover();
  }
  function renderMentionPopover() {
    if (!mentionPopover) return;
    if (!mentionRequestActive) {
      mentionPopover.classList.remove("open");
      return;
    }
    if (mentionItems.length === 0) {
      mentionPopover.innerHTML = `
      <div class="mention-header">Workspace Files</div>
      <div class="empty-inline" style="margin: 2px 4px 4px;">No matching files found</div>
    `;
      mentionPopover.classList.add("open");
      return;
    }
    const rowsHtml = mentionItems.map((item, idx) => {
      const base = basename(item.label);
      const selectedClass = idx === mentionSelectedIndex ? " selected" : "";
      return `
        <button type="button" class="mention-item${selectedClass}" data-mention-idx="${idx}" role="option" aria-selected="${idx === mentionSelectedIndex ? "true" : "false"}">
          <span class="mention-item-name">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
            </svg>
            ${escapeHtml(base)}
          </span>
          <span class="mention-item-path">${escapeHtml(item.label)}</span>
        </button>
      `;
    }).join("");
    mentionPopover.innerHTML = `<div class="mention-header">Workspace Files</div>${rowsHtml}`;
    mentionPopover.classList.add("open");
    mentionPopover.querySelectorAll("button[data-mention-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.mentionIdx);
        const chosen = mentionItems[idx];
        if (chosen) {
          insertMention(chosen);
        }
      });
    });
  }
  function detectAndQueryMention() {
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
    if (rawQuery.startsWith("symbol:")) {
      closeMentionPopover();
      return;
    }
    const start = caret - fullToken.length;
    activeMentionRange = { start, end: caret };
    mentionRequestActive = true;
    const prefix = rawQuery.startsWith("file:") ? rawQuery.slice(5) : rawQuery;
    if (mentionDebounceTimer !== void 0) {
      window.clearTimeout(mentionDebounceTimer);
    }
    mentionDebounceTimer = window.setTimeout(() => {
      postToHost({
        type: "user:query_mentions",
        prefix
      });
    }, 130);
  }
  function doSubmit() {
    if (!promptInput || !modeSelect) return;
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    postToHost({
      type: "user:submit_turn",
      prompt,
      mode: modeSelect.value
    });
    promptInput.value = "";
    resizePromptInput();
    closeMentionPopover();
    if (streamEl) streamEl.textContent = "";
    setStreamEmptyVisible(false);
    if (btnSubmit) btnSubmit.style.display = "none";
    if (btnStop) btnStop.style.display = "inline-flex";
    setStreamStatus("Generating...", "running");
  }
  function updateStatus(status) {
    if (statusDot && sessionBadge) {
      if (status.serverOnline) {
        statusDot.className = isGeneratingStream ? "status-dot pulsing generating" : "status-dot pulsing";
        sessionBadge.textContent = "Server: Online";
        if (serverStatusPill) {
          serverStatusPill.className = "status-pill";
          serverStatusPill.title = `Server: ${status.serverUrl || "http://localhost:3000"} (Healthy)`;
        }
      } else {
        statusDot.className = "status-dot offline";
        sessionBadge.textContent = "Server: Offline";
        if (serverStatusPill) {
          serverStatusPill.className = "status-pill offline";
          serverStatusPill.title = `Server: ${status.serverUrl || "http://localhost:3000"} (Unreachable)`;
        }
      }
    }
    if (modelLabel) {
      modelLabel.textContent = status.activeModel;
    }
    if (modelStatusTag) {
      if (status.modelOnline) {
        modelStatusTag.className = "model-tag online";
        modelStatusTag.textContent = "ONLINE";
      } else {
        modelStatusTag.className = "model-tag offline";
        modelStatusTag.textContent = "OFFLINE";
      }
    }
    if (status.availableModels && status.availableModels.length > 0) {
      renderModelDrawer(status.activeModel, status.availableModels);
    }
  }
  function renderModelDrawer(activeModel, models) {
    if (!modelDrawerList) return;
    modelDrawerList.innerHTML = "";
    for (const m of models) {
      const item = document.createElement("button");
      item.type = "button";
      const isActive = m.id === activeModel || m.name === activeModel || m.id.endsWith(activeModel);
      item.className = `model-option ${isActive ? "active" : ""}`;
      item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span style="font-weight: 600; font-size: 11px;">${escapeHtml(m.name || m.id)}</span>
        ${isActive ? '<span style="color: var(--accent-primary); font-size: 10px;">\u2713 Active</span>' : ""}
      </div>
      <span style="font-size: 9.5px; color: var(--fg-muted);">${escapeHtml(m.id)}</span>
    `;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        postToHost({
          type: "user:switch_model",
          modelId: m.id
        });
        if (modelDrawer) modelDrawer.style.display = "none";
        showToast(`Switched active model to ${m.name || m.id}`);
      });
      modelDrawerList.appendChild(item);
    }
    const qpItem = document.createElement("button");
    qpItem.type = "button";
    qpItem.className = "model-option";
    qpItem.style.borderTop = "1px solid var(--border-subtle)";
    qpItem.style.marginTop = "4px";
    qpItem.style.paddingTop = "6px";
    qpItem.innerHTML = `
    <span style="font-size: 10.5px; color: var(--accent-primary); display: flex; align-items: center; gap: 5px;">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Browse all models (QuickPick)...
    </span>
  `;
    qpItem.addEventListener("click", (e) => {
      e.stopPropagation();
      postToHost({ type: "user:switch_model" });
      if (modelDrawer) modelDrawer.style.display = "none";
    });
    modelDrawerList.appendChild(qpItem);
  }
  btnSubmit?.addEventListener("click", doSubmit);
  promptInput?.addEventListener("input", () => {
    resizePromptInput();
    detectAndQueryMention();
  });
  promptInput?.addEventListener("keydown", (e) => {
    if (mentionRequestActive && mentionPopover?.classList.contains("open")) {
      if (e.key === "ArrowDown" && mentionItems.length > 0) {
        e.preventDefault();
        mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionItems.length;
        renderMentionPopover();
        return;
      }
      if (e.key === "ArrowUp" && mentionItems.length > 0) {
        e.preventDefault();
        mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionItems.length) % mentionItems.length;
        renderMentionPopover();
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey && mentionItems.length > 0) {
        e.preventDefault();
        const chosen = mentionItems[mentionSelectedIndex];
        if (chosen) {
          insertMention(chosen);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMentionPopover();
        return;
      }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSubmit();
    }
  });
  btnMention?.addEventListener("click", () => {
    if (!promptInput) return;
    const start = promptInput.selectionStart ?? promptInput.value.length;
    const end = promptInput.selectionEnd ?? promptInput.value.length;
    const val = promptInput.value;
    const needsSpace = start > 0 && !/\s/.test(val[start - 1]);
    const inserted = needsSpace ? " @" : "@";
    promptInput.value = val.slice(0, start) + inserted + val.slice(end);
    const caret = start + inserted.length;
    promptInput.focus();
    promptInput.setSelectionRange(caret, caret);
    resizePromptInput();
    activeMentionRange = { start: caret - 1, end: caret };
    mentionRequestActive = true;
    postToHost({ type: "user:query_mentions", prefix: "" });
  });
  modelBadge?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!modelDrawer) return;
    const isHidden = modelDrawer.style.display === "none" || !modelDrawer.style.display;
    modelDrawer.style.display = isHidden ? "block" : "none";
  });
  btnRefresh?.addEventListener("click", () => {
    btnRefresh.style.transform = "rotate(180deg)";
    setTimeout(() => {
      btnRefresh.style.transform = "";
    }, 400);
    postToHost({ type: "user:refresh_status" });
  });
  document.addEventListener("click", (e) => {
    if (inputSection && e.target instanceof Node && !inputSection.contains(e.target)) {
      closeMentionPopover();
    }
    if (modelDrawer && modelDrawer.style.display === "block") {
      if (!modelDrawer.contains(e.target) && !modelBadge?.contains(e.target)) {
        modelDrawer.style.display = "none";
      }
    }
  });
  document.querySelectorAll(".quick-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (!promptInput) return;
      const starter = chip.dataset.prompt || "";
      promptInput.value = starter;
      resizePromptInput();
      promptInput.focus();
      const len = promptInput.value.length;
      promptInput.setSelectionRange(len, len);
    });
  });
  btnCopyStream?.addEventListener("click", async () => {
    const text = streamEl?.textContent?.trim() || "";
    if (!text) {
      showToast("Nothing in Agent Stream to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      document.body.removeChild(tmp);
    }
    btnCopyStream.classList.add("copied");
    btnCopyStream.title = "Copied!";
    window.setTimeout(() => {
      btnCopyStream.classList.remove("copied");
      btnCopyStream.title = "Copy stream output";
    }, 1500);
  });
  btnClearStream?.addEventListener("click", () => {
    if (streamEl) streamEl.textContent = "";
    setStreamEmptyVisible(true);
    setStreamStatus("Idle", "idle");
  });
  btnStop?.addEventListener("click", () => {
    postToHost({ type: "user:stop_generation" });
    if (btnStop) btnStop.style.display = "none";
    if (btnSubmit) btnSubmit.style.display = "inline-flex";
    setStreamStatus("Stopped", "idle");
    if (!streamEl?.textContent?.trim()) {
      setStreamEmptyVisible(true);
    }
  });
  btnAcceptAll?.addEventListener("click", () => {
    if (currentReview) {
      postToHost({
        type: "user:file_decision",
        fileId: currentReview.fileId,
        decision: "accept_all"
      });
    }
  });
  btnRejectAll?.addEventListener("click", () => {
    if (currentReview) {
      postToHost({
        type: "user:file_decision",
        fileId: currentReview.fileId,
        decision: "reject_all"
      });
    }
  });
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "stream:text_delta":
        if (streamEl) {
          setStreamEmptyVisible(false);
          streamEl.textContent += msg.delta;
          streamEl.scrollTop = streamEl.scrollHeight;
        }
        break;
      case "stream:event":
        handleStreamEvent(msg.event);
        break;
      case "ledger:updated":
        updateLedger(msg.ledger);
        break;
      case "diff:queue_updated":
        updateDiffQueue(msg.activeReview, msg.queuedCount);
        break;
      case "mentions:results":
        if (mentionRequestActive) {
          mentionItems = msg.items || [];
          mentionSelectedIndex = 0;
          renderMentionPopover();
        }
        break;
      case "status:updated":
        updateStatus(msg);
        break;
    }
  });
  function handleStreamEvent(event) {
    if (event.type === "tool_call_start") {
      if (streamEl) {
        setStreamEmptyVisible(false);
        streamEl.textContent += `

[Tool: ${String(event.toolName ?? "tool")}]...
`;
        streamEl.scrollTop = streamEl.scrollHeight;
      }
    } else if (event.type === "model_failover") {
      const toModel = typeof event.toModel === "string" ? event.toModel : "";
      const fromModel = typeof event.fromModel === "string" ? event.fromModel : "";
      if (toModel && modelLabel) {
        modelLabel.textContent = toModel;
      }
      if (toModel) {
        showToast(`Model failover: ${fromModel || "primary"} \u2192 ${toModel}`);
      }
    } else if (event.type === "turn_complete") {
      setStreamStatus("Complete", "done");
      if (btnStop) btnStop.style.display = "none";
      if (btnSubmit) btnSubmit.style.display = "inline-flex";
      if (!streamEl?.textContent?.trim()) {
        setStreamEmptyVisible(true);
      }
    } else if (event.type === "error") {
      const errMsg = typeof event.message === "string" ? event.message : "Unknown error";
      setStreamStatus("Error", "error");
      if (streamStatus) {
        streamStatus.title = errMsg;
      }
      if (streamEl && !streamEl.textContent?.trim()) {
        setStreamEmptyVisible(false);
        streamEl.textContent = `Error: ${errMsg}`;
      }
      showToast(`Error: ${errMsg}`);
      if (btnStop) btnStop.style.display = "none";
      if (btnSubmit) btnSubmit.style.display = "inline-flex";
    }
  }
  function updateLedger(ledger) {
    if (!ledger) return;
    const pct = ledger.budgetCap > 0 ? Math.min(100, Math.round(ledger.totalTokensUsed / ledger.budgetCap * 100)) : 0;
    if (tokenUsage) {
      tokenUsage.textContent = `${ledger.totalTokensUsed.toLocaleString()} / ${ledger.budgetCap.toLocaleString()} tokens`;
    }
    if (tokenPct) {
      tokenPct.textContent = `${pct}%`;
    }
    if (tokenBar) {
      tokenBar.style.width = `${pct}%`;
      tokenBar.classList.toggle("warn", pct >= 75 && pct < 90);
      tokenBar.classList.toggle("danger", pct >= 90);
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
      const sliceHtml = hasSlices ? ledger.slices.map((s) => {
        const fileName = basename(s.filePath);
        const pinClass = s.pinned ? " pinned" : "";
        const pinBtnClass = s.pinned ? "btn-pin active" : "btn-pin";
        const pinLabel = s.pinned ? "Pinned" : "Pin";
        return `
              <div class="slice-row${pinClass}">
                <div class="slice-main">
                  <div class="slice-rationale" title="${escapeAttr(s.rationale)}">
                    ${s.pinned ? "\u{1F4CC} " : ""}${escapeHtml(s.rationale)}
                  </div>
                  <div class="slice-meta">
                    <span class="meta-pill" title="${escapeAttr(s.filePath)}">${escapeHtml(fileName)} \xB7 L${s.startLine}\u2013${s.endLine}</span>
                    <span class="meta-pill tokens">${s.tokens.toLocaleString()} tok</span>
                  </div>
                </div>
                <button type="button" class="${pinBtnClass}" data-slice-id="${escapeAttr(s.id)}" data-pinned="${s.pinned ? "true" : "false"}" data-action="toggle_pin">
                  ${pinLabel}
                </button>
              </div>
            `;
      }).join("") : "";
      const tocHtml = hasToc ? `
        <div class="toc-section">
          <div class="toc-heading">
            <span>Overflow TOC</span>
            <span class="badge amber">${ledger.overflowToc.length}</span>
          </div>
          ${ledger.overflowToc.map((t) => {
        const fileName = basename(t.filePath);
        return `
                <div class="toc-row">
                  <div class="toc-info">
                    <span class="toc-symbol" title="${escapeAttr(t.symbolName)}">\u26A1 ${escapeHtml(t.symbolName)}</span>
                    <div class="slice-meta">
                      <span class="meta-pill" title="${escapeAttr(t.filePath)}">${escapeHtml(fileName)} \xB7 L${t.startLine}\u2013${t.endLine}</span>
                      <span class="meta-pill">~${t.tokens.toLocaleString()} tok</span>
                    </div>
                  </div>
                  <button type="button" class="btn-promote" data-toc-id="${escapeAttr(t.id)}" data-action="promote_toc">
                    + Promote
                  </button>
                </div>
              `;
      }).join("")}
        </div>
      ` : "";
      ledgerSlices.innerHTML = sliceHtml + tocHtml;
      ledgerSlices.querySelectorAll('button[data-action="toggle_pin"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const sliceId = btn.dataset.sliceId;
          const wasPinned = btn.dataset.pinned === "true";
          if (sliceId) {
            postToHost({
              type: "user:pin_slice",
              sliceId,
              pinned: !wasPinned
            });
          }
        });
      });
      ledgerSlices.querySelectorAll('button[data-action="promote_toc"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const tocEntryId = btn.dataset.tocId;
          if (tocEntryId) {
            postToHost({
              type: "user:promote_toc",
              tocEntryId
            });
          }
        });
      });
    }
  }
  function renderDiffPreview(hunk) {
    const oldLines = hunk.oldText ? hunk.oldText.split(/\r?\n/) : [];
    const newLines = hunk.newText ? hunk.newText.split(/\r?\n/) : [];
    if (oldLines.length === 0 && newLines.length === 0) return "";
    const maxLinesPerSide = 4;
    const delShown = oldLines.slice(0, maxLinesPerSide);
    const addShown = newLines.slice(0, maxLinesPerSide);
    const hiddenCount = Math.max(0, oldLines.length - maxLinesPerSide) + Math.max(0, newLines.length - maxLinesPerSide);
    const delHtml = delShown.map((line) => `<span class="diff-line del">- ${escapeHtml(line)}</span>`).join("");
    const addHtml = addShown.map((line) => `<span class="diff-line add">+ ${escapeHtml(line)}</span>`).join("");
    const moreHtml = hiddenCount > 0 ? `<span class="diff-line more">\u2026 ${hiddenCount} more line${hiddenCount === 1 ? "" : "s"} (open Side-by-Side Diff)</span>` : "";
    return `<div class="hunk-diff-preview">${delHtml}${addHtml}${moreHtml}</div>`;
  }
  function updateDiffQueue(activeReview, queuedCount) {
    currentReview = activeReview;
    if (!diffCard || !reviewTitle || !hunksList) return;
    if (!activeReview) {
      diffCard.style.display = "none";
      hunksList.innerHTML = "";
      return;
    }
    diffCard.style.display = "block";
    diffCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const filename = basename(activeReview.filePath);
    reviewTitle.textContent = `${filename}${queuedCount > 0 ? ` (+${queuedCount} queued)` : ""}`;
    reviewTitle.title = activeReview.filePath;
    hunksList.innerHTML = activeReview.hunks.map((hunk) => {
      const statusBadge = hunk.status === "accepted" ? '<span class="badge green">Accepted</span>' : hunk.status === "rejected" ? '<span class="badge red">Rejected</span>' : '<span class="badge amber">Pending</span>';
      const lspBadge = hunk.shadowDiagnostics === void 0 ? "" : hunk.shadowDiagnostics.zeroRegression ? '<span class="lsp-pill ok">\u2713 LSP: 0 errors</span>' : `<span class="lsp-pill warn">\u26A0 LSP: ${hunk.shadowDiagnostics.newErrors} issue${hunk.shadowDiagnostics.newErrors === 1 ? "" : "s"}</span>`;
      const endLine = hunk.oldStart + Math.max(0, hunk.oldLines - 1);
      const previewHtml = renderDiffPreview(hunk);
      const actions = hunk.status === "pending" ? `
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
          ` : "";
      return `
        <div class="hunk-item ${escapeAttr(hunk.status)}">
          <div class="hunk-top">
            <button type="button" class="hunk-loc-btn" data-action="reveal" data-file-path="${escapeAttr(activeReview.filePath)}" data-line="${hunk.oldStart}" title="Reveal in editor">
              <span>Hunk #${hunk.index + 1}</span>
              <span class="hunk-lines-pill">L${hunk.oldStart}\u2013${endLine}</span>
            </button>
            <div class="hunk-badges">${lspBadge}${statusBadge}</div>
          </div>
          <div class="hunk-rationale">${escapeHtml(hunk.rationale || "Proposed edit")}</div>
          ${previewHtml}
          ${actions}
        </div>
      `;
    }).join("");
    hunksList.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const hunkId = btn.dataset.hunkId;
        const fileId = btn.dataset.fileId;
        const hunkIndex = btn.dataset.hunkIndex ? parseInt(btn.dataset.hunkIndex, 10) : void 0;
        if (action === "accept" && hunkId) {
          postToHost({
            type: "user:hunk_decision",
            hunkId,
            decision: "accepted"
          });
        } else if (action === "reject" && hunkId) {
          postToHost({
            type: "user:hunk_decision",
            hunkId,
            decision: "rejected"
          });
        } else if (action === "diff" && fileId) {
          postToHost({
            type: "user:toggle_native_diff",
            fileId,
            hunkIndex
          });
        } else if (action === "reveal") {
          const filePath = btn.dataset.filePath;
          const line = btn.dataset.line ? parseInt(btn.dataset.line, 10) : 1;
          if (filePath) {
            postToHost({
              type: "user:reveal_hunk",
              filePath,
              line
            });
          }
        }
      });
    });
  }
  function basename(filePath) {
    return filePath.split(/[/\\]/).pop() || filePath;
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
//# sourceMappingURL=index.js.map
