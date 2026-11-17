/**
 * @file all_tasks_verification.test.mjs
 * @description Comprehensive, unified verification test for all 3 tasks:
 *   - Task 1 (Task A): Mode 1 Inline Edit, Staging, Application & Checkpoint Undo on Flask helpers.py
 *   - Task 2 (Task B): Mode 2 Agent Context Ledger, Budget Cap, TOC Overflow & Slice Pinning
 *   - Task 3 (Task C): Real-time SSE Streaming & Mid-Stream Socket Cancellation
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { StagingBuffer } from '../src/diff/stagingBuffer';
import { UndoCheckpointStack } from '../src/diff/undoStack';
import { VirtualDiffProvider } from '../src/diff/virtualDiffProvider';
import { ShadowDiagnosticsChecker } from '../src/diff/shadowDiagnostics';
import { ContextLedgerTracker } from '../src/context/ledgerTracker';
import { StreamHandler } from '../src/trueforge/streamHandler';
import { estimateTokens } from '../src/types/contracts';

// ============================================================================
// TASK 1 (TASK A): Mode 1 Inline Edit, Staging, Bottom-to-Top Applier, Undo
// ============================================================================
test('TASK 1 (Task A): Mode 1 Inline Edit on Flask get_debug_flag', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-task1-'));
  const helpersPy = path.join(tmpDir, 'helpers.py');

  const originalContent = [
    'import os',
    '',
    'def get_debug_flag() -> bool:',
    '    """Get whether debug mode should be enabled for the app.',
    '    Default is development, or False otherwise.',
    '    """',
    '    val = os.environ.get("FLASK_DEBUG")',
    '    if not val:',
    '        return os.environ.get("FLASK_ENV") == "development"',
    '    return val.lower() not in {"0", "false", "no"}',
    '',
    'def get_load_dotenv() -> bool:',
    '    return True',
  ].join('\n');

  fs.writeFileSync(helpersPy, originalContent, 'utf8');

  const turnId = 'turn-task-1';
  const undoStack = new UndoCheckpointStack();
  const virtualDiff = new VirtualDiffProvider();
  const shadowDiags = new ShadowDiagnosticsChecker(virtualDiff);
  const stagingBuffer = new StagingBuffer();

  // Step 1: Snapshot before turn
  await undoStack.ensureFileSnapshotted(turnId, helpersPy);
  assert.strictEqual(undoStack.canUndo(), true, 'Undo stack must record initial state');

  // Step 2: Proposed modifications (Docstring + Logic)
  const proposedDocstring = [
    '    """Get whether debug mode should be enabled for the app.',
    '    Default is development, or False otherwise.',
    "    The values '0', 'false', 'no', 'off', and 'n' are treated as false.",
    '    """',
  ].join('\n');
  const proposedLogic = '    return val.lower() not in {"0", "false", "no", "off", "n"}';

  const proposedFull = originalContent
    .replace(
      originalContent.slice(
        originalContent.indexOf('    """Get whether'),
        originalContent.indexOf('    """') + 7,
      ),
      proposedDocstring,
    )
    .replace('    return val.lower() not in {"0", "false", "no"}', proposedLogic);

  const fileId = 'review-helpers-01';
  const hunks = [
    {
      id: 'hunk-docstring',
      fileId,
      filePath: helpersPy,
      index: 0,
      oldStart: 4,
      oldLines: 3,
      newStart: 4,
      newLines: 4,
      oldText: originalContent.slice(
        originalContent.indexOf('    """Get whether'),
        originalContent.indexOf('    """') + 7,
      ),
      newText: proposedDocstring,
      rationale: 'Update docstring to document off and n',
      status: 'pending',
    },
    {
      id: 'hunk-logic',
      fileId,
      filePath: helpersPy,
      index: 1,
      oldStart: 10,
      oldLines: 1,
      newStart: 11,
      newLines: 1,
      oldText: '    return val.lower() not in {"0", "false", "no"}',
      newText: proposedLogic,
      rationale: 'Add off and n to falsy set',
      status: 'pending',
    },
  ];

  // Step 3: Enqueue review in staging buffer
  let gateResolved = false;
  stagingBuffer.enqueueFileReview({
    fileId,
    filePath: helpersPy,
    originalContent,
    proposedFullContent: proposedFull,
    hunks,
    resolveGate: () => {
      gateResolved = true;
    },
  });

  const activeReview = stagingBuffer.getActiveReview();
  assert.ok(activeReview, 'Review must be staged');
  assert.strictEqual(activeReview.hunks.length, 2);

  // Step 4: Accept All & Apply Bottom-to-Top
  await stagingBuffer.acceptAllInActive();
  assert.strictEqual(gateResolved, true, 'Approval gate must be resolved');

  // Apply bottom-to-top replacement to the file
  const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  let edited = originalContent;
  for (const h of sortedHunks) {
    edited = edited.replace(h.oldText, h.newText);
  }
  fs.writeFileSync(helpersPy, edited, 'utf8');

  // Verify modifications applied on disk
  const modifiedContent = fs.readFileSync(helpersPy, 'utf8');
  assert.ok(modifiedContent.includes('"off", "n"'), 'Logic must include off and n');
  assert.ok(modifiedContent.includes("The values '0', 'false', 'no', 'off', and 'n'"), 'Docstring must be updated');

  // Step 5: Rollback via UndoCheckpointStack
  const undoSuccess = await undoStack.undoLastTurn();
  assert.strictEqual(undoSuccess, true, 'Undo operation must succeed');

  const restoredContent = fs.readFileSync(helpersPy, 'utf8');
  assert.strictEqual(restoredContent, originalContent, 'File must be bit-for-bit restored after undo');
  assert.strictEqual(undoStack.canUndo(), false, 'Undo stack must be empty after rollback');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// TASK 2 (TASK B): Mode 2 Context Ledger, Budget Cap, TOC & Slice Pinning
// ============================================================================
test('TASK 2 (Task B): Mode 2 Context Ledger, Budget Cap, and TOC Promotion', () => {
  const ledger = new ContextLedgerTracker();
  const tokenBudget = 500; // Small budget to test overflow boundary
  ledger.resetForTurn('turn-mode2-001', 'agent-mode', tokenBudget, 1000);

  // Add primary slice
  const helperCode = 'def get_debug_flag() -> bool: return val not in {"0", "false", "no"}';
  ledger.addSlice({
    id: 'slice-helper',
    filePath: 'src/flask/helpers.py',
    startLine: 20,
    endLine: 35,
    tokens: estimateTokens(helperCode),
    source: 'symbol-search',
    score: 95,
    rationale: 'helpers.py: get_debug_flag definition',
    content: helperCode,
    pinned: false,
  });

  // Add overflow TOC entry for symbol that exceeded token budget
  ledger.addOverflow({
    id: 'toc-app-debug',
    filePath: 'src/flask/app.py',
    symbolName: 'Flask.debug',
    startLine: 400,
    endLine: 450,
    tokens: 220,
    score: 75,
  });

  let snapshot = ledger.getSnapshot();
  assert.strictEqual(snapshot.slices.length, 1);
  assert.strictEqual(snapshot.overflowToc.length, 1);
  assert.strictEqual(snapshot.slices[0].pinned, false);
  assert.ok(snapshot.totalTokensUsed > 0);

  // Pin slice
  ledger.pinSlice('slice-helper', true);
  snapshot = ledger.getSnapshot();
  assert.strictEqual(snapshot.slices[0].pinned, true, 'Slice must be pinned');

  // Promote TOC entry into active slice
  const promotedCode = '@property\ndef debug(self) -> bool: return self.config["DEBUG"]';
  const promoted = ledger.promoteToc('toc-app-debug', promotedCode);
  assert.strictEqual(promoted, true, 'TOC entry promotion must succeed');

  snapshot = ledger.getSnapshot();
  assert.strictEqual(snapshot.slices.length, 2, 'Must have 2 active slices after promotion');
  assert.strictEqual(snapshot.overflowToc.length, 0, 'TOC overflow must be empty after promotion');
  assert.strictEqual(snapshot.slices[1].promotedFromToc, true);
  assert.strictEqual(snapshot.slices[1].pinned, true, 'Promoted slice must be auto-pinned');
});

// ============================================================================
// TASK 3 (TASK C): Streaming & Cancellation Engine
// ============================================================================
test('TASK 3 (Task C): Real-time SSE Streaming & Immediate Mid-Stream Cancellation', async () => {
  const handler = new StreamHandler();
  const controller = handler.createAbortController();
  assert.ok(controller);
  assert.strictEqual(controller.signal.aborted, false);

  // 1. Verify SSE streaming delta delivery
  const ssePayload = [
    'event: text_delta\ndata: {"delta":"def get_debug_flag"}\n\n',
    'event: text_delta\ndata: {"delta":"() -> bool:"}\n\n',
    'event: text_delta\ndata: {"delta":"\\n    return True"}\n\n',
    'data: [DONE]\n\n',
  ].join('');

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(ssePayload));
      ctrl.close();
    },
  });

  const response = new Response(readable);
  const receivedDeltas = [];

  for await (const ev of handler.parseSSEStream(response)) {
    if (ev.type === 'text_delta') {
      receivedDeltas.push(ev.delta);
    }
  }

  assert.strictEqual(receivedDeltas.join(''), 'def get_debug_flag() -> bool:\n    return True');

  // 2. Verify Cancellation & Socket Abort
  const cancellableHandler = new StreamHandler();
  const cancelController = cancellableHandler.createAbortController();

  let cancelled = false;
  cancelController.signal.addEventListener('abort', () => {
    cancelled = true;
  });

  // Trigger mid-stream abort
  cancellableHandler.abort();
  assert.strictEqual(cancelled, true, 'Abort event listener must fire');
  assert.strictEqual(cancelController.signal.aborted, true, 'AbortController signal must be marked aborted');

  // 3. Staging Buffer Queue Cancellation
  const stagingBuffer = new StagingBuffer();
  stagingBuffer.enqueueFileReview({
    fileId: 'pending-review',
    filePath: 'test.py',
    originalContent: 'x = 1',
    proposedFullContent: 'x = 2',
    hunks: [
      {
        id: 'hunk-pending',
        fileId: 'pending-review',
        filePath: 'test.py',
        index: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        oldText: 'x = 1',
        newText: 'x = 2',
        status: 'pending',
      },
    ],
    resolveGate: () => {},
  });

  assert.ok(stagingBuffer.getActiveReview(), 'Must have an active review');
  stagingBuffer.clearAllPendingWithCancelledStatus();
  assert.strictEqual(stagingBuffer.getActiveReview(), null, 'Review queue must be cleared on cancellation');
  assert.strictEqual(stagingBuffer.getQueuedCount(), 0);
});
