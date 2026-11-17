/**
 * @file retriever.ts
 * @description Domain-agnostic multi-signal context retriever (Mode 2 - Agent Mode).
 *              Combines BM25 lexical search, workspace symbol discovery, and
 *              import neighbor heuristics to populate the token ledger and overflow TOC.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  estimateTokens,
  type ContextSlice,
  type TocOverflowEntry,
} from '../types/contracts';

interface ScoredCandidate {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  source: ContextSlice['source'];
  rationale: string;
  symbolName?: string;
}

export class ContextRetriever {
  private static STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'to', 'in', 'at',
    'for', 'with', 'on', 'of', 'by', 'from', 'this', 'that', 'it', 'as', 'be',
  ]);

  /**
   * Multi-signal retrieval across workspace files.
   * Returns top slices within budget and overflow TOC entries for the rest.
   */
  async retrieveSlices(
    query: string,
    tokenBudget = 10000,
    targetFilePath?: string,
  ): Promise<{ slices: ContextSlice[]; overflowToc: TocOverflowEntry[] }> {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      return { slices: [], overflowToc: [] };
    }

    const candidates: ScoredCandidate[] = [];

    // 1. Symbol Search
    try {
      const symbols = (await vscode.commands.executeCommand(
        'vscode.executeWorkspaceSymbolProvider',
        queryTokens[0] || query,
      )) as vscode.SymbolInformation[] | undefined;

      if (symbols && symbols.length > 0) {
        for (const sym of symbols.slice(0, 15)) {
          try {
            const doc = await vscode.workspace.openTextDocument(sym.location.uri);
            const startLine = Math.max(0, sym.location.range.start.line - 1);
            const endLine = Math.min(doc.lineCount - 1, sym.location.range.end.line + 3);
            const content = doc.getText(
              new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).range.end.character),
            );

            candidates.push({
              filePath: sym.location.uri.fsPath,
              startLine: startLine + 1,
              endLine: endLine + 1,
              content,
              score: 85,
              source: 'symbol-search',
              rationale: `Workspace symbol: ${sym.name} (${vscode.SymbolKind[sym.kind]})`,
              symbolName: sym.name,
            });
          } catch {
            // ignore unreadable docs
          }
        }
      }
    } catch {
      // ignore symbol provider failures
    }

    // 2. BM25 Lexical Search across Workspace Files
    try {
      const files = await vscode.workspace.findFiles(
        '**/*',
        '**/{node_modules,.git,dist,.vscode,__pycache__}/**',
        60,
      );

      for (const fileUri of files) {
        // Skip target file if provided
        if (targetFilePath && fileUri.fsPath.toLowerCase() === targetFilePath.toLowerCase()) {
          continue;
        }

        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const text = doc.getText();
          const score = this.calculateBm25Score(queryTokens, text);

          if (score > 0) {
            const matchingSnippet = this.extractTopSnippet(doc, queryTokens);
            if (matchingSnippet) {
              candidates.push({
                filePath: fileUri.fsPath,
                startLine: matchingSnippet.startLine,
                endLine: matchingSnippet.endLine,
                content: matchingSnippet.content,
                score,
                source: 'ripgrep-bm25',
                rationale: `BM25 match (score: ${Math.round(score)}) in ${path.basename(fileUri.fsPath)}`,
              });
            }
          }
        } catch {
          // ignore unreadable files
        }
      }
    } catch {
      // ignore findFiles errors
    }

    // 3. Rank candidates by score descending
    candidates.sort((a, b) => b.score - a.score);

    // 4. Budget assembly: pack slices into tokenBudget, overflow the rest into TOC
    const slices: ContextSlice[] = [];
    const overflowToc: TocOverflowEntry[] = [];
    let currentTokens = 0;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const sliceTokens = estimateTokens(cand.content);

      if (currentTokens + sliceTokens <= tokenBudget && slices.length < 10) {
        currentTokens += sliceTokens;
        slices.push({
          id: `slice-${Date.now()}-${i}`,
          filePath: cand.filePath,
          startLine: cand.startLine,
          endLine: cand.endLine,
          tokens: sliceTokens,
          source: cand.source,
          score: cand.score,
          rationale: cand.rationale,
          content: cand.content,
          pinned: false,
        });
      } else {
        overflowToc.push({
          id: `toc-${Date.now()}-${i}`,
          filePath: cand.filePath,
          symbolName: cand.symbolName || path.basename(cand.filePath),
          startLine: cand.startLine,
          endLine: cand.endLine,
          tokens: sliceTokens,
          score: cand.score,
        });
      }
    }

    return { slices, overflowToc };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !ContextRetriever.STOP_WORDS.has(w));
  }

  private calculateBm25Score(tokens: string[], text: string): number {
    const lower = text.toLowerCase();
    let score = 0;
    const k1 = 1.2;

    for (const token of tokens) {
      const count = (lower.match(new RegExp(`\\b${token}\\b`, 'g')) || []).length;
      if (count > 0) {
        // Simple term frequency scoring
        const tf = (count * (k1 + 1)) / (count + k1);
        score += tf * 10;
      }
    }

    return score;
  }

  private extractTopSnippet(
    doc: vscode.TextDocument,
    tokens: string[],
  ): { startLine: number; endLine: number; content: string } | null {
    const totalLines = doc.lineCount;
    let bestLine = 0;
    let maxMatches = 0;

    for (let i = 0; i < Math.min(totalLines, 300); i++) {
      const lineText = doc.lineAt(i).text.toLowerCase();
      let matches = 0;
      for (const t of tokens) {
        if (lineText.includes(t)) matches++;
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        bestLine = i;
      }
    }

    if (maxMatches === 0) return null;

    const startLine = Math.max(0, bestLine - 10);
    const endLine = Math.min(totalLines - 1, bestLine + 20);
    const content = doc.getText(
      new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).range.end.character),
    );

    return {
      startLine: startLine + 1,
      endLine: endLine + 1,
      content,
    };
  }
}
