---
phase: 05-error-taxonomy-archon-5-bucket-mapping
plan: 04
subsystem: errors
tags: [errors, ci, linter, corpus-tests, parity, drift-prevention]
requires:
  - 05-03 (ErrorMapper + dispatch integration)
  - 05-02 (YAML SoT + codegen)
  - 05-01 (RED scaffolds + fixture re-targeting)
provides:
  - scripts/lint-errors.sh (ERR-07 + PAR-05 CI drift guard; 15-class cross-check)
  - .github/workflows/ci.yml (parity job extended with lint-errors.sh step)
  - ts/src/errors/errorMapperCorpus.spec.ts (fixture-corpus contract: 3 run_corpus_* tests)
  - python/tests/errors/test_error_mapper_corpus.py (Python parity: 3 test_run_corpus_* tests)
  - spec/errors.md (updated: Phase 5 state; §3 patterns; §4 YAML stderr_patterns; §5 gaps resolved; §6 handoff marked complete)
affects:
  - .github/workflows/ci.yml (parity job: new lint-errors.sh step added)
tech-stack:
  added: []
  patterns:
    - Glob-driven corpus loop with static it()/def test_ names for parity compatibility
    - lint-errors.sh uses comm -3 for set-equality (BSD grep -E compat; no -P)
    - CI lint step added as sibling to diff-test-names.sh within existing parity job
key-files:
  created:
    - scripts/lint-errors.sh
    - ts/src/errors/errorMapperCorpus.spec.ts
    - python/tests/errors/test_error_mapper_corpus.py
  modified:
    - .github/workflows/ci.yml (parity job extended)
    - spec/errors.md (full Phase 5 update)
decisions:
  - "Corpus test placed at ts/src/errors/errorMapperCorpus.spec.ts (not ts/tests/) — vitest.config.ts include pattern is src/**/*.{test,spec}.ts; project convention colocates tests with source (Rule 3 deviation)"
  - "Static it('run_corpus_...') names used (not template literals) — diff-test-names.sh grep -oE pattern requires single/double-quoted strings; template literals are not captured by parity extractor"
  - "ErrorMapper.fromExit called with keyword-args shape { exitCode, stderr } — actual implementation uses named params (not positional); plan template adapted to real API"
  - "lint-errors.sh uses comm -3 for set-equality comparison across YAML/TS/Python class names — BSD grep -E only as per STATE.md Phase 02-04 decision"
  - "GeminiError subclasses are the sole vocabulary for Phases 6-10 error handling — import from ts/src/errors/index.ts or python/src/gemini_sdk/errors/__init__.py"
metrics:
  duration_minutes: 4
  completed_date: 2026-04-15
  tasks: 2
  files_created: 3
  files_modified: 2
---

# Phase 5 Plan 04: CI Linter + Fixture-Corpus Contract Tests Summary

CI linter script enforces YAML/TS/Python class-set equality and regeneration drift; fixture-corpus contract tests iterate all error-* fixtures to prove ERR-04 + ERR-05 at scale; spec/errors.md finalized to reflect real Phase 5 state.

**One-liner:** scripts/lint-errors.sh guards 15-class taxonomy drift in CI parity job; fixture-corpus tests (3+3 run_corpus_* in TS/Python) prove both ErrorMapper paths classify every error-* fixture correctly; 107:107 parity preserved, 121 TS + 177 Python tests pass.

## CI Linter Details

**`scripts/lint-errors.sh` capability:**
1. Re-runs `node scripts/gen-errors.mjs` + `python scripts/gen-errors.py`
2. `git diff --exit-code` against committed `ts/src/errors/errors.ts` + `python/src/gemini_sdk/errors/errors.py` — fails if regeneration produces any change
3. Extracts class names from YAML (`grep -E '^\s*-\s*name:'`), TS (`grep -oE '^export class ...'`), Python (`grep -oE '^class ...'`)
4. `comm -3` set-equality check: YAML names == TS exports == Python classes; fails with diff on mismatch

**Classes enforced by the linter:** 15 (GeminiError, RateLimitError, AuthError, NotConfigured, Forbidden403, Expired, ToSViolation, ModelAccessError, InvalidPromptError, ProcessError, ProcessCrashError, AbortError, ParseError, UnsupportedFeatureError, GeminiNotFoundError)

**Parity job location in `.github/workflows/ci.yml`:** The new step follows the existing "Check test name parity" step at line ~94 of the parity job.

## Fixture-Corpus Contract Tests

**Total corpus test cases generated:** 2 error-* fixtures x 3 path checks = 6 corpus assertions (across TS and Python). Each language has 3 static test functions:
- `run_corpus_fromStreamEvent_matches_expected_type` — validates stream-json path per fixture
- `run_corpus_fromExit_matches_expected_type` — validates exit-code+stderr path per fixture
- `run_corpus_both_paths_agree_on_class` — validates ERR-05 two-path parity per fixture

**Auto-extension:** Adding a new `spec/fixtures/error-*.ndjson` + `.stderr.txt` + `.expected.json` triple automatically adds new assertions on the next test run — no code changes required.

**Current fixtures covered:**
- `error-auth` (AuthError, stream path + exit path)
- `error-rate-limit` (RateLimitError, stream path + exit path)

## Deferred Items from spec/errors.md §5

The following gaps remain open after Phase 5 completion:

- **Real auth / rate-limit stderr format:** deferred to `follow-up-auth-isolation-hardening` + `follow-up-quota-capped-key`
- **`Retry-After` field name in 429 response:** field name unconfirmed; `ErrorMapper` skips dynamic extraction; deferred to `follow-up-quota-capped-key`
- **Model deprecation errors:** `ModelAccessError` class in taxonomy; real stderr patterns not validated; deferred to future phase
- **Content policy / `InvalidPromptError`:** class in taxonomy; real pattern not validated; deferred to future phase
- **`UnsupportedFeatureError`:** class in taxonomy; trigger not validated; deferred to future phase

## GeminiError Subclass Vocabulary

`GeminiError` subclasses are the SOLE vocabulary Phases 6–10 should import for error handling:

- **TypeScript:** `import { GeminiError, RateLimitError, AuthError, ... } from 'ts/src/errors/index.ts'`
- **Python:** `from gemini_sdk.errors import GeminiError, RateLimitError, AuthError, ...`
- **Archon buckets:** `err.bucket` returns one of `rate_limit | auth | model_access | crash | unknown`
- **Retry:** `err.retryable` is `true` only for `RateLimitError`

## Deviations from Plan

### Rule 3 — TS corpus test placed at ts/src/errors/ (not ts/tests/)

**Plan said:** `ts/tests/errorMapperCorpus.test.ts`
**Did instead:** `ts/src/errors/errorMapperCorpus.spec.ts`
**Reason:** `ts/vitest.config.ts` has `include: ['src/**/*.{test,spec}.ts']`. A file at `ts/tests/` would not be discovered by vitest. Project convention across all modules colocates tests with source (`BinaryResolver.spec.ts`, `dispatch.spec.ts`, etc.). Identical deviation was documented in 05-01-SUMMARY.md.

### Rule 1 — Static test names (not template literal parametrize)

**Plan said:** `it(\`run_corpus_${slug}_fromStreamEvent_matches_expected_type\`)`  (template literal)
**Did instead:** `it('run_corpus_fromStreamEvent_matches_expected_type', ...)` with internal slug loop
**Reason:** `scripts/diff-test-names.sh` uses `grep -oE "(test|it)\(['\"][^'\"]+['\"]"` which matches only single/double-quoted strings. Template literals (backtick strings) are invisible to the parity extractor. Static names preserve 107:107 parity while the internal loop still iterates all slugs automatically.

### Rule 1 — ErrorMapper.fromExit called with keyword args

**Plan said:** `ErrorMapper.fromExit(1, stderr, [])` (positional args)
**Did instead:** `ErrorMapper.fromExit({ exitCode: 1, stderr })` (keyword-args shape)
**Reason:** The actual `ts/src/errors/ErrorMapper.ts` implementation (from plan 05-03) uses `options: { exitCode, stderr, lastEvents }` not positional args. The plan template was aspirational; actual API used.

## Tasks Executed

### Task 1 — scripts/lint-errors.sh + CI wiring + spec/errors.md

Commit: `9af1c26`

- `scripts/lint-errors.sh`: 46-line ERR-07+PAR-05 drift guard; grep -E only; BSD compat; 15 classes verified
- `.github/workflows/ci.yml`: `Lint error taxonomy (ERR-07 + PAR-05)` step added to parity job
- `spec/errors.md`: §3 updated with Phase 5 re-capture outcome; §4 documents YAML stderr_patterns; §5 gaps resolved (retryAfter deferred); §6 marks Phase 5 complete
- `bash scripts/lint-errors.sh` exits 0

### Task 2 — Fixture-corpus contract tests (TS + Python)

Commit: `d24653a`

- `ts/src/errors/errorMapperCorpus.spec.ts`: 3 corpus tests (4 `it('run_corpus_...')` including glob-driven describe); iterates error-auth + error-rate-limit
- `python/tests/errors/test_error_mapper_corpus.py`: 3 Python corpus tests with matching docstrings; glob-driven via `FIXTURES.glob("error-*.ndjson")`
- 107:107 TS/Python parity preserved
- 121 TS + 177 Python tests pass

## Verification

- [x] `bash scripts/lint-errors.sh` exits 0 — 15 classes in sync across YAML, TS, Python
- [x] `cd ts && pnpm test -- --run` — 121 tests pass (full suite green including corpus)
- [x] `cd python && uv run pytest` — 177 tests pass (full suite green including corpus)
- [x] `bash scripts/diff-test-names.sh` — 107:107 TS/Python parity preserved
- [x] `.github/workflows/ci.yml` parity job invokes `bash scripts/lint-errors.sh`
- [x] `spec/errors.md` Phase 5 complete; §6 handoff marked with plan citations
- [x] New `error-*.ndjson` triple would be auto-covered by glob-driven corpus loops

## Self-Check: PASSED

- [x] `scripts/lint-errors.sh` exists (FOUND)
- [x] `ts/src/errors/errorMapperCorpus.spec.ts` exists (FOUND)
- [x] `python/tests/errors/test_error_mapper_corpus.py` exists (FOUND)
- [x] `grep -E "Lint error taxonomy" .github/workflows/ci.yml` — match (FOUND)
- [x] `grep -E "Phase 5 complete" spec/errors.md` — match (FOUND)
- [x] Commit `9af1c26` in git log (FOUND)
- [x] Commit `d24653a` in git log (FOUND)
