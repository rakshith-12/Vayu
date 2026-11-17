/**
 * @file client.ts
 * @description TrueForge session manager and approval resolver.
 *              Targeted at TrueForge v0.185+ (/api/v1) with automatic IPv4/IPv6 loopback resolution.
 */

import {
  type TrueForgeStreamEvent,
  type ToolApprovalRequiredEvent,
  HttpError,
} from '../types/contracts';
import { StreamHandler } from './streamHandler';
import { ResilienceSupervisor } from './resilience';

/** Options for creating a new TrueForge session. */
interface CreateSessionOptions {
  /** MCP port the extension listens on for tool calls. */
  mcpPort?: number;
}

/** Response shape returned by session creation. */
interface CreateSessionResponse {
  sessionId?: string;
  id?: string;
  data?: {
    id: string;
    agent?: unknown;
  };
}

/** Response body returned by model listing. */
export interface ModelEntry {
  id: string;
  name: string;
}

/** Decision payload sent when resolving a tool approval gate. */
export interface ToolApprovalDecision {
  approved: boolean;
  accepted_hunks?: number[];
  rejected_hunks?: number[];
}

export class TrueForgeClient {
  private readonly serverUrl: string;
  private readonly agentId: string;
  private activeSessionId: string | null = null;
  private activeBaseUrl: string | null = null;
  private readonly streamHandler: StreamHandler;
  private readonly resilience: ResilienceSupervisor;

  constructor(serverUrl: string, agentId: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.agentId = agentId;
    this.streamHandler = new StreamHandler();
    this.resilience = new ResilienceSupervisor();
  }

  /**
   * Produce candidate base URLs to transparently handle IPv4 (127.0.0.1) and IPv6 (localhost / ::1).
   */
  private getCandidateBaseUrls(): string[] {
    const list: string[] = [];
    if (this.activeBaseUrl) {
      list.push(this.activeBaseUrl);
    }
    list.push(this.serverUrl);

    if (this.serverUrl.includes('127.0.0.1')) {
      list.push(this.serverUrl.replace('127.0.0.1', 'localhost'));
      list.push(this.serverUrl.replace('127.0.0.1', '[::1]'));
    } else if (this.serverUrl.includes('localhost')) {
      list.push(this.serverUrl.replace('localhost', '127.0.0.1'));
      list.push(this.serverUrl.replace('localhost', '[::1]'));
    } else if (this.serverUrl.includes('[::1]')) {
      list.push(this.serverUrl.replace('[::1]', 'localhost'));
      list.push(this.serverUrl.replace('[::1]', '127.0.0.1'));
    }

    return Array.from(new Set(list));
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  async createSession(options?: CreateSessionOptions): Promise<string> {
    const candidateBases = this.getCandidateBaseUrls();
    const urls: string[] = [];
    for (const base of candidateBases) {
      urls.push(`${base}/api/v1/sessions`);
    }

    const body = JSON.stringify({
      agent: { name: this.agentId },
      metadata: options?.mcpPort ? { mcpPort: String(options.mcpPort) } : {},
    });

    const response = await this.resilience.executeTurnWithFailover(async (signal) => {
      let lastErr: Error | null = null;

      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal,
          });

          if (res.ok) {
            const urlObj = new URL(url);
            this.activeBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
            return (await res.json()) as CreateSessionResponse;
          }

          const errText = await res.text().catch(() => '');
          lastErr = new HttpError(
            res.status,
            `createSession failed on ${url} (${res.status}): ${errText || res.statusText}`,
          );
        } catch (err: unknown) {
          lastErr = err instanceof Error ? err : new Error(String(err));
        }
      }

      throw (
        lastErr ||
        new Error(
          `Cannot reach TrueForge at ${this.serverUrl}. Ensure the server is running (run 'start-server.cmd').`,
        )
      );
    });

    const sessionId = response.data?.id || response.sessionId || response.id;
    if (!sessionId) {
      throw new Error(`Failed to extract sessionId from response: ${JSON.stringify(response)}`);
    }

    this.activeSessionId = sessionId;
    return sessionId;
  }

  // ---------------------------------------------------------------------------
  // Turn execution
  // ---------------------------------------------------------------------------

  async *submitTurn(
    sessionId: string,
    prompt: string,
    systemDirective?: string,
  ): AsyncGenerator<TrueForgeStreamEvent> {
    const fullText = systemDirective ? `${systemDirective}\n\n${prompt}` : prompt;

    const candidateBases = this.getCandidateBaseUrls();
    const urls: string[] = [];
    for (const base of candidateBases) {
      urls.push(`${base}/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`);
    }

    const body = JSON.stringify({
      input: [
        {
          type: 'user.message',
          content: fullText,
        },
      ],
      stream: true,
    });

    const response = await this.resilience.executeTurnWithFailover(async (signal) => {
      const abortCtrl = this.streamHandler.createAbortController();
      signal.addEventListener('abort', () => abortCtrl.abort(), { once: true });

      let lastErr: Error | null = null;

      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body,
            signal: abortCtrl.signal,
          });

          if (res.ok) {
            const urlObj = new URL(url);
            this.activeBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
            return res;
          }

          const errText = await res.text().catch(() => '');
          lastErr = new HttpError(
            res.status,
            `submitTurn failed on ${url} (${res.status}): ${errText || res.statusText}`,
          );
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
        }
      }

      throw (
        lastErr ||
        new Error(
          `Cannot reach TrueForge at ${this.serverUrl}. Ensure the server is running (run 'start-server.cmd').`,
        )
      );
    });

    yield* this.streamHandler.parseSSEStream(response);
  }

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  async cancelSession(sessionId: string): Promise<void> {
    this.streamHandler.abort();

    const candidateBases = this.getCandidateBaseUrls();
    const urls: string[] = [];
    for (const base of candidateBases) {
      urls.push(`${base}/api/v1/sessions/${encodeURIComponent(sessionId)}/cancel`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);

    try {
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
          });
          if (res.ok) break;
        } catch {
          // ignore
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Tool approval
  // ---------------------------------------------------------------------------

  async resolveToolApproval(
    sessionId: string,
    approvalId: string,
    decision: ToolApprovalDecision,
  ): Promise<void> {
    const candidateBases = this.getCandidateBaseUrls();
    const urls: string[] = [];
    for (const base of candidateBases) {
      urls.push(`${base}/api/v1/sessions/${encodeURIComponent(sessionId)}/grants`);
    }
    const body = JSON.stringify(decision);

    await this.resilience.executeTurnWithFailover(async (signal) => {
      let lastErr: Error | null = null;
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal,
          });
          if (res.ok) return;
          lastErr = new HttpError(res.status, `resolveToolApproval failed on ${url}: ${res.statusText}`);
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw lastErr || new Error('resolveToolApproval failed');
    });
  }

  // ---------------------------------------------------------------------------
  // Model listing
  // ---------------------------------------------------------------------------

  async listModels(): Promise<ModelEntry[]> {
    const candidateBases = this.getCandidateBaseUrls();
    const urls: string[] = [];
    for (const base of candidateBases) {
      urls.push(`${base}/api/v1/models`);
    }

    return this.resilience.executeTurnWithFailover(async (signal) => {
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal,
          });
          if (res.ok) {
            const data = (await res.json()) as {
              data?: Record<string, unknown> | Array<{ id?: string; name: string; model_id?: string }>;
            };
            if (Array.isArray(data)) {
              return data.map((m) => ({ id: m.id || m.name, name: m.name }));
            }
            if (Array.isArray(data.data)) {
              return data.data.map((m) => ({ id: m.name || m.model_id || 'unknown', name: m.name }));
            }
            if (data.data && typeof data.data === 'object') {
              return Object.keys(data.data).map((key) => ({ id: key, name: key }));
            }
            return [];
          }
        } catch {
          // try next
        }
      }
      return [
        { id: 'google-gemini/gemini-3-5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
        { id: 'google-gemini/gemini-3-1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
      ];
    });
  }

  get currentSessionId(): string | null {
    return this.activeSessionId;
  }
}

export { HttpError };
