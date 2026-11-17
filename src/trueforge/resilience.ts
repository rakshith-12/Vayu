/**
 * @file resilience.ts
 * @description Watchdog, retry supervisor, and failover manager for TrueForge requests.
 */

import { HttpError } from '../types/contracts';
export { HttpError };

export interface ResilienceConfig {
  connectionTimeoutMs: number;
  ttftWatchdogMs: number;
  maxAttempts: number;
  backoffMs: number;
  primaryModel?: string;
  fallbackModel?: string;
}

export class ResilienceSupervisor {
  private config: ResilienceConfig;
  private currentModel: string;
  private onFailoverCallback?: (from: string, to: string, reason: string) => void;

  constructor(config?: Partial<ResilienceConfig>) {
    this.config = {
      connectionTimeoutMs: 5000,
      ttftWatchdogMs: 12000,
      maxAttempts: 2,
      backoffMs: 500,
      ...config,
    };
    this.currentModel = this.config.primaryModel || 'primary-coding-model';
  }

  public setFailoverCallback(cb: (from: string, to: string, reason: string) => void): void {
    this.onFailoverCallback = cb;
  }

  public getCurrentModel(): string {
    return this.currentModel;
  }

  public setCurrentModel(model: string): void {
    this.currentModel = model;
  }

  /**
   * Execute an async network operation with retry, timeout watchdog, and model failover.
   */
  async executeTurnWithFailover<T>(
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Connection timeout after ${this.config.connectionTimeoutMs}ms`));
      }, this.config.connectionTimeoutMs);

      try {
        const result = await fn(controller.signal);
        clearTimeout(timeoutId);
        return result;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        lastError = err;

        const isNetworkOr5xx =
          err instanceof HttpError
            ? err.status >= 500 || err.status === 429
            : (err as { code?: string })?.code === 'ECONNREFUSED' ||
              (err as { message?: string })?.message?.includes('fetch failed') ||
              (err as { message?: string })?.message?.includes('timeout');

        // Check if failover is possible
        if (
          attempt === 1 &&
          isNetworkOr5xx &&
          this.config.fallbackModel &&
          this.currentModel !== this.config.fallbackModel
        ) {
          const prev = this.currentModel;
          this.currentModel = this.config.fallbackModel;
          if (this.onFailoverCallback) {
            this.onFailoverCallback(
              prev,
              this.currentModel,
              err instanceof Error ? err.message : 'Primary model unavailable',
            );
          }
        }

        if (attempt < this.config.maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.backoffMs * attempt),
          );
        }
      }
    }

    throw lastError;
  }
}
