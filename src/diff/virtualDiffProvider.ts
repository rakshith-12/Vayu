/**
 * @file virtualDiffProvider.ts
 * @description In-memory TextDocumentContentProvider for `trueforge-diff://` and
 *              `trueforge-shadow://` URI schemes, enabling native side-by-side diff
 *              and shadow LSP validation without disk writes.
 */

import * as vscode from 'vscode';

export class VirtualDiffProvider implements vscode.TextDocumentContentProvider {
  private contentMap = new Map<string, string>();
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  /**
   * Set or update virtual file content for a URI.
   */
  setContent(uri: vscode.Uri, content: string): void {
    this.contentMap.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  /**
   * Get virtual file content.
   */
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.toString()) ?? '';
  }

  /**
   * Remove virtual file content.
   */
  deleteContent(uri: vscode.Uri): void {
    this.contentMap.delete(uri.toString());
    this.onDidChangeEmitter.fire(uri);
  }

  /**
   * Clear all virtual files.
   */
  clear(): void {
    this.contentMap.clear();
  }
}
