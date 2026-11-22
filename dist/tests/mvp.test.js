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
    var EventEmitter2 = class {
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
    var Uri = {
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
    var workspace = {
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
            text: lines[line] || "",
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
                return new Position(i, offset - cur);
              }
              cur = next;
            }
            return new Position(lines.length - 1, (lines[lines.length - 1] || "").length);
          },
          save: async () => {
          }
        };
      },
      applyEdit: async (edit) => {
        if (edit && edit.edits) {
          for (const e of edit.edits) {
            if (e.range && e.uri && fs2.existsSync(e.uri.fsPath)) {
              const content = fs2.readFileSync(e.uri.fsPath, "utf8");
              const isCRLF = content.includes("\r\n");
              const eol = isCRLF ? "\r\n" : "\n";
              const lines = content.split(/\r?\n/);
              const startLine = e.range.start.line;
              const startChar = e.range.start.character;
              const endLine = e.range.end.line;
              const endChar = e.range.end.character;
              const before = (lines[startLine] || "").substring(0, startChar);
              const after = (lines[endLine] || "").substring(endChar);
              const replacementLines = e.text.split(/\r?\n/);
              if (replacementLines.length === 1) {
                lines.splice(startLine, endLine - startLine + 1, before + replacementLines[0] + after);
              } else {
                const first = before + replacementLines[0];
                const middle = replacementLines.slice(1, -1);
                const last = replacementLines[replacementLines.length - 1] + after;
                lines.splice(startLine, endLine - startLine + 1, first, ...middle, last);
              }
              fs2.writeFileSync(e.uri.fsPath, lines.join(eol), "utf8");
            }
          }
        }
        return true;
      },
      asRelativePath: (uri) => typeof uri === "string" ? uri : uri.fsPath
    };
    var languages = {
      getDiagnostics: () => []
    };
    var DiagnosticSeverity = {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3
    };
    var window = {
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
    var WorkspaceEdit = class {
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
    var Range = class {
      constructor(startLineOrPos, startCharOrPos, endLine, endChar) {
        if (typeof startLineOrPos === "object" && startLineOrPos !== null) {
          this.start = startLineOrPos;
          this.end = startCharOrPos;
        } else {
          this.start = new Position(startLineOrPos, startCharOrPos);
          this.end = new Position(endLine, endChar);
        }
      }
    };
    var Position = class {
      constructor(line, char) {
        this.line = line;
        this.character = char;
      }
    };
    var EndOfLine = {
      LF: 1,
      CRLF: 2
    };
    module2.exports = {
      EventEmitter: EventEmitter2,
      Uri,
      workspace,
      languages,
      DiagnosticSeverity,
      EndOfLine,
      window,
      commands,
      WorkspaceEdit,
      Range,
      Position
    };
  }
});

// tests/mvp.test.mjs
var import_node_test = __toESM(require("node:test"), 1);
var import_strict = __toESM(require("node:assert/strict"), 1);

// src/types/contracts.ts
var HttpError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
};
function estimateTokens(s) {
  return Math.ceil(s.length / 3.8);
}

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

// src/trueforge/resilience.ts
var ResilienceSupervisor = class {
  config;
  currentModel;
  onFailoverCallback;
  constructor(config) {
    this.config = {
      connectionTimeoutMs: 5e3,
      ttftWatchdogMs: 12e3,
      maxAttempts: 2,
      backoffMs: 500,
      ...config
    };
    this.currentModel = this.config.primaryModel || "primary-coding-model";
  }
  setFailoverCallback(cb) {
    this.onFailoverCallback = cb;
  }
  getCurrentModel() {
    return this.currentModel;
  }
  setCurrentModel(model) {
    this.currentModel = model;
  }
  /**
   * Execute an async network operation with retry, timeout watchdog, and model failover.
   */
  async executeTurnWithFailover(fn) {
    let lastError;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Connection timeout after ${this.config.connectionTimeoutMs}ms`));
      }, this.config.connectionTimeoutMs);
      try {
        const result = await fn(controller.signal);
        clearTimeout(timeoutId);
        return result;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        const isNetworkOr5xx = err instanceof HttpError ? err.status >= 500 || err.status === 429 : err?.code === "ECONNREFUSED" || err?.message?.includes("fetch failed") || err?.message?.includes("timeout");
        if (attempt === 1 && isNetworkOr5xx && this.config.fallbackModel && this.currentModel !== this.config.fallbackModel) {
          const prev = this.currentModel;
          this.currentModel = this.config.fallbackModel;
          if (this.onFailoverCallback) {
            this.onFailoverCallback(
              prev,
              this.currentModel,
              err instanceof Error ? err.message : "Primary model unavailable"
            );
          }
        }
        if (attempt < this.config.maxAttempts) {
          await new Promise(
            (resolve) => setTimeout(resolve, this.config.backoffMs * attempt)
          );
        }
      }
    }
    throw lastError;
  }
};

// src/context/ledgerTracker.ts
var vscode = __toESM(require_mock_vscode());
var ContextLedgerTracker = class {
  turnId = "";
  mode = "inline-edit";
  budgetCap = 16e3;
  ceilingCap = 32e3;
  slices = [];
  overflowToc = [];
  onDidUpdateLedgerEmitter = new vscode.EventEmitter();
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

// src/trueforge/configValidator.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var ConfigValidator = class {
  /**
   * Run pre-flight health checks against TrueForge server and workspace environment.
   */
  static async runPreflight(serverUrl, workspaceRoot) {
    const warnings = [];
    let serverReachable = false;
    let models = [];
    let error;
    const cleanUrl = serverUrl.replace(/\/+$/, "");
    const endpoints = [`${cleanUrl}/api/v1/models`, `${cleanUrl}/api/models`];
    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3e3);
        const res = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok) {
          serverReachable = true;
          const json = await res.json();
          if (Array.isArray(json)) {
            models = json.map((m) => m.name || m.id || String(m));
          } else if (Array.isArray(json.data)) {
            models = json.data.map((m) => m.name || m.id);
          } else if (json.data && typeof json.data === "object") {
            models = Object.keys(json.data);
          }
          break;
        }
      } catch (err) {
      }
    }
    if (!serverReachable) {
      error = `TrueForge server is not reachable at ${serverUrl}. Ensure the server is running (e.g. via 'start-server.cmd').`;
      warnings.push("TrueForge local server is offline.");
    } else if (models.length === 0) {
      warnings.push("TrueForge server returned an empty model list. Check config.yaml on the server.");
    }
    let mcpConfigured = false;
    if (workspaceRoot) {
      const mcpJson = path.join(workspaceRoot, ".vscode", "trueforge-mcp.json");
      if (fs.existsSync(mcpJson)) {
        mcpConfigured = true;
      }
    }
    return {
      serverReachable,
      serverUrl,
      models,
      mcpConfigured,
      warnings,
      error
    };
  }
};

// tests/mvp.test.mjs
(0, import_node_test.default)("estimateTokens calculates ~3.8 chars per token", () => {
  import_strict.default.strictEqual(estimateTokens(""), 0);
  import_strict.default.strictEqual(estimateTokens("abcd"), 2);
  import_strict.default.strictEqual(estimateTokens("1234567890"), 3);
});
(0, import_node_test.default)("StreamHandler parses SSE stream events", async () => {
  const handler = new StreamHandler();
  const streamData = [
    'event: text_delta\ndata: {"delta":"Hello "}\n\n',
    'event: text_delta\ndata: {"delta":"World"}\n\n',
    'event: tool_call_start\ndata: {"toolName":"propose_file_edit","callId":"call-1"}\n\n',
    "data: [DONE]\n\n"
  ].join("");
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(streamData));
      controller.close();
    }
  });
  const mockResponse = new Response(readable);
  const events = [];
  for await (const ev of handler.parseSSEStream(mockResponse)) {
    events.push(ev);
  }
  import_strict.default.strictEqual(events.length, 3);
  import_strict.default.strictEqual(events[0].type, "text_delta");
  import_strict.default.strictEqual(events[0].delta, "Hello ");
  import_strict.default.strictEqual(events[1].type, "text_delta");
  import_strict.default.strictEqual(events[1].delta, "World");
  import_strict.default.strictEqual(events[2].type, "tool_call_start");
  import_strict.default.strictEqual(events[2].toolName, "propose_file_edit");
});
(0, import_node_test.default)("ResilienceSupervisor retries on transient failures", async () => {
  const supervisor = new ResilienceSupervisor({
    maxAttempts: 3,
    backoffMs: 10,
    connectionTimeoutMs: 500,
    primaryModel: "primary-model",
    fallbackModel: "fallback-model"
  });
  let attempts = 0;
  const result = await supervisor.executeTurnWithFailover(async () => {
    attempts++;
    if (attempts < 2) {
      throw new Error("fetch failed (transient network glitch)");
    }
    return "success";
  });
  import_strict.default.strictEqual(result, "success");
  import_strict.default.strictEqual(attempts, 2);
});
(0, import_node_test.default)("ResilienceSupervisor triggers model failover on persistent failure", async () => {
  let failoverTriggered = false;
  const supervisor = new ResilienceSupervisor({
    maxAttempts: 2,
    backoffMs: 10,
    connectionTimeoutMs: 500,
    primaryModel: "model-a",
    fallbackModel: "model-b"
  });
  supervisor.setFailoverCallback((from, to, reason) => {
    failoverTriggered = true;
    import_strict.default.strictEqual(from, "model-a");
    import_strict.default.strictEqual(to, "model-b");
  });
  let attempts = 0;
  try {
    await supervisor.executeTurnWithFailover(async () => {
      attempts++;
      throw new Error("fetch failed: 503 service unavailable");
    });
  } catch {
  }
  import_strict.default.strictEqual(failoverTriggered, true);
  import_strict.default.strictEqual(supervisor.getCurrentModel(), "model-b");
});
(0, import_node_test.default)("Mention regex captures @file and @symbol syntax", () => {
  const MENTION_REGEX = /@file:([^\s]+)|@symbol:([^\s]+)|@([a-zA-Z0-9_./-]+)/g;
  const prompt = "Please check @file:src/helpers.py and @symbol:get_debug_flag also @utils.py";
  const matches = Array.from(prompt.matchAll(MENTION_REGEX));
  import_strict.default.strictEqual(matches.length, 3);
  import_strict.default.strictEqual(matches[0][1], "src/helpers.py");
  import_strict.default.strictEqual(matches[1][2], "get_debug_flag");
  import_strict.default.strictEqual(matches[2][3], "utils.py");
});
(0, import_node_test.default)("HttpError preserves status code and message", () => {
  const err = new HttpError(404, "Session not found");
  import_strict.default.strictEqual(err.status, 404);
  import_strict.default.strictEqual(err.message, "Session not found");
  import_strict.default.strictEqual(err.name, "HttpError");
});
(0, import_node_test.default)("ContextLedgerTracker handles pinSlice and promoteToc", () => {
  const tracker = new ContextLedgerTracker();
  tracker.resetForTurn("turn-101", "agent-mode", 16e3, 32e3);
  tracker.addSlice({
    id: "slice-1",
    filePath: "/src/main.ts",
    startLine: 1,
    endLine: 20,
    tokens: 150,
    source: "symbol-search",
    score: 90,
    rationale: "Core entry point",
    content: "function main() {}",
    pinned: false
  });
  tracker.addOverflow({
    id: "toc-1",
    filePath: "/src/utils.ts",
    symbolName: "formatDate",
    startLine: 50,
    endLine: 70,
    tokens: 80,
    score: 60
  });
  let snapshot = tracker.getSnapshot();
  import_strict.default.strictEqual(snapshot.slices.length, 1);
  import_strict.default.strictEqual(snapshot.slices[0].pinned, false);
  import_strict.default.strictEqual(snapshot.overflowToc.length, 1);
  tracker.pinSlice("slice-1", true);
  snapshot = tracker.getSnapshot();
  import_strict.default.strictEqual(snapshot.slices[0].pinned, true);
  const promoted = tracker.promoteToc("toc-1", "export function formatDate() {}");
  import_strict.default.strictEqual(promoted, true);
  snapshot = tracker.getSnapshot();
  import_strict.default.strictEqual(snapshot.slices.length, 2);
  import_strict.default.strictEqual(snapshot.overflowToc.length, 0);
  import_strict.default.strictEqual(snapshot.slices[1].promotedFromToc, true);
  import_strict.default.strictEqual(snapshot.slices[1].pinned, true);
});
(0, import_node_test.default)("ConfigValidator reports offline server cleanly without throwing", async () => {
  const result = await ConfigValidator.runPreflight("http://127.0.0.1:59999");
  import_strict.default.strictEqual(result.serverReachable, false);
  import_strict.default.ok(result.error?.includes("not reachable"));
  import_strict.default.ok(result.warnings.length > 0);
});
(0, import_node_test.default)("StreamHandler abort halts active stream parsing cleanly", async () => {
  const handler = new StreamHandler();
  const controller = handler.createAbortController();
  import_strict.default.ok(controller);
  import_strict.default.strictEqual(controller.signal.aborted, false);
  handler.abort();
  import_strict.default.strictEqual(controller.signal.aborted, true);
});
