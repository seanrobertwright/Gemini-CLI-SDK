/**
 * ts/src/errors/errors.spec.ts
 *
 * Phase 5 RED — implementation lands in plan 05-02 / 05-03.
 *
 * Failing test scaffolds for ERR-01 (class hierarchy), ERR-02 (5-bucket map),
 * ERR-03 (retryable invariant). These tests fail at import time because
 * `./index.js` does not yet re-export the new class hierarchy. That is the
 * correct RED state for Wave 1 of Phase 5.
 *
 * Parity: every `it('run_X_...')` here has a matching Python test in
 * python/tests/errors/test_errors.py whose docstring first line is `run_X_...`.
 *
 * NOTE ON TEST FILE LOCATION (deviation from 05-01-PLAN.md):
 *   Plan specified ts/tests/errors.test.ts, but project convention (vitest.config.ts
 *   `include: ['src/**\/*.{test,spec}.ts']`) colocates tests with source. Placing the
 *   file here ensures vitest discovers it. The plan's `ts/tests/` path was aspirational.
 */

import { describe, it, expect } from 'vitest';
import {
  GeminiError,
  RateLimitError,
  AuthError,
  NotConfigured,
  Forbidden403,
  Expired,
  ToSViolation,
  ModelAccessError,
  InvalidPromptError,
  ProcessError,
  ProcessCrashError,
  ParseError,
  AbortError,
  UnsupportedFeatureError,
  GeminiNotFoundError,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} from './index.js';

// ── ERR-01: class hierarchy ─────────────────────────────────────────────────

describe('GeminiError hierarchy (ERR-01)', () => {
  it('run_GeminiError_exists_and_is_base', () => {
    const e = new GeminiError('test');
    expect(e instanceof Error).toBe(true);
  });

  const allTenSubclasses: Array<[string, new (...args: any[]) => Error]> = [
    ['RateLimitError', RateLimitError],
    ['AuthError', AuthError],
    ['ModelAccessError', ModelAccessError],
    ['InvalidPromptError', InvalidPromptError],
    ['ProcessError', ProcessError],
    ['ProcessCrashError', ProcessCrashError],
    ['ParseError', ParseError],
    ['AbortError', AbortError],
    ['UnsupportedFeatureError', UnsupportedFeatureError],
    ['GeminiNotFoundError', GeminiNotFoundError],
  ];

  // Plan requires a single parametrized description but each it() needs a unique
  // static name so the static grep picks it up for parity. We run one assertion
  // per class inside a single it() so the extracted name stays `run_all_10_subclasses_extend_GeminiError`.
  it('run_all_10_subclasses_extend_GeminiError', () => {
    for (const [name, Cls] of allTenSubclasses) {
      const instance = new (Cls as any)('test');
      expect(instance instanceof GeminiError).toBe(true);
      expect(instance.name ?? name).toBeDefined();
    }
  });

  it('run_AuthError_subtypes_extend_AuthError', () => {
    const subtypes: Array<new (...args: any[]) => Error> = [
      NotConfigured,
      Forbidden403,
      Expired,
      ToSViolation,
    ];
    for (const Cls of subtypes) {
      const instance = new (Cls as any)('test');
      expect(instance instanceof AuthError).toBe(true);
      expect(instance instanceof GeminiError).toBe(true);
    }
  });
});

// ── ERR-02 + ERR-03: bucket + retryable invariants ──────────────────────────

describe('Bucket + retryable invariants (ERR-02, ERR-03)', () => {
  const allClasses: Array<[string, new (...args: any[]) => any, string]> = [
    ['RateLimitError', RateLimitError, 'rate_limit'],
    ['AuthError', AuthError, 'auth'],
    ['NotConfigured', NotConfigured, 'auth'],
    ['Forbidden403', Forbidden403, 'auth'],
    ['Expired', Expired, 'auth'],
    ['ToSViolation', ToSViolation, 'auth'],
    ['ModelAccessError', ModelAccessError, 'model_access'],
    ['ProcessError', ProcessError, 'crash'],
    ['ProcessCrashError', ProcessCrashError, 'crash'],
    ['AbortError', AbortError, 'crash'],
    ['InvalidPromptError', InvalidPromptError, 'unknown'],
    ['ParseError', ParseError, 'unknown'],
    ['UnsupportedFeatureError', UnsupportedFeatureError, 'unknown'],
    ['GeminiNotFoundError', GeminiNotFoundError, 'unknown'],
  ];

  const allowedBuckets = new Set(['rate_limit', 'auth', 'model_access', 'crash', 'unknown']);

  it('run_bucket_matches_archon_5', () => {
    for (const [name, Cls, expectedBucket] of allClasses) {
      const instance = new (Cls as any)('test');
      expect(allowedBuckets.has(instance.bucket)).toBe(true);
      expect(instance.bucket).toBe(expectedBucket);
      // Touch name so lint doesn't complain
      void name;
    }
  });

  it('run_retryable_is_boolean', () => {
    for (const [, Cls] of allClasses) {
      const instance = new (Cls as any)('test');
      expect(typeof instance.retryable).toBe('boolean');
    }
  });

  it('run_RateLimitError_retryable_is_true', () => {
    const e = new RateLimitError('test');
    expect(e.retryable).toBe(true);
  });

  it('run_RateLimitError_retryAfterMs_populates_from_constructor_options', () => {
    const e = new RateLimitError('msg', { retryAfterMs: 5000 });
    expect(e.retryAfterMs).toBe(5000);
  });

  it('run_AuthError_retryable_is_false', () => {
    const e = new AuthError('test');
    expect(e.retryable).toBe(false);
  });
});
