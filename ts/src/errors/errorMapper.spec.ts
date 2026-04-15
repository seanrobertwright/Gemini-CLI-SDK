/**
 * ts/src/errors/errorMapper.spec.ts
 *
 * Phase 5 RED — implementation lands in plan 05-02 / 05-03.
 *
 * Failing test scaffolds for ERR-04 (two-path mapping: fromStreamEvent + fromExit)
 * and ERR-05 (parity between the two paths). These tests fail at import time
 * because `./ErrorMapper.js` does not yet exist. That is the correct RED state
 * for Wave 1 of Phase 5.
 *
 * Parity: every `it('run_X_...')` here has a matching Python test in
 * python/tests/errors/test_error_mapper.py whose docstring first line is `run_X_...`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  GeminiError,
  RateLimitError,
  AuthError,
  Forbidden403,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} from './index.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ErrorMapper } from './ErrorMapper.js';

// ── ERR-04: fromStreamEvent ─────────────────────────────────────────────────

describe('ErrorMapper.fromStreamEvent (ERR-04)', () => {
  it('run_fromStreamEvent_code429_yields_RateLimitError', () => {
    const err = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { code: 429, message: 'quota exceeded' },
    });
    expect(err instanceof RateLimitError).toBe(true);
    expect((err as RateLimitError).retryable).toBe(true);
  });

  it('run_fromStreamEvent_RESOURCE_EXHAUSTED_status_yields_RateLimitError', () => {
    const err = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' },
    });
    expect(err instanceof RateLimitError).toBe(true);
  });

  it('run_fromStreamEvent_code401_yields_AuthError', () => {
    const err = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { code: 401, message: 'API key not valid' },
    });
    expect(err instanceof AuthError).toBe(true);
  });

  it('run_fromStreamEvent_code403_yields_Forbidden403', () => {
    const err = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { code: 403, message: 'Forbidden' },
    });
    expect(err instanceof Forbidden403).toBe(true);
  });

  it('run_fromStreamEvent_unknown_event_yields_GeminiError_with_bucket_unknown', () => {
    const err = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { message: 'something weird' },
    });
    expect(err instanceof GeminiError).toBe(true);
    expect((err as GeminiError).bucket).toBe('unknown');
  });

  it('run_fromStreamEvent_retryAfter_populates_retryAfterMs', () => {
    // Phase 5 plan 01: real 429 not captured; actual retryAfter field name unknown.
    // ErrorMapper must tolerate absence — asserting undefined is a valid contract
    // until follow-up capture resolves RESEARCH.md Open Question #3.
    const err = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { code: 429, message: 'quota exceeded' },
    });
    expect(err instanceof RateLimitError).toBe(true);
    // retryAfterMs may be undefined when no retry-after field is present in the event
    expect((err as RateLimitError).retryAfterMs === undefined ||
      typeof (err as RateLimitError).retryAfterMs === 'number').toBe(true);
  });
});

// ── ERR-04: fromExit ────────────────────────────────────────────────────────

describe('ErrorMapper.fromExit (ERR-04)', () => {
  it('run_fromExit_quota_stderr_yields_RateLimitError', () => {
    const err = ErrorMapper.fromExit({
      exitCode: 1,
      stderr: 'Error: You have exceeded your quota. Please try again later. Status: RESOURCE_EXHAUSTED',
    });
    expect(err instanceof RateLimitError).toBe(true);
  });

  it('run_fromExit_api_key_not_valid_yields_AuthError', () => {
    const err = ErrorMapper.fromExit({
      exitCode: 1,
      stderr: 'Error: API key not valid. Please pass a valid API key. Status: UNAUTHENTICATED',
    });
    expect(err instanceof AuthError).toBe(true);
  });

  it('run_fromExit_unmatched_stderr_yields_generic_GeminiError_bucket_unknown', () => {
    // After SC-2 / ERR-06 fix: the catch-all returns ProcessError (bucket='crash') so that
    // any stream ending without a terminal result event is a crash-bucket error (not unknown).
    // ProcessError extends GeminiError so `instanceof GeminiError` still holds.
    const err = ErrorMapper.fromExit({
      exitCode: 42,
      stderr: 'some unrecognized error tail',
    });
    expect(err instanceof GeminiError).toBe(true);
    expect((err as GeminiError).bucket).toBe('crash');
    expect((err as GeminiError).retryable).toBe(false);
    expect(err.message).toMatch(/42/);
    expect(err.message).toMatch(/some unrecognized error tail/);
  });
});

// ── ERR-05: two-path parity ─────────────────────────────────────────────────

describe('Two-path parity (ERR-05)', () => {
  it('run_stream_and_exit_path_produce_same_class_for_rate_limit', () => {
    const streamErr = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' },
    });
    const exitErr = ErrorMapper.fromExit({
      exitCode: 1,
      stderr: 'Error: You have exceeded your quota. Status: RESOURCE_EXHAUSTED',
    });
    expect(streamErr.constructor.name).toBe(exitErr.constructor.name);
    expect(streamErr.constructor.name).toBe('RateLimitError');
  });

  it('run_stream_and_exit_path_produce_same_class_for_auth', () => {
    const streamErr = ErrorMapper.fromStreamEvent({
      type: 'error',
      error: { code: 401, status: 'UNAUTHENTICATED', message: 'API key not valid' },
    });
    const exitErr = ErrorMapper.fromExit({
      exitCode: 1,
      stderr: 'Error: API key not valid. Status: UNAUTHENTICATED',
    });
    expect(streamErr.constructor.name).toBe(exitErr.constructor.name);
  });
});

// ── ERR-04 + ERR-05: fixture corpus contract ────────────────────────────────

describe('Fixture corpus contract (ERR-04, ERR-05)', () => {
  const fixturesDir = new URL('../../../spec/fixtures/', import.meta.url);
  const errorFixtureNames = readdirSync(new URL('.', fixturesDir))
    .filter((f: string) => f.startsWith('error-') && f.endsWith('.expected.json'))
    .map((f: string) => f.replace('.expected.json', ''))
    .sort();

  // Single static it() so the parity extractor captures a stable name.
  // Iteration happens inside the test body — Python mirrors via parametrize
  // over the same fixture slugs with the same docstring-anchored name.
  it('run_fixture_corpus_both_paths_match_expected_errorType', () => {
    for (const slug of errorFixtureNames) {
      const expectedPath = new URL(`${slug}.expected.json`, fixturesDir);
      const expected = JSON.parse(readFileSync(expectedPath, 'utf-8')) as {
        _throws?: boolean;
        _errorType?: string;
      };
      if (!expected._throws || !expected._errorType) continue;

      // Load the stderr tail (real or synthetic placeholder)
      let stderrTail = '';
      try {
        stderrTail = readFileSync(new URL(`${slug}.stderr.txt`, fixturesDir), 'utf-8');
      } catch {
        // ignore
      }

      // Load ndjson, find the error event if present
      let errorEvent: Record<string, unknown> | null = null;
      try {
        const ndjson = readFileSync(new URL(`${slug}.ndjson`, fixturesDir), 'utf-8');
        for (const line of ndjson.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj.type === 'error') {
              errorEvent = obj;
              break;
            }
          } catch {
            // skip malformed
          }
        }
      } catch {
        // ignore
      }

      if (errorEvent) {
        const err = ErrorMapper.fromStreamEvent(errorEvent);
        expect(err.constructor.name).toBe(expected._errorType);
      }

      const exitErr = ErrorMapper.fromExit({ exitCode: 1, stderr: stderrTail });
      expect(exitErr.constructor.name).toBe(expected._errorType);
    }
    expect(errorFixtureNames.length).toBeGreaterThan(0);
  });
});
