/**
 * @file stagingBuffer.ts
 * @description FIFO staging buffer and review coordinator for proposed file edits.
 */

import * as vscode from 'vscode';
import type {
  StagedFileReview,
  StagedHunk,
  ProposeEditResolution,
} from '../types/contracts';
import { WorkspaceApplier } from './workspaceApplier';

export class StagingBuffer {
  private queue: StagedFileReview[] = [];
  private activeReview: StagedFileReview | null = null;
  private onDidChangeQueueEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeQueue = this.onDidChangeQueueEmitter.event;

  /**
   * Enqueue a new file review.
   * Returns a Promise that resolves only when the user finishes reviewing the file.
   */
  enqueueFileReview(review: StagedFileReview): Promise<ProposeEditResolution> {
    return new Promise<ProposeEditResolution>((resolve) => {
      // Wrap resolveGate to also resolve the promise
      const originalResolveGate = review.resolveGate;
      review.resolveGate = (resolution: ProposeEditResolution) => {
        if (originalResolveGate) {
          try {
            originalResolveGate(resolution);
          } catch {
            // ignore
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

  getActiveReview(): StagedFileReview | null {
    return this.activeReview;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }

  private presentNext(): void {
    if (this.queue.length > 0) {
      this.activeReview = this.queue.shift()!;
      this.openActiveFile();
    } else {
      this.activeReview = null;
    }
    this.onDidChangeQueueEmitter.fire();
  }

  private async openActiveFile(): Promise<void> {
    if (!this.activeReview) return;
    try {
      const uri = vscode.Uri.file(this.activeReview.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      // ignore
    }
  }

  /**
   * Accept a specific hunk by its ID.
   */
  async acceptHunk(hunkId: string): Promise<void> {
    if (!this.activeReview) return;
    const hunk = this.activeReview.hunks.find((h) => h.id === hunkId);
    if (!hunk || hunk.status !== 'pending') return;

    hunk.status = 'accepted';
    this.checkReviewCompletion();
  }

  /**
   * Reject a specific hunk by its ID.
   */
  async rejectHunk(hunkId: string): Promise<void> {
    if (!this.activeReview) return;
    const hunk = this.activeReview.hunks.find((h) => h.id === hunkId);
    if (!hunk || hunk.status !== 'pending') return;

    hunk.status = 'rejected';
    this.checkReviewCompletion();
  }

  /**
   * Accept all remaining pending hunks in the active review.
   */
  async acceptAllInActive(): Promise<void> {
    if (!this.activeReview) return;
    for (const hunk of this.activeReview.hunks) {
      if (hunk.status === 'pending') {
        hunk.status = 'accepted';
      }
    }
    await this.completeActiveReview();
  }

  /**
   * Accept all remaining pending hunks in active and all queued file reviews.
   */
  async acceptAllInAllQueued(): Promise<void> {
    while (this.activeReview) {
      await this.acceptAllInActive();
    }
  }

  /**
   * Reject all remaining pending hunks in the active review.
   */
  async rejectAllInActive(): Promise<void> {
    if (!this.activeReview) return;
    for (const hunk of this.activeReview.hunks) {
      if (hunk.status === 'pending') {
        hunk.status = 'rejected';
      }
    }
    await this.completeActiveReview();
  }

  private async checkReviewCompletion(): Promise<void> {
    if (!this.activeReview) return;
    const anyPending = this.activeReview.hunks.some((h) => h.status === 'pending');
    if (!anyPending) {
      await this.completeActiveReview();
    } else {
      this.onDidChangeQueueEmitter.fire();
    }
  }

  private async completeActiveReview(): Promise<void> {
    const review = this.activeReview;
    if (!review) return;

    const acceptedHunks = review.hunks.filter((h) => h.status === 'accepted');
    const rejectedHunks = review.hunks.filter((h) => h.status === 'rejected');

    // Apply accepted hunks via atomic WorkspaceEdit
    if (acceptedHunks.length > 0) {
      await WorkspaceApplier.applyFileReview(review, acceptedHunks);
    }

    let status: ProposeEditResolution['status'] = 'rejected';
    if (acceptedHunks.length > 0 && rejectedHunks.length === 0) {
      status = 'applied';
    } else if (acceptedHunks.length > 0 && rejectedHunks.length > 0) {
      status = 'partially_applied';
    }

    const appliedIndices = acceptedHunks.map((h) => h.index);
    const rejectedIndices = rejectedHunks.map((h) => h.index);

    const resolution: ProposeEditResolution = {
      status,
      applied_hunks: appliedIndices,
      rejected_hunks: rejectedIndices,
      post_edit_snippet: acceptedHunks.map((h) => h.newText).join('\n---\n').slice(0, 500),
    };

    review.resolveGate(resolution);
    this.presentNext();
  }

  /**
   * Clear all pending reviews, cancelling parked promises.
   */
  clearAllPendingWithCancelledStatus(): void {
    if (this.activeReview) {
      this.activeReview.resolveGate({
        status: 'cancelled',
        applied_hunks: [],
        rejected_hunks: [],
        post_edit_snippet: '',
      });
      this.activeReview = null;
    }

    while (this.queue.length > 0) {
      const review = this.queue.shift()!;
      review.resolveGate({
        status: 'cancelled',
        applied_hunks: [],
        rejected_hunks: [],
        post_edit_snippet: '',
      });
    }

    this.onDidChangeQueueEmitter.fire();
  }
}
