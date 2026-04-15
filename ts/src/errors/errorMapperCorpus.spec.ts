/**
 * ts/src/errors/errorMapperCorpus.spec.ts
 *
 * Fixture-corpus contract tests (ERR-04 + ERR-05) at scale.
 * Iterates every spec/fixtures/error-*.ndjson + .stderr.txt + .expected.json triple.
 * Adding a new fixture triple automatically adds new coverage on the next run.
 *
 * Test names use `run_corpus_*` prefix for AST-parity extraction
 * (matches `scripts/diff-test-names.sh` pattern).
 *
 * Parity: every `it('run_corpus_...')` here has a matching Python function in
 * python/tests/errors/test_error_mapper_corpus.py whose docstring first line is identical.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorMapper } from './ErrorMapper.js';
import * as errorClasses from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../spec/fixtures');

function getErrorSlugs(): string[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith('error-') && f.endsWith('.ndjson'))
    .map((f) => f.replace('.ndjson', ''))
    .sort();
}

interface ExpectedJson {
  _errorType?: string;
  _throws?: boolean;
}

interface StreamErrorEventLike {
  type: string;
  error?: Record<string, unknown>;
}

function loadFixture(slug: string): {
  ndjson: string;
  stderr: string;
  expected: ExpectedJson;
  errorEvent: StreamErrorEventLike | undefined;
} {
  const ndjsonPath = join(FIXTURES, `${slug}.ndjson`);
  const stderrPath = join(FIXTURES, `${slug}.stderr.txt`);
  const expectedPath = join(FIXTURES, `${slug}.expected.json`);

  const ndjson = readFileSync(ndjsonPath, 'utf8');
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedJson;
  let stderr = '';
  try {
    stderr = readFileSync(stderrPath, 'utf8');
  } catch {
    // no stderr file — skip exit-path tests
  }

  let errorEvent: StreamErrorEventLike | undefined;
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as StreamErrorEventLike;
      if (obj.type === 'error') {
        errorEvent = obj;
        break;
      }
    } catch {
      // skip malformed line
    }
  }

  return { ndjson, stderr, expected, errorEvent };
}

describe('ErrorMapper corpus: fromStreamEvent (ERR-04)', () => {
  it('run_corpus_fromStreamEvent_matches_expected_type', () => {
    const slugs = getErrorSlugs();
    expect(slugs.length).toBeGreaterThan(0);

    for (const slug of slugs) {
      const { expected, errorEvent } = loadFixture(slug);
      if (!expected._errorType) continue;

      if (!errorEvent) continue; // no stream event in this fixture — skip

      const expectedCtor = (errorClasses as Record<string, unknown>)[expected._errorType] as new (
        ...args: unknown[]
      ) => InstanceType<typeof errorClasses.GeminiError>;
      expect(expectedCtor, `${slug}: _errorType '${expected._errorType}' not found in errors module`).toBeTruthy();

      const err = ErrorMapper.fromStreamEvent(errorEvent as Parameters<typeof ErrorMapper.fromStreamEvent>[0]);
      expect(err, `${slug}: fromStreamEvent result should be instanceof ${expected._errorType}`).toBeInstanceOf(expectedCtor);
    }
  });
});

describe('ErrorMapper corpus: fromExit (ERR-04)', () => {
  it('run_corpus_fromExit_matches_expected_type', () => {
    const slugs = getErrorSlugs();
    expect(slugs.length).toBeGreaterThan(0);

    for (const slug of slugs) {
      const { expected, stderr } = loadFixture(slug);
      if (!expected._errorType) continue;
      if (!stderr.trim()) continue; // no stderr — skip exit-path test

      const expectedCtor = (errorClasses as Record<string, unknown>)[expected._errorType] as new (
        ...args: unknown[]
      ) => InstanceType<typeof errorClasses.GeminiError>;
      expect(expectedCtor, `${slug}: _errorType '${expected._errorType}' not found in errors module`).toBeTruthy();

      const err = ErrorMapper.fromExit({ exitCode: 1, stderr });
      expect(err, `${slug}: fromExit result should be instanceof ${expected._errorType}`).toBeInstanceOf(expectedCtor);
    }
  });
});

describe('ErrorMapper corpus: two-path parity (ERR-05)', () => {
  it('run_corpus_both_paths_agree_on_class', () => {
    const slugs = getErrorSlugs();
    expect(slugs.length).toBeGreaterThan(0);

    for (const slug of slugs) {
      const { expected, errorEvent, stderr } = loadFixture(slug);
      if (!expected._errorType) continue;
      if (!errorEvent || !stderr.trim()) continue; // need both paths

      const fromStream = ErrorMapper.fromStreamEvent(
        errorEvent as Parameters<typeof ErrorMapper.fromStreamEvent>[0],
      );
      const fromExit = ErrorMapper.fromExit({ exitCode: 1, stderr });

      expect(
        fromStream.constructor.name,
        `${slug}: stream-path produced ${fromStream.constructor.name} but exit-path produced ${fromExit.constructor.name}`,
      ).toBe(fromExit.constructor.name);
    }
  });
});
