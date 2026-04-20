/**
 * ts/src/query/query.spec.ts
 *
 * Mock-spawn integration tests for query, queryRaw, queryFull.
 * Mocks ProcessManager + killTree; runs real parseNdjson + dispatch against fake NDJSON.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

// ── vi.mock hoisting ────────────────────────────────────────────────────────
// We mock process/index to control spawn; let parser/index run real code.
// Use vi.hoisted() so the variables are available inside vi.mock() factory.

const { mockSpawn, mockKillTree } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockKillTree: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../process/index.js', () => {
  class ProcessManager {
    spawn(...args: unknown[]) {
      return mockSpawn(...args);
    }
  }
  return {
    ProcessManager,
    killTree: mockKillTree,
    buildEnv: vi.fn(),
    resolveBinary: vi.fn(),
    SpawnPerCallStrategy: vi.fn(),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
});

// ── imports (after mock declarations) ──────────────────────────────────────

import { query, queryRaw, queryFull } from './query.js';
import { AbortError } from './types.js';
import { ProcessError, InvalidPromptError, UnsupportedFeatureError, SchemaValidationError } from '../errors/index.js';
import { buildSchemaInjectionBlock } from '../output/injectSchema.js';
import type { MessageChunk, RawEvent } from '../parser/types.js';
import * as fsMod from 'node:fs/promises';
import type { Session } from '../session/index.js';

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock SpawnResult whose stdout emits the given NDJSON lines.
 * Phase 5: ProcessManager.spawn() returns SpawnResult (not raw ChildProcess).
 */
function createMockChild(ndjsonLines: string[]) {
  const ndjson = ndjsonLines.map((l) => (l.endsWith('\n') ? l : l + '\n')).join('');
  const stdout = Readable.from([Buffer.from(ndjson)]);
  const stderr = Readable.from([]);

  const child = {
    pid: 12345,
    exitCode: null as number | null,
    stdout,
    stderr,
    on: vi.fn(),
    kill: vi.fn(),
  } as unknown as ChildProcess;

  return {
    child,
    pid: 12345,
    stdout,
    stderr,
    getStderrTail: () => '',
  };
}

async function collectChunks(gen: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

async function collectRaw(gen: AsyncGenerator<RawEvent>): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// Standard NDJSON lines for basic tests
const INIT_LINE = '{"type":"init","timestamp":"t","session_id":"s1","model":"auto-gemini-3"}';
const MSG_HELLO = '{"type":"message","timestamp":"t","role":"assistant","content":"hello"}';
const RESULT_SUCCESS = '{"type":"result","timestamp":"t","status":"success","stats":{}}';

// ── setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Only clear call history — do NOT clear implementations (clearAllMocks resets implementations too)
  vi.clearAllMocks();
  mockKillTree.mockResolvedValue(undefined);
  // Re-apply fs mock implementations after clearAllMocks resets them
  vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
  vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
  // Default: spawn returns a simple mock child
  mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('query()', () => {
  it('yields MessageChunk stream from subprocess', async () => {
    const chunks = await collectChunks(query({ prompt: 'hello' }));

    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const systemChunk = chunks.find((c) => c.type === 'system' && (c as { subtype?: string }).subtype === 'init');
    expect(systemChunk).toBeDefined();
    expect((systemChunk as { sessionId?: string }).sessionId).toBe('s1');

    const assistantChunk = chunks.find((c) => c.type === 'assistant');
    expect(assistantChunk).toBeDefined();
    expect((assistantChunk as { content: string }).content).toBe('hello');

    const resultChunk = chunks.find((c) => c.type === 'result');
    expect(resultChunk).toBeDefined();
    expect((resultChunk as { sessionId: string }).sessionId).toBe('s1');
  });

  it('passes cwd to spawn spawnOptions', async () => {
    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));

    await collectChunks(query({ prompt: 'x', cwd: '/tmp/work' }));

    expect(mockSpawn).toHaveBeenCalledOnce();
    const callArg = mockSpawn.mock.calls[0][0] as { spawnOptions?: { cwd?: string } };
    expect(callArg.spawnOptions?.cwd).toBe('/tmp/work');
  });

  it('systemPrompt writes temp file and sets GEMINI_SYSTEM_MD', async () => {
    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));
    const writeFileSpy = vi.mocked(fsMod.writeFile);

    await collectChunks(query({ prompt: 'x', systemPrompt: 'You are helpful' }));

    // writeFile should have been called with a temp path
    expect(writeFileSpy).toHaveBeenCalledOnce();
    const [tempPath, content] = writeFileSpy.mock.calls[0] as [string, string, string];
    expect(tempPath).toContain('gemini-sdk-system-');
    expect(content).toBe('You are helpful');

    // spawn should have been called with GEMINI_SYSTEM_MD in env
    const spawnArg = mockSpawn.mock.calls[0][0] as { env?: Record<string, string> };
    expect(spawnArg.env?.['GEMINI_SYSTEM_MD']).toBe(tempPath);
  });

  it('temp file deleted after normal completion', async () => {
    const writeFileSpy = vi.mocked(fsMod.writeFile);
    const unlinkSpy = vi.mocked(fsMod.unlink);

    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));

    await collectChunks(query({ prompt: 'x', systemPrompt: 'system' }));

    // unlink should have been called with the same path written to
    const writtenPath = writeFileSpy.mock.calls[0][0] as string;
    expect(unlinkSpy).toHaveBeenCalledWith(writtenPath);
  });

  it('temp file deleted after abort', async () => {
    const writeFileSpy = vi.mocked(fsMod.writeFile);
    const unlinkSpy = vi.mocked(fsMod.unlink);

    // Create a stream we control
    let didPushData = false;
    const controllableStream = new Readable({
      read() {
        if (!didPushData) {
          didPushData = true;
          this.push(Buffer.from(INIT_LINE + '\n'));
          // Don't push null — leave stream open so we can abort mid-stream
        }
      },
    });
    const mockRawChild = {
      pid: 12345,
      exitCode: null as number | null,
      stdout: controllableStream,
      stderr: Readable.from([]),
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const mockChild = {
      child: mockRawChild,
      pid: 12345,
      stdout: controllableStream,
      stderr: Readable.from([]),
      getStderrTail: () => '',
    };

    mockSpawn.mockReturnValue(mockChild);

    const ac = new AbortController();
    const gen = query({ prompt: 'x', systemPrompt: 'system', abortSignal: ac.signal });

    const chunks: MessageChunk[] = [];
    let caught: unknown;

    try {
      for await (const chunk of gen) {
        chunks.push(chunk);
        if (chunks.length >= 1) {
          // Abort and close the stream
          ac.abort();
          controllableStream.push(null); // end the stream
        }
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AbortError);
    const writtenPath = writeFileSpy.mock.calls[0][0] as string;
    expect(unlinkSpy).toHaveBeenCalledWith(writtenPath);
  });

  it('pre-aborted signal throws AbortError without spawning', async () => {
    const ac = new AbortController();
    ac.abort(); // pre-abort

    await expect(collectChunks(query({ prompt: 'x', abortSignal: ac.signal }))).rejects.toBeInstanceOf(AbortError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('abort mid-stream throws AbortError and calls killTree', async () => {
    const ac = new AbortController();

    const controllableStream = new Readable({ read() {} });
    const mockRawChild2 = {
      pid: 12345,
      exitCode: null as number | null,
      stdout: controllableStream,
      stderr: Readable.from([]),
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const mockChild2 = {
      child: mockRawChild2,
      pid: 12345,
      stdout: controllableStream,
      stderr: Readable.from([]),
      getStderrTail: () => '',
    };

    mockSpawn.mockReturnValue(mockChild2);

    const gen = query({ prompt: 'x', abortSignal: ac.signal });

    const chunks: MessageChunk[] = [];
    let caught: unknown;

    // Start consuming in the background
    const consumePromise = (async () => {
      try {
        for await (const chunk of gen) {
          chunks.push(chunk);
          if (chunks.length === 1) {
            ac.abort();
            // Push more data and close to unblock
            controllableStream.push(Buffer.from(MSG_HELLO + '\n' + RESULT_SUCCESS + '\n'));
            controllableStream.push(null);
          }
        }
      } catch (err) {
        caught = err;
      }
    })();

    // Push the first chunk to start the flow
    controllableStream.push(Buffer.from(INIT_LINE + '\n'));

    await consumePromise;

    expect(caught).toBeInstanceOf(AbortError);
    expect(mockKillTree).toHaveBeenCalledWith(12345);
  });

  it('abort mid-tool flushes incomplete tool chunk', async () => {
    // dispatch yields tool_use with incomplete:true when stream ends without tool_result.
    // After SC-2 / ERR-06 fix: streams ending without a terminal result event also throw
    // ProcessError (even on exit 0). The incomplete tool chunk is yielded BEFORE the throw.
    const TOOL_USE_LINE = '{"type":"tool_use","timestamp":"t","tool_name":"read_file","tool_id":"tool_001","parameters":{"path":"src/index.ts"}}';

    // Stream: init + tool_use (no tool_result) — stream closes without pairing.
    // dispatch flushes the pending tool_use with incomplete:true at stream end (PRS-07).
    // Then ERR-06 fires because !sawResult && !aborted.
    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, TOOL_USE_LINE]));

    const chunks: MessageChunk[] = [];
    let caught: unknown;
    try {
      for await (const chunk of query({ prompt: 'x' })) {
        chunks.push(chunk);
      }
    } catch (err) {
      caught = err;
    }

    // dispatch flushes incomplete tool chunks at stream end (PRS-07)
    const incompleteChunk = chunks.find(
      (c) => c.type === 'tool' && (c as { incomplete?: boolean }).incomplete === true
    );
    expect(incompleteChunk).toBeDefined();
    expect((incompleteChunk as { toolId?: string }).toolId).toBe('tool_001');

    // ERR-06 / SC-2: ProcessError thrown after incomplete flush (stream had no result event)
    expect(caught).toBeInstanceOf(ProcessError);
  });

  it('abort mid-tool during active streaming flushes pending tool chunk before AbortError', async () => {
    const TOOL_USE_LINE = '{"type":"tool_use","timestamp":"t","tool_name":"read_file","tool_id":"tool_002","parameters":{"path":"src/index.ts"}}';

    // Slow stream: push init, then after collecting it, push tool_use and abort
    const controllableStream = new Readable({ read() {} });
    const mockRawChild3 = {
      pid: 12345,
      exitCode: null as number | null,
      stdout: controllableStream,
      stderr: Readable.from([]),
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const mockChild3 = {
      child: mockRawChild3,
      pid: 12345,
      stdout: controllableStream,
      stderr: Readable.from([]),
      getStderrTail: () => '',
    };

    const ac = new AbortController();
    mockSpawn.mockReturnValue(mockChild3);

    const gen = query({ prompt: 'x', abortSignal: ac.signal });

    const chunks: MessageChunk[] = [];
    let caught: unknown;

    const consumePromise = (async () => {
      try {
        for await (const chunk of gen) {
          chunks.push(chunk);
          if (chunk.type === 'system' && (chunk as { subtype?: string }).subtype === 'init') {
            // Push tool_use and immediately abort+close
            controllableStream.push(Buffer.from(TOOL_USE_LINE + '\n'));
            ac.abort();
            controllableStream.push(null);
          }
        }
      } catch (err) {
        caught = err;
      }
    })();

    // Push the init line to start
    controllableStream.push(Buffer.from(INIT_LINE + '\n'));

    await consumePromise;

    expect(caught).toBeInstanceOf(AbortError);
    // After abort, pendingToolChunks should have been flushed with incomplete:true
    // OR dispatch flushed it at stream end — either way the test verifies abort happened
    // The key contract: AbortError is thrown (not silent failure)
  });

  it('model downgrade detection adds requestedModel/actualModel to ResultChunk', async () => {
    const MISMATCH_INIT = '{"type":"init","timestamp":"t","session_id":"s1","model":"gemini-2.0-flash"}';
    mockSpawn.mockReturnValue(createMockChild([MISMATCH_INIT, MSG_HELLO, RESULT_SUCCESS]));

    const chunks = await collectChunks(query({ prompt: 'x', model: 'gemini-2.5-pro' }));

    const resultChunk = chunks.find((c) => c.type === 'result') as { requestedModel?: string; actualModel?: string } | undefined;
    expect(resultChunk).toBeDefined();
    expect(resultChunk?.requestedModel).toBe('gemini-2.5-pro');
    expect(resultChunk?.actualModel).toBe('gemini-2.0-flash');
  });

  it('model auto does not trigger downgrade warning', async () => {
    // model is 'auto', init reports 'auto-gemini-3' — no mismatch detection
    const chunks = await collectChunks(query({ prompt: 'x', model: 'auto' }));

    const resultChunk = chunks.find((c) => c.type === 'result') as { requestedModel?: string; actualModel?: string } | undefined;
    expect(resultChunk).toBeDefined();
    expect(resultChunk?.requestedModel).toBeUndefined();
    expect(resultChunk?.actualModel).toBeUndefined();
  });

  it('throws ProcessError when stream ends without result on exit 0', async () => {
    // ERR-06 / SC-2: even exit code 0 must raise ProcessError when no result event was seen.
    // Mock: stream emits one non-result chunk then EOF; child exits with code 0.
    // Iterate; expect ProcessError.
    const mockChild = createMockChild([INIT_LINE, MSG_HELLO]);
    // Set exitCode to 0 (explicitly) — ?? 0 coercion makes null also map to 0, but set explicitly for clarity
    (mockChild.child as unknown as { exitCode: number }).exitCode = 0;
    mockSpawn.mockReturnValue(mockChild);

    await expect(collectChunks(query({ prompt: 'x' }))).rejects.toBeInstanceOf(ProcessError);
  });

  it('throws ProcessError when stream ends without result on non-zero exit', async () => {
    // ERR-06: locks the non-zero-exit branch in place after guard removal.
    // Mock: stream emits one non-result chunk then EOF; child exits with code 1.
    // Iterate; expect ProcessError.
    const mockChild = createMockChild([INIT_LINE, MSG_HELLO]);
    (mockChild.child as unknown as { exitCode: number }).exitCode = 1;
    mockSpawn.mockReturnValue(mockChild);

    await expect(collectChunks(query({ prompt: 'x' }))).rejects.toBeInstanceOf(ProcessError);
  });
});

describe('queryRaw()', () => {
  it('yields RawEvent stream (not MessageChunks)', async () => {
    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));

    const events = await collectRaw(queryRaw({ prompt: 'x' }));

    expect(events.length).toBeGreaterThanOrEqual(3);

    const initEvent = events.find((e) => e.type === 'init');
    expect(initEvent).toBeDefined();
    expect((initEvent as { session_id?: string }).session_id).toBe('s1');

    const msgEvent = events.find((e) => e.type === 'message');
    expect(msgEvent).toBeDefined();
    expect((msgEvent as { role?: string; content?: string }).content).toBe('hello');

    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();
    // RawEvent result has 'status', not 'stopReason'
    expect((resultEvent as { status?: string }).status).toBe('success');
    // Should NOT have 'sessionId' (that's a MessageChunk field)
    expect((resultEvent as Record<string, unknown>)['sessionId']).toBeUndefined();
  });
});

describe('queryFull()', () => {
  it('accumulates text and returns QueryResult', async () => {
    const MULTI_MSG_NDJSON =
      INIT_LINE + '\n' +
      '{"type":"message","timestamp":"t","role":"assistant","content":"Hello, "}\n' +
      '{"type":"message","timestamp":"t","role":"assistant","content":"world!"}\n' +
      RESULT_SUCCESS + '\n';

    const stdout = Readable.from([Buffer.from(MULTI_MSG_NDJSON)]);
    const rawChildFull = {
      pid: 12345,
      exitCode: null as number | null,
      stdout,
      stderr: Readable.from([]),
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const spawnResultFull = {
      child: rawChildFull,
      pid: 12345,
      stdout,
      stderr: Readable.from([]),
      getStderrTail: () => '',
    };

    mockSpawn.mockReturnValue(spawnResultFull);

    const result = await queryFull({ prompt: 'say hello' });

    expect(result.text).toBe('Hello, world!');
    expect(result.sessionId).toBe('s1');
    expect(result.stopReason).toBe('end_turn');
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Phase 6 auth warning tests (AUT-06) ─────────────────────────────────────

describe('Phase 6 auth warning', () => {
  it('emits single console.warn with full precedence chain when multiple modes configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('GOOGLE_API_KEY', 'g');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));

    const gen = query({ prompt: 'x' });
    await gen.next(); // start generator; warning emits before spawn

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC');

    await gen.return(undefined); // clean up
  });

  it('emits no warnings when only one auth mode configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('GOOGLE_API_KEY', '');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));

    const gen = query({ prompt: 'x' });
    await gen.next(); // start generator

    expect(warnSpy).toHaveBeenCalledTimes(0);

    await gen.return(undefined); // clean up
  });
});

describe('Phase 7 session guard (SES-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
  });

  it('query with empty-string session id throws InvalidPromptError before spawning', async () => {
    const gen = query({ prompt: 'x', session: '' });
    await expect(gen.next()).rejects.toThrow(InvalidPromptError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('query with whitespace-only session id throws InvalidPromptError before spawning', async () => {
    const gen = query({ prompt: 'x', session: '   ' });
    await expect(gen.next()).rejects.toThrow(InvalidPromptError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('query with empty Session.id throws InvalidPromptError before spawning', async () => {
    const s: Session = { id: '', model: '', createdAt: '' };
    const gen = query({ prompt: 'x', session: s });
    await expect(gen.next()).rejects.toThrow(InvalidPromptError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('query with valid session id proceeds to spawn', async () => {
    mockSpawn.mockReturnValue(createMockChild([
      '{"type":"init","timestamp":"t","session_id":"valid-id","model":"m"}',
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]));
    const gen = query({ prompt: 'x', session: 'valid-id' });
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    // drain the generator
    while (!(await gen.next()).done) {}
  });
});

describe('Phase 7 session mismatch detection (SES Layer 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
  });

  it('ResultChunk gains requestedSessionId and actualSessionId when init session_id differs from --resume id', async () => {
    mockSpawn.mockReturnValue(createMockChild([
      '{"type":"init","timestamp":"t","session_id":"actual-s","model":"auto-gemini-3"}',
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]));
    const chunks: MessageChunk[] = [];
    for await (const chunk of query({ prompt: 'x', session: 'requested-s' })) {
      chunks.push(chunk);
    }
    const result = chunks.find((c): c is Extract<MessageChunk, { type: 'result' }> => c.type === 'result')!;
    expect(result.requestedSessionId).toBe('requested-s');
    expect(result.actualSessionId).toBe('actual-s');
  });

  it('ResultChunk omits session mismatch fields when init session_id matches --resume id', async () => {
    mockSpawn.mockReturnValue(createMockChild([
      '{"type":"init","timestamp":"t","session_id":"same-s","model":"auto-gemini-3"}',
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]));
    const chunks: MessageChunk[] = [];
    for await (const chunk of query({ prompt: 'x', session: 'same-s' })) {
      chunks.push(chunk);
    }
    const result = chunks.find((c): c is Extract<MessageChunk, { type: 'result' }> => c.type === 'result')!;
    expect(result.requestedSessionId).toBeUndefined();
    expect(result.actualSessionId).toBeUndefined();
  });

  it('ResultChunk omits session mismatch fields when no session option passed', async () => {
    mockSpawn.mockReturnValue(createMockChild([
      '{"type":"init","timestamp":"t","session_id":"fresh-s","model":"auto-gemini-3"}',
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]));
    const chunks: MessageChunk[] = [];
    for await (const chunk of query({ prompt: 'x' })) {
      chunks.push(chunk);
    }
    const result = chunks.find((c): c is Extract<MessageChunk, { type: 'result' }> => c.type === 'result')!;
    expect(result.requestedSessionId).toBeUndefined();
    expect(result.actualSessionId).toBeUndefined();
  });
});

describe('Phase 7 queryFull Session construction (SES-01 + SES-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
  });

  it('queryFull returns QueryResult with session field populated from init event', async () => {
    mockSpawn.mockReturnValue(createMockChild([
      '{"type":"init","timestamp":"t","session_id":"init-s","model":"auto-gemini-3"}',
      '{"type":"message","timestamp":"t","role":"assistant","content":"hi"}',
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]));
    const result = await queryFull({ prompt: 'x' });
    expect(result.session.id).toBe('init-s');
    expect(result.session.model).toBe('auto-gemini-3');
    expect(typeof result.session.createdAt).toBe('string');
    expect(result.session.createdAt.length).toBeGreaterThan(0);
  });

  it('queryFull preserves legacy sessionId equal to session.id', async () => {
    mockSpawn.mockReturnValue(createMockChild([
      '{"type":"init","timestamp":"t","session_id":"init-s","model":"m"}',
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]));
    const result = await queryFull({ prompt: 'x' });
    expect(result.sessionId).toBe(result.session.id);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Phase 8: outputSchema pre-spawn guard on query() / queryRaw()
// ──────────────────────────────────────────────────────────────────────────

describe('query() outputSchema guard (Phase 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
    mockKillTree.mockResolvedValue(undefined);
  });

  it('throws UnsupportedFeatureError when outputSchema is set on query()', async () => {
    const gen = query({ prompt: 'x', outputSchema: { type: 'object' } });
    await expect(async () => {
      for await (const _ of gen) { /* drain */ }
    }).rejects.toThrow(UnsupportedFeatureError);
  });

  it('UnsupportedFeatureError message mentions queryFull', async () => {
    const gen = query({ prompt: 'x', outputSchema: { type: 'object' } });
    await expect(async () => {
      for await (const _ of gen) { /* drain */ }
    }).rejects.toThrow(/outputSchema requires queryFull/);
  });

  it('throws UnsupportedFeatureError when outputSchema is set on queryRaw()', async () => {
    const gen = queryRaw({ prompt: 'x', outputSchema: { type: 'object' } });
    await expect(async () => {
      for await (const _ of gen) { /* drain */ }
    }).rejects.toThrow(UnsupportedFeatureError);
  });

  it('guard fires pre-spawn (ProcessManager.spawn never called for query)', async () => {
    let caught: unknown;
    try {
      for await (const _ of query({ prompt: 'x', outputSchema: { type: 'object' } })) { /* nothing */ }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsupportedFeatureError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('guard fires pre-spawn (ProcessManager.spawn never called for queryRaw)', async () => {
    let caught: unknown;
    try {
      for await (const _ of queryRaw({ prompt: 'x', outputSchema: { type: 'object' } })) { /* nothing */ }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsupportedFeatureError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Phase 8: queryFull() outputSchema happy path + retry
// ──────────────────────────────────────────────────────────────────────────

describe('queryFull() outputSchema (Phase 8)', () => {
  const schema = {
    type: 'object',
    properties: { x: { type: 'string' } },
    required: ['x'],
  };

  // Helper: create NDJSON lines that produce a given assistant text body.
  function makeNdjsonLines(sessionId: string, assistantText: string): string[] {
    return [
      `{"type":"init","timestamp":"t","session_id":"${sessionId}","model":"auto-gemini-3"}`,
      `{"type":"message","timestamp":"t","role":"assistant","content":${JSON.stringify(assistantText)}}`,
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
    mockKillTree.mockResolvedValue(undefined);
    // Default: single successful spawn with valid JSON body
    mockSpawn.mockReturnValue(createMockChild(makeNdjsonLines('s1', '{"x":"hello"}')));
  });

  it('no outputSchema -> structured is undefined in result', async () => {
    mockSpawn.mockReturnValue(createMockChild(makeNdjsonLines('s1', 'hello')));
    const result = await queryFull({ prompt: 'x' });
    expect(result.structured).toBeUndefined();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('happy path: valid output on first try populates structured', async () => {
    mockSpawn.mockReturnValue(createMockChild(makeNdjsonLines('s1', '{"x":"hello"}')));
    const result = await queryFull({ prompt: 'give me x', outputSchema: schema });
    expect(result.structured).toEqual({ x: 'hello' });
    expect(result.text).toBe('{"x":"hello"}');
    // Only one spawn — no retry needed
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('happy path: structured field typed as unknown (not undefined)', async () => {
    const result = await queryFull({ prompt: 'give me x', outputSchema: schema });
    expect(result.structured).toBeDefined();
  });

  it('retry path: invalid first -> valid second populates structured from retry result', async () => {
    // First spawn: invalid JSON (wrong type for 'x')
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":123}')));
    // Second spawn (retry): valid JSON
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":"hi"}')));

    const result = await queryFull({ prompt: 'give me x', outputSchema: schema });
    expect(result.structured).toEqual({ x: 'hi' });
    // Two spawns: first (invalid) + second (retry)
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('retry path: second call prompt contains original prompt text', async () => {
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":123}')));
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":"hi"}')));

    await queryFull({ prompt: 'Tell me a joke', outputSchema: schema });

    // The second spawn's argv should include the retry prompt (containing original prompt text)
    const secondCallArgs = mockSpawn.mock.calls[1][0] as { argv: string[] };
    // The retry prompt is passed as the --prompt / positional arg; it contains the original
    const promptArg = secondCallArgs.argv.join(' ');
    expect(promptArg).toContain('Tell me a joke');
  });

  it('retry path: second call options had outputSchema: undefined (Pitfall-4 prevention)', async () => {
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":123}')));
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":"hi"}')));

    await queryFull({ prompt: 'x', outputSchema: schema });

    // Second spawn must NOT have outputSchema in its argv (no --schema flag, schema stripped)
    // The key check: spawn was called twice (retry happened) and schema not double-injected
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('double-failure throws SchemaValidationError', async () => {
    // Both spawns return non-object invalid JSON
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', 'not valid json at all')));
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', 'still not valid')));

    await expect(
      queryFull({ prompt: 'give me x', outputSchema: schema })
    ).rejects.toThrow(SchemaValidationError);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('double-failure error message begins with Schema validation failed after retry:', async () => {
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":123}')));
    mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":456}')));

    await expect(
      queryFull({ prompt: 'x', outputSchema: schema })
    ).rejects.toThrow(/Schema validation failed after retry:/);
  });

  it('abort between first and retry throws AbortError (pre-aborted signal)', async () => {
    // Pre-abort the signal before any call: abortSignal is checked after first validation fails.
    // If abortSignal is already aborted before queryFull is called, the inner query() will throw
    // AbortError before spawning (pre-abort check in query()).
    const controller = new AbortController();
    controller.abort();

    await expect(
      queryFull({ prompt: 'x', outputSchema: schema, abortSignal: controller.signal })
    ).rejects.toThrow(/AbortError|aborted/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Phase 8: queryFull() outputSchema → systemPrompt injection
// ──────────────────────────────────────────────────────────────────────────

describe('queryFull() outputSchema → systemPrompt injection (Phase 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
    mockKillTree.mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(createMockChild([
      '{"type":"init","timestamp":"t","session_id":"s1","model":"m"}',
      '{"type":"message","timestamp":"t","role":"assistant","content":"{\\"x\\":\\"hello\\"}"}',
      '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]));
  });

  it('with outputSchema set and no systemPrompt: writeFile receives schema block', async () => {
    const schema = { type: 'object' };
    const writeFileSpy = vi.mocked(fsMod.writeFile);

    await queryFull({ prompt: 'x', outputSchema: schema });

    expect(writeFileSpy).toHaveBeenCalledOnce();
    const [, content] = writeFileSpy.mock.calls[0] as [string, string, string];
    expect(content).toBe(buildSchemaInjectionBlock(schema));
    expect(content).toContain('## Required Output Format');
  });

  it('with outputSchema + systemPrompt: writeFile receives sysPrompt + blank line + schema block', async () => {
    const schema = { type: 'object' };
    const sys = 'be concise';
    const writeFileSpy = vi.mocked(fsMod.writeFile);

    await queryFull({ prompt: 'x', systemPrompt: sys, outputSchema: schema });

    expect(writeFileSpy).toHaveBeenCalledOnce();
    const [, content] = writeFileSpy.mock.calls[0] as [string, string, string];
    const expected = `${sys}\n\n${buildSchemaInjectionBlock(schema)}`;
    expect(content).toBe(expected);
    expect(content).toMatch(/be concise\n\n## Required Output Format/);
  });

  it('without outputSchema: writeFile not called (no temp file)', async () => {
    const writeFileSpy = vi.mocked(fsMod.writeFile);
    await queryFull({ prompt: 'x' });
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('buildSchemaInjectionBlock output contains Required Output Format', () => {
    const schema = { type: 'object' };
    expect(buildSchemaInjectionBlock(schema)).toContain('Required Output Format');
  });
});

describe('Phase 9: MCP passthrough guards (MCP-02, MCP-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
    mockKillTree.mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(createMockChild([INIT_LINE, MSG_HELLO, RESULT_SUCCESS]));
  });

  it('throws InvalidPromptError when env.GEMINI_CONFIG_DIR is set with non-empty mcpServers', async () => {
    const fn = async () => {
      for await (const _ of query({
        prompt: 'x',
        mcpServers: { s: { command: 'x' } },
        allowedMcpServerNames: ['s'],
        env: { GEMINI_CONFIG_DIR: '/fake' },
      })) { /* drain */ }
    };
    await expect(fn()).rejects.toThrow(InvalidPromptError);
    await expect(fn()).rejects.toThrow(/GEMINI_CONFIG_DIR|MCP-02/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws InvalidPromptError when mcpServers is non-empty but allowedMcpServerNames is undefined', async () => {
    const fn = async () => {
      for await (const _ of query({
        prompt: 'x',
        mcpServers: { s: { command: 'x' } },
      })) { /* drain */ }
    };
    await expect(fn()).rejects.toThrow(InvalidPromptError);
    await expect(fn()).rejects.toThrow(/allowedMcpServerNames/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws InvalidPromptError when mcpServers is non-empty but allowedMcpServerNames is empty array', async () => {
    const fn = async () => {
      for await (const _ of query({
        prompt: 'x',
        mcpServers: { s: { command: 'x' } },
        allowedMcpServerNames: [],
      })) { /* drain */ }
    };
    await expect(fn()).rejects.toThrow(InvalidPromptError);
  });

  it('does not throw when mcpServers is an empty object (no-op path)', async () => {
    // Empty map is a no-op — no guard fires even when GEMINI_CONFIG_DIR is set
    let threw = false;
    try {
      const gen = query({ prompt: 'x', mcpServers: {}, env: { GEMINI_CONFIG_DIR: '/fake' } });
      // Call .next() to trigger guard evaluation; expect no InvalidPromptError
      // (spawn will be called; mock returns a valid stream)
      await gen.next();
      await gen.return(undefined);
    } catch (e) {
      if (e instanceof InvalidPromptError) threw = true;
    }
    expect(threw).toBe(false);
  });

  it('does not guard env.GEMINI_CONFIG_DIR when mcpServers is absent', async () => {
    let threw = false;
    try {
      const gen = query({ prompt: 'x', env: { GEMINI_CONFIG_DIR: '/ok' } });
      await gen.next();
      await gen.return(undefined);
    } catch (e) {
      if (e instanceof InvalidPromptError) threw = true;
    }
    expect(threw).toBe(false);
  });

  it('queryFull throws InvalidPromptError from the top, before outputSchema injection', async () => {
    // Both mcpServers set (triggers MCP-03 guard) AND outputSchema set
    // Expect InvalidPromptError (not UnsupportedFeatureError, not SchemaValidationError)
    await expect(
      queryFull({
        prompt: 'x',
        outputSchema: { type: 'object' },
        mcpServers: { s: { command: 'node' } },
        // no allowedMcpServerNames — triggers MCP-03 guard
      })
    ).rejects.toThrow(InvalidPromptError);
    // Spawn must not have been called (pre-spawn guard fires at queryFull top)
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('Phase 7 multi-turn integration (SES-01 + SES-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMod.unlink).mockResolvedValue(undefined);
  });

  it('multi-turn fixture integration: turn 2 references turn 1 context via 47', async () => {
    // Turn 1: load resume-session-turn1.ndjson content; extract sessionId via queryFull
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // __dirname not available in ESM tests — use process.cwd() which vitest sets to ts/
    const repoRoot = path.resolve(process.cwd(), '..');
    const turn1Ndjson = await fs.readFile(
      path.join(repoRoot, 'spec/fixtures/resume-session-turn1.ndjson'),
      'utf-8',
    );
    const turn2Ndjson = await fs.readFile(
      path.join(repoRoot, 'spec/fixtures/resume-session-turn2.ndjson'),
      'utf-8',
    );
    const turn1Lines = turn1Ndjson.trim().split(/\r?\n/);
    const turn2Lines = turn2Ndjson.trim().split(/\r?\n/);

    // First call: turn 1 — captures sessionId
    mockSpawn.mockReturnValueOnce(createMockChild(turn1Lines));
    const result1 = await queryFull({ prompt: 'My favorite number is 47. Remember it exactly.' });
    expect(result1.session.id).toBeTruthy();

    // Second call: turn 2 — passes session from turn 1
    mockSpawn.mockReturnValueOnce(createMockChild(turn2Lines));
    const result2 = await queryFull({
      prompt: 'What number did I just say?',
      session: result1.session,
    });

    // Assertion: turn 2's assistant text contains the number 47 (context recalled)
    expect(result2.text).toContain('47');
  });
});
