---
phase: 05-error-taxonomy-archon-5-bucket-mapping
verified: 2026-04-15T08:40:00Z
status: passed
score: 4/4 success criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "SC-2 / ERR-06: stream ending without terminal result now always raises ProcessError regardless of exit code (including exit 0) — exitCode !== 0 guard removed from both TS and Python query implementations; four new unit tests lock both branches"
  gaps_remaining: []
  regressions: []
---

# Phase 5: Error Taxonomy + Archon 5-Bucket Mapping — Verification Report

**Phase Goal:** Define the typed `GeminiError` hierarchy generated from a single YAML source consumed by both languages, build the `ErrorMapper` that pattern-matches `(exit code, stderr tail, last events)` into typed errors, wire both the exit-code and stream-json error-event paths, and map 1:1 to Archon's 5 retry buckets.

**Verified:** 2026-04-15T08:40:00Z
**Status:** PASSED
**Re-verification:** Yes — after SC-2 / ERR-06 gap closure (Plan 05-05)

---

## Goal Achievement

### Observable Truths (Phase 5 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Contract test runs every stderr fixture through both TS + Python ErrorMapper and asserts same typed class, same `.retryable`, same `.retryAfterMs`, same Archon bucket | VERIFIED | `errorMapper.spec.ts` (12 tests pass), `errorMapperCorpus.spec.ts` (4 corpus tests pass), `test_error_mapper.py` (12 pass), `test_error_mapper_corpus.py` (3 pass); `diff-test-names.sh` 109:109 |
| SC-2 | Stream ending without terminal `result` event always raises `ProcessError` — **even on exit code 0** — verified by a fixture | VERIFIED | `query.ts` line 164: `if (!sawResult && !aborted)` with no inner exit-code guard; `query.py` line 179: `if not saw_result and not cancelled:` with no inner exit-code guard. Both call `ErrorMapper.fromExit/from_exit` unconditionally. `exitCode !== 0` guard confirmed absent (grep returns no matches). Two TS tests + two Python tests cover exit-0 and exit-nonzero paths. |
| SC-3 | `scripts/lint-errors.sh` runs in CI, fails merge if any class in `spec/errors.yaml` is missing from either TS or Python implementations (or vice versa) | VERIFIED | `scripts/lint-errors.sh` exists (65 lines), uses `comm -3` set equality; wired into `.github/workflows/ci.yml` parity job; `bash scripts/lint-errors.sh` exits 0 live ("15 classes in sync across YAML, TS, Python") |
| SC-4 | A stream-json `{"type":"error"}` event and an exit-code+stderr match for the same underlying failure both produce the identical typed error instance | VERIFIED | `run_stream_and_exit_path_produce_same_class_for_rate_limit` and `run_stream_and_exit_path_produce_same_class_for_auth` tests pass in both languages; corpus parity test `run_corpus_both_paths_agree_on_class` passes |

**Score:** 4/4 success criteria verified

---

### Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `spec/errors.yaml` | VERIFIED | Exists, 15 class entries, 5-bucket enum, single source of truth for both codegen scripts |
| `scripts/gen-errors.mjs` | VERIFIED | Exists, reads YAML, emits `ts/src/errors/errors.ts` with AUTO-GENERATED header |
| `scripts/gen-errors.py` | VERIFIED | Exists, reads YAML, emits `python/src/gemini_sdk/errors/errors.py` with AUTO-GENERATED header |
| `ts/src/errors/errors.ts` | VERIFIED | 15 `export class` declarations, starts with `// AUTO-GENERATED`, all hierarchy correct, `ArchonBucket` type declared |
| `python/src/gemini_sdk/errors/errors.py` | VERIFIED | 15 `class` declarations, starts with `# AUTO-GENERATED`, `ArchonBucket = Literal[...]` declared, correct hierarchy |
| `ts/src/errors/ErrorMapper.ts` | VERIFIED | 106 lines, `class ErrorMapper` with `static fromStreamEvent` and `static fromExit`; catch-all returns `ProcessError` (bucket=crash) — ERR-06 conformant |
| `python/src/gemini_sdk/errors/error_mapper.py` | VERIFIED | 135 lines, `class ErrorMapper` with `from_stream_event` and `from_exit` static methods; catch-all returns `ProcessError` (bucket=crash) — ERR-06 conformant |
| `ts/src/query/query.ts` | VERIFIED | ERR-06 block at line 164 is unconditional: `if (!sawResult && !aborted)` with no inner exit-code guard; `grep -n 'exitCode !== 0' query.ts` returns no matches |
| `python/src/gemini_sdk/query/query.py` | VERIFIED | ERR-06 block at line 179 is unconditional: `if not saw_result and not cancelled:` with no inner exit-code guard; `grep -n 'exit_code != 0' query.py` returns no matches |
| `ts/src/process/ProcessManager.ts` | VERIFIED | `getStderrTail()` method present, 8 KiB ring buffer attached synchronously at spawn |
| `python/src/gemini_sdk/process/process_manager.py` | VERIFIED | `_StderrRing` class + `get_stderr_tail` accessor on `SpawnResult` |
| `scripts/lint-errors.sh` | VERIFIED | 65 lines, uses `comm -3`, wired to CI; exits 0 live |
| `ts/src/errors/errors.spec.ts` | VERIFIED | 8 `run_*` tests covering ERR-01/02/03, all pass |
| `ts/src/errors/errorMapper.spec.ts` | VERIFIED | 12 `run_*` tests covering ERR-04/05; bucket assertion for catch-all updated to `'crash'` per SC-2 fix |
| `ts/src/errors/errorMapperCorpus.spec.ts` | VERIFIED | 4 static corpus tests iterating error-* fixture glob |
| `ts/src/query/query.spec.ts` | VERIFIED | 15 tests total; two new ERR-06 tests ("throws ProcessError when stream ends without result on exit 0", "throws ProcessError when stream ends without result on non-zero exit") both pass |
| `python/tests/errors/test_errors.py` | VERIFIED | 8 `test_run_*` tests, all pass |
| `python/tests/errors/test_error_mapper.py` | VERIFIED | 12 `test_run_*` tests; bucket assertion for catch-all updated to `'crash'` per SC-2 fix |
| `python/tests/errors/test_error_mapper_corpus.py` | VERIFIED | 3 corpus tests (parametrize-based), all pass |
| `python/tests/test_query.py` | VERIFIED | 30 tests total; two new parity ERR-06 tests with docstrings matching TS it() strings byte-for-byte |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|---------|
| `ts/src/parser/dispatch.ts` | `ErrorMapper.fromStreamEvent` | throw on `{type:'error'}` events | WIRED | `grep ErrorMapper dispatch.ts` shows import + `throw ErrorMapper.fromStreamEvent(event)` at error-event path |
| `ts/src/query/query.ts` | `ErrorMapper.fromExit` | unconditional call when `!sawResult && !aborted` after stream end | WIRED | Line 164-167: guard is `!sawResult && !aborted` with no inner exit-code condition; `ErrorMapper.fromExit({exitCode, stderr: tail})` called unconditionally. SC-2 gap CLOSED. |
| `python/src/gemini_sdk/parser/dispatch.py` | `ErrorMapper.from_stream_event` | raise on error events | WIRED | `raise ErrorMapper.from_stream_event(event)` confirmed at error-event dispatch path |
| `python/src/gemini_sdk/query/query.py` | `ErrorMapper.from_exit` | unconditional raise when `not saw_result and not cancelled` after stream end | WIRED | Lines 179-183: guard is `not saw_result and not cancelled` with no inner exit-code condition; `raise ErrorMapper.from_exit(exit_code=code, stderr=tail)` unconditional. SC-2 gap CLOSED. |
| `ts/src/errors/index.ts` | `ts/src/errors/errors.ts` | `export * from './errors.js'` | WIRED | Barrel confirmed |
| `python/src/gemini_sdk/errors/__init__.py` | `python/src/gemini_sdk/errors/errors.py` | `from .errors import (...)` | WIRED | Barrel confirmed, all 15 classes exported |
| `.github/workflows/ci.yml` | `scripts/lint-errors.sh` | parity job step | WIRED | "Lint error taxonomy (ERR-07 + PAR-05)" step confirmed |

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|---------|
| ERR-01 | Typed error hierarchy: `GeminiError` base + 10 subclasses (4 `AuthError` subtypes) | SATISFIED | 15 classes generated from YAML; correct inheritance in both languages |
| ERR-02 | Every error carries `.retryable: boolean` and optional `.retryAfterMs?: number` | SATISFIED | All generated classes have `retryable` and `retryAfterMs`/`retry_after_ms` |
| ERR-03 | Error classes map 1:1 to Archon's 5 retry buckets | SATISFIED | `ArchonBucket = 'rate_limit' | 'auth' | 'model_access' | 'crash' | 'unknown'` in both languages; all 15 classes have correct bucket assignments |
| ERR-04 | `ErrorMapper` pattern-matches `(exit code, stderr tail, last events)` into typed errors | SATISFIED | `fromStreamEvent` + `fromExit` both implemented and tested |
| ERR-05 | Stream-json `error` events and exit-code+stderr matching produce the same typed errors | SATISFIED | Two-path parity tests pass in both languages; corpus tests confirm |
| ERR-06 | SDK raises `ProcessError` if stream ends without terminal `result` event, even on exit code 0 | SATISFIED | `exitCode !== 0` guard removed from `query.ts`; `exit_code != 0` guard removed from `query.py`; `ErrorMapper.fromExit/from_exit` catch-all now returns `ProcessError` (bucket=crash); four new unit tests verify both exit-0 and exit-nonzero paths |
| ERR-07 | CI linter cross-checks `spec/errors.md` against both TS and Python implementations | SATISFIED | `scripts/lint-errors.sh` wired into parity CI job; exits 0 live ("15 classes in sync") |
| PAR-05 | Error taxonomy generated from one YAML source consumed by both SDKs | SATISFIED | `spec/errors.yaml` is single source; both codegen scripts consume it; lint-errors.sh enforces no drift; `diff-test-names.sh` 109:109 |

---

### Anti-Patterns Found

None. The `exitCode !== 0` / `exit_code != 0` guards that were flagged in the initial verification have been removed. No new anti-patterns introduced.

Previous warnings from initial verification:

| File | Pattern | Severity | Resolution |
|------|---------|----------|------------|
| `ts/src/query/query.ts` (was line 162) | ERR-06 guard `exitCode !== 0` contradicting SC-2 | WARNING | RESOLVED — guard removed in Plan 05-05 |
| `python/src/gemini_sdk/query/query.py` (was line 177) | Same selective guard | WARNING | RESOLVED — guard removed in Plan 05-05 |

---

### Human Verification Required

None — all automated checks complete and the gap closure is confirmed by:
1. Direct code inspection (guards absent, confirmed via grep)
2. Live test runs (123 TS tests pass, 181 Python tests pass)
3. Parity verification (diff-test-names.sh at 109:109)
4. Linter clean (lint-errors.sh exits 0)

---

## Re-Verification Summary

**Gap from initial verification:** SC-2 / ERR-06 — both `query.ts` and `query.py` gated the ProcessError raise on `exitCode !== 0`, treating exit-code-0 partial streams as benign.

**Resolution via Plan 05-05:**
- `ts/src/query/query.ts`: Inner `if (exitCode !== 0)` guard deleted; ERR-06 block now fires unconditionally on `!sawResult && !aborted`
- `python/src/gemini_sdk/query/query.py`: Inner `if exit_code is not None and exit_code != 0:` guard deleted; ERR-06 block fires unconditionally on `not saw_result and not cancelled`
- `ts/src/errors/ErrorMapper.ts`: Catch-all changed from `new GeminiError(...)` to `new ProcessError(...)` (bucket=crash) — ensures exit-0 with empty stderr correctly returns `ProcessError`
- `python/src/gemini_sdk/errors/error_mapper.py`: Matching change — catch-all returns `ProcessError` (bucket=crash)
- Four new unit tests added (2 TS + 2 Python) locking both exit-0 and exit-nonzero ERR-06 paths with identical test names for diff-test-names.sh parity

**All previously VERIFIED items remain intact** — no regressions detected across the full test suites.

**Final test counts:** 123 TS tests (11 files), 181 Python tests — all passing.

---

*Verified: 2026-04-15T08:40:00Z*
*Verifier: Claude (gsd-verifier)*
*Re-verification: Yes — SC-2/ERR-06 gap closure after Plan 05-05*
