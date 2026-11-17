/**
 * @file undoStack.ts
 * @description Dual-layer undo system. Layer A leverages VS Code's native
 *              undo stack for individual edits. Layer B maintains turn-level
 *              checkpoints for atomic full-turn rollbacks.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import type { UndoCheckpoint, UndoFileSnapshot } from '../types/contracts';

export class UndoCheckpointStack {
  private stack: UndoCheckpoint[] = [];

  /**
   * Ensure that a file is snapshotted before any modifications in this turn.
   */
  async ensureFileSnapshotted(turnId: string, filePath: string): Promise<void> {
    let checkpoint = this.stack.find((c) => c.turnId === turnId);
    if (!checkpoint) {
      checkpoint = {
        turnId,
        snapshots: [],
        createdAt: Date.now(),
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
      const uri = vscode.Uri.file(filePath);
      const data = await vscode.workspace.fs.readFile(uri);
      existedBefore = true;
      rawBytes = Buffer.from(data);
    } catch {
      existedBefore = false;
    }

    checkpoint.snapshots.push({
      filePath,
      existedBefore,
      rawBytes,
    });
  }

  /**
   * Roll back the entire last turn atomically.
   * Restores all modified files to pre-turn bytes and removes newly created files.
   */
  async undoLastTurn(): Promise<boolean> {
    const checkpoint = this.stack.pop();
    if (!checkpoint) {
      return false;
    }

    for (const snapshot of checkpoint.snapshots) {
      const uri = vscode.Uri.file(snapshot.filePath);
      try {
        if (!snapshot.existedBefore) {
          // File was created in this turn — delete it
          await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
        } else {
          // Restore exact previous contents
          await vscode.workspace.fs.writeFile(uri, snapshot.rawBytes);
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
  canUndo(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Clear the entire undo checkpoint stack.
   */
  clear(): void {
    this.stack = [];
  }
}
