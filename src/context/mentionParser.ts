/**
 * @file mentionParser.ts
 * @description Extracts and resolves `@file` and `@symbol` mentions from user prompts.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { estimateTokens, type ContextSlice } from '../types/contracts';

export class MentionParser {
  private static MENTION_REGEX = /@file:([^\s]+)|@symbol:([^\s]+)|@([a-zA-Z0-9_./-]+)/g;

  /**
   * Parse mentions from an instruction string and resolve them to ContextSlices.
   */
  static async parseAndResolve(instruction: string): Promise<ContextSlice[]> {
    const slices: ContextSlice[] = [];
    const matches = Array.from(instruction.matchAll(this.MENTION_REGEX));

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    for (const match of matches) {
      const fileMention = match[1] || match[3];
      const symbolMention = match[2];

      if (symbolMention) {
        // Resolve symbol
        try {
          const syms = (await vscode.commands.executeCommand(
            'vscode.executeWorkspaceSymbolProvider',
            symbolMention,
          )) as vscode.SymbolInformation[] | undefined;

          if (syms && syms.length > 0) {
            const topSym = syms[0];
            const uri = topSym.location.uri;
            const doc = await vscode.workspace.openTextDocument(uri);
            const startLine = Math.max(0, topSym.location.range.start.line - 2);
            const endLine = Math.min(doc.lineCount - 1, topSym.location.range.end.line + 5);

            const content = doc.getText(
              new vscode.Range(
                startLine,
                0,
                endLine,
                doc.lineAt(endLine).range.end.character,
              ),
            );

            slices.push({
              id: `mention-symbol-${topSym.name}`,
              filePath: uri.fsPath,
              startLine: startLine + 1,
              endLine: endLine + 1,
              tokens: estimateTokens(content),
              source: 'mention-symbol',
              score: 95,
              rationale: `Direct @symbol mention of ${topSym.name}`,
              content,
              pinned: true,
            });
          }
        } catch {
          // ignore
        }
      } else if (fileMention) {
        // Resolve file
        let resolvedPath = path.isAbsolute(fileMention)
          ? fileMention
          : path.join(workspaceRoot, fileMention);

        // Try fuzzy match if file doesn't exist directly
        if (!fs.existsSync(resolvedPath)) {
          const found = await vscode.workspace.findFiles(`**/${fileMention}`, null, 1);
          if (found.length > 0) {
            resolvedPath = found[0].fsPath;
          }
        }

        if (fs.existsSync(resolvedPath)) {
          try {
            const raw = fs.readFileSync(resolvedPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            const cappedLines = lines.slice(0, 250);
            const content = cappedLines.join('\n');

            slices.push({
              id: `mention-file-${path.basename(resolvedPath)}`,
              filePath: resolvedPath,
              startLine: 1,
              endLine: cappedLines.length,
              tokens: estimateTokens(content),
              source: 'mention-file',
              score: 100,
              rationale: `Direct @file mention of ${path.basename(resolvedPath)}`,
              content,
              pinned: true,
            });
          } catch {
            // ignore
          }
        }
      }
    }

    return slices;
  }
}
