/**
 * @file configValidator.ts
 * @description Pre-flight environment and configuration validator for TrueForge.
 *              Validates server connectivity, model catalog availability, and workspace setup.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface PreflightValidationResult {
  serverReachable: boolean;
  serverUrl: string;
  models: string[];
  mcpConfigured: boolean;
  warnings: string[];
  error?: string;
}

export class ConfigValidator {
  /**
   * Run pre-flight health checks against TrueForge server and workspace environment.
   */
  static async runPreflight(
    serverUrl: string,
    workspaceRoot?: string,
  ): Promise<PreflightValidationResult> {
    const warnings: string[] = [];
    let serverReachable = false;
    let models: string[] = [];
    let error: string | undefined;

    const cleanUrl = serverUrl.replace(/\/+$/, '');

    // 1. Check Server Connectivity & Model Catalog
    const endpoints = [`${cleanUrl}/api/v1/models`, `${cleanUrl}/api/models`];
    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);

        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          serverReachable = true;
          const json = (await res.json()) as {
            data?: Record<string, unknown> | Array<{ id: string; name: string }>;
          };

          if (Array.isArray(json)) {
            models = json.map((m: { id?: string; name?: string }) => m.name || m.id || String(m));
          } else if (Array.isArray(json.data)) {
            models = json.data.map((m) => m.name || m.id);
          } else if (json.data && typeof json.data === 'object') {
            models = Object.keys(json.data);
          }
          break;
        }
      } catch (err: unknown) {
        // Continue to fallback endpoint
      }
    }

    if (!serverReachable) {
      error = `TrueForge server is not reachable at ${serverUrl}. Ensure the server is running (e.g. via 'start-server.cmd').`;
      warnings.push('TrueForge local server is offline.');
    } else if (models.length === 0) {
      warnings.push('TrueForge server returned an empty model list. Check config.yaml on the server.');
    }

    // 2. Check MCP Configuration file in workspace
    let mcpConfigured = false;
    if (workspaceRoot) {
      const mcpJson = path.join(workspaceRoot, '.vscode', 'trueforge-mcp.json');
      if (fs.existsSync(mcpJson)) {
        mcpConfigured = true;
      }
    }

    return {
      serverReachable,
      serverUrl,
      models,
      mcpConfigured,
      warnings,
      error,
    };
  }
}
