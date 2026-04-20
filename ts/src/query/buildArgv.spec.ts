/**
 * ts/src/query/buildArgv.spec.ts
 *
 * Unit tests + property-based fuzz test for buildArgv.
 * Covers all branches: model omission, explicit model, additionalDirectories.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { buildArgv } from './buildArgv.js';
import { Model } from './types.js';
import type { Session } from '../session/index.js';

// ── basic prompt ──────────────────────────────────────────────────────────────

describe('buildArgv: basic prompt', () => {
  it('returns fixed header followed by -p and prompt', () => {
    const result = buildArgv({ prompt: 'hello' });
    expect(result).toEqual(['--output-format', 'stream-json', '-p', 'hello']);
  });

  it('prompt is always the 4th element', () => {
    const result = buildArgv({ prompt: 'world' });
    expect(result[3]).toBe('world');
  });

  it('always starts with --output-format stream-json', () => {
    const result = buildArgv({ prompt: 'test' });
    expect(result[0]).toBe('--output-format');
    expect(result[1]).toBe('stream-json');
  });
});

// ── model omission ────────────────────────────────────────────────────────────

describe('buildArgv: model omission', () => {
  it('omits --model when model is undefined', () => {
    const result = buildArgv({ prompt: 'x', model: undefined });
    expect(result).not.toContain('--model');
  });

  it('omits --model when model is auto', () => {
    const result = buildArgv({ prompt: 'x', model: 'auto' });
    expect(result).not.toContain('--model');
  });

  it("omits --model when model is Model.AUTO", () => {
    const result = buildArgv({ prompt: 'x', model: Model.AUTO });
    expect(result).not.toContain('--model');
  });

  it('has exactly 4 elements when prompt only and no model', () => {
    const result = buildArgv({ prompt: 'x' });
    expect(result).toHaveLength(4);
  });
});

// ── explicit model ────────────────────────────────────────────────────────────

describe('buildArgv: explicit model', () => {
  it("adds --model gemini-2.5-pro for Model.PRO_25", () => {
    const result = buildArgv({ prompt: 'x', model: 'gemini-2.5-pro' });
    expect(result).toContain('--model');
    const idx = result.indexOf('--model');
    expect(result[idx + 1]).toBe('gemini-2.5-pro');
  });

  it("adds --model gemini-2.5-flash for Model.FLASH_25", () => {
    const result = buildArgv({ prompt: 'x', model: Model.FLASH_25 });
    const idx = result.indexOf('--model');
    expect(result[idx + 1]).toBe('gemini-2.5-flash');
  });

  it("adds --model gemini-2.0-flash for Model.FLASH_20", () => {
    const result = buildArgv({ prompt: 'x', model: Model.FLASH_20 });
    const idx = result.indexOf('--model');
    expect(result[idx + 1]).toBe('gemini-2.0-flash');
  });

  it("adds --model gemini-3-flash for Model.FLASH_3", () => {
    const result = buildArgv({ prompt: 'x', model: Model.FLASH_3 });
    const idx = result.indexOf('--model');
    expect(result[idx + 1]).toBe('gemini-3-flash');
  });

  it("adds --model gemini-3-pro for Model.PRO_3", () => {
    const result = buildArgv({ prompt: 'x', model: Model.PRO_3 });
    const idx = result.indexOf('--model');
    expect(result[idx + 1]).toBe('gemini-3-pro');
  });
});

// ── string escape hatch (MDL-02) ──────────────────────────────────────────────

describe('buildArgv: string escape hatch', () => {
  it('passes through arbitrary model string to --model (MDL-02)', () => {
    const result = buildArgv({ prompt: 'x', model: 'custom-future-model' });
    expect(result).toContain('--model');
    const idx = result.indexOf('--model');
    expect(result[idx + 1]).toBe('custom-future-model');
  });

  it('passes through gemini-99-ultra as raw string model', () => {
    const result = buildArgv({ prompt: 'x', model: 'gemini-99-ultra' });
    const idx = result.indexOf('--model');
    expect(result[idx + 1]).toBe('gemini-99-ultra');
  });
});

// ── additionalDirectories (CWD-02) ────────────────────────────────────────────

describe('buildArgv: additionalDirectories', () => {
  it('maps two directories to two --include-directories flags', () => {
    const result = buildArgv({ prompt: 'x', additionalDirectories: ['dir1', 'dir2'] });
    expect(result).toEqual([
      '--output-format', 'stream-json',
      '-p', 'x',
      '--include-directories', 'dir1',
      '--include-directories', 'dir2',
    ]);
  });

  it('omits --include-directories when array is empty', () => {
    const result = buildArgv({ prompt: 'x', additionalDirectories: [] });
    expect(result).not.toContain('--include-directories');
    expect(result).toHaveLength(4);
  });

  it('omits --include-directories when not provided', () => {
    const result = buildArgv({ prompt: 'x' });
    expect(result).not.toContain('--include-directories');
  });

  it('handles a single directory', () => {
    const result = buildArgv({ prompt: 'x', additionalDirectories: ['only-dir'] });
    const idx = result.indexOf('--include-directories');
    expect(result[idx + 1]).toBe('only-dir');
    // Only one occurrence
    expect(result.filter((v) => v === '--include-directories')).toHaveLength(1);
  });
});

// ── Model enum values ─────────────────────────────────────────────────────────

describe('buildArgv: Model enum values', () => {
  it('Model.AUTO is the string auto', () => {
    expect(Model.AUTO).toBe('auto');
  });

  it('Model.FLASH_25 is the string gemini-2.5-flash', () => {
    expect(Model.FLASH_25).toBe('gemini-2.5-flash');
  });

  it('Model.PRO_25 is the string gemini-2.5-pro', () => {
    expect(Model.PRO_25).toBe('gemini-2.5-pro');
  });

  it('Model.FLASH_20 is the string gemini-2.0-flash', () => {
    expect(Model.FLASH_20).toBe('gemini-2.0-flash');
  });

  it('Model.FLASH_3 is the string gemini-3-flash', () => {
    expect(Model.FLASH_3).toBe('gemini-3-flash');
  });

  it('Model.PRO_3 is the string gemini-3-pro', () => {
    expect(Model.PRO_3).toBe('gemini-3-pro');
  });

  it('Model has exactly 6 keys', () => {
    expect(Object.keys(Model)).toHaveLength(6);
  });

  it('all Model values are strings', () => {
    for (const value of Object.values(Model)) {
      expect(typeof value).toBe('string');
    }
  });
});

// ── fuzz test ─────────────────────────────────────────────────────────────────

describe('buildArgv: fuzz test', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('never throws for arbitrary input and always returns non-empty string[]', () => {
    // Ensure deterministic env state: fallback env var must not be set
    vi.unstubAllEnvs();
    fc.assert(
      fc.property(
        fc.record({
          prompt: fc.string({ minLength: 1 }),
          model: fc.option(
            fc.oneof(
              fc.constant('auto'),
              fc.constant('gemini-2.5-flash'),
              fc.constant('gemini-2.5-pro'),
              fc.constant('gemini-2.0-flash'),
              fc.constant('gemini-3-flash'),
              fc.constant('gemini-3-pro'),
              fc.string({ minLength: 1 }),
            ),
            { nil: undefined }
          ),
          additionalDirectories: fc.option(
            fc.array(fc.string()),
            { nil: undefined }
          ),
          session: fc.option(
            fc.oneof(
              fc.string({ minLength: 1 }),
              fc.record({ id: fc.string(), model: fc.string(), createdAt: fc.string() }),
            ),
            { nil: undefined }
          ),
        }),
        (opts) => {
          const result = buildArgv(opts);
          // Never throws, always non-empty, always starts correctly
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBeGreaterThan(0);
          expect(result[0]).toBe('--output-format');
          expect(result[1]).toBe('stream-json');
          // All elements are strings
          for (const el of result) {
            expect(typeof el).toBe('string');
          }
          // Session invariant (fallback env var NOT set, so primary path applies)
          if (opts.session !== undefined) {
            expect(result).toContain('--resume');
            expect(result[2]).toBe('--resume');
          } else {
            expect(result[2]).toBe('-p');
            expect(result[3]).toBe(opts.prompt);
          }
        }
      )
    );
  });

  it('fuzz: model auto/undefined never produces --model flag', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.constant('auto'), { nil: undefined }),
        (prompt, model) => {
          const result = buildArgv({ prompt, model });
          expect(result).not.toContain('--model');
        }
      )
    );
  });

  it('fuzz: non-auto model always produces --model flag', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }).filter((s) => s !== 'auto'),
        (prompt, model) => {
          const result = buildArgv({ prompt, model });
          expect(result).toContain('--model');
          const idx = result.indexOf('--model');
          expect(result[idx + 1]).toBe(model);
        }
      )
    );
  });
});

describe('buildArgv: session primary path (SES-02)', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('omits --resume when no session option provided', () => {
    const result = buildArgv({ prompt: 'x' });
    expect(result).not.toContain('--resume');
  });

  it('inserts --resume id between stream-json and -p when session is a string', () => {
    const result = buildArgv({ prompt: 'x', session: 'abc-123' });
    expect(result).toEqual(['--output-format', 'stream-json', '--resume', 'abc-123', '-p', 'x']);
  });

  it('inserts --resume id when session is a Session object', () => {
    const s: Session = { id: 'xyz-9', model: '', createdAt: '' };
    const result = buildArgv({ prompt: 'x', session: s });
    expect(result[2]).toBe('--resume');
    expect(result[3]).toBe('xyz-9');
  });

  it('places --resume before -p', () => {
    const result = buildArgv({ prompt: 'x', session: 'abc' });
    const resumeIdx = result.indexOf('--resume');
    const pIdx = result.indexOf('-p');
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(pIdx).toBeGreaterThan(-1);
    expect(resumeIdx).toBeLessThan(pIdx);
  });

  it('session and additionalDirectories both produce flags in argv', () => {
    const result = buildArgv({ prompt: 'x', session: 's', additionalDirectories: ['d1'] });
    expect(result).toEqual([
      '--output-format', 'stream-json',
      '--resume', 's',
      '-p', 'x',
      '--include-directories', 'd1',
    ]);
  });

  it('session and model both produce flags in argv', () => {
    const result = buildArgv({ prompt: 'x', session: 's', model: 'gemini-3-pro' });
    expect(result).toContain('--resume');
    expect(result).toContain('--model');
    expect(result).toContain('gemini-3-pro');
  });
});

describe('buildArgv: transcript-prepend fallback (SES-04)', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('fallback env var set plus transcript present omits --resume and prepends transcript', () => {
    vi.stubEnv('GEMINI_SDK_TRANSCRIPT_FALLBACK', '1');
    const s: Session = {
      id: 'abc',
      model: '',
      createdAt: '',
      transcript: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    };
    const result = buildArgv({ prompt: 'next', session: s });
    expect(result).not.toContain('--resume');
    expect(result[3]).toBe('User: hi\nAssistant: hello\n\nUser: next');
  });

  it('fallback env var set but no transcript falls back to primary path', () => {
    vi.stubEnv('GEMINI_SDK_TRANSCRIPT_FALLBACK', '1');
    const s: Session = { id: 'abc', model: '', createdAt: '' };
    const result = buildArgv({ prompt: 'x', session: s });
    expect(result).toContain('--resume');
  });

  it('fallback env var set but session is a string falls back to primary path', () => {
    vi.stubEnv('GEMINI_SDK_TRANSCRIPT_FALLBACK', '1');
    const result = buildArgv({ prompt: 'x', session: 'abc' });
    expect(result).toContain('--resume');
  });

  it('fallback env var unset with transcript present uses primary path', () => {
    const s: Session = {
      id: 'abc',
      model: '',
      createdAt: '',
      transcript: [{ role: 'user', content: 'hi' }],
    };
    const result = buildArgv({ prompt: 'x', session: s });
    expect(result).toContain('--resume');
  });
});
