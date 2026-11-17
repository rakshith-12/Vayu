/**
 * @file mvp.test.mjs
 * @description Comprehensive test suite for TrueForge VS Code agent core modules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, HttpError } from '../src/types/contracts';
import { StreamHandler } from '../src/trueforge/streamHandler';
import { ResilienceSupervisor } from '../src/trueforge/resilience';
import { ContextLedgerTracker } from '../src/context/ledgerTracker';
import { ConfigValidator } from '../src/trueforge/configValidator';

// Test 1: Token estimation contract
test('estimateTokens calculates ~3.8 chars per token', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens('abcd'), 2); // 4 / 3.8 = 1.05 -> ceil 2
  assert.strictEqual(estimateTokens('1234567890'), 3); // 10 / 3.8 = 2.63 -> ceil 3
});

// Test 2: StreamHandler parsing SSE text_delta and tool_call
test('StreamHandler parses SSE stream events', async () => {
  const handler = new StreamHandler();

  const streamData = [
    'event: text_delta\ndata: {"delta":"Hello "}\n\n',
    'event: text_delta\ndata: {"delta":"World"}\n\n',
    'event: tool_call_start\ndata: {"toolName":"propose_file_edit","callId":"call-1"}\n\n',
    'data: [DONE]\n\n',
  ].join('');

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(streamData));
      controller.close();
    },
  });

  const mockResponse = new Response(readable);
  const events = [];
  for await (const ev of handler.parseSSEStream(mockResponse)) {
    events.push(ev);
  }

  assert.strictEqual(events.length, 3);
  assert.strictEqual(events[0].type, 'text_delta');
  assert.strictEqual(events[0].delta, 'Hello ');
  assert.strictEqual(events[1].type, 'text_delta');
  assert.strictEqual(events[1].delta, 'World');
  assert.strictEqual(events[2].type, 'tool_call_start');
  assert.strictEqual(events[2].toolName, 'propose_file_edit');
});

// Test 3: ResilienceSupervisor retry & failover
test('ResilienceSupervisor retries on transient failures', async () => {
  const supervisor = new ResilienceSupervisor({
    maxAttempts: 3,
    backoffMs: 10,
    connectionTimeoutMs: 500,
    primaryModel: 'primary-model',
    fallbackModel: 'fallback-model',
  });

  let attempts = 0;
  const result = await supervisor.executeTurnWithFailover(async () => {
    attempts++;
    if (attempts < 2) {
      throw new Error('fetch failed (transient network glitch)');
    }
    return 'success';
  });

  assert.strictEqual(result, 'success');
  assert.strictEqual(attempts, 2);
});

test('ResilienceSupervisor triggers model failover on persistent failure', async () => {
  let failoverTriggered = false;

  const supervisor = new ResilienceSupervisor({
    maxAttempts: 2,
    backoffMs: 10,
    connectionTimeoutMs: 500,
    primaryModel: 'model-a',
    fallbackModel: 'model-b',
  });

  supervisor.setFailoverCallback((from, to, reason) => {
    failoverTriggered = true;
    assert.strictEqual(from, 'model-a');
    assert.strictEqual(to, 'model-b');
  });

  let attempts = 0;
  try {
    await supervisor.executeTurnWithFailover(async () => {
      attempts++;
      throw new Error('fetch failed: 503 service unavailable');
    });
  } catch {
    // Expected to fail after max attempts
  }

  assert.strictEqual(failoverTriggered, true);
  assert.strictEqual(supervisor.getCurrentModel(), 'model-b');
});

// Test 4: Mention Regex parsing
test('Mention regex captures @file and @symbol syntax', () => {
  const MENTION_REGEX = /@file:([^\s]+)|@symbol:([^\s]+)|@([a-zA-Z0-9_./-]+)/g;
  const prompt = 'Please check @file:src/helpers.py and @symbol:get_debug_flag also @utils.py';

  const matches = Array.from(prompt.matchAll(MENTION_REGEX));
  assert.strictEqual(matches.length, 3);

  // Match 1: @file:src/helpers.py
  assert.strictEqual(matches[0][1], 'src/helpers.py');

  // Match 2: @symbol:get_debug_flag
  assert.strictEqual(matches[1][2], 'get_debug_flag');

  // Match 3: @utils.py
  assert.strictEqual(matches[2][3], 'utils.py');
});

// Test 5: HttpError attributes
test('HttpError preserves status code and message', () => {
  const err = new HttpError(404, 'Session not found');
  assert.strictEqual(err.status, 404);
  assert.strictEqual(err.message, 'Session not found');
  assert.strictEqual(err.name, 'HttpError');
});

// Test 6: ContextLedgerTracker Pinning & TOC Promotion
test('ContextLedgerTracker handles pinSlice and promoteToc', () => {
  const tracker = new ContextLedgerTracker();
  tracker.resetForTurn('turn-101', 'agent-mode', 16000, 32000);

  tracker.addSlice({
    id: 'slice-1',
    filePath: '/src/main.ts',
    startLine: 1,
    endLine: 20,
    tokens: 150,
    source: 'symbol-search',
    score: 90,
    rationale: 'Core entry point',
    content: 'function main() {}',
    pinned: false,
  });

  tracker.addOverflow({
    id: 'toc-1',
    filePath: '/src/utils.ts',
    symbolName: 'formatDate',
    startLine: 50,
    endLine: 70,
    tokens: 80,
    score: 60,
  });

  let snapshot = tracker.getSnapshot();
  assert.strictEqual(snapshot.slices.length, 1);
  assert.strictEqual(snapshot.slices[0].pinned, false);
  assert.strictEqual(snapshot.overflowToc.length, 1);

  // Pin slice
  tracker.pinSlice('slice-1', true);
  snapshot = tracker.getSnapshot();
  assert.strictEqual(snapshot.slices[0].pinned, true);

  // Promote TOC entry
  const promoted = tracker.promoteToc('toc-1', 'export function formatDate() {}');
  assert.strictEqual(promoted, true);

  snapshot = tracker.getSnapshot();
  assert.strictEqual(snapshot.slices.length, 2);
  assert.strictEqual(snapshot.overflowToc.length, 0);
  assert.strictEqual(snapshot.slices[1].promotedFromToc, true);
  assert.strictEqual(snapshot.slices[1].pinned, true);
});

// Test 7: ConfigValidator pre-flight offline reporting
test('ConfigValidator reports offline server cleanly without throwing', async () => {
  const result = await ConfigValidator.runPreflight('http://127.0.0.1:59999');
  assert.strictEqual(result.serverReachable, false);
  assert.ok(result.error?.includes('not reachable'));
  assert.ok(result.warnings.length > 0);
});

// Test 8: StreamHandler abort and cancellation
test('StreamHandler abort halts active stream parsing cleanly', async () => {
  const handler = new StreamHandler();
  const controller = handler.createAbortController();

  assert.ok(controller);
  assert.strictEqual(controller.signal.aborted, false);

  handler.abort();
  assert.strictEqual(controller.signal.aborted, true);
});
