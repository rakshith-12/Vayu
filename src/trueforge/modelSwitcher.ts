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
      'google-gemini/gemini-3-5-flash-lite';
    this.client.setActiveModel(this.activeModel);
  }

  getActiveModel(): string {
    return this.activeModel;
  }

  setActiveModel(modelId: string): void {
    if (this.activeModel !== modelId) {
      this.activeModel = modelId;
      this.client.setActiveModel(modelId);
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
        { id: 'google-gemini/gemini-3-5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
        { id: 'openrouter/nemotron-3-ultra-free', name: 'Nemotron 3 Ultra (Free)' },
        { id: 'google-gemini/gemini-3-1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
      ];
    }

    if (models.length === 0) {
      models = [
        { id: 'google-gemini/gemini-3-5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
        { id: 'openrouter/nemotron-3-ultra-free', name: 'Nemotron 3 Ultra (Free)' },
        { id: 'google-gemini/gemini-3-1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
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
