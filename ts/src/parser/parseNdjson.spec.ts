/**
 * ts/src/parser/parseNdjson.spec.ts
 *
 * Unit tests for parseNdjson covering PRS-01 through PRS-04.
 * Test names match Python parity spec.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNdjson } from './parseNdjson.js';
import type { RawEvent } from './types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

async function* toStream(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const fixturesDir = new URL('../../../spec/fixtures/', import.meta.url);

function readFixture(name: string): string {
  return readFileSync(new URL(name, fixturesDir), 'utf-8');
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('parseNdjson', () => {
  it('parses simple-text fixture into correct RawEvent sequence', async () => {
    const content = readFixture('simple-text.ndjson');
    const events = await collect(parseNdjson(toStream([encode(content)])));

    expect(events).toHaveLength(4);

    expect(events[0].type).toBe('init');
    expect(events[1].type).toBe('message');
    expect((events[1] as { role: string }).role).toBe('user');
    expect(events[2].type).toBe('message');
    expect((events[2] as { role: string }).role).toBe('assistant');
    expect(events[3].type).toBe('result');
  });

  it('tolerates CRLF line endings identically to LF', async () => {
    const content = readFixture('simple-text.ndjson');
    const lfContent = content.replace(/\r\n/g, '\n');
    const crlfContent = lfContent.replace(/\n/g, '\r\n');

    const lfEvents = await collect(parseNdjson(toStream([encode(lfContent)])));
    const crlfEvents = await collect(parseNdjson(toStream([encode(crlfContent)])));

    expect(crlfEvents).toHaveLength(lfEvents.length);
    expect(JSON.stringify(crlfEvents)).toBe(JSON.stringify(lfEvents));
  });

  it('emits cli_log for lines over 1 MiB without throwing', async () => {
    // 1.1 MiB line (no newline until end)
    const bigLine = 'x'.repeat(1024 * 1024 + 100);
    const input = bigLine + '\n';

    let events: RawEvent[] = [];
    await expect(
      (async () => {
        events = await collect(parseNdjson(toStream([encode(input)])));
      })()
    ).resolves.not.toThrow();

    // At least one cli_log event should have been emitted
    expect(events.some(e => e.type === 'cli_log')).toBe(true);
  });

  it('emits cli_log for non-JSON lines without throwing', async () => {
    const input = 'GEMINI WARNING: policy text\n';

    let events: RawEvent[] = [];
    await expect(
      (async () => {
        events = await collect(parseNdjson(toStream([encode(input)])));
      })()
    ).resolves.not.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('cli_log');
    expect((events[0] as { line: string }).line).toBe('GEMINI WARNING: policy text');
  });

  it('emits unknown for unrecognized event types without throwing', async () => {
    const content = readFixture('event-unknown.ndjson');

    let events: RawEvent[] = [];
    await expect(
      (async () => {
        events = await collect(parseNdjson(toStream([encode(content)])));
      })()
    ).resolves.not.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('unknown');
    const unknownEvent = events[0] as { type: 'unknown'; raw: Record<string, unknown> };
    expect(unknownEvent.raw.type).toBe('cosmic_ray_hit');
  });

  it('skips empty lines between events', async () => {
    const line1 = '{"type":"init","timestamp":"2026-01-01T00:00:00.000Z","session_id":"s1","model":"test"}';
    const line2 = '{"type":"result","timestamp":"2026-01-01T00:00:01.000Z","status":"success","stats":{}}';
    const input = line1 + '\n\n\n' + line2 + '\n';

    const events = await collect(parseNdjson(toStream([encode(input)])));

    // Only 2 events — the 3 empty lines are skipped
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('init');
    expect(events[1].type).toBe('result');
  });

  it('decodes split UTF-8 codepoint across chunk boundaries', async () => {
    // U+1F600 GRINNING FACE — 4-byte UTF-8: F0 9F 98 80
    const fullChar = '\u{1F600}';
    const jsonLine = JSON.stringify({ type: 'init', timestamp: '2026-01-01T00:00:00.000Z', session_id: 's1', model: 'test', greeting: fullChar }) + '\n';
    const bytes = encode(jsonLine);

    // Split after the first 3 bytes of the 4-byte emoji (which starts mid-JSON near the end)
    // Find the emoji bytes in the buffer and split there
    const emojiBytes = new TextEncoder().encode(fullChar);
    // Find position of emoji in bytes array
    let splitPos = -1;
    for (let i = 0; i < bytes.length - emojiBytes.length; i++) {
      if (bytes[i] === emojiBytes[0] && bytes[i + 1] === emojiBytes[1]) {
        splitPos = i + 2; // split after first 2 bytes of the 4-byte sequence
        break;
      }
    }

    if (splitPos === -1) {
      // Fallback: split in middle of buffer
      splitPos = Math.floor(bytes.length / 2);
    }

    const chunk1 = bytes.slice(0, splitPos);
    const chunk2 = bytes.slice(splitPos);

    const events = await collect(parseNdjson(toStream([chunk1, chunk2])));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('init');
    const initEvent = events[0] as { type: 'init'; greeting: string };
    expect(initEvent.greeting).toBe(fullChar);
  });

  it('flushes remaining buffer on stream end', async () => {
    // No trailing newline
    const line = '{"type":"init","timestamp":"2026-01-01T00:00:00.000Z","session_id":"s1","model":"test"}';

    const events = await collect(parseNdjson(toStream([encode(line)])));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('init');
  });

  it('yields no events for empty stream', async () => {
    const events = await collect(parseNdjson(toStream([])));
    expect(events).toHaveLength(0);
  });
});
