/**
 * @file inlineDecorator.ts
 * @description In-editor decorations and CodeLens provider for staged diff hunks.
 */

import * as vscode from 'vscode';
import type { StagingBuffer } from './stagingBuffer';
import type { StagedHunk } from '../types/contracts';

export class InlineDecorator implements vscode.CodeLensProvider {
  private decorationType: vscode.TextEditorDecorationType;
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(private stagingBuffer: StagingBuffer) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(248, 81, 73, 0.18)',
      isWholeLine: true,
      overviewRulerColor: 'rgba(248, 81, 73, 0.5)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    // Refresh decorations and CodeLens whenever the staging buffer changes
    this.stagingBuffer.onDidChangeQueue(() => {
      this.refresh();
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
    this.updateDecorations();
  }

  private updateDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const activeReview = this.stagingBuffer.getActiveReview();
    if (!activeReview || editor.document.uri.fsPath !== activeReview.filePath) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const ranges: vscode.DecorationOptions[] = [];
    for (const hunk of activeReview.hunks) {
      if (hunk.status !== 'pending') continue;

      const startLine = Math.max(0, hunk.oldStart - 1);
      const endLine = Math.min(
        editor.document.lineCount - 1,
        startLine + Math.max(0, hunk.oldLines - 1),
      );

      const range = new vscode.Range(
        startLine,
        0,
        endLine,
        editor.document.lineAt(endLine).range.end.character,
      );

      ranges.push({
        range,
        hoverMessage: new vscode.MarkdownString(
          `**TrueForge Proposed Change (#${hunk.index + 1})**\n\n${hunk.rationale}\n\n` +
            `*${hunk.shadowDiagnostics?.zeroRegression ? '✅ LSP: 0 errors' : '⚠️ LSP issues detected'}*`,
        ),
      });
    }

    editor.setDecorations(this.decorationType, ranges);
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const activeReview = this.stagingBuffer.getActiveReview();
    if (!activeReview || document.uri.fsPath !== activeReview.filePath) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];

    // File-level header CodeLens at line 0
    if (activeReview.hunks.some((h) => h.status === 'pending')) {
      const topRange = new vscode.Range(0, 0, 0, 0);
      lenses.push(
        new vscode.CodeLens(topRange, {
          title: '$(check-all) Accept All Hunks in File',
          command: 'trueforge.acceptFile',
        }),
        new vscode.CodeLens(topRange, {
          title: '$(discard) Reject All Hunks in File',
          command: 'trueforge.rejectFile',
        }),
      );
    }

    // Per-hunk CodeLens
    for (const hunk of activeReview.hunks) {
      if (hunk.status !== 'pending') continue;

      const hunkLine = Math.max(0, hunk.oldStart - 1);
      const range = new vscode.Range(hunkLine, 0, hunkLine, 0);

      // 1. Accept Hunk
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(check) Accept Hunk #${hunk.index + 1}${hunk.rationale ? `: ${hunk.rationale}` : ''}`,
          command: 'trueforge.acceptHunk',
          arguments: [hunk.id],
        }),
      );

      // 2. Reject Hunk
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(close) Reject Hunk',
          command: 'trueforge.rejectHunk',
          arguments: [hunk.id],
        }),
      );

      // 3. Side-by-Side Diff
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(diff) Side-by-Side Diff',
          command: 'trueforge.toggleNativeDiff',
          arguments: [activeReview.fileId, hunk.index],
        }),
      );

      // 4. LSP status
      const lspTitle = hunk.shadowDiagnostics?.zeroRegression
        ? '$(pass) LSP: 0 errors'
        : `$(warning) LSP: ${hunk.shadowDiagnostics?.newErrors ?? 0} errors`;
      lenses.push(
        new vscode.CodeLens(range, {
          title: lspTitle,
          command: '', // Informational badge
        }),
      );
    }

    return lenses;
  }

  dispose(): void {
    this.decorationType.dispose();
  }
}
