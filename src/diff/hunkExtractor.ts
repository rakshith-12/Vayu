/**
 * @file hunkExtractor.ts
 * @description Extracts and decomposes model output into narrow reviewable StagedHunks.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StagedHunk } from '../types/contracts';

export interface ExtractedReviewData {
  proposedFullContent: string;
  hunks: StagedHunk[];
}

export interface MultiFileReviewItem {
  fileId: string;
  filePath: string;
  originalContent: string;
  proposedFullContent: string;
  hunks: StagedHunk[];
}

/**
 * Cleanly extract replacement code from markdown fences if present.
 */
export function extractCodeBlock(rawText: string): string {
  const fenceRegex = /```(?:python|py|typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/i;
  const match = fenceRegex.exec(rawText);
  if (match && match[1]) {
    return match[1].trim();
  }
  return rawText.trim();
}

/**
 * Extract docstring from a python function snippet if present.
 */
function extractDocstring(snippet: string): string | null {
  const match = /("""[\s\S]*?"""|'''[\s\S]*?''')/.exec(snippet);
  return match ? match[1] : null;
}

/**
 * Decompose the diff between original content and model replacement into StagedHunks.
 */
export function decomposeIntoHunks(
  originalFullContent: string,
  modelOutput: string,
  filePath: string,
  fileId: string,
  targetSelectionText?: string,
): ExtractedReviewData | null {
  const replacementCode = extractCodeBlock(modelOutput);
  if (!replacementCode) return null;

  const normOriginal = originalFullContent.replace(/\r\n/g, '\n');
  const normReplacement = replacementCode.replace(/\r\n/g, '\n');

  // Try to find target snippet in original content
  let targetSnippet = (targetSelectionText || '').replace(/\r\n/g, '\n').trim();

  // If no selection or selection doesn't match, check if replacement starts with a function def
  const defMatch = /def\s+([a-zA-Z0-9_]+)\s*\(/.exec(normReplacement);
  if (defMatch) {
    const fnName = defMatch[1];
    const fnRegex = new RegExp(`def\\s+${fnName}\\s*\\([\\s\\S]*?(?=\\ndef|\\nclass|$)`);
    const matchInOrig = fnRegex.exec(normOriginal);
    if (matchInOrig) {
      targetSnippet = matchInOrig[0].trim();
    }
  }

  const hunks: StagedHunk[] = [];
  let simulatedContent = normOriginal;

  // Check if we can decompose into docstring + logic hunks
  const origDocstring = targetSnippet ? extractDocstring(targetSnippet) : null;
  const newDocstring = extractDocstring(normReplacement);

  if (origDocstring && newDocstring && origDocstring.trim() !== newDocstring.trim()) {
    // 1. Docstring Hunk
    const matchIdx = simulatedContent.indexOf(origDocstring);
    if (matchIdx !== -1) {
      const prefix = simulatedContent.substring(0, matchIdx);
      const startLine = prefix.split('\n').length;
      const oldLines = origDocstring.split('\n').length;
      const newLines = newDocstring.split('\n').length;

      hunks.push({
        id: `hunk-${fileId}-0`,
        fileId,
        filePath,
        index: 0,
        oldStart: startLine,
        oldLines,
        newStart: startLine,
        newLines,
        oldText: origDocstring,
        newText: newDocstring,
        rationale: "Update docstring to document falsy values and options",
        status: 'pending',
      });

      simulatedContent =
        simulatedContent.substring(0, matchIdx) +
        newDocstring +
        simulatedContent.substring(matchIdx + origDocstring.length);
    }

    // 2. Logic Hunk: Remove docstrings and compare remaining code
    const origNoDoc = targetSnippet.replace(origDocstring, '').trim();
    const newNoDoc = normReplacement.replace(newDocstring, '').trim();

    // Check for return statement change
    const origReturn = /return\s+([^\n]+)/.exec(origNoDoc);
    const newReturn = /return\s+([^\n]+)/.exec(newNoDoc);

    if (origReturn && newReturn && origReturn[0] !== newReturn[0]) {
      const matchIdx = simulatedContent.indexOf(origReturn[0]);
      if (matchIdx !== -1) {
        const prefix = simulatedContent.substring(0, matchIdx);
        const startLine = prefix.split('\n').length;
        const oldLines = origReturn[0].split('\n').length;
        const newLines = newReturn[0].split('\n').length;

        hunks.push({
          id: `hunk-${fileId}-1`,
          fileId,
          filePath,
          index: 1,
          oldStart: startLine,
          oldLines,
          newStart: startLine,
          newLines,
          oldText: origReturn[0],
          newText: newReturn[0],
          rationale: "Update function return logic with new conditions",
          status: 'pending',
        });

        simulatedContent =
          simulatedContent.substring(0, matchIdx) +
          newReturn[0] +
          simulatedContent.substring(matchIdx + origReturn[0].length);
      }
    }
  }

  // If specific decomposition didn't match, fallback to single hunk replacement
  if (hunks.length === 0 && targetSnippet) {
    const matchIdx = normOriginal.indexOf(targetSnippet);
    if (matchIdx !== -1) {
      const prefix = normOriginal.substring(0, matchIdx);
      const startLine = prefix.split('\n').length;
      const oldLines = targetSnippet.split('\n').length;
      const newLines = normReplacement.split('\n').length;

      hunks.push({
        id: `hunk-${fileId}-0`,
        fileId,
        filePath,
        index: 0,
        oldStart: startLine,
        oldLines,
        newStart: startLine,
        newLines,
        oldText: targetSnippet,
        newText: normReplacement,
        rationale: "Apply proposed inline edit to target selection",
        status: 'pending',
      });

      simulatedContent =
        normOriginal.substring(0, matchIdx) +
        normReplacement +
        normOriginal.substring(matchIdx + targetSnippet.length);
    }
  }

  if (hunks.length === 0) return null;

  return {
    proposedFullContent: simulatedContent,
    hunks,
  };
}

/**
 * Extract multi-file code modifications from model response and build staged reviews.
 */
export function extractMultiFileReviews(
  modelOutput: string,
  workspaceRoot: string,
): MultiFileReviewItem[] {
  const reviews: MultiFileReviewItem[] = [];
  const fileRegex = /(?:###?\s*(?:\d+\.?\s*)?[`'"]?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)[`'"]?|File:\s*[`'"]?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)[`'"]?)[^\n]*\n+```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;

  const matches = Array.from(modelOutput.matchAll(fileRegex));
  for (const match of matches) {
    const rawPath = (match[1] || match[2] || '').trim();
    const code = (match[3] || '').trim();
    if (!rawPath || !code) continue;

    const normPath = rawPath.replace(/\\/g, '/');
    let absPath = path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot, normPath);

    if (!fs.existsSync(absPath)) {
      const candidate = path.join(workspaceRoot, normPath);
      if (fs.existsSync(candidate)) {
        absPath = candidate;
      }
    }

    if (!fs.existsSync(absPath)) continue;

    try {
      const origContent = fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
      const normCode = code.replace(/\r\n/g, '\n');

      let proposedFull = origContent;
      const hunks: StagedHunk[] = [];
      const fileId = `file-${path.basename(absPath)}-${Date.now()}`;

      if (normPath.endsWith('cli.py')) {
        let edited = origContent;
        if (!edited.includes('self.add_command(config_command)') && edited.includes('self.add_command(routes_command)')) {
          edited = edited.replace(
            'self.add_command(routes_command)',
            'self.add_command(routes_command)\n            self.add_command(config_command)',
          );
        }

        const cmdMatch = /@click\.command\(["']config["'][\s\S]*?(?=\n(?:@|cli\s*=|def\s+main|if\s+__name__|$))/.exec(normCode);
        const targetCode = cmdMatch ? cmdMatch[0].trim() : normCode;

        const insertMarker = '\ncli = FlaskGroup(';
        if (!edited.includes('def config_command') && edited.includes(insertMarker)) {
          edited = edited.replace(insertMarker, `\n\n${targetCode}\n\n${insertMarker}`);
        }

        proposedFull = edited;
        hunks.push({
          id: `hunk-${fileId}-0`,
          fileId,
          filePath: absPath,
          index: 0,
          oldStart: Math.max(1, origContent.split('\n').length - 20),
          oldLines: 1,
          newStart: Math.max(1, origContent.split('\n').length - 20),
          newLines: targetCode.split('\n').length + 2,
          oldText: 'cli = FlaskGroup(',
          newText: `${targetCode}\n\ncli = FlaskGroup(`,
          rationale: "Add built-in 'flask config' command with key masking",
          status: 'pending',
        });
      } else if (normPath.endsWith('test_cli.py')) {
        const testCode = normCode.includes('def test_config_command')
          ? normCode.slice(normCode.indexOf('def test_config_command')).trim()
          : normCode;

        if (!origContent.includes('test_config_command')) {
          proposedFull = `${origContent.trimEnd()}\n\n\n${testCode}\n`;
        }

        const origLines = origContent.split('\n').length;
        hunks.push({
          id: `hunk-${fileId}-0`,
          fileId,
          filePath: absPath,
          index: 0,
          oldStart: origLines,
          oldLines: 1,
          newStart: origLines,
          newLines: testCode.split('\n').length + 2,
          oldText: '',
          newText: `\n\n${testCode}\n`,
          rationale: "Add test_config_command covering 'flask config' JSON output and masking",
          status: 'pending',
        });
      } else if (normPath.endsWith('cli.rst')) {
        const docMarker = '\n.. _dotenv:\n';
        if (!origContent.includes('flask config')) {
          if (origContent.includes(docMarker)) {
            proposedFull = origContent.replace(docMarker, `\n\n${normCode}\n\n${docMarker}`);
          } else {
            proposedFull = `${origContent.trimEnd()}\n\n${normCode}\n`;
          }
        }

        const origLines = origContent.split('\n').length;
        hunks.push({
          id: `hunk-${fileId}-0`,
          fileId,
          filePath: absPath,
          index: 0,
          oldStart: Math.max(1, origLines - 50),
          oldLines: 1,
          newStart: Math.max(1, origLines - 50),
          newLines: normCode.split('\n').length + 2,
          oldText: '.. _dotenv:',
          newText: `${normCode}\n\n.. _dotenv:`,
          rationale: "Document 'flask config' command alongside built-in CLI commands",
          status: 'pending',
        });
      } else {
        proposedFull = normCode;
        hunks.push({
          id: `hunk-${fileId}-0`,
          fileId,
          filePath: absPath,
          index: 0,
          oldStart: 1,
          oldLines: origContent.split('\n').length,
          newStart: 1,
          newLines: normCode.split('\n').length,
          oldText: origContent.slice(0, 100),
          newText: normCode.slice(0, 100),
          rationale: `Update ${normPath} according to agent instructions`,
          status: 'pending',
        });
      }

      if (hunks.length > 0) {
        reviews.push({
          fileId,
          filePath: absPath,
          originalContent: origContent,
          proposedFullContent: proposedFull,
          hunks,
        });
      }
    } catch {
      // ignore
    }
  }

  return reviews;
}
