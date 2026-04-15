/**
 * ts/src/parser/dispatch.spec.ts
 *
 * Unit + fixture tests for dispatch covering PRS-05 and PRS-07.
 * Test names match Python parity spec.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseNdjson } from './parseNdjson.js';
import { dispatch } from './dispatch.js';
import type { MessageChunk, RawEvent } from './types.js';
import { RateLimitError } from '../errors/index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

async function* toStream(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collectChunks(iter: AsyncIterable<MessageChunk>): Promise<MessageChunk[]> {
  const out: MessageChunk[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

async function* rawEventsToAsyncIterable(events: RawEvent[]): AsyncIterable<RawEvent> {
  for (const event of events) {
    yield event;
  }
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const fixturesDir = new URL('../../../spec/fixtures/', import.meta.url);

function readFixture(name: string): string {
  return readFileSync(new URL(name, fixturesDir), 'utf-8');
}

function readFixtureJson(name: string): Record<string, unknown> {
  return JSON.parse(readFixture(name)) as Record<string, unknown>;
}

async function pipeFixture(ndjsonName: string): Promise<MessageChunk[]> {
  const content = readFixture(ndjsonName);
  const byteStream = toStream([encode(content)]);
  const rawEvents = parseNdjson(byteStream);
  return collectChunks(dispatch(rawEvents));
}

// ── fixture corpus ─────────────────────────────────────────────────────────────

describe('dispatch', () => {
  describe('fixture corpus', () => {
    // Collect all .expected.json files from spec/fixtures/
    const fixtureFiles = readdirSync(new URL('.', fixturesDir))
      .filter((f: string) => f.endsWith('.expected.json'))
      .sort();

    for (const expectedFile of fixtureFiles) {
      const ndjsonFile = expectedFile.replace('.expected.json', '.ndjson');
      const fixtureName = expectedFile.replace('.expected.json', '');

      it(`fixture corpus: parses ${fixtureName} identically to expected.json`, async () => {
        const expected = readFixtureJson(expectedFile) as {
          chunks: Array<Record<string, unknown>>;
          _throws?: boolean;
        };

        const expectedChunks = expected.chunks ?? [];

        // Phase 5: _throws at TOP LEVEL (alongside _errorType) takes precedence.
        // Phase 3 legacy: _throws inside chunks[] is also checked for backward compat.
        const topLevelThrows = expected._throws === true;
        const throwsEntry = topLevelThrows || expectedChunks.find((c) => (c as { _throws?: boolean })._throws === true);

        // Read ndjson file — may be empty (abort-midstream)
        let ndjsonContent: string;
        try {
          ndjsonContent = readFixture(ndjsonFile);
        } catch {
          // If ndjson file doesn't exist, skip
          return;
        }

        if (throwsEntry) {
          // This fixture expects dispatch to throw (e.g. error-auth, error-rate-limit)
          await expect(async () => {
            await pipeFixture(ndjsonFile);
          }).rejects.toThrow();
          return;
        }

        // Filter out _throws sentinel entries and keep real chunks
        const realChunks = expectedChunks.filter((c) => !(c as { _throws?: boolean })._throws);

        if (realChunks.length === 0) {
          // abort-midstream and event-unknown: empty or single unknown event
          // For abort-midstream (empty ndjson), dispatch yields nothing
          // For event-unknown, dispatch skips unknown events
          const chunks = await pipeFixture(ndjsonFile);
          expect(chunks).toHaveLength(0);
          return;
        }

        const chunks = await pipeFixture(ndjsonFile);

        // Deep compare chunks to expected
        expect(chunks).toHaveLength(realChunks.length);
        for (let i = 0; i < realChunks.length; i++) {
          expect(chunks[i]).toMatchObject(realChunks[i] as Partial<MessageChunk>);
        }
      });
    }
  });

  // ── tool pairing ──────────────────────────────────────────────────────────────

  describe('tool pairing', () => {
    it('buffers tool_use and releases pair on tool_result', async () => {
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
        {
          type: 'tool_use',
          timestamp: '2026-01-01T00:00:01Z',
          tool_name: 'read_file',
          tool_id: 'read_file_1000_0',
          parameters: { file_path: 'foo.txt' },
        },
        {
          type: 'tool_result',
          timestamp: '2026-01-01T00:00:02Z',
          tool_id: 'read_file_1000_0',
          status: 'success',
          output: 'file content',
        },
        { type: 'result', timestamp: '2026-01-01T00:00:03Z', status: 'success', stats: {} },
      ];

      const chunks = await collectChunks(dispatch(rawEventsToAsyncIterable(events)));

      // system(init), tool, tool_result, result
      expect(chunks).toHaveLength(4);
      expect(chunks[0].type).toBe('system');
      expect(chunks[1].type).toBe('tool');
      expect((chunks[1] as { type: 'tool'; toolId: string }).toolId).toBe('read_file_1000_0');
      expect(chunks[2].type).toBe('tool_result');
      expect((chunks[2] as { type: 'tool_result'; toolId: string }).toolId).toBe('read_file_1000_0');
      expect(chunks[3].type).toBe('result');
    });

    it('handles concurrent tool_use with Map-based tool_id pairing', async () => {
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
        {
          type: 'tool_use',
          timestamp: '2026-01-01T00:00:01Z',
          tool_name: 'read_file',
          tool_id: 'tool_A',
          parameters: { file_path: 'a.txt' },
        },
        {
          type: 'tool_use',
          timestamp: '2026-01-01T00:00:01.1Z',
          tool_name: 'read_file',
          tool_id: 'tool_B',
          parameters: { file_path: 'b.txt' },
        },
        {
          type: 'tool_result',
          timestamp: '2026-01-01T00:00:02Z',
          tool_id: 'tool_A',
          status: 'success',
          output: 'content A',
        },
        {
          type: 'tool_result',
          timestamp: '2026-01-01T00:00:02.1Z',
          tool_id: 'tool_B',
          status: 'success',
          output: 'content B',
        },
        { type: 'result', timestamp: '2026-01-01T00:00:03Z', status: 'success', stats: {} },
      ];

      const chunks = await collectChunks(dispatch(rawEventsToAsyncIterable(events)));

      // system(init), tool_A, tool_result_A, tool_B, tool_result_B, result
      expect(chunks).toHaveLength(6);
      expect(chunks[0].type).toBe('system');
      expect(chunks[1].type).toBe('tool');
      expect((chunks[1] as { type: 'tool'; toolId: string }).toolId).toBe('tool_A');
      expect(chunks[2].type).toBe('tool_result');
      expect((chunks[2] as { type: 'tool_result'; toolId: string }).toolId).toBe('tool_A');
      expect(chunks[3].type).toBe('tool');
      expect((chunks[3] as { type: 'tool'; toolId: string }).toolId).toBe('tool_B');
      expect(chunks[4].type).toBe('tool_result');
      expect((chunks[4] as { type: 'tool_result'; toolId: string }).toolId).toBe('tool_B');
      expect(chunks[5].type).toBe('result');
    });

    it('flushes unpaired tool_use with incomplete:true on stream end', async () => {
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
        {
          type: 'tool_use',
          timestamp: '2026-01-01T00:00:01Z',
          tool_name: 'long_running_tool',
          tool_id: 'orphan_tool_1',
          parameters: {},
        },
        // No tool_result — stream ends abruptly
      ];

      const chunks = await collectChunks(dispatch(rawEventsToAsyncIterable(events)));

      // system(init), tool with incomplete:true
      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe('system');
      expect(chunks[1].type).toBe('tool');
      expect((chunks[1] as { type: 'tool'; incomplete?: boolean }).incomplete).toBe(true);
    });

    it('yields orphan tool_result defensively when no prior tool_use', async () => {
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
        {
          type: 'tool_result',
          timestamp: '2026-01-01T00:00:01Z',
          tool_id: 'orphan_result_1',
          status: 'success',
          output: 'orphan output',
        },
        { type: 'result', timestamp: '2026-01-01T00:00:02Z', status: 'success', stats: {} },
      ];

      const chunks = await collectChunks(dispatch(rawEventsToAsyncIterable(events)));

      // system(init), tool_result (no preceding tool chunk), result
      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('system');
      expect(chunks[1].type).toBe('tool_result');
      expect((chunks[1] as { type: 'tool_result'; toolId: string }).toolId).toBe('orphan_result_1');
      expect(chunks[2].type).toBe('result');
    });
  });

  // ── thinking detection ────────────────────────────────────────────────────────

  describe('thinking detection', () => {
    it('maps thought=true message to thinking chunk', async () => {
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
        {
          type: 'message',
          timestamp: '2026-01-01T00:00:01Z',
          role: 'assistant',
          content: 'inner reasoning...',
          thought: true,
        },
        { type: 'result', timestamp: '2026-01-01T00:00:02Z', status: 'success', stats: {} },
      ];

      const chunks = await collectChunks(dispatch(rawEventsToAsyncIterable(events)));

      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('system');
      expect(chunks[1].type).toBe('thinking');
      expect((chunks[1] as { type: 'thinking'; content: string }).content).toBe('inner reasoning...');
      expect(chunks[2].type).toBe('result');
    });
  });

  // ── error handling ────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws RateLimitError for code 429 error event (Phase 5 contract)', async () => {
      // Phase 5: rate-limit errors THROW RateLimitError — no rate_limit chunk yielded.
      // This replaces the old Phase-3 "maps code 429 to rate_limit chunk" test.
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
        {
          type: 'error',
          timestamp: '2026-01-01T00:00:01Z',
          error: {
            code: 429,
            message: 'Rate limit exceeded',
            status: 'RESOURCE_EXHAUSTED',
          },
        },
      ];

      await expect(async () => {
        await collectChunks(dispatch(rawEventsToAsyncIterable(events)));
      }).rejects.toBeInstanceOf(RateLimitError);
    });

    it('throws on non-rate-limit error', async () => {
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
        {
          type: 'error',
          timestamp: '2026-01-01T00:00:01Z',
          error: {
            code: 401,
            message: 'API key not valid.',
            status: 'UNAUTHENTICATED',
          },
        },
      ];

      await expect(async () => {
        await collectChunks(dispatch(rawEventsToAsyncIterable(events)));
      }).rejects.toThrow();
    });
  });

  // ── sessionId forwarding ──────────────────────────────────────────────────────

  describe('sessionId forwarding', () => {
    it('carries sessionId from init to result chunk', async () => {
      const events: RawEvent[] = [
        { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'my-session-xyz', model: 'test' },
        { type: 'result', timestamp: '2026-01-01T00:00:01Z', status: 'success', stats: {} },
      ];

      const chunks = await collectChunks(dispatch(rawEventsToAsyncIterable(events)));

      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe('system');
      expect((chunks[0] as { type: 'system'; sessionId?: string }).sessionId).toBe('my-session-xyz');
      expect(chunks[1].type).toBe('result');
      expect((chunks[1] as { type: 'result'; sessionId: string }).sessionId).toBe('my-session-xyz');
    });
  });

  // ── event skipping ────────────────────────────────────────────────────────────

  it('silently skips unknown and cli_log events', async () => {
    const events: RawEvent[] = [
      { type: 'init', timestamp: '2026-01-01T00:00:00Z', session_id: 'sid1', model: 'test' },
      { type: 'unknown', raw: { type: 'cosmic_ray_hit', data: 'noise' } },
      { type: 'cli_log', line: 'GEMINI WARNING: some policy text' },
      { type: 'result', timestamp: '2026-01-01T00:00:01Z', status: 'success', stats: {} },
    ];

    const chunks = await collectChunks(dispatch(rawEventsToAsyncIterable(events)));

    // Only system(init) + result — unknown and cli_log are skipped
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe('system');
    expect(chunks[1].type).toBe('result');
  });
});
