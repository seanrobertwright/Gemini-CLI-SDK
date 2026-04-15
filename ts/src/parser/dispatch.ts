/**
 * ts/src/parser/dispatch.ts
 *
 * Stage 2 of the two-stage parser pipeline.
 * Maps RawEvents into MessageChunks.
 *
 * Requirements satisfied:
 *   PRS-05 — EventDispatcher routes all known event types to MessageChunk variants
 *   PRS-07 — Tool pairing by tool_id with incomplete:true flush on stream end
 *
 * Phase 5: all stream-json error events route through ErrorMapper.fromStreamEvent();
 * the old rate_limit chunk yield is replaced by a typed throw (ERR-04).
 */

import type { RawEvent, MessageChunk, ToolChunk } from './types.js';
import { ErrorMapper, type StreamErrorEvent } from '../errors/index.js';

/**
 * Stage 2: Maps RawEvents into MessageChunks.
 * Maintains internal state for tool pairing and sessionId forwarding.
 */
export async function* dispatch(
  events: AsyncIterable<RawEvent>
): AsyncGenerator<MessageChunk> {
  const pending = new Map<string, ToolChunk>(); // tool pairing buffer (PRS-07)
  let sessionId = ''; // captured from init event, forwarded to result

  for await (const event of events) {
    switch (event.type) {
      case 'init':
        sessionId = event.session_id;
        yield { type: 'system', subtype: 'init', sessionId: event.session_id, model: event.model };
        break;

      case 'message':
        if (isThinking(event)) {
          yield { type: 'thinking', content: event.content };
        } else if (event.role === 'assistant') {
          yield { type: 'assistant', content: event.content };
        } else {
          yield { type: 'system', subtype: 'message', role: event.role, content: event.content };
        }
        break;

      case 'tool_use':
        pending.set(event.tool_id, {
          type: 'tool',
          toolName: event.tool_name,
          toolId: event.tool_id,
          parameters: event.parameters,
        });
        break;

      case 'tool_result': {
        const toolChunk = pending.get(event.tool_id);
        if (toolChunk) {
          pending.delete(event.tool_id);
          yield toolChunk; // tool chunk first (PRS-07)
        }
        // Build tool_result chunk — yield defensively even for orphan tool_results
        const resultChunk: MessageChunk = {
          type: 'tool_result',
          toolId: event.tool_id,
          status: event.status,
          output: event.output,
          ...(event.error !== undefined ? { error: event.error } : {}),
        };
        yield resultChunk;
        break;
      }

      case 'error':
        // Phase 5: all stream-json error events route through ErrorMapper; no rate_limit chunk yield.
        throw ErrorMapper.fromStreamEvent(event as unknown as StreamErrorEvent);

      case 'result':
        yield {
          type: 'result',
          sessionId,
          stopReason: mapStopReason(event.status),
        };
        break;

      // 'unknown' and 'cli_log' are parser-level events — silently skip in dispatch
      default:
        break;
    }
  }

  // Flush unpaired tool_use on stream end (PRS-07)
  for (const toolChunk of pending.values()) {
    yield { ...toolChunk, incomplete: true };
  }
}

function isThinking(event: { thought?: boolean; role?: string; type?: string }): boolean {
  return (
    (event as { thought?: unknown }).thought === true ||
    event.role === 'thinking' ||
    (event as { type?: unknown }).type === 'thinking'
  );
}

function mapStopReason(status: string): string {
  if (status === 'success') return 'end_turn';
  return status; // pass-through for unknown statuses
}
