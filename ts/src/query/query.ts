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
import { ErrorMapper, GeminiError, InvalidPromptError, SchemaValidationError, UnsupportedFeatureError } from '../errors/index.js';
import { buildSchemaInjectionBlock } from '../output/injectSchema.js';
import { validateWithSchema } from '../output/schemaValidator.js';
import { buildRetryPrompt } from '../output/retry.js';
import { resolveAuth } from '../auth/index.js';
import { normaliseSessionId } from '../session/index.js';
import type { Session } from '../session/index.js';

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Write a system prompt to a uniquely-named temp file.
 * Returns the absolute path to the temp file, or undefined if no prompt given.
 */
async function writeTempSystemPrompt(
  systemPrompt: string | undefined,
  outputSchema?: Record<string, unknown>,
): Promise<string | undefined> {
  if (!systemPrompt && !outputSchema) return undefined;
  const base = systemPrompt ?? '';
  let content = base;
  if (outputSchema) {
    const schemaBlock = buildSchemaInjectionBlock(outputSchema);
    content = base ? `${base}\n\n${schemaBlock}` : schemaBlock;
  }
  const suffix = randomBytes(8).toString('hex');
  const tempPath = join(tmpdir(), 'gemini-sdk-system-' + suffix + '.md');
  await writeFile(tempPath, content, 'utf-8');
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
  // Phase 8 (OUT-01 guard): outputSchema only supported on queryFull().
  // Throw pre-spawn to save a subprocess round-trip on caller mistakes.
  if (options.outputSchema !== undefined) {
    throw new UnsupportedFeatureError(
      'outputSchema requires queryFull() — not supported on query()/queryRaw()'
    );
  }

  // Phase 7 (SES-01 Layer 1 guard): reject empty/whitespace session ids BEFORE spawn.
  // Saves a subprocess round-trip for client-side mistakes. Uses existing Phase 5 class.
  if (options.session !== undefined) {
    const id = normaliseSessionId(options.session);
    if (!id || !id.trim()) {
      throw new InvalidPromptError('session id is empty');
    }
  }

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

  // Step 2: Write optional system prompt to temp file (Phase 8: passes outputSchema for injection)
  const tempPath = await writeTempSystemPrompt(options.systemPrompt, options.outputSchema);

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

      // Enrich ResultChunk with model mismatch (MDL-04) and session mismatch (Phase 7) info
      if (chunk.type === 'result') {
        sawResult = true;
        const base = chunk as ResultChunk;
        const modelMismatch =
          requestedModel !== undefined && actualModel !== undefined && requestedModel !== actualModel;
        let requestedSessionId: string | undefined;
        let actualSessionId: string | undefined;
        if (options.session !== undefined) {
          requestedSessionId = normaliseSessionId(options.session);
          actualSessionId = base.sessionId;
          if (requestedSessionId === actualSessionId) {
            // No mismatch — clear both so we don't surface them
            requestedSessionId = undefined;
            actualSessionId = undefined;
          }
        }
        if (modelMismatch || (requestedSessionId !== undefined && actualSessionId !== undefined)) {
          const enriched: ResultChunk = { ...base };
          if (modelMismatch) {
            enriched.requestedModel = requestedModel;
            enriched.actualModel = actualModel;
          }
          if (requestedSessionId !== undefined && actualSessionId !== undefined) {
            enriched.requestedSessionId = requestedSessionId;
            enriched.actualSessionId = actualSessionId;
          }
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
  // Phase 8 (OUT-01 guard): outputSchema only supported on queryFull().
  if (options.outputSchema !== undefined) {
    throw new UnsupportedFeatureError(
      'outputSchema requires queryFull() — not supported on query()/queryRaw()'
    );
  }

  // Phase 7 (SES-01 Layer 1 guard): reject empty/whitespace session ids BEFORE spawn.
  if (options.session !== undefined) {
    const id = normaliseSessionId(options.session);
    if (!id || !id.trim()) {
      throw new InvalidPromptError('session id is empty');
    }
  }

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

  const tempPath = await writeTempSystemPrompt(options.systemPrompt, options.outputSchema);

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
  let initSessionId = '';
  let initModel = '';

  // Phase 8: query() guards against outputSchema being set (only queryFull is supported).
  // Inject the schema block into systemPrompt here and strip outputSchema before delegating
  // to query(). This satisfies the writeTempSystemPrompt extension contract: the combined
  // systemPrompt written to the temp file contains the schema block when outputSchema is set.
  let innerOptions: QueryOptions = options;
  if (options.outputSchema !== undefined) {
    const schemaBlock = buildSchemaInjectionBlock(options.outputSchema);
    const combinedSystemPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${schemaBlock}`
      : schemaBlock;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { outputSchema: _stripped, ...rest } = options;
    innerOptions = { ...rest, systemPrompt: combinedSystemPrompt };
  }

  for await (const chunk of query(innerOptions)) {
    chunks.push(chunk);
    if (chunk.type === 'assistant') text += chunk.content;
    if (chunk.type === 'system' && chunk.subtype === 'init') {
      initSessionId = chunk.sessionId ?? '';
      initModel = chunk.model ?? '';
    }
    if (chunk.type === 'result') {
      sessionId = chunk.sessionId;
      stopReason = chunk.stopReason;
    }
  }

  const session: Session = {
    id: initSessionId || sessionId,  // prefer init-event id; fall back to result-event id
    model: initModel,
    createdAt: new Date().toISOString(),  // wall-clock at queryFull call time
  };

  // Phase 8 (OUT-01/02/03): if outputSchema is unset, existing behavior preserved.
  if (options.outputSchema === undefined) {
    return { text, sessionId, session, stopReason, chunks };
  }

  // Validate first response. If valid → return with structured field populated.
  const firstValidation = validateWithSchema(options.outputSchema, text);
  if (firstValidation.success) {
    return {
      text,
      sessionId,
      session,
      stopReason,
      chunks,
      structured: firstValidation.data,
    };
  }

  // Invalid → retry once. Honor abortSignal between calls.
  if (options.abortSignal?.aborted) {
    throw new AbortError();
  }

  // Build retry options: reuse session (Phase 7 --resume), strip outputSchema
  // to prevent recursive schema injection and nested retry loops (Pitfall 4).
  const retryPrompt = buildRetryPrompt(options.prompt, firstValidation.error, text);
  const retryOptions: QueryOptions = {
    ...options,
    prompt: retryPrompt,
    session: session,
    outputSchema: undefined,
  };

  const retryResult = await queryFull(retryOptions);

  // Validate retry response. Success → return with structured; failure → throw.
  const secondValidation = validateWithSchema(options.outputSchema, retryResult.text);
  if (secondValidation.success) {
    return {
      ...retryResult,
      structured: secondValidation.data,
    };
  }

  throw new SchemaValidationError(
    `Schema validation failed after retry: ${secondValidation.error}`
  );
}
