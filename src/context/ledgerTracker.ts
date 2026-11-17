/**
 * @file ledgerTracker.ts
 * @description Context ledger and token accounting tracker.
 */

import * as vscode from 'vscode';
import {
  estimateTokens,
  type ContextLedgerSnapshot,
  type ContextSlice,
  type ExecutionMode,
  type TocOverflowEntry,
} from '../types/contracts';

export class ContextLedgerTracker {
  private turnId: string = '';
  private mode: ExecutionMode = 'inline-edit';
  private budgetCap: number = 16000;
  private ceilingCap: number = 32000;
  private slices: ContextSlice[] = [];
  private overflowToc: TocOverflowEntry[] = [];
  private onDidUpdateLedgerEmitter = new vscode.EventEmitter<ContextLedgerSnapshot>();

  readonly onDidUpdateLedger = this.onDidUpdateLedgerEmitter.event;

  resetForTurn(turnId: string, mode: ExecutionMode, budgetCap = 16000, ceilingCap = 32000): void {
    this.turnId = turnId;
    this.mode = mode;
    this.budgetCap = budgetCap;
    this.ceilingCap = ceilingCap;
    this.slices = [];
    this.overflowToc = [];
  }

  addSlice(slice: ContextSlice): void {
    this.slices.push(slice);
    this.notifyUpdate();
  }

  addOverflow(entry: TocOverflowEntry): void {
    this.overflowToc.push(entry);
    this.notifyUpdate();
  }

  pinSlice(sliceId: string, pinned: boolean): void {
    const slice = this.slices.find((s) => s.id === sliceId);
    if (slice) {
      slice.pinned = pinned;
      this.notifyUpdate();
    }
  }

  promoteToc(tocEntryId: string, content: string): boolean {
    const idx = this.overflowToc.findIndex((t) => t.id === tocEntryId);
    if (idx === -1) return false;

    const toc = this.overflowToc.splice(idx, 1)[0];
    const newSlice: ContextSlice = {
      id: `promoted-${toc.id}`,
      filePath: toc.filePath,
      startLine: toc.startLine,
      endLine: toc.endLine,
      tokens: toc.tokens,
      source: 'symbol-search',
      score: toc.score,
      rationale: `User promoted: ${toc.symbolName}`,
      content,
      pinned: true,
      promotedFromToc: true,
    };

    this.slices.push(newSlice);
    this.notifyUpdate();
    return true;
  }

  getTocEntry(tocEntryId: string): TocOverflowEntry | undefined {
    return this.overflowToc.find((t) => t.id === tocEntryId);
  }

  getSlices(): ContextSlice[] {
    return [...this.slices];
  }

  getSnapshot(): ContextLedgerSnapshot {
    let systemAndMap = 0;
    let mentionsAndPinned = 0;
    let ripgrepBm25 = 0;
    let astImports = 0;
    let mcpToolReads = 0;

    for (const slice of this.slices) {
      switch (slice.source) {
        case 'repo-map':
          systemAndMap += slice.tokens;
          break;
        case 'user-pinned':
        case 'mention-file':
        case 'mention-symbol':
          mentionsAndPinned += slice.tokens;
          break;
        case 'ripgrep-bm25':
        case 'symbol-search':
          ripgrepBm25 += slice.tokens;
          break;
        case 'ast-import-neighbor':
          astImports += slice.tokens;
          break;
        case 'mcp-tool-read':
          mcpToolReads += slice.tokens;
          break;
      }
    }

    const totalTokensUsed =
      systemAndMap + mentionsAndPinned + ripgrepBm25 + astImports + mcpToolReads;

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
        mcpToolReads,
      },
      slices: this.slices.map(({ content, ...rest }) => rest),
      overflowToc: [...this.overflowToc],
    };
  }

  private notifyUpdate(): void {
    this.onDidUpdateLedgerEmitter.fire(this.getSnapshot());
  }
}
