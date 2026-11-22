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
    const isCRLF = doc.eol === vscode.EndOfLine?.CRLF || docText.includes('\r\n');

    const formatNewText = (text: string): string => {
      const normalized = text.replace(/\r\n/g, '\n');
      return isCRLF ? normalized.replace(/\n/g, '\r\n') : normalized;
    };

    // Sort descending by oldStart so bottom edits happen first
    const sortedHunks = [...acceptedHunks].sort((a, b) => b.oldStart - a.oldStart);

    for (const hunk of sortedHunks) {
      // Find the hunk's location in current document
      const range = this.findHunkRange(doc, hunk, docText);
      if (range) {
        edit.replace(uri, range, formatNewText(hunk.newText));
      } else {
        // Fallback: use oldStart and oldLines (1-indexed lines)
        const startLine = Math.max(0, hunk.oldStart - 1);
        const endLine = Math.min(doc.lineCount - 1, startLine + Math.max(0, hunk.oldLines - 1));
        const targetLine = doc.lineAt(startLine);
        const lineIndent = targetLine.text.match(/^(\s*)/)?.[1] || '';

        let replacement = hunk.newText;
        if (lineIndent && !replacement.startsWith(lineIndent)) {
          const lines = replacement.replace(/\r\n/g, '\n').split('\n');
          if (!lines[0].startsWith(lineIndent)) {
            lines[0] = lineIndent + lines[0];
          }
          replacement = lines.join('\n');
        }

        const endChar = doc.lineAt(endLine).range.end.character;
        const fallbackRange = new vscode.Range(startLine, 0, endLine, endChar);
        edit.replace(uri, fallbackRange, formatNewText(replacement));
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
   * Completely line-ending agnostic (CRLF vs LF) and resistant to indentation mismatches.
   */
  private static findHunkRange(
    doc: vscode.TextDocument,
    hunk: StagedHunk,
    docText: string,
  ): vscode.Range | null {
    if (!hunk.oldText && hunk.oldText !== '') {
      return null;
    }

    const normDoc = docText.replace(/\r\n/g, '\n');
    const normOld = hunk.oldText.replace(/\r\n/g, '\n');

    // Function to convert normalized character offset to vscode.Position(line, character)
    const offsetToPos = (offset: number): vscode.Position => {
      const prefix = normDoc.substring(0, offset);
      const lines = prefix.split('\n');
      const line = lines.length - 1;
      const character = lines[lines.length - 1].length;
      return new vscode.Position(line, character);
    };

    // Helper: offset in normDoc of start of line (0-indexed)
    const lineToOffset = (lineNum: number): number => {
      let curLine = 0;
      let idx = 0;
      while (curLine < lineNum && idx < normDoc.length) {
        const nextNl = normDoc.indexOf('\n', idx);
        if (nextNl === -1) return normDoc.length;
        idx = nextNl + 1;
        curLine++;
      }
      return idx;
    };

    // 1. Insertion (empty oldText)
    if (normOld.length === 0) {
      const targetLine = Math.max(0, Math.min(doc.lineCount - 1, hunk.oldStart - 1));
      const pos = new vscode.Position(targetLine, doc.lineAt(targetLine).range.end.character);
      return new vscode.Range(pos, pos);
    }

    // 2. Search around expected line (oldStart is 1-indexed)
    const expectedLine = Math.max(0, hunk.oldStart - 1);
    const startOffsetGuess = lineToOffset(expectedLine);
    const searchStart = Math.max(0, startOffsetGuess - 600);
    const searchEnd = Math.min(normDoc.length, startOffsetGuess + 600 + normOld.length);
    const searchSlice = normDoc.substring(searchStart, searchEnd);

    const sliceIdx = searchSlice.indexOf(normOld);
    if (sliceIdx !== -1) {
      const exactIndex = searchStart + sliceIdx;
      return new vscode.Range(offsetToPos(exactIndex), offsetToPos(exactIndex + normOld.length));
    }

    // 3. Global search
    const firstMatch = normDoc.indexOf(normOld);
    if (firstMatch !== -1) {
      const secondMatch = normDoc.indexOf(normOld, firstMatch + 1);
      if (secondMatch === -1) {
        return new vscode.Range(offsetToPos(firstMatch), offsetToPos(firstMatch + normOld.length));
      }
      // If multiple occurrences, pick the one closest to expectedLine
      let bestMatch = firstMatch;
      let minDiff = Math.abs(offsetToPos(firstMatch).line - expectedLine);
      let cur = secondMatch;
      while (cur !== -1) {
        const diff = Math.abs(offsetToPos(cur).line - expectedLine);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = cur;
        }
        cur = normDoc.indexOf(normOld, cur + 1);
      }
      return new vscode.Range(offsetToPos(bestMatch), offsetToPos(bestMatch + normOld.length));
    }

    // 4. Fuzzy / trimmed search: if oldText was trimmed or missing leading indent
    const trimmedOld = normOld.trim();
    if (trimmedOld.length > 0) {
      const trimmedSliceIdx = searchSlice.indexOf(trimmedOld);
      if (trimmedSliceIdx !== -1) {
        const exactIndex = searchStart + trimmedSliceIdx;
        return new vscode.Range(offsetToPos(exactIndex), offsetToPos(exactIndex + trimmedOld.length));
      }
      const globalTrimmed = normDoc.indexOf(trimmedOld);
      if (globalTrimmed !== -1) {
        return new vscode.Range(offsetToPos(globalTrimmed), offsetToPos(globalTrimmed + trimmedOld.length));
      }
    }

    return null;
  }
}
