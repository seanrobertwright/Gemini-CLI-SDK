/**
 * ts/src/query/query.ts
 *
 * Three public query functions:
 *   query()     — async generator yielding MessageChunk stream
 *   queryRaw()  — async generator yielding RawEvent stream (no dispatch)
 *   queryFull() — accumulates all chunks into a QueryResult
 *
 * Requirements satisfied:
 *   API-01 — query() public entry point
 *   API-03 — queryRaw() raw event stream
 *   API-04 — queryFull() accumulated result
 *   API-05 — Abort kills subprocess + cleans temp file + flushes incomplete tool chunks
 *   API-06 — systemPrompt temp file lifecycle
 *   SYS-01 — GEMINI_SYSTEM_MD env var for system prompt injection
 *   SYS-02 — Temp system-prompt file deleted in finally
 *   CWD-01 — cwd option passed to subprocess
 *   MDL-04 — Model mismatch surfaced on ResultChunk
 *   ERR-06 — sawResult tracking: stream ending without terminal result throws via ErrorMapper
 */

import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ProcessManager, killTree } from '../process/index.js';
import { parseNdjson, dispatch } from '../parser/index.js';
import type { MessageChunk, RawEvent, ResultChunk } from '../parser/types.js';
import type { QueryOptions, QueryResult } from './types.js';
import { AbortError } from './types.js';
import { buildArgv } from './buildArgv.js';
import { ErrorMapper, GeminiError } from '../errors/index.js';
import { resolveAuth } from '../auth/index.js';

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Write a system prompt to a uniquely-named temp file.
 * Returns the absolute path to the temp file, or undefined if no prompt given.
 */
async function writeTempSystemPrompt(systemPrompt: string | undefined): Promise<string | undefined> {
  if (!systemPrompt) return undefined;
  const suffix = randomBytes(8).toString('hex');
  const tempPath = join(tmpdir(), 'gemini-sdk-system-' + suffix + '.md');
  await writeFile(tempPath, systemPrompt, 'utf-8');
  return tempPath;
}

// ────────────────────────────────────────────────────────────────────────────
// query() — primary public API (MessageChunk stream)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Yields a MessageChunk stream backed by a gemini-cli subprocess pipeline.
 *
 * Lifecycle:
 *   1. Pre-abort check
 *   2. Write optional system prompt to temp file → GEMINI_SYSTEM_MD
 *   3. Spawn subprocess via ProcessManager
 *   4. Pipe stdout through parseNdjson → dispatch
 *   5. Yield chunks; detect model mismatch; buffer pending tool_use chunks
 *   6. On abort: flush pending tool_use as incomplete, throw AbortError
 *   7. ERR-06: if stream ends without a result chunk AND not aborted, throw via ErrorMapper.fromExit
 *   8. Finally: remove abort listener, kill subprocess, delete temp file
 */
export async function* query(options: QueryOptions): AsyncGenerator<MessageChunk> {
  // Step 1: Pre-abort check
  if (options.abortSignal?.aborted) {
    throw new AbortError();
  }

  // Phase 6 (AUT-06): resolve auth mode and emit precedence warning if multiple configured.
  // resolveAuth is pure — takes a snapshot of process.env; does not read env during spawn.
  const resolved = resolveAuth({ ...process.env });
  for (const w of resolved.warnings) {
    console.warn(w);
  }

  // Step 2: Write optional system prompt to temp file
  const tempPath = await writeTempSystemPrompt(options.systemPrompt);

  // Step 3: Build env overrides
  const envOverrides: Record<string, string> = {
    ...resolved.envOverrides,  // Phase 6 placeholder (empty today)
    ...(options.env ?? {}),    // caller overrides win per existing contract
  };
  // NotConfigured is emitted post-spawn by ErrorMapper per Phase 5; resolveAuth 'adc' fallback covers the no-explicit-var case.
  if (tempPath) {
    envOverrides['GEMINI_SYSTEM_MD'] = tempPath;
  }

  // Step 4: Build argv and spawn subprocess
  const argv = buildArgv(options);
  const manager = new ProcessManager();
  const spawnResult = manager.spawn({
    argv,
    cliPath: options.cliPath,
    env: envOverrides,
    spawnOptions: { cwd: options.cwd },
  });

  // Step 5: Abort listener setup
  let aborted = false;
  const onAbort = () => { aborted = true; };
  options.abortSignal?.addEventListener('abort', onAbort, { once: true });

  // Step 6: Track model for mismatch detection (MDL-04)
  const requestedModel =
    options.model && options.model !== 'auto' ? (options.model as string) : undefined;
  let actualModel: string | undefined;

  // Step 7: Tool chunk buffering — unpaired tool_use chunks accumulate here
  const pendingToolChunks: MessageChunk[] = [];

  // ERR-06: track whether a terminal result chunk was received
  let sawResult = false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawEvents = parseNdjson(spawnResult.stdout! as any);
    const chunks = dispatch(rawEvents);

    for await (const chunk of chunks) {
      if (aborted) break;

      // Capture model from init event
      if (chunk.type === 'system' && chunk.subtype === 'init') {
        actualModel = chunk.model;
      }

      // Enrich ResultChunk with model mismatch info (MDL-04)
      if (chunk.type === 'result') {
        sawResult = true;
        if (requestedModel && actualModel && requestedModel !== actualModel) {
          const enriched: ResultChunk = {
            ...(chunk as ResultChunk),
            requestedModel,
            actualModel,
          };
          // Update pending tool tracking: result chunk ends the stream, clear pending
          pendingToolChunks.length = 0;
          yield enriched;
          continue;
        }
        // No mismatch — clear pending and yield as-is
        pendingToolChunks.length = 0;
      }

      // Tool chunk buffering
      if (chunk.type === 'tool') {
        pendingToolChunks.push(chunk);
      } else if (chunk.type === 'tool_result') {
        // Paired — clear the last pending tool_use
        pendingToolChunks.pop();
      }

      yield chunk;
    }

    // Step 8: Abort flush — yield pending tool_use chunks as incomplete before throwing
    if (aborted) {
      for (const pending of pendingToolChunks) {
        yield { ...pending, incomplete: true } as MessageChunk;
      }
      throw new AbortError();
    }

    // ERR-06 (SC-2): stream ended without a terminal result chunk AND not aborted.
    // Per ROADMAP Phase 5 SC-2, ProcessError must be raised regardless of exit code
    // (including exit 0) when no terminal result event was seen. ErrorMapper.fromExit
    // classifies the resulting exit + stderr tail into the correct typed subclass
    // (ProcessError for the generic no-result case; more specific subclasses when
    // stderr patterns match, e.g. AuthError / RateLimitError).
    if (!sawResult && !aborted) {
      const exitCode = spawnResult.child.exitCode ?? 0;
      const tail = spawnResult.getStderrTail();
      throw ErrorMapper.fromExit({ exitCode, stderr: tail });
    }
  } catch (err) {
    // Stream-event path: dispatch already threw a typed GeminiError — re-raise as-is.
    if (err instanceof GeminiError) throw err;
    // AbortError handling: already thrown above, but guard for unexpected re-entry
    if (err instanceof AbortError) throw err;
    // Unexpected error during iteration — treat as exit-code path
    const tail = spawnResult.getStderrTail();
    const exitCode = spawnResult.child.exitCode ?? 1;
    throw ErrorMapper.fromExit({ exitCode, stderr: tail });
  } finally {
    options.abortSignal?.removeEventListener('abort', onAbort);
    if (spawnResult.pid !== undefined) {
      killTree(spawnResult.pid).catch(() => { /* ignore — process may already be dead */ });
    }
    if (tempPath) {
      unlink(tempPath).catch(() => { /* ignore — temp file cleanup is best-effort */ });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// queryRaw() — raw RawEvent stream (skips dispatch)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Yields a RawEvent stream from a gemini-cli subprocess.
 * Skips the dispatch stage — intended for low-level introspection.
 */
export async function* queryRaw(options: QueryOptions): AsyncGenerator<RawEvent> {
  // Pre-abort check
  if (options.abortSignal?.aborted) {
    throw new AbortError();
  }

  // Phase 6 (AUT-06): resolve auth mode and emit precedence warning if multiple configured.
  // resolveAuth is pure — takes a snapshot of process.env; does not read env during spawn.
  const resolved = resolveAuth({ ...process.env });
  for (const w of resolved.warnings) {
    console.warn(w);
  }

  const tempPath = await writeTempSystemPrompt(options.systemPrompt);

  const envOverrides: Record<string, string> = {
    ...resolved.envOverrides,  // Phase 6 placeholder (empty today)
    ...(options.env ?? {}),    // caller overrides win per existing contract
  };
  if (tempPath) {
    envOverrides['GEMINI_SYSTEM_MD'] = tempPath;
  }

  const argv = buildArgv(options);
  const manager = new ProcessManager();
  const spawnResult = manager.spawn({
    argv,
    cliPath: options.cliPath,
    env: envOverrides,
    spawnOptions: { cwd: options.cwd },
  });

  let aborted = false;
  const onAbort = () => { aborted = true; };
  options.abortSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawEvents = parseNdjson(spawnResult.stdout! as any);

    for await (const event of rawEvents) {
      if (aborted) break;
      yield event;
    }

    if (aborted) {
      throw new AbortError();
    }
  } finally {
    options.abortSignal?.removeEventListener('abort', onAbort);
    if (spawnResult.pid !== undefined) {
      killTree(spawnResult.pid).catch(() => { /* ignore */ });
    }
    if (tempPath) {
      unlink(tempPath).catch(() => { /* ignore */ });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// queryFull() — accumulates chunks into a QueryResult
// ────────────────────────────────────────────────────────────────────────────

/**
 * Runs a full query and accumulates all MessageChunks into a QueryResult.
 * Convenience wrapper around query() for callers that don't need streaming.
 */
export async function queryFull(options: QueryOptions): Promise<QueryResult> {
  const chunks: MessageChunk[] = [];
  let text = '';
  let sessionId = '';
  let stopReason = '';

  for await (const chunk of query(options)) {
    chunks.push(chunk);
    if (chunk.type === 'assistant') text += chunk.content;
    if (chunk.type === 'result') {
      sessionId = chunk.sessionId;
      stopReason = chunk.stopReason;
    }
  }

  return { text, sessionId, stopReason, chunks };
}
