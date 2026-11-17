/**
 * @file task_a_e2e.test.mjs
 * @description End-to-end integration test for Task A (Flask 3.1.3 inline edit).
 *              Simulates the full proposed hunk staging, per-hunk acceptance,
 *              bottom-to-top replacement, and checkpoint undo.
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

// Original Flask 3.1.3 snippet from src/flask/helpers.py
const ORIGINAL_FLASK_HELPERS = `import os
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

test('Task A E2E: Flask 3.1.3 inline edit staging, acceptance, and turn rollback', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-task-a-'));
  const helpersPyPath = path.join(tmpDir, 'helpers.py');
  fs.writeFileSync(helpersPyPath, ORIGINAL_FLASK_HELPERS, 'utf8');

  try {
    const turnId = 'turn-task-a-001';
    const undoStack = new UndoCheckpointStack();
    const virtualDiff = new VirtualDiffProvider();
    const shadowDiags = new ShadowDiagnosticsChecker(virtualDiff);
    const stagingBuffer = new StagingBuffer();

    // 1. Snapshot file before modification
    await undoStack.ensureFileSnapshotted(turnId, helpersPyPath);
    assert.strictEqual(undoStack.canUndo(), true);

    // 2. Prepare the 2 distinct hunks (docstring + logic)
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

    const currentContent = fs.readFileSync(helpersPyPath, 'utf8');
    assert.ok(currentContent.includes(oldDocstring));
    assert.ok(currentContent.includes(oldLogic));

    // Simulate proposed full content
    let proposedFull = currentContent.replace(oldDocstring, newDocstring).replace(oldLogic, newLogic);
    assert.ok(proposedFull.includes("'off', and 'n'"));
    assert.ok(proposedFull.includes('{"0", "false", "no", "off", "n"}'));

    const fileId = 'review-flask-helpers';
    const hunks = [
      {
        id: 'hunk-0',
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
        status: 'pending',
      },
      {
        id: 'hunk-1',
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
        status: 'pending',
      },
    ];

    // Check shadow diagnostics
    const diagSummary = await shadowDiags.verifyHunksInShadowDoc(helpersPyPath, proposedFull, hunks);
    assert.strictEqual(diagSummary.zeroRegression, true);

    // 3. Enqueue review into staging buffer
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
      },
    });

    const activeReview = stagingBuffer.getActiveReview();
    assert.ok(activeReview);
    assert.strictEqual(activeReview.hunks.length, 2);
    assert.strictEqual(activeReview.hunks[0].status, 'pending');
    assert.strictEqual(activeReview.hunks[1].status, 'pending');

    // 4. Accept Hunk #1
    await stagingBuffer.acceptHunk('hunk-0');
    assert.strictEqual(activeReview.hunks[0].status, 'accepted');
    assert.strictEqual(activeReview.hunks[1].status, 'pending');

    // 5. Accept Hunk #2
    await stagingBuffer.acceptHunk('hunk-1');
    assert.strictEqual(activeReview.hunks[1].status, 'accepted');

    // Await review completion
    const resolution = await reviewPromise;
    assert.strictEqual(resolution.status, 'applied');
    assert.deepStrictEqual(resolution.applied_hunks, [0, 1]);
    assert.deepStrictEqual(resolution.rejected_hunks, []);

    // 6. Simulate WorkspaceApplier applying bottom-to-top
    // Sort descending by oldStart
    const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
    let edited = currentContent;
    for (const h of sortedHunks) {
      edited = edited.replace(h.oldText, h.newText);
    }
    fs.writeFileSync(helpersPyPath, edited, 'utf8');

    // Verify modified file
    const appliedContent = fs.readFileSync(helpersPyPath, 'utf8');
    assert.ok(appliedContent.includes("'off', and 'n'"));
    assert.ok(appliedContent.includes('{"0", "false", "no", "off", "n"}'));

    // 7. Verify Turn-Level Checkpoint Undo
    const undoSuccess = await undoStack.undoLastTurn();
    assert.strictEqual(undoSuccess, true);

    // Verify file content is reverted back to exact original byte-for-byte!
    const restoredContent = fs.readFileSync(helpersPyPath, 'utf8');
    assert.strictEqual(restoredContent, ORIGINAL_FLASK_HELPERS);
    assert.ok(!restoredContent.includes("'off'"));
    assert.ok(!restoredContent.includes('"off", "n"'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
