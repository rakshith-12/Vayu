"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
            const eventType = parsed.type || event.event || "text_delta";
            const streamEvent = {
              type: eventType,
              ...parsed
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
