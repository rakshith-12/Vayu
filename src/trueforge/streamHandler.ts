/**
 * @file streamHandler.ts
 * @description Handles SSE streams from the TrueForge backend, parsing events
 *              and batching text deltas with cancellation support.
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type { TrueForgeStreamEvent, TrueForgeStreamEventType } from '../types/contracts';

export class StreamHandler {
  private activeController: AbortController | null = null;

  /**
   * Create and store a new AbortController for a streaming request.
   */
  createAbortController(): AbortController {
    this.abort();
    this.activeController = new AbortController();
    return this.activeController;
  }

  /**
   * Abort the active stream if running.
   */
  abort(): void {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  /**
   * Parse an SSE Response into an AsyncGenerator of TrueForgeStreamEvents.
   */
  async *parseSSEStream(response: Response): AsyncGenerator<TrueForgeStreamEvent> {
    if (!response.body) {
      throw new Error('Response body is null, cannot parse SSE stream');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const eventQueue: TrueForgeStreamEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let streamDone = false;
    let streamError: Error | null = null;

    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data) {
          const rawData = event.data.trim();
          if (rawData === '[DONE]') {
            streamDone = true;
            if (resolveWait) resolveWait();
            return;
          }

          try {
            const parsed = JSON.parse(rawData);
            const rawType = (parsed.type || event.event || '').toString();
            let eventType: TrueForgeStreamEventType = 'text_delta';

            if (
              rawType === 'text.delta' ||
              rawType === 'content.delta' ||
              rawType === 'text_delta' ||
              rawType === 'model.message.delta' ||
              rawType === 'model_message_delta'
            ) {
              eventType = 'text_delta';
            } else if (rawType === 'turn.complete' || rawType === 'turn.done' || rawType === 'turn_complete') {
              eventType = 'turn_complete';
            } else if (rawType === 'tool.call' || rawType === 'tool_call_start') {
              eventType = 'tool_call_start';
            } else if (rawType === 'tool.call.delta' || rawType === 'tool_call_delta') {
              eventType = 'tool_call_delta';
            } else if (rawType === 'tool.result' || rawType === 'tool_result') {
              eventType = 'tool_result';
            } else if (rawType === 'error') {
              eventType = 'error';
            } else if (rawType) {
              eventType = rawType as TrueForgeStreamEventType;
            }

            const delta = parsed.delta || (typeof parsed.content === 'string' ? parsed.content : parsed.text) || '';

            const streamEvent: TrueForgeStreamEvent = {
              ...parsed,
              type: eventType,
              ...(delta ? { delta } : {}),
            };
            eventQueue.push(streamEvent);
            if (resolveWait) resolveWait();
          } catch {
            // If data is plain text and event is text_delta
            if (rawData.length > 0) {
              eventQueue.push({
                type: 'text_delta',
                delta: rawData,
              });
              if (resolveWait) resolveWait();
            }
          }
        }
      },
    });

    // Background stream pump
    const pump = async () => {
      try {
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
            if (resolveWait) resolveWait();
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          parser.feed(chunk);
        }
      } catch (err: unknown) {
        streamError = err instanceof Error ? err : new Error(String(err));
        streamDone = true;
        if (resolveWait) resolveWait();
      }
    };

    // Start pumping in background
    pump();

    try {
      while (true) {
        while (eventQueue.length > 0) {
          const ev = eventQueue.shift()!;
          yield ev;
        }

        if (streamDone) {
          const err = streamError as Error | null;
          if (err && err.name !== 'AbortError') {
            throw err;
          }
          break;
        }

        // Wait for next events or completion
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
        resolveWait = null;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
      this.activeController = null;
    }
  }
}
