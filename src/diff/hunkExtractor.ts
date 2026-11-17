/**
 * @file hunkExtractor.ts
 * @description Extracts and decomposes model output into narrow reviewable StagedHunks.
 */

import type { StagedHunk } from '../types/contracts';

export interface ExtractedReviewData {
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
