/**
 * @file budgetAssembler.ts
 * @description Mode 1 inline edit fast-path assembler and context packer.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { estimateTokens, type ContextSlice } from '../types/contracts';
import { MentionParser } from './mentionParser';
import type { ContextLedgerTracker } from './ledgerTracker';

export interface InlineEditContext {
  targetFilePath: string;
  targetRange: vscode.Range;
  selectedText: string;
  prefixContext: string;
  suffixContext: string;
  importsContext: string;
  diagnosticsContext: string;
  mentionSlices: ContextSlice[];
  systemDirective: string;
  assembledPrompt: string;
}

export async function buildInlineEditContext(
  editor: vscode.TextEditor,
  instruction: string,
  turnId: string,
  ledger: ContextLedgerTracker,
): Promise<InlineEditContext> {
  const doc = editor.document;
  const filePath = doc.uri.fsPath;
  let selection = editor.selection;

  ledger.resetForTurn(turnId, 'inline-edit');

  // If selection is empty, expand to current line or ±20 lines
  if (selection.isEmpty) {
    const curLine = selection.active.line;
    const startLine = Math.max(0, curLine - 20);
    const endLine = Math.min(doc.lineCount - 1, curLine + 20);
    selection = new vscode.Selection(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, doc.lineAt(endLine).range.end.character),
    );
  }

  const selectedText = doc.getText(selection);
  const targetRange = new vscode.Range(selection.start, selection.end);

  // 1. Target code slice
  const targetSlice: ContextSlice = {
    id: `target-selection-${path.basename(filePath)}`,
    filePath,
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    tokens: estimateTokens(selectedText),
    source: 'user-pinned',
    score: 100,
    rationale: `Active user selection in ${path.basename(filePath)}`,
    content: selectedText,
    pinned: true,
  };
  ledger.addSlice(targetSlice);

  // 2. Prefix context (up to 40 lines above)
  const prefixStart = Math.max(0, selection.start.line - 40);
  const prefixRange = new vscode.Range(prefixStart, 0, selection.start.line, 0);
  const prefixContext = doc.getText(prefixRange);

  // 3. Suffix context (up to 40 lines below)
  const suffixEnd = Math.min(doc.lineCount - 1, selection.end.line + 40);
  const suffixRange = new vscode.Range(
    selection.end.line + 1,
    0,
    suffixEnd,
    doc.lineAt(suffixEnd).range.end.character,
  );
  const suffixContext = selection.end.line < doc.lineCount - 1 ? doc.getText(suffixRange) : '';

  // 4. Imports context (top 35 lines)
  const importsEnd = Math.min(doc.lineCount - 1, 35);
  const importsRange = new vscode.Range(0, 0, importsEnd, doc.lineAt(importsEnd).range.end.character);
  const importsContext = doc.getText(importsRange);

  // 5. Diagnostics
  const diags = vscode.languages.getDiagnostics(doc.uri);
  const diagMessages = diags
    .filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Error ||
        d.severity === vscode.DiagnosticSeverity.Warning,
    )
    .map((d) => `Line ${d.range.start.line + 1}: [${vscode.DiagnosticSeverity[d.severity]}] ${d.message}`)
    .join('\n');

  // 6. Mention parsing
  const mentionSlices = await MentionParser.parseAndResolve(instruction);
  for (const ms of mentionSlices) {
    ledger.addSlice(ms);
  }

  // System directive for Mode 1
  const systemDirective = `You are performing an inline edit in Visual Studio Code.
Target File: ${filePath}
Target Lines: ${selection.start.line + 1} to ${selection.end.line + 1}

Rules:
1. Provide the complete updated replacement code for the target selection.
2. If multiple modifications are made (e.g. separate docstring updates from implementation logic edits), ensure both are clearly reflected in the replacement code.
3. Output the replacement code in a clean \`\`\`python ... \`\`\` code block.
4. Ensure exact indentation matching the existing code.`;

  // Assembled prompt
  const assembledPrompt = `User Instruction: ${instruction}

Target File: ${filePath} (lines ${selection.start.line + 1}-${selection.end.line + 1})

--- IMPORTS (Lines 1-${importsEnd + 1}) ---
${importsContext}

--- PREFIX CONTEXT ---
${prefixContext}

--- TARGET CODE TO EDIT (Lines ${selection.start.line + 1}-${selection.end.line + 1}) ---
${selectedText}

--- SUFFIX CONTEXT ---
${suffixContext}
${diagMessages ? `\n--- ACTIVE DIAGNOSTICS ---\n${diagMessages}\n` : ''}
${mentionSlices.length > 0 ? `\n--- MENTIONED CONTEXT ---\n` + mentionSlices.map((s) => `[${s.rationale}]\n${s.content}`).join('\n\n') : ''}`;

  return {
    targetFilePath: filePath,
    targetRange,
    selectedText,
    prefixContext,
    suffixContext,
    importsContext,
    diagnosticsContext: diagMessages,
    mentionSlices,
    systemDirective,
    assembledPrompt,
  };
}
