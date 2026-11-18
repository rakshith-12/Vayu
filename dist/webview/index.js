"use strict";
(() => {
  // src/webview/ui/index.ts
  var vscode = acquireVsCodeApi();
  var streamEl = document.getElementById("chat-stream");
  var streamStatus = document.getElementById("stream-status");
  var promptInput = document.getElementById("prompt-input");
  var modeSelect = document.getElementById("mode-select");
  var btnSubmit = document.getElementById("btn-submit");
  var btnStop = document.getElementById("btn-stop");
  var diffCard = document.getElementById("diff-card");
  var hunksList = document.getElementById("hunks-list");
  var reviewTitle = document.getElementById("review-title");
  var btnAcceptAll = document.getElementById("btn-accept-all");
  var btnRejectAll = document.getElementById("btn-reject-all");
  var tokenUsage = document.getElementById("token-usage");
  var tokenBar = document.getElementById("token-bar");
  var ledgerSlices = document.getElementById("ledger-slices");
  var modelBadge = document.getElementById("model-badge");
  var currentReview = null;
  function doSubmit() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    vscode.postMessage({
      type: "user:submit_turn",
      prompt,
      mode: modeSelect.value
    });
    promptInput.value = "";
    if (streamEl) streamEl.textContent = "";
    if (btnSubmit) btnSubmit.style.display = "none";
    if (btnStop) btnStop.style.display = "inline-flex";
    if (streamStatus) streamStatus.textContent = "Generating...";
  }
  btnSubmit?.addEventListener("click", doSubmit);
  promptInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSubmit();
    }
  });
  modelBadge?.addEventListener("click", () => {
    vscode.postMessage({
      type: "user:query_mentions",
      query: "@model"
    });
  });
  btnStop?.addEventListener("click", () => {
    vscode.postMessage({ type: "user:stop_generation" });
    if (btnStop) btnStop.style.display = "none";
    if (btnSubmit) btnSubmit.style.display = "inline-flex";
    if (streamStatus) streamStatus.textContent = "Stopped";
  });
  btnAcceptAll?.addEventListener("click", () => {
    if (currentReview) {
      vscode.postMessage({
        type: "user:file_decision",
        fileId: currentReview.fileId,
        decision: "accept_all"
      });
    }
  });
  btnRejectAll?.addEventListener("click", () => {
    if (currentReview) {
      vscode.postMessage({
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
          if (streamEl.textContent === "Awaiting instruction...") {
            streamEl.textContent = "";
          }
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
    }
  });
  function handleStreamEvent(event) {
    if (event.type === "tool_call_start") {
      if (streamEl) {
        streamEl.textContent += `

[Tool: ${event.toolName}]...
`;
      }
    } else if (event.type === "turn_complete") {
      if (streamStatus) streamStatus.textContent = "Complete";
      if (btnStop) btnStop.style.display = "none";
      if (btnSubmit) btnSubmit.style.display = "inline-flex";
    } else if (event.type === "error") {
      if (streamStatus) streamStatus.textContent = `Error: ${event.message}`;
      if (btnStop) btnStop.style.display = "none";
      if (btnSubmit) btnSubmit.style.display = "inline-flex";
    }
  }
  function updateLedger(ledger) {
    if (!ledger) return;
    if (tokenUsage) {
      tokenUsage.textContent = `${ledger.totalTokensUsed.toLocaleString()} / ${ledger.budgetCap.toLocaleString()} tokens`;
    }
    if (tokenBar) {
      const pct = Math.min(100, Math.round(ledger.totalTokensUsed / ledger.budgetCap * 100));
      tokenBar.style.width = `${pct}%`;
    }
    if (ledgerSlices) {
      const sliceHtml = ledger.slices && ledger.slices.length > 0 ? ledger.slices.map(
        (s) => `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <span>${s.pinned ? "\u{1F4CC} " : "\u2022 "}${escapeHtml(s.rationale)} (${s.tokens} tok)</span>
            <button class="secondary" style="padding: 1px 5px; font-size: 10px;" data-slice-id="${s.id}" data-pinned="${s.pinned ? "true" : "false"}" data-action="toggle_pin">
              ${s.pinned ? "Unpin" : "Pin"}
            </button>
          </div>
        `
      ).join("") : "<div>No active slices</div>";
      const tocHtml = ledger.overflowToc && ledger.overflowToc.length > 0 ? `
        <div style="margin-top: 8px; border-top: 1px solid var(--border); padding-top: 6px;">
          <strong style="font-size: 11px;">Overflow TOC (${ledger.overflowToc.length} symbols):</strong>
          ${ledger.overflowToc.map(
        (t) => `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 11px;">
              <span>\u26A1 ${escapeHtml(t.symbolName)} (~${t.tokens} tok)</span>
              <button class="btn-green" style="padding: 1px 5px; font-size: 10px;" data-toc-id="${t.id}" data-action="promote_toc">
                + Promote
              </button>
            </div>
          `
      ).join("")}
        </div>
      ` : "";
      ledgerSlices.innerHTML = sliceHtml + tocHtml;
      ledgerSlices.querySelectorAll('button[data-action="toggle_pin"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const sliceId = btn.dataset.sliceId;
          const wasPinned = btn.dataset.pinned === "true";
          if (sliceId) {
            vscode.postMessage({
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
            vscode.postMessage({
              type: "user:promote_toc",
              tocEntryId
            });
          }
        });
      });
    }
  }
  function updateDiffQueue(activeReview, queuedCount) {
    currentReview = activeReview;
    if (!diffCard || !reviewTitle || !hunksList) return;
    if (!activeReview) {
      diffCard.style.display = "none";
      return;
    }
    diffCard.style.display = "block";
    diffCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const filename = activeReview.filePath.split(/[/\\]/).pop() || activeReview.filePath;
    reviewTitle.textContent = `${filename}${queuedCount > 0 ? ` (+${queuedCount} queued)` : ""}`;
    hunksList.innerHTML = activeReview.hunks.map((hunk) => {
      const statusBadge = hunk.status === "accepted" ? '<span class="badge green">Accepted</span>' : hunk.status === "rejected" ? '<span class="badge red">Rejected</span>' : '<span class="badge">Pending</span>';
      const lspBadge = hunk.shadowDiagnostics?.zeroRegression ? '<span style="color: #388a34; font-size: 11px;">\u2713 LSP: 0 errors</span>' : '<span style="color: #fce100; font-size: 11px;">\u26A0\uFE0F LSP issues</span>';
      const actions = hunk.status === "pending" ? `
        <div class="hunk-actions">
          <button class="btn-green" data-hunk-id="${hunk.id}" data-action="accept">Accept</button>
          <button class="btn-red" data-hunk-id="${hunk.id}" data-action="reject">Reject</button>
          <button class="secondary" data-file-id="${activeReview.fileId}" data-hunk-index="${hunk.index}" data-action="diff">Diff</button>
        </div>
      ` : "";
      return `
        <div class="hunk-item ${hunk.status}">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span><strong>Hunk #${hunk.index + 1}</strong> (lines ${hunk.oldStart}-${hunk.oldStart + hunk.oldLines})</span>
            <div>${lspBadge} ${statusBadge}</div>
          </div>
          <div style="font-size: 11px; opacity: 0.9;">${escapeHtml(hunk.rationale || "Proposed edit")}</div>
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
          vscode.postMessage({
            type: "user:hunk_decision",
            hunkId,
            decision: "accepted"
          });
        } else if (action === "reject" && hunkId) {
          vscode.postMessage({
            type: "user:hunk_decision",
            hunkId,
            decision: "rejected"
          });
        } else if (action === "diff" && fileId) {
          vscode.postMessage({
            type: "user:toggle_native_diff",
            fileId,
            hunkIndex
          });
        }
      });
    });
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
//# sourceMappingURL=index.js.map
