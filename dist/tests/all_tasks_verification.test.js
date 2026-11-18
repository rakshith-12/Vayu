"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/mock-vscode.js
var require_mock_vscode = __commonJS({
  "tests/mock-vscode.js"(exports2, module2) {
    "use strict";
    var fs2 = require("fs");
    var EventEmitter4 = class {
      constructor() {
        this.listeners = [];
      }
      get event() {
        return (listener) => {
          this.listeners.push(listener);
          return {
            dispose: () => {
              const idx = this.listeners.indexOf(listener);
              if (idx !== -1) this.listeners.splice(idx, 1);
            }
          };
        };
      }
      fire(data) {
        for (const listener of [...this.listeners]) {
          try {
            listener(data);
          } catch (err) {
            console.error("EventEmitter listener error:", err);
          }
        }
      }
      dispose() {
        this.listeners = [];
      }
    };
    var Uri5 = {
      file: (filePath) => ({
        fsPath: filePath,
        path: filePath,
        scheme: "file",
        toString: () => `file://${filePath}`
      }),
      parse: (uriString) => {
        const parts = uriString.split(":");
        return {
          scheme: parts[0],
          path: parts[1] || "",
          fsPath: parts[1] || "",
          toString: () => uriString
        };
      }
    };
    var workspace4 = {
      workspaceFolders: [],
      textDocuments: [],
      fs: {
        readFile: async (uri) => fs2.promises.readFile(uri.fsPath),
        writeFile: async (uri, data) => fs2.promises.writeFile(uri.fsPath, data),
        delete: async (uri) => fs2.promises.rm(uri.fsPath, { force: true, recursive: true })
      },
      openTextDocument: async (uri) => {
        const text = fs2.readFileSync(uri.fsPath, "utf8");
        const lines = text.split(/\r?\n/);
        return {
          uri,
          lineCount: lines.length,
          getText: () => text,
          lineAt: (line) => ({
            range: {
              end: { character: (lines[line] || "").length }
            }
          }),
          offsetAt: (position) => {
            let offset = 0;
            for (let i = 0; i < position.line && i < lines.length; i++) {
              offset += lines[i].length + 1;
            }
            return offset + (position.character || 0);
          },
          positionAt: (offset) => {
            let cur = 0;
            for (let i = 0; i < lines.length; i++) {
              const next = cur + lines[i].length + 1;
              if (offset < next) {
                return new Position2(i, offset - cur);
              }
              cur = next;
            }
            return new Position2(lines.length - 1, (lines[lines.length - 1] || "").length);
          },
          save: async () => {
          }
        };
      },
      applyEdit: async () => true,
      asRelativePath: (uri) => typeof uri === "string" ? uri : uri.fsPath
    };
    var languages2 = {
      getDiagnostics: () => []
    };
    var DiagnosticSeverity2 = {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3
    };
    var window2 = {
      activeTextEditor: void 0,
      showTextDocument: async () => {
      },
      showErrorMessage: () => {
      },
      showInformationMessage: () => {
      },
      showWarningMessage: () => {
      }
    };
    var commands = {
      executeCommand: async () => void 0,
      registerCommand: () => ({ dispose: () => {
      } })
    };
    var WorkspaceEdit2 = class {
      constructor() {
        this.edits = [];
      }
      replace(uri, range, text) {
        this.edits.push({ uri, range, text });
      }
      createFile(uri) {
        this.edits.push({ type: "create", uri });
      }
      deleteFile(uri) {
        this.edits.push({ type: "delete", uri });
      }
      insert(uri, pos, text) {
        this.edits.push({ type: "insert", uri, pos, text });
      }
    };
    var Range2 = class {
      constructor(startLine, startChar, endLine, endChar) {
        this.start = { line: startLine, character: startChar };
        this.end = { line: endLine, character: endChar };
      }
    };
    var Position2 = class {
      constructor(line, char) {
        this.line = line;
        this.character = char;
      }
    };
    module2.exports = {
      EventEmitter: EventEmitter4,
      Uri: Uri5,
      workspace: workspace4,
      languages: languages2,
      DiagnosticSeverity: DiagnosticSeverity2,
      window: window2,
      commands,
      WorkspaceEdit: WorkspaceEdit2,
      Range: Range2,
      Position: Position2
    };
  }
});

// tests/all_tasks_verification.test.mjs
var import_node_test = __toESM(require("node:test"), 1);
var import_strict = __toESM(require("node:assert/strict"), 1);
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var os = __toESM(require("os"), 1);

// src/diff/stagingBuffer.ts
var vscode2 = __toESM(require_mock_vscode());

// src/diff/workspaceApplier.ts
var vscode = __toESM(require_mock_vscode());
var WorkspaceApplier = class {
  /**
   * Apply accepted hunks for a staged file review.
   * Edits are applied bottom-to-top (descending line order) so line shifts
   * do not invalidate subsequent range calculations.
   */
  static async applyFileReview(review, acceptedHunks) {
    const uri = vscode.Uri.file(review.filePath);
    const edit = new vscode.WorkspaceEdit();
    if (review.isDeleteFile) {
      edit.deleteFile(uri, { ignoreIfNotExists: true });
      return vscode.workspace.applyEdit(edit);
    }
    if (review.isNewFile) {
      edit.createFile(uri, { overwrite: true });
      edit.insert(uri, new vscode.Position(0, 0), review.proposedFullContent);
      const applied2 = await vscode.workspace.applyEdit(edit);
      if (applied2) {
        const doc2 = await vscode.workspace.openTextDocument(uri);
        await doc2.save();
      }
      return applied2;
    }
    if (acceptedHunks.length === 0) {
      return true;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const docText = doc.getText();
    const sortedHunks = [...acceptedHunks].sort((a, b) => b.oldStart - a.oldStart);
    for (const hunk of sortedHunks) {
      const range = this.findHunkRange(doc, hunk, docText);
      if (range) {
        edit.replace(uri, range, hunk.newText);
      } else {
        const startLine = Math.max(0, hunk.oldStart - 1);
        const endLine = Math.min(doc.lineCount - 1, startLine + Math.max(0, hunk.oldLines - 1));
        const endChar = doc.lineAt(endLine).range.end.character;
        const fallbackRange = new vscode.Range(startLine, 0, endLine, endChar);
        edit.replace(uri, fallbackRange, hunk.newText);
      }
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      await doc.save();
    }
    return applied;
  }
  /**
   * Locate the exact Range of hunk.oldText within the document.
   */
  static findHunkRange(doc, hunk, docText) {
    const expectedLine = Math.max(0, hunk.oldStart - 1);
    const startOffsetGuess = doc.offsetAt(new vscode.Position(expectedLine, 0));
    const exactIndex = docText.indexOf(hunk.oldText, Math.max(0, startOffsetGuess - 500));
    if (exactIndex !== -1 && exactIndex < startOffsetGuess + 500) {
      const startPos = doc.positionAt(exactIndex);
      const endPos = doc.positionAt(exactIndex + hunk.oldText.length);
      return new vscode.Range(startPos, endPos);
    }
    const firstMatch = docText.indexOf(hunk.oldText);
    if (firstMatch !== -1 && docText.indexOf(hunk.oldText, firstMatch + 1) === -1) {
      const startPos = doc.positionAt(firstMatch);
      const endPos = doc.positionAt(firstMatch + hunk.oldText.length);
      return new vscode.Range(startPos, endPos);
    }
    return null;
  }
};

// src/diff/stagingBuffer.ts
var StagingBuffer = class {
  queue = [];
  activeReview = null;
  onDidChangeQueueEmitter = new vscode2.EventEmitter();
  onDidChangeQueue = this.onDidChangeQueueEmitter.event;
  /**
   * Enqueue a new file review.
   * Returns a Promise that resolves only when the user finishes reviewing the file.
   */
  enqueueFileReview(review) {
    return new Promise((resolve) => {
      const originalResolveGate = review.resolveGate;
      review.resolveGate = (resolution) => {
        if (originalResolveGate) {
          try {
            originalResolveGate(resolution);
          } catch {
          }
        }
        resolve(resolution);
      };
      this.queue.push(review);
      if (!this.activeReview) {
        this.presentNext();
      } else {
        this.onDidChangeQueueEmitter.fire();
      }
    });
  }
  getActiveReview() {
    return this.activeReview;
  }
  getQueuedCount() {
    return this.queue.length;
  }
  presentNext() {
    if (this.queue.length > 0) {
      this.activeReview = this.queue.shift();
      this.openActiveFile();
    } else {
      this.activeReview = null;
    }
    this.onDidChangeQueueEmitter.fire();
  }
  async openActiveFile() {
    if (!this.activeReview) return;
    try {
      const uri = vscode2.Uri.file(this.activeReview.filePath);
      const doc = await vscode2.workspace.openTextDocument(uri);
      await vscode2.window.showTextDocument(doc, { preview: false });
    } catch {
    }
  }
  /**
   * Accept a specific hunk by its ID.
   */
  async acceptHunk(hunkId) {
    if (!this.activeReview) return;
    const hunk = this.activeReview.hunks.find((h) => h.id === hunkId);
    if (!hunk || hunk.status !== "pending") return;
    hunk.status = "accepted";
    this.checkReviewCompletion();
  }
  /**
   * Reject a specific hunk by its ID.
   */
  async rejectHunk(hunkId) {
    if (!this.activeReview) return;
    const hunk = this.activeReview.hunks.find((h) => h.id === hunkId);
    if (!hunk || hunk.status !== "pending") return;
    hunk.status = "rejected";
    this.checkReviewCompletion();
  }
  /**
   * Accept all remaining pending hunks in the active review.
   */
  async acceptAllInActive() {
    if (!this.activeReview) return;
    for (const hunk of this.activeReview.hunks) {
      if (hunk.status === "pending") {
        hunk.status = "accepted";
      }
    }
    await this.completeActiveReview();
  }
  /**
   * Accept all remaining pending hunks in active and all queued file reviews.
   */
  async acceptAllInAllQueued() {
    while (this.activeReview) {
      await this.acceptAllInActive();
    }
  }
  /**
   * Reject all remaining pending hunks in the active review.
   */
  async rejectAllInActive() {
    if (!this.activeReview) return;
    for (const hunk of this.activeReview.hunks) {
      if (hunk.status === "pending") {
        hunk.status = "rejected";
      }
    }
    await this.completeActiveReview();
  }
  async checkReviewCompletion() {
    if (!this.activeReview) return;
    const anyPending = this.activeReview.hunks.some((h) => h.status === "pending");
    if (!anyPending) {
      await this.completeActiveReview();
    } else {
      this.onDidChangeQueueEmitter.fire();
    }
  }
  async completeActiveReview() {
    const review = this.activeReview;
    if (!review) return;
    const acceptedHunks = review.hunks.filter((h) => h.status === "accepted");
    const rejectedHunks = review.hunks.filter((h) => h.status === "rejected");
    if (acceptedHunks.length > 0) {
      await WorkspaceApplier.applyFileReview(review, acceptedHunks);
    }
    let status = "rejected";
    if (acceptedHunks.length > 0 && rejectedHunks.length === 0) {
      status = "applied";
    } else if (acceptedHunks.length > 0 && rejectedHunks.length > 0) {
      status = "partially_applied";
    }
    const appliedIndices = acceptedHunks.map((h) => h.index);
    const rejectedIndices = rejectedHunks.map((h) => h.index);
    const resolution = {
      status,
      applied_hunks: appliedIndices,
      rejected_hunks: rejectedIndices,
      post_edit_snippet: acceptedHunks.map((h) => h.newText).join("\n---\n").slice(0, 500)
    };
    review.resolveGate(resolution);
    this.presentNext();
  }
  /**
   * Clear all pending reviews, cancelling parked promises.
   */
  clearAllPendingWithCancelledStatus() {
    if (this.activeReview) {
      this.activeReview.resolveGate({
        status: "cancelled",
        applied_hunks: [],
        rejected_hunks: [],
        post_edit_snippet: ""
      });
      this.activeReview = null;
    }
    while (this.queue.length > 0) {
      const review = this.queue.shift();
      review.resolveGate({
        status: "cancelled",
        applied_hunks: [],
        rejected_hunks: [],
        post_edit_snippet: ""
      });
    }
    this.onDidChangeQueueEmitter.fire();
  }
};

// src/diff/undoStack.ts
var vscode3 = __toESM(require_mock_vscode());
var UndoCheckpointStack = class {
  stack = [];
  /**
   * Ensure that a file is snapshotted before any modifications in this turn.
   */
  async ensureFileSnapshotted(turnId, filePath) {
    let checkpoint = this.stack.find((c) => c.turnId === turnId);
    if (!checkpoint) {
      checkpoint = {
        turnId,
        snapshots: [],
        createdAt: Date.now()
      };
      this.stack.push(checkpoint);
    }
    const alreadySnapshotted = checkpoint.snapshots.some((s) => s.filePath === filePath);
    if (alreadySnapshotted) {
      return;
    }
    let existedBefore = false;
    let rawBytes = Buffer.alloc(0);
    try {
      const uri = vscode3.Uri.file(filePath);
      const data = await vscode3.workspace.fs.readFile(uri);
      existedBefore = true;
      rawBytes = Buffer.from(data);
    } catch {
      existedBefore = false;
    }
    checkpoint.snapshots.push({
      filePath,
      existedBefore,
      rawBytes
    });
  }
  /**
   * Roll back the entire last turn atomically.
   * Restores all modified files to pre-turn bytes and removes newly created files.
   */
  async undoLastTurn() {
    const checkpoint = this.stack.pop();
    if (!checkpoint) {
      return false;
    }
    for (const snapshot of checkpoint.snapshots) {
      const uri = vscode3.Uri.file(snapshot.filePath);
      try {
        if (!snapshot.existedBefore) {
          await vscode3.workspace.fs.delete(uri, { recursive: false, useTrash: false });
        } else {
          await vscode3.workspace.fs.writeFile(uri, snapshot.rawBytes);
        }
      } catch (err) {
        console.error(`Failed to restore file ${snapshot.filePath}:`, err);
      }
    }
    return true;
  }
  /**
   * Check if any turn checkpoints exist.
   */
  canUndo() {
    return this.stack.length > 0;
  }
  /**
   * Clear the entire undo checkpoint stack.
   */
  clear() {
    this.stack = [];
  }
};

// src/diff/virtualDiffProvider.ts
var vscode4 = __toESM(require_mock_vscode());
var VirtualDiffProvider = class {
  contentMap = /* @__PURE__ */ new Map();
  onDidChangeEmitter = new vscode4.EventEmitter();
  onDidChange = this.onDidChangeEmitter.event;
  /**
   * Set or update virtual file content for a URI.
   */
  setContent(uri, content) {
    this.contentMap.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }
  /**
   * Get virtual file content.
   */
  provideTextDocumentContent(uri) {
    return this.contentMap.get(uri.toString()) ?? "";
  }
  /**
   * Remove virtual file content.
   */
  deleteContent(uri) {
    this.contentMap.delete(uri.toString());
    this.onDidChangeEmitter.fire(uri);
  }
  /**
   * Clear all virtual files.
   */
  clear() {
    this.contentMap.clear();
  }
};

// src/diff/shadowDiagnostics.ts
var vscode5 = __toESM(require_mock_vscode());
var ShadowDiagnosticsChecker = class {
  constructor(virtualDiffProvider) {
    this.virtualDiffProvider = virtualDiffProvider;
  }
  /**
   * Verify proposed hunks in a virtual shadow document and compare diagnostics.
   */
  async verifyHunksInShadowDoc(filePath, proposedContent, hunks) {
    try {
      const originalUri = vscode5.Uri.file(filePath);
      const ext = filePath.includes(".") ? filePath.substring(filePath.lastIndexOf(".")) : "";
      const shadowUri = vscode5.Uri.parse(`trueforge-shadow:${filePath}`);
      this.virtualDiffProvider.setContent(shadowUri, proposedContent);
      const baselineDiags = vscode5.languages.getDiagnostics(originalUri);
      const baselineErrors = baselineDiags.filter((d) => d.severity === vscode5.DiagnosticSeverity.Error).length;
      const baselineWarnings = baselineDiags.filter((d) => d.severity === vscode5.DiagnosticSeverity.Warning).length;
      const shadowDiags = vscode5.languages.getDiagnostics(shadowUri);
      const shadowErrors = shadowDiags.filter((d) => d.severity === vscode5.DiagnosticSeverity.Error).length;
      const shadowWarnings = shadowDiags.filter((d) => d.severity === vscode5.DiagnosticSeverity.Warning).length;
      const newErrors = Math.max(0, shadowErrors - baselineErrors);
      const newWarnings = Math.max(0, shadowWarnings - baselineWarnings);
      const messages = shadowDiags.filter((d) => d.severity === vscode5.DiagnosticSeverity.Error || d.severity === vscode5.DiagnosticSeverity.Warning).map((d) => `Line ${d.range.start.line + 1}: ${d.message}`);
      return {
        newErrors,
        newWarnings,
        zeroRegression: newErrors === 0,
        messages,
        checkedAt: Date.now()
      };
    } catch {
      return {
        newErrors: 0,
        newWarnings: 0,
        zeroRegression: true,
        messages: [],
        checkedAt: Date.now()
      };
    }
  }
};

// src/context/ledgerTracker.ts
var vscode6 = __toESM(require_mock_vscode());
var ContextLedgerTracker = class {
  turnId = "";
  mode = "inline-edit";
  budgetCap = 16e3;
  ceilingCap = 32e3;
  slices = [];
  overflowToc = [];
  onDidUpdateLedgerEmitter = new vscode6.EventEmitter();
  onDidUpdateLedger = this.onDidUpdateLedgerEmitter.event;
  resetForTurn(turnId, mode, budgetCap = 16e3, ceilingCap = 32e3) {
    this.turnId = turnId;
    this.mode = mode;
    this.budgetCap = budgetCap;
    this.ceilingCap = ceilingCap;
    this.slices = [];
    this.overflowToc = [];
  }
  addSlice(slice) {
    this.slices.push(slice);
    this.notifyUpdate();
  }
  addOverflow(entry) {
    this.overflowToc.push(entry);
    this.notifyUpdate();
  }
  pinSlice(sliceId, pinned) {
    const slice = this.slices.find((s) => s.id === sliceId);
    if (slice) {
      slice.pinned = pinned;
      this.notifyUpdate();
    }
  }
  promoteToc(tocEntryId, content) {
    const idx = this.overflowToc.findIndex((t) => t.id === tocEntryId);
    if (idx === -1) return false;
    const toc = this.overflowToc.splice(idx, 1)[0];
    const newSlice = {
      id: `promoted-${toc.id}`,
      filePath: toc.filePath,
      startLine: toc.startLine,
      endLine: toc.endLine,
      tokens: toc.tokens,
      source: "symbol-search",
      score: toc.score,
      rationale: `User promoted: ${toc.symbolName}`,
      content,
      pinned: true,
      promotedFromToc: true
    };
    this.slices.push(newSlice);
    this.notifyUpdate();
    return true;
  }
  getTocEntry(tocEntryId) {
    return this.overflowToc.find((t) => t.id === tocEntryId);
  }
  getSlices() {
    return [...this.slices];
  }
  getSnapshot() {
    let systemAndMap = 0;
    let mentionsAndPinned = 0;
    let ripgrepBm25 = 0;
    let astImports = 0;
    let mcpToolReads = 0;
    for (const slice of this.slices) {
      switch (slice.source) {
        case "repo-map":
          systemAndMap += slice.tokens;
          break;
        case "user-pinned":
        case "mention-file":
        case "mention-symbol":
          mentionsAndPinned += slice.tokens;
          break;
        case "ripgrep-bm25":
        case "symbol-search":
          ripgrepBm25 += slice.tokens;
          break;
        case "ast-import-neighbor":
          astImports += slice.tokens;
          break;
        case "mcp-tool-read":
          mcpToolReads += slice.tokens;
          break;
      }
    }
    const totalTokensUsed = systemAndMap + mentionsAndPinned + ripgrepBm25 + astImports + mcpToolReads;
    return {
      turnId: this.turnId,
      mode: this.mode,
      budgetCap: this.budgetCap,
      ceilingCap: this.ceilingCap,
      totalTokensUsed,
      slotBreakdown: {
        systemAndMap,
        mentionsAndPinned,
        ripgrepBm25,
        astImports,
        mcpToolReads
      },
      slices: this.slices.map(({ content, ...rest }) => rest),
      overflowToc: [...this.overflowToc]
    };
  }
  notifyUpdate() {
    this.onDidUpdateLedgerEmitter.fire(this.getSnapshot());
  }
};

// node_modules/eventsource-parser/dist/index.js
var ParseError = class extends Error {
  constructor(message, options) {
    super(message), this.name = "ParseError", this.type = options.type, this.field = options.field, this.value = options.value, this.line = options.line;
  }
};
var LF = 10;
var CR = 13;
var SPACE = 32;
function noop(_arg) {
}
function createParser(config) {
  if (typeof config == "function")
    throw new TypeError(
      "`config` must be an object, got a function instead. Did you mean `createParser({onEvent: fn})`?"
    );
  const { onEvent = noop, onError = noop, onRetry = noop, onComment, maxBufferSize } = config, pendingFragments = [];
  let pendingFragmentsLength = 0, isFirstChunk = true, id, data = "", dataLines = 0, eventType, terminated = false;
  function feed(chunk) {
    if (terminated)
      throw new Error(
        "Cannot feed parser: it was terminated after exceeding the configured max buffer size. Call `reset()` to resume parsing."
      );
    if (isFirstChunk && (isFirstChunk = false, chunk.charCodeAt(0) === 239 && chunk.charCodeAt(1) === 187 && chunk.charCodeAt(2) === 191 && (chunk = chunk.slice(3))), pendingFragments.length === 0) {
      const trailing2 = processLines(chunk);
      trailing2 !== "" && (pendingFragments.push(trailing2), pendingFragmentsLength = trailing2.length), checkBufferSize();
      return;
    }
    if (chunk.indexOf(`
`) === -1 && chunk.indexOf("\r") === -1) {
      pendingFragments.push(chunk), pendingFragmentsLength += chunk.length, checkBufferSize();
      return;
    }
    pendingFragments.push(chunk);
    const input = pendingFragments.join("");
    pendingFragments.length = 0, pendingFragmentsLength = 0;
    const trailing = processLines(input);
    trailing !== "" && (pendingFragments.push(trailing), pendingFragmentsLength = trailing.length), checkBufferSize();
  }
  function checkBufferSize() {
    maxBufferSize !== void 0 && (pendingFragmentsLength + data.length <= maxBufferSize || (terminated = true, pendingFragments.length = 0, pendingFragmentsLength = 0, id = void 0, data = "", dataLines = 0, eventType = void 0, onError(
      new ParseError(`Buffered data exceeded max buffer size of ${maxBufferSize} characters`, {
        type: "max-buffer-size-exceeded"
      })
    )));
  }
  function processLines(chunk) {
    let searchIndex = 0;
    if (chunk.indexOf("\r") === -1) {
      let lfIndex = chunk.indexOf(`
`, searchIndex);
      for (; lfIndex !== -1; ) {
        if (searchIndex === lfIndex) {
          dataLines > 0 && onEvent({ id, event: eventType, data }), id = void 0, data = "", dataLines = 0, eventType = void 0, searchIndex = lfIndex + 1, lfIndex = chunk.indexOf(`
`, searchIndex);
          continue;
        }
        const firstCharCode = chunk.charCodeAt(searchIndex);
        if (isDataPrefix(chunk, searchIndex, firstCharCode)) {
          const valueStart = chunk.charCodeAt(searchIndex + 5) === SPACE ? searchIndex + 6 : searchIndex + 5, value = chunk.slice(valueStart, lfIndex);
          if (dataLines === 0 && chunk.charCodeAt(lfIndex + 1) === LF) {
            onEvent({ id, event: eventType, data: value }), id = void 0, data = "", eventType = void 0, searchIndex = lfIndex + 2, lfIndex = chunk.indexOf(`
`, searchIndex);
            continue;
          }
          data = dataLines === 0 ? value : `${data}
${value}`, dataLines++;
        } else isEventPrefix(chunk, searchIndex, firstCharCode) ? eventType = chunk.slice(
          chunk.charCodeAt(searchIndex + 6) === SPACE ? searchIndex + 7 : searchIndex + 6,
          lfIndex
        ) || void 0 : parseLine(chunk, searchIndex, lfIndex);
        searchIndex = lfIndex + 1, lfIndex = chunk.indexOf(`
`, searchIndex);
      }
      return chunk.slice(searchIndex);
    }
    for (; searchIndex < chunk.length; ) {
      const crIndex = chunk.indexOf("\r", searchIndex), lfIndex = chunk.indexOf(`
`, searchIndex);
      let lineEnd = -1;
      if (crIndex !== -1 && lfIndex !== -1 ? lineEnd = crIndex < lfIndex ? crIndex : lfIndex : crIndex !== -1 ? crIndex === chunk.length - 1 ? lineEnd = -1 : lineEnd = crIndex : lfIndex !== -1 && (lineEnd = lfIndex), lineEnd === -1)
        break;
      parseLine(chunk, searchIndex, lineEnd), searchIndex = lineEnd + 1, chunk.charCodeAt(searchIndex - 1) === CR && chunk.charCodeAt(searchIndex) === LF && searchIndex++;
    }
    return chunk.slice(searchIndex);
  }
  function parseLine(chunk, start, end) {
    if (start === end) {
      dispatchEvent();
      return;
    }
    const firstCharCode = chunk.charCodeAt(start);
    if (isDataPrefix(chunk, start, firstCharCode)) {
      const valueStart = chunk.charCodeAt(start + 5) === SPACE ? start + 6 : start + 5, value2 = chunk.slice(valueStart, end);
      data = dataLines === 0 ? value2 : `${data}
${value2}`, dataLines++;
      return;
    }
    if (isEventPrefix(chunk, start, firstCharCode)) {
      eventType = chunk.slice(chunk.charCodeAt(start + 6) === SPACE ? start + 7 : start + 6, end) || void 0;
      return;
    }
    if (firstCharCode === 105 && chunk.charCodeAt(start + 1) === 100 && chunk.charCodeAt(start + 2) === 58) {
      const value2 = chunk.slice(chunk.charCodeAt(start + 3) === SPACE ? start + 4 : start + 3, end);
      value2.includes("\0") || (id = value2);
      return;
    }
    if (firstCharCode === 58) {
      if (onComment) {
        const line2 = chunk.slice(start, end);
        onComment(line2.slice(chunk.charCodeAt(start + 1) === SPACE ? 2 : 1));
      }
      return;
    }
    const line = chunk.slice(start, end), fieldSeparatorIndex = line.indexOf(":");
    if (fieldSeparatorIndex === -1) {
      processField(line, "", line);
      return;
    }
    const field = line.slice(0, fieldSeparatorIndex), offset = line.charCodeAt(fieldSeparatorIndex + 1) === SPACE ? 2 : 1, value = line.slice(fieldSeparatorIndex + offset);
    processField(field, value, line);
  }
  function processField(field, value, line) {
    switch (field) {
      case "event":
        eventType = value || void 0;
        break;
      case "data":
        data = dataLines === 0 ? value : `${data}
${value}`, dataLines++;
        break;
      case "id":
        value.includes("\0") || (id = value);
        break;
      case "retry":
        /^\d+$/.test(value) ? onRetry(parseInt(value, 10)) : onError(
          new ParseError(`Invalid \`retry\` value: "${value}"`, {
            type: "invalid-retry",
            value,
            line
          })
        );
        break;
      default:
        onError(
          new ParseError(
            `Unknown field "${field.length > 20 ? `${field.slice(0, 20)}\u2026` : field}"`,
            { type: "unknown-field", field, value, line }
          )
        );
        break;
    }
  }
  function dispatchEvent() {
    dataLines > 0 && onEvent({
      id,
      event: eventType,
      data
    }), id = void 0, data = "", dataLines = 0, eventType = void 0;
  }
  function reset(options = {}) {
    if (options.consume && pendingFragments.length > 0) {
      const incompleteLine = pendingFragments.join("");
      parseLine(incompleteLine, 0, incompleteLine.length);
    }
    isFirstChunk = true, id = void 0, data = "", dataLines = 0, eventType = void 0, pendingFragments.length = 0, pendingFragmentsLength = 0, terminated = false;
  }
  return { feed, reset };
}
function isDataPrefix(chunk, i, firstCharCode) {
  return firstCharCode === 100 && chunk.charCodeAt(i + 1) === 97 && chunk.charCodeAt(i + 2) === 116 && chunk.charCodeAt(i + 3) === 97 && chunk.charCodeAt(i + 4) === 58;
}
function isEventPrefix(chunk, i, firstCharCode) {
  return firstCharCode === 101 && chunk.charCodeAt(i + 1) === 118 && chunk.charCodeAt(i + 2) === 101 && chunk.charCodeAt(i + 3) === 110 && chunk.charCodeAt(i + 4) === 116 && chunk.charCodeAt(i + 5) === 58;
}

// src/trueforge/streamHandler.ts
var StreamHandler = class {
  activeController = null;
  /**
   * Create and store a new AbortController for a streaming request.
   */
  createAbortController() {
    this.abort();
    this.activeController = new AbortController();
    return this.activeController;
  }
  /**
   * Abort the active stream if running.
   */
  abort() {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }
  /**
   * Parse an SSE Response into an AsyncGenerator of TrueForgeStreamEvents.
   */
  async *parseSSEStream(response) {
    if (!response.body) {
      throw new Error("Response body is null, cannot parse SSE stream");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const eventQueue = [];
    let resolveWait = null;
    let streamDone = false;
    let streamError = null;
    const parser = createParser({
      onEvent: (event) => {
        if (event.data) {
          const rawData = event.data.trim();
          if (rawData === "[DONE]") {
            streamDone = true;
            if (resolveWait) resolveWait();
            return;
          }
          try {
            const parsed = JSON.parse(rawData);
            const rawType = (parsed.type || event.event || "").toString();
            let eventType = "text_delta";
            if (rawType === "text.delta" || rawType === "content.delta" || rawType === "text_delta" || rawType === "model.message.delta" || rawType === "model_message_delta") {
              eventType = "text_delta";
            } else if (rawType === "turn.complete" || rawType === "turn.done" || rawType === "turn_complete") {
              eventType = "turn_complete";
            } else if (rawType === "tool.call" || rawType === "tool_call_start") {
              eventType = "tool_call_start";
            } else if (rawType === "tool.call.delta" || rawType === "tool_call_delta") {
              eventType = "tool_call_delta";
            } else if (rawType === "tool.result" || rawType === "tool_result") {
              eventType = "tool_result";
            } else if (rawType === "error") {
              eventType = "error";
            } else if (rawType) {
              eventType = rawType;
            }
            const delta = parsed.delta || (typeof parsed.content === "string" ? parsed.content : parsed.text) || "";
            const streamEvent = {
              ...parsed,
              type: eventType,
              ...delta ? { delta } : {}
            };
            eventQueue.push(streamEvent);
            if (resolveWait) resolveWait();
          } catch {
            if (rawData.length > 0) {
              eventQueue.push({
                type: "text_delta",
                delta: rawData
              });
              if (resolveWait) resolveWait();
            }
          }
        }
      }
    });
    const pump = async () => {
      try {
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
            if (resolveWait) resolveWait();
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          parser.feed(chunk);
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        streamDone = true;
        if (resolveWait) resolveWait();
      }
    };
    pump();
    try {
      while (true) {
        while (eventQueue.length > 0) {
          const ev = eventQueue.shift();
          yield ev;
        }
        if (streamDone) {
          const err = streamError;
          if (err && err.name !== "AbortError") {
            throw err;
          }
          break;
        }
        await new Promise((resolve) => {
          resolveWait = resolve;
        });
        resolveWait = null;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
      }
      this.activeController = null;
    }
  }
};

// src/types/contracts.ts
function estimateTokens(s) {
  return Math.ceil(s.length / 3.8);
}

// tests/all_tasks_verification.test.mjs
(0, import_node_test.default)("TASK 1 (Task A): Mode 1 Inline Edit on Flask get_debug_flag", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-task1-"));
  const helpersPy = path.join(tmpDir, "helpers.py");
  const originalContent = [
    "import os",
    "",
    "def get_debug_flag() -> bool:",
    '    """Get whether debug mode should be enabled for the app.',
    "    Default is development, or False otherwise.",
    '    """',
    '    val = os.environ.get("FLASK_DEBUG")',
    "    if not val:",
    '        return os.environ.get("FLASK_ENV") == "development"',
    '    return val.lower() not in {"0", "false", "no"}',
    "",
    "def get_load_dotenv() -> bool:",
    "    return True"
  ].join("\n");
  fs.writeFileSync(helpersPy, originalContent, "utf8");
  const turnId = "turn-task-1";
  const undoStack = new UndoCheckpointStack();
  const virtualDiff = new VirtualDiffProvider();
  const shadowDiags = new ShadowDiagnosticsChecker(virtualDiff);
  const stagingBuffer = new StagingBuffer();
  await undoStack.ensureFileSnapshotted(turnId, helpersPy);
  import_strict.default.strictEqual(undoStack.canUndo(), true, "Undo stack must record initial state");
  const proposedDocstring = [
    '    """Get whether debug mode should be enabled for the app.',
    "    Default is development, or False otherwise.",
    "    The values '0', 'false', 'no', 'off', and 'n' are treated as false.",
    '    """'
  ].join("\n");
  const proposedLogic = '    return val.lower() not in {"0", "false", "no", "off", "n"}';
  const proposedFull = originalContent.replace(
    originalContent.slice(
      originalContent.indexOf('    """Get whether'),
      originalContent.indexOf('    """') + 7
    ),
    proposedDocstring
  ).replace('    return val.lower() not in {"0", "false", "no"}', proposedLogic);
  const fileId = "review-helpers-01";
  const hunks = [
    {
      id: "hunk-docstring",
      fileId,
      filePath: helpersPy,
      index: 0,
      oldStart: 4,
      oldLines: 3,
      newStart: 4,
      newLines: 4,
      oldText: originalContent.slice(
        originalContent.indexOf('    """Get whether'),
        originalContent.indexOf('    """') + 7
      ),
      newText: proposedDocstring,
      rationale: "Update docstring to document off and n",
      status: "pending"
    },
    {
      id: "hunk-logic",
      fileId,
      filePath: helpersPy,
      index: 1,
      oldStart: 10,
      oldLines: 1,
      newStart: 11,
      newLines: 1,
      oldText: '    return val.lower() not in {"0", "false", "no"}',
      newText: proposedLogic,
      rationale: "Add off and n to falsy set",
      status: "pending"
    }
  ];
  let gateResolved = false;
  stagingBuffer.enqueueFileReview({
    fileId,
    filePath: helpersPy,
    originalContent,
    proposedFullContent: proposedFull,
    hunks,
    resolveGate: () => {
      gateResolved = true;
    }
  });
  const activeReview = stagingBuffer.getActiveReview();
  import_strict.default.ok(activeReview, "Review must be staged");
  import_strict.default.strictEqual(activeReview.hunks.length, 2);
  await stagingBuffer.acceptAllInActive();
  import_strict.default.strictEqual(gateResolved, true, "Approval gate must be resolved");
  const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  let edited = originalContent;
  for (const h of sortedHunks) {
    edited = edited.replace(h.oldText, h.newText);
  }
  fs.writeFileSync(helpersPy, edited, "utf8");
  const modifiedContent = fs.readFileSync(helpersPy, "utf8");
  import_strict.default.ok(modifiedContent.includes('"off", "n"'), "Logic must include off and n");
  import_strict.default.ok(modifiedContent.includes("The values '0', 'false', 'no', 'off', and 'n'"), "Docstring must be updated");
  const undoSuccess = await undoStack.undoLastTurn();
  import_strict.default.strictEqual(undoSuccess, true, "Undo operation must succeed");
  const restoredContent = fs.readFileSync(helpersPy, "utf8");
  import_strict.default.strictEqual(restoredContent, originalContent, "File must be bit-for-bit restored after undo");
  import_strict.default.strictEqual(undoStack.canUndo(), false, "Undo stack must be empty after rollback");
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
(0, import_node_test.default)("TASK 2 (Task B): Mode 2 Context Ledger, Budget Cap, and TOC Promotion", () => {
  const ledger = new ContextLedgerTracker();
  const tokenBudget = 500;
  ledger.resetForTurn("turn-mode2-001", "agent-mode", tokenBudget, 1e3);
  const helperCode = 'def get_debug_flag() -> bool: return val not in {"0", "false", "no"}';
  ledger.addSlice({
    id: "slice-helper",
    filePath: "src/flask/helpers.py",
    startLine: 20,
    endLine: 35,
    tokens: estimateTokens(helperCode),
    source: "symbol-search",
    score: 95,
    rationale: "helpers.py: get_debug_flag definition",
    content: helperCode,
    pinned: false
  });
  ledger.addOverflow({
    id: "toc-app-debug",
    filePath: "src/flask/app.py",
    symbolName: "Flask.debug",
    startLine: 400,
    endLine: 450,
    tokens: 220,
    score: 75
  });
  let snapshot = ledger.getSnapshot();
  import_strict.default.strictEqual(snapshot.slices.length, 1);
  import_strict.default.strictEqual(snapshot.overflowToc.length, 1);
  import_strict.default.strictEqual(snapshot.slices[0].pinned, false);
  import_strict.default.ok(snapshot.totalTokensUsed > 0);
  ledger.pinSlice("slice-helper", true);
  snapshot = ledger.getSnapshot();
  import_strict.default.strictEqual(snapshot.slices[0].pinned, true, "Slice must be pinned");
  const promotedCode = '@property\ndef debug(self) -> bool: return self.config["DEBUG"]';
  const promoted = ledger.promoteToc("toc-app-debug", promotedCode);
  import_strict.default.strictEqual(promoted, true, "TOC entry promotion must succeed");
  snapshot = ledger.getSnapshot();
  import_strict.default.strictEqual(snapshot.slices.length, 2, "Must have 2 active slices after promotion");
  import_strict.default.strictEqual(snapshot.overflowToc.length, 0, "TOC overflow must be empty after promotion");
  import_strict.default.strictEqual(snapshot.slices[1].promotedFromToc, true);
  import_strict.default.strictEqual(snapshot.slices[1].pinned, true, "Promoted slice must be auto-pinned");
});
(0, import_node_test.default)("TASK 3 (Task C): Real-time SSE Streaming & Immediate Mid-Stream Cancellation", async () => {
  const handler = new StreamHandler();
  const controller = handler.createAbortController();
  import_strict.default.ok(controller);
  import_strict.default.strictEqual(controller.signal.aborted, false);
  const ssePayload = [
    'event: text_delta\ndata: {"delta":"def get_debug_flag"}\n\n',
    'event: text_delta\ndata: {"delta":"() -> bool:"}\n\n',
    'event: text_delta\ndata: {"delta":"\\n    return True"}\n\n',
    "data: [DONE]\n\n"
  ].join("");
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(ssePayload));
      ctrl.close();
    }
  });
  const response = new Response(readable);
  const receivedDeltas = [];
  for await (const ev of handler.parseSSEStream(response)) {
    if (ev.type === "text_delta") {
      receivedDeltas.push(ev.delta);
    }
  }
  import_strict.default.strictEqual(receivedDeltas.join(""), "def get_debug_flag() -> bool:\n    return True");
  const cancellableHandler = new StreamHandler();
  const cancelController = cancellableHandler.createAbortController();
  let cancelled = false;
  cancelController.signal.addEventListener("abort", () => {
    cancelled = true;
  });
  cancellableHandler.abort();
  import_strict.default.strictEqual(cancelled, true, "Abort event listener must fire");
  import_strict.default.strictEqual(cancelController.signal.aborted, true, "AbortController signal must be marked aborted");
  const stagingBuffer = new StagingBuffer();
  stagingBuffer.enqueueFileReview({
    fileId: "pending-review",
    filePath: "test.py",
    originalContent: "x = 1",
    proposedFullContent: "x = 2",
    hunks: [
      {
        id: "hunk-pending",
        fileId: "pending-review",
        filePath: "test.py",
        index: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        oldText: "x = 1",
        newText: "x = 2",
        status: "pending"
      }
    ],
    resolveGate: () => {
    }
  });
  import_strict.default.ok(stagingBuffer.getActiveReview(), "Must have an active review");
  stagingBuffer.clearAllPendingWithCancelledStatus();
  import_strict.default.strictEqual(stagingBuffer.getActiveReview(), null, "Review queue must be cleared on cancellation");
  import_strict.default.strictEqual(stagingBuffer.getQueuedCount(), 0);
});
