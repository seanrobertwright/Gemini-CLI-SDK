/**
 * adapter-archon/src/provider.spec.ts — Phase 10 plan 10-04.
 *
 * Unit tests for GeminiProvider:
 *  1. getType() === 'gemini'
 *  2. getCapabilities() deep-equals GEMINI_CAPABILITIES
 *  3. sendQuery delegates: SDK assistant/tool/result chunks -> provider
 *     emits [assistant, workflow_dispatch, tool, result] with renamed fields
 *  4. sendQuery forwards prompt/cwd/session through translateOptions
 *  5. sendQuery propagates errors (object identity preserved)
 *  6. Compile-time IAgentProvider structural check (ARC-02)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@lrilai/gemini-cli-sdk', () => ({ query: mocks.query }));

import { GeminiProvider, GEMINI_CAPABILITIES } from './index.js';
import type { IAgentProvider } from './types.js';

// ARC-02: compile-time signature match. If GeminiProvider diverges from
// IAgentProvider, tsc fails this assignment and the file won't typecheck.
const _structuralCheck: IAgentProvider = new GeminiProvider();
void _structuralCheck;

async function* genChunks(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const c of chunks) yield c;
}

beforeEach(() => {
  mocks.query.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GeminiProvider.getType', () => {
  it("returns 'gemini'", () => {
    expect(new GeminiProvider().getType()).toBe('gemini');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GeminiProvider.getCapabilities', () => {
  it('returns GEMINI_CAPABILITIES object', () => {
    const caps = new GeminiProvider().getCapabilities();
    expect(caps).toEqual(GEMINI_CAPABILITIES);
    expect(caps.sessionResume).toBe(true);
    expect(caps.mcp).toBe(true);
    expect(caps.hooks).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GeminiProvider.sendQuery delegation', () => {
  it('emits [assistant, workflow_dispatch, tool, result] with translated fields', async () => {
    mocks.query.mockReturnValue(
      genChunks([
        { type: 'assistant', content: 'hi' },
        { type: 'tool', toolName: 'read_file', toolId: 'T1', parameters: { path: '/x' } },
        { type: 'result', sessionId: 'S', stopReason: 'end' },
      ]),
    );

    const provider = new GeminiProvider();
    const collected: unknown[] = [];
    for await (const chunk of provider.sendQuery('p', '/w')) {
      collected.push(chunk);
    }

    expect(collected).toHaveLength(4);
    expect(collected[0]).toEqual({ type: 'assistant', content: 'hi' });
    expect(collected[1]).toEqual({
      type: 'workflow_dispatch',
      workerConversationId: '',
      workflowName: 'read_file',
    });
    expect(collected[2]).toEqual({
      type: 'tool',
      toolName: 'read_file',
      toolCallId: 'T1',
      toolInput: { path: '/x' },
    });
    expect(collected[3]).toMatchObject({ type: 'result', sessionId: 'S', stopReason: 'end' });
  });

  it('forwards prompt, cwd, session through translateOptions into query()', async () => {
    mocks.query.mockReturnValue(genChunks([]));

    const provider = new GeminiProvider();
    for await (const _ of provider.sendQuery('my-prompt', '/work/dir', 'SESSION-42', {
      model: 'gemini-3-pro',
    })) {
      void _;
    }

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const passed = mocks.query.mock.calls[0][0] as Record<string, unknown>;
    expect(passed.prompt).toBe('my-prompt');
    expect(passed.cwd).toBe('/work/dir');
    expect(passed.session).toBe('SESSION-42');
    expect(passed.model).toBe('gemini-3-pro');
    expect(passed.approvalMode).toBe('yolo');
  });

  it('propagates errors from query() with object identity preserved', async () => {
    const boom = Object.assign(new Error('rate limited'), { bucket: 'rate_limit' });
    async function* throwing(): AsyncGenerator<unknown> {
      yield { type: 'assistant', content: 'partial' };
      throw boom;
    }
    mocks.query.mockReturnValue(throwing());

    const provider = new GeminiProvider();
    let caught: unknown = undefined;
    try {
      for await (const _ of provider.sendQuery('p', '/w')) {
        void _;
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
    expect((caught as { bucket?: string }).bucket).toBe('rate_limit');
  });
});
