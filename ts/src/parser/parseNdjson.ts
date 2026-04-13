/**
 * ts/src/parser/parseNdjson.ts
 *
 * Stage 1 of the two-stage parser pipeline.
 * Converts a byte stream (AsyncIterable<Uint8Array>) into an AsyncIterable<RawEvent>.
 *
 * Requirements satisfied:
 *   PRS-01 — 1 MiB line limit (oversized lines yield cli_log, never throw)
 *   PRS-02 — CRLF tolerance (strip \r before \n)
 *   PRS-03 — Unknown event type fallback → { type: 'unknown', raw }
 *   PRS-04 — Non-JSON line fallback → { type: 'cli_log', line }
 */

import type { RawEvent } from './types.js';
import { KNOWN_RAW_TYPES } from './types.js';

const MAX_LINE = 1024 * 1024; // 1 MiB (PRS-01)

export async function* parseNdjson(
  stream: AsyncIterable<Uint8Array>
): AsyncGenerator<RawEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buf = '';

  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1); // CRLF (PRS-02)
      if (line.length === 0) continue;
      yield parseLine(line);
    }
    // Check buffer overflow (PRS-01)
    if (buf.length > MAX_LINE) {
      yield { type: 'cli_log' as const, line: buf.slice(0, MAX_LINE) };
      buf = buf.slice(MAX_LINE);
    }
  }
  // Flush TextDecoder internal state (handles split multi-byte codepoints)
  buf += decoder.decode();
  if (buf.trim().length > 0) {
    const line = buf.endsWith('\r') ? buf.slice(0, -1) : buf;
    yield parseLine(line);
  }
}

function parseLine(line: string): RawEvent {
  try {
    const obj = JSON.parse(line) as unknown;
    if (typeof obj !== 'object' || obj === null || !('type' in obj)) {
      return { type: 'cli_log', line };
    }
    const typed = obj as Record<string, unknown>;
    if (!KNOWN_RAW_TYPES.includes(typed['type'] as (typeof KNOWN_RAW_TYPES)[number])) {
      return { type: 'unknown', raw: typed }; // PRS-03
    }
    return typed as unknown as RawEvent;
  } catch {
    return { type: 'cli_log', line }; // PRS-04
  }
}
