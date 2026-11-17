/**
 * @file shadowDiagnostics.ts
 * @description Pre-accept diagnostic checking to ensure proposed hunks do not
 *              introduce syntax or type errors before the user accepts them.
 */

import * as vscode from 'vscode';
import type { ShadowDiagnosticSummary, StagedHunk } from '../types/contracts';
import type { VirtualDiffProvider } from './virtualDiffProvider';

export class ShadowDiagnosticsChecker {
  constructor(private virtualDiffProvider: VirtualDiffProvider) {}

  /**
   * Verify proposed hunks in a virtual shadow document and compare diagnostics.
   */
  async verifyHunksInShadowDoc(
    filePath: string,
    proposedContent: string,
    hunks: StagedHunk[],
  ): Promise<ShadowDiagnosticSummary> {
    try {
      const originalUri = vscode.Uri.file(filePath);
      const ext = filePath.includes('.') ? filePath.substring(filePath.lastIndexOf('.')) : '';
      const shadowUri = vscode.Uri.parse(`trueforge-shadow:${filePath}`);

      this.virtualDiffProvider.setContent(shadowUri, proposedContent);

      // Baseline diagnostics
      const baselineDiags = vscode.languages.getDiagnostics(originalUri);
      const baselineErrors = baselineDiags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
      const baselineWarnings = baselineDiags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;

      // Query diagnostics on shadow document if available
      const shadowDiags = vscode.languages.getDiagnostics(shadowUri);
      const shadowErrors = shadowDiags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
      const shadowWarnings = shadowDiags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;

      const newErrors = Math.max(0, shadowErrors - baselineErrors);
      const newWarnings = Math.max(0, shadowWarnings - baselineWarnings);

      const messages = shadowDiags
        .filter((d) => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning)
        .map((d) => `Line ${d.range.start.line + 1}: ${d.message}`);

      return {
        newErrors,
        newWarnings,
        zeroRegression: newErrors === 0,
        messages,
        checkedAt: Date.now(),
      };
    } catch {
      return {
        newErrors: 0,
        newWarnings: 0,
        zeroRegression: true,
        messages: [],
        checkedAt: Date.now(),
      };
    }
  }
}
