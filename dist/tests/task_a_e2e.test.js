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
    var EventEmitter3 = class {
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
      EventEmitter: EventEmitter3,
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

// tests/task_a_e2e.test.mjs
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

// tests/task_a_e2e.test.mjs
var ORIGINAL_FLASK_HELPERS = `import os
import sys
import typing as t

def get_debug_flag() -> bool:
    """Get whether debug mode should be enabled for the app, indicated by the
    :envvar:\`FLASK_DEBUG\` environment variable. The default is \`\`True\`\` if
    :envvar:\`FLASK_ENV\` is \`\`development\`\`, or \`\`False\`\` otherwise.
    """
    val = os.environ.get("FLASK_DEBUG")

    if not val:
        return os.environ.get("FLASK_ENV") == "development"

    return val.lower() not in {"0", "false", "no"}

def get_load_dotenv(default: bool = True) -> bool:
    val = os.environ.get("FLASK_SKIP_DOTENV")
    if not val:
        return default
    return val.lower() not in {"0", "false", "no"}
`;
(0, import_node_test.default)("Task A E2E: Flask 3.1.3 inline edit staging, acceptance, and turn rollback", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-task-a-"));
  const helpersPyPath = path.join(tmpDir, "helpers.py");
  fs.writeFileSync(helpersPyPath, ORIGINAL_FLASK_HELPERS, "utf8");
  try {
    const turnId = "turn-task-a-001";
    const undoStack = new UndoCheckpointStack();
    const virtualDiff = new VirtualDiffProvider();
    const shadowDiags = new ShadowDiagnosticsChecker(virtualDiff);
    const stagingBuffer = new StagingBuffer();
    await undoStack.ensureFileSnapshotted(turnId, helpersPyPath);
    import_strict.default.strictEqual(undoStack.canUndo(), true);
    const oldDocstring = `    """Get whether debug mode should be enabled for the app, indicated by the
    :envvar:\`FLASK_DEBUG\` environment variable. The default is \`\`True\`\` if
    :envvar:\`FLASK_ENV\` is \`\`development\`\`, or \`\`False\`\` otherwise.
    """`;
    const newDocstring = `    """Get whether debug mode should be enabled for the app, indicated by the
    :envvar:\`FLASK_DEBUG\` environment variable. The default is \`\`True\`\` if
    :envvar:\`FLASK_ENV\` is \`\`development\`\`, or \`\`False\`\` otherwise.
    The values '0', 'false', 'no', 'off', and 'n' (case-insensitively) are
    treated as false.
    """`;
    const oldLogic = `return val.lower() not in {"0", "false", "no"}`;
    const newLogic = `return val.lower() not in {"0", "false", "no", "off", "n"}`;
    const currentContent = fs.readFileSync(helpersPyPath, "utf8");
    import_strict.default.ok(currentContent.includes(oldDocstring));
    import_strict.default.ok(currentContent.includes(oldLogic));
    let proposedFull = currentContent.replace(oldDocstring, newDocstring).replace(oldLogic, newLogic);
    import_strict.default.ok(proposedFull.includes("'off', and 'n'"));
    import_strict.default.ok(proposedFull.includes('{"0", "false", "no", "off", "n"}'));
    const fileId = "review-flask-helpers";
    const hunks = [
      {
        id: "hunk-0",
        fileId,
        filePath: helpersPyPath,
        index: 0,
        oldStart: 6,
        oldLines: 4,
        newStart: 6,
        newLines: 6,
        oldText: oldDocstring,
        newText: newDocstring,
        rationale: "Update docstring to document 'off' and 'n' as falsy values",
        status: "pending"
      },
      {
        id: "hunk-1",
        fileId,
        filePath: helpersPyPath,
        index: 1,
        oldStart: 15,
        oldLines: 1,
        newStart: 17,
        newLines: 1,
        oldText: oldLogic,
        newText: newLogic,
        rationale: "Add 'off' and 'n' to falsy set in get_debug_flag",
        status: "pending"
      }
    ];
    const diagSummary = await shadowDiags.verifyHunksInShadowDoc(helpersPyPath, proposedFull, hunks);
    import_strict.default.strictEqual(diagSummary.zeroRegression, true);
    let resolutionResult = null;
    const reviewPromise = stagingBuffer.enqueueFileReview({
      fileId,
      turnId,
      filePath: helpersPyPath,
      isNewFile: false,
      isDeleteFile: false,
      originalContent: currentContent,
      proposedFullContent: proposedFull,
      hunks,
      resolveGate: (res) => {
        resolutionResult = res;
      }
    });
    const activeReview = stagingBuffer.getActiveReview();
    import_strict.default.ok(activeReview);
    import_strict.default.strictEqual(activeReview.hunks.length, 2);
    import_strict.default.strictEqual(activeReview.hunks[0].status, "pending");
    import_strict.default.strictEqual(activeReview.hunks[1].status, "pending");
    await stagingBuffer.acceptHunk("hunk-0");
    import_strict.default.strictEqual(activeReview.hunks[0].status, "accepted");
    import_strict.default.strictEqual(activeReview.hunks[1].status, "pending");
    await stagingBuffer.acceptHunk("hunk-1");
    import_strict.default.strictEqual(activeReview.hunks[1].status, "accepted");
    const resolution = await reviewPromise;
    import_strict.default.strictEqual(resolution.status, "applied");
    import_strict.default.deepStrictEqual(resolution.applied_hunks, [0, 1]);
    import_strict.default.deepStrictEqual(resolution.rejected_hunks, []);
    const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
    let edited = currentContent;
    for (const h of sortedHunks) {
      edited = edited.replace(h.oldText, h.newText);
    }
    fs.writeFileSync(helpersPyPath, edited, "utf8");
    const appliedContent = fs.readFileSync(helpersPyPath, "utf8");
    import_strict.default.ok(appliedContent.includes("'off', and 'n'"));
    import_strict.default.ok(appliedContent.includes('{"0", "false", "no", "off", "n"}'));
    const undoSuccess = await undoStack.undoLastTurn();
    import_strict.default.strictEqual(undoSuccess, true);
    const restoredContent = fs.readFileSync(helpersPyPath, "utf8");
    import_strict.default.strictEqual(restoredContent, ORIGINAL_FLASK_HELPERS);
    import_strict.default.ok(!restoredContent.includes("'off'"));
    import_strict.default.ok(!restoredContent.includes('"off", "n"'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
