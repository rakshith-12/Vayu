/**
 * @file modelSwitcher.ts
 * @description Model management and interactive QuickPick model switcher for TrueForge.
 */

import * as vscode from 'vscode';
import type { TrueForgeClient, ModelEntry } from './client';

export class ModelSwitcher {
  private activeModel: string;
  private onDidChangeModelEmitter = new vscode.EventEmitter<string>();

  readonly onDidChangeModel = this.onDidChangeModelEmitter.event;

  constructor(
    private client: TrueForgeClient,
    initialModel?: string,
  ) {
    const config = vscode.workspace.getConfiguration('trueforge');
    this.activeModel =
      initialModel ||
      config.get<string>('primaryModel') ||
      'primary-coding-model';
  }

  getActiveModel(): string {
    return this.activeModel;
  }

  setActiveModel(modelId: string): void {
    if (this.activeModel !== modelId) {
      this.activeModel = modelId;
      this.onDidChangeModelEmitter.fire(modelId);

      // Persist to user settings
      vscode.workspace
        .getConfiguration('trueforge')
        .update('primaryModel', modelId, vscode.ConfigurationTarget.Global)
        .then(undefined, () => {});
    }
  }

  /**
   * Prompt user with a QuickPick to switch the active model.
   */
  async promptModelQuickPick(): Promise<string | undefined> {
    let models: ModelEntry[] = [];
    try {
      models = await this.client.listModels();
    } catch {
      models = [
        { id: 'primary-coding-model', name: 'Primary Coding Model' },
        { id: 'secondary-fallback-model', name: 'Secondary Fallback Model' },
      ];
    }

    if (models.length === 0) {
      models = [
        { id: 'primary-coding-model', name: 'Primary Coding Model' },
        { id: 'secondary-fallback-model', name: 'Secondary Fallback Model' },
      ];
    }

    const items: vscode.QuickPickItem[] = models.map((m) => {
      const isSelected = m.id === this.activeModel;
      return {
        label: isSelected ? `$(check) ${m.name}` : m.name,
        description: m.id,
        picked: isSelected,
      };
    });

    const chosen = await vscode.window.showQuickPick(items, {
      placeHolder: `Select active model (Current: ${this.activeModel})`,
      matchOnDescription: true,
    });

    if (chosen && chosen.description) {
      this.setActiveModel(chosen.description);
      vscode.window.showInformationMessage(`TrueForge active model switched to: ${chosen.description}`);
      return chosen.description;
    }

    return undefined;
  }
}
