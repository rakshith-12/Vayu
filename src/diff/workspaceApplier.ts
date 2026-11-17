/**
 * @file workspaceApplier.ts
 * @description Bottom-to-top atomic WorkspaceEdit applier for accepted diff hunks.
 */

import * as vscode from 'vscode';
import type { StagedFileReview, StagedHunk } from '../types/contracts';

export class WorkspaceApplier {
  /**
   * Apply accepted hunks for a staged file review.
   * Edits are applied bottom-to-top (descending line order) so line shifts
   * do not invalidate subsequent range calculations.
   */
  static async applyFileReview(
    review: StagedFileReview,
    acceptedHunks: StagedHunk[],
  ): Promise<boolean> {
    const uri = vscode.Uri.file(review.filePath);
    const edit = new vscode.WorkspaceEdit();

    if (review.isDeleteFile) {
      edit.deleteFile(uri, { ignoreIfNotExists: true });
      return vscode.workspace.applyEdit(edit);
    }

    if (review.isNewFile) {
      edit.createFile(uri, { overwrite: true });
      edit.insert(uri, new vscode.Position(0, 0), review.proposedFullContent);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        const doc = await vscode.workspace.openTextDocument(uri);
        await doc.save();
      }
      return applied;
    }

    if (acceptedHunks.length === 0) {
      return true;
    }

    // Open existing document to get exact line ranges
    const doc = await vscode.workspace.openTextDocument(uri);
    const docText = doc.getText();

    // Sort descending by oldStart so bottom edits happen first
    const sortedHunks = [...acceptedHunks].sort((a, b) => b.oldStart - a.oldStart);

    for (const hunk of sortedHunks) {
      // Find the hunk's location in current document
      const range = this.findHunkRange(doc, hunk, docText);
      if (range) {
        edit.replace(uri, range, hunk.newText);
      } else {
        // Fallback: use oldStart and oldLines (1-indexed lines)
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
  private static findHunkRange(
    doc: vscode.TextDocument,
    hunk: StagedHunk,
    docText: string,
  ): vscode.Range | null {
    // 1. Try exact match around oldStart
    const expectedLine = Math.max(0, hunk.oldStart - 1);
    const startOffsetGuess = doc.offsetAt(new vscode.Position(expectedLine, 0));

    // Check exact substring at startOffsetGuess or nearby
    const exactIndex = docText.indexOf(hunk.oldText, Math.max(0, startOffsetGuess - 500));
    if (exactIndex !== -1 && exactIndex < startOffsetGuess + 500) {
      const startPos = doc.positionAt(exactIndex);
      const endPos = doc.positionAt(exactIndex + hunk.oldText.length);
      return new vscode.Range(startPos, endPos);
    }

    // 2. Global exact match if unique
    const firstMatch = docText.indexOf(hunk.oldText);
    if (firstMatch !== -1 && docText.indexOf(hunk.oldText, firstMatch + 1) === -1) {
      const startPos = doc.positionAt(firstMatch);
      const endPos = doc.positionAt(firstMatch + hunk.oldText.length);
      return new vscode.Range(startPos, endPos);
    }

    return null;
  }
}
