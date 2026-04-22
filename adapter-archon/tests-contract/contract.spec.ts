/**
 * adapter-archon/tests-contract/contract.spec.ts — Phase 10 plan 10-05.
 *
 * Archon contract test: proves GeminiProvider.sendQuery() emits Archon-shaped
 * MessageChunks in the exact order and with the exact field names that the
 * Archon provider registry expects.
 *
 * Strategy: read the recorded NDJSON fixture to document the upstream shape,
 * then hand-author the pre-computed SDK-shape MessageChunks that Phase 3
 * dispatch would produce from it. Mock @gemini-sdk/core.query() to yield
 * those SDK chunks, invoke sendQuery() via the public barrel, and assert the
 * Archon-shaped output sequence.
 *
 * Keeping the SDK chunks hand-authored insulates this contract test from
 * parser internals — if Phase 3 dispatch changes, the unit tests catch it;
 * this test only cares about the translation layer.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@gemini-sdk/core', () => ({ query: mocks.query }));

import { GeminiProvider } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixtures/gemini-stub-stream.ndjson');

beforeEach(() => {
  mocks.query.mockReset();
});

async function* genChunks(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const c of chunks) yield c;
}

describe('archon contract: fixture sanity', () => {
  it('fixture is >= 5 lines and every line is valid JSON per events.schema.json shape', () => {
    const raw = readFileSync(FIXTURE_PATH, 'utf8').trim();
    const lines = raw.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(5);
    const types = new Set<string>();
    for (const line of lines) {
      const obj = JSON.parse(line) as { type: string };
      expect(obj.type).toBeTypeOf('string');
      types.add(obj.type);
    }
    // Must cover the five canonical event types the provider translates.
    expect(types.has('init')).toBe(true);
    expect(types.has('message')).toBe(true);
    expect(types.has('tool_use')).toBe(true);
    expect(types.has('tool_result')).toBe(true);
    expect(types.has('result')).toBe(true);
  });
});

describe('archon contract: GeminiProvider emits Archon-shaped MessageChunks', () => {
  it('yields [system, assistant, workflow_dispatch, tool, tool_result, result] in order', async () => {
    // Hand-authored SDK-shape chunks that Phase 3 dispatch would produce
    // from the fixture NDJSON. Independent of parser internals.
    const sdkChunks = [
      { type: 'system', subtype: 'init', sessionId: 'session-abc', model: 'auto-gemini-3', content: '' },
      { type: 'assistant', content: 'I will read the file.' },
      {
        type: 'tool',
        toolName: 'read_file',
        toolId: 'read_file_1775953086139_0',
        parameters: { file_path: 'test.txt' },
      },
      {
        type: 'tool_result',
        toolId: 'read_file_1775953086139_0',
        output: 'file contents',
      },
      { type: 'result', sessionId: 'session-abc', stopReason: 'end' },
    ];
    mocks.query.mockReturnValue(genChunks(sdkChunks));

    const provider = new GeminiProvider();
    const collected: Array<Record<string, unknown>> = [];
    for await (const chunk of provider.sendQuery('test prompt', '/tmp', 'session-abc', {})) {
      collected.push(chunk as Record<string, unknown>);
    }

    // Exact order.
    const order = collected.map((c) => c.type);
    expect(order).toEqual([
      'system',
      'assistant',
      'workflow_dispatch',
      'tool',
      'tool_result',
      'result',
    ]);

    // workflow_dispatch sentinel shape.
    expect(collected[2]).toEqual({
      type: 'workflow_dispatch',
      workerConversationId: '',
      workflowName: 'read_file',
    });

    // tool: field renames toolCallId + toolInput (NOT toolId/parameters).
    expect(collected[3]).toEqual({
      type: 'tool',
      toolName: 'read_file',
      toolCallId: 'read_file_1775953086139_0',
      toolInput: { file_path: 'test.txt' },
    });
    expect(collected[3]).not.toHaveProperty('toolId');
    expect(collected[3]).not.toHaveProperty('parameters');

    // tool_result: field renames toolCallId + toolOutput (NOT toolId/output).
    expect(collected[4]).toMatchObject({
      type: 'tool_result',
      toolCallId: 'read_file_1775953086139_0',
      toolOutput: 'file contents',
    });
    expect(collected[4]).not.toHaveProperty('toolId');
    // Archon tool_result has `toolOutput`, not `output`.
    expect(collected[4]).not.toHaveProperty('output');

    // system: collapsed to { type, content } (no SDK subtype leak).
    expect(collected[0]).toEqual({ type: 'system', content: '' });
    expect(collected[0]).not.toHaveProperty('subtype');
  });

  it('does not leak any SDK-specific field names into any emitted chunk', async () => {
    const sdkChunks = [
      { type: 'system', subtype: 'init', sessionId: 'S', content: 'x' },
      {
        type: 'tool',
        toolName: 'read_file',
        toolId: 'T1',
        parameters: { path: '/x' },
      },
      { type: 'tool_result', toolId: 'T1', output: 'ok' },
    ];
    mocks.query.mockReturnValue(genChunks(sdkChunks));

    const provider = new GeminiProvider();
    const collected: unknown[] = [];
    for await (const chunk of new GeminiProvider().sendQuery('p', '/w', undefined, {})) {
      collected.push(chunk);
    }
    void provider;

    // Serialise everything and scan for banned SDK-internal field names.
    const serialized = JSON.stringify(collected);
    expect(serialized).not.toMatch(/"subtype"/);
    expect(serialized).not.toMatch(/"parameters"/);
    expect(serialized).not.toMatch(/"toolId"/);
  });

  it('forwards session id through translateOptions into query()', async () => {
    mocks.query.mockReturnValue(genChunks([]));

    const provider = new GeminiProvider();
    for await (const _ of provider.sendQuery('test prompt', '/tmp', 'session-abc', {})) {
      void _;
    }

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const passed = mocks.query.mock.calls[0][0] as Record<string, unknown>;
    expect(passed.session).toBe('session-abc');
    expect(passed.prompt).toBe('test prompt');
    expect(passed.cwd).toBe('/tmp');
  });
});
