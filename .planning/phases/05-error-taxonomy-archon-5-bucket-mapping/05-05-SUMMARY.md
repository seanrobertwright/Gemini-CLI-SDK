---
phase: 05-error-taxonomy-archon-5-bucket-mapping
plan: "05"
subsystem: error-handling
tags: [error-taxonomy, ProcessError, ERR-06, SC-2, query, test-parity]

# Dependency graph
requires:
  - phase: 05-error-taxonomy-archon-5-bucket-mapping
    provides: "Plans 05-01..05-04: ErrorMapper, dispatch, linter, corpus tests (all VERIFIED)"
provides:
  - "SC-2 gap closed: query() throws ProcessError even on exit 0 when stream has no terminal result event"
  - "Four new unit tests (2 TS + 2 Python) locking exit-0 and exit-nonzero ERR-06 paths"
  - "ErrorMapper.fromExit/from_exit catch-all now returns ProcessError (bucket=crash) not GeminiError"
  - "diff-test-names.sh parity maintained at 109:109"
affects: [phases-06-10, archon-adapter, error-retry-logic]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ERR-06 unconditional throw: !sawResult && !aborted fires regardless of exit code in both languages"
    - "ErrorMapper catch-all returns ProcessError (bucket=crash) for no-pattern-match case"
    - "TDD parity: TS it() string == Python docstring first line for diff-test-names.sh enforcement"

key-files:
  created: []
  modified:
    - "ts/src/query/query.ts — ERR-06 block: removed exitCode !== 0 inner guard, unconditional throw"
    - "ts/src/query/query.spec.ts — two new ERR-06 tests (exit-0 + exit-nonzero); updated abort-mid-tool test"
    - "ts/src/errors/ErrorMapper.ts — catch-all changed from GeminiError to ProcessError; added ProcessError import"
    - "ts/src/errors/errorMapper.spec.ts — bucket assertion updated from 'unknown' to 'crash'"
    - "python/src/gemini_sdk/query/query.py — ERR-06 block: removed exit_code != 0 inner guard, unconditional raise"
    - "python/tests/test_query.py — two new parity ERR-06 tests; updated abort-mid-tool test"
    - "python/src/gemini_sdk/errors/error_mapper.py — catch-all changed from GeminiError to ProcessError; added ProcessError import"
    - "python/tests/errors/test_error_mapper.py — bucket assertion updated from 'unknown' to 'crash'"

key-decisions:
  - "SC-2 intent is authoritative: exit-0 streams without a terminal result event must raise ProcessError — the 05-03 decision to treat them as benign was deliberate drift now reversed"
  - "ErrorMapper.fromExit/from_exit catch-all changed from GeminiError to ProcessError: the generic no-pattern-match case is always a crash-bucket error (stream ended without result), not unknown"
  - "Auto-fixed: abort-mid-tool tests in both languages updated to expect ProcessError after incomplete chunk flush — this is correct per SC-2; the incomplete chunk is still yielded first"
  - "Auto-fixed: errorMapper spec bucket assertions updated from 'unknown' to 'crash' for parity with new catch-all behavior"

patterns-established:
  - "ERR-06 unconditional: query() and query() always raise on !sawResult && !aborted; no exit-code exemptions"
  - "ProcessError is the canonical catch-all for fromExit: any process exit without a recognized error pattern is crash, not unknown"

requirements-completed: [ERR-06]

# Metrics
duration: 25min
completed: 2026-04-15
---

# Phase 05 Plan 05: SC-2 / ERR-06 Gap Closure Summary

**Closed the SC-2 conformance gap: query() now unconditionally throws ProcessError via ErrorMapper.fromExit when a stream ends without a terminal result event, regardless of exit code (including exit 0), in both TS and Python.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-15T08:28:00Z
- **Completed:** 2026-04-15T08:33:00Z
- **Tasks:** 3 (2 with code changes + 1 verification-only)
- **Files modified:** 8

## Accomplishments

- Removed `exitCode !== 0` / `exit_code != 0` inner guard from ERR-06 block in both `query.ts` and `query.py`; the unconditional throw/raise now fires on exit 0 as well as non-zero exit
- Fixed `ErrorMapper.fromExit` / `ErrorMapper.from_exit` catch-all to return `ProcessError` (bucket=crash) instead of `GeminiError` (bucket=unknown), making the generic no-result-event case correctly classified
- Added four new unit tests (2 TS + 2 Python) locking the exit-0 and exit-nonzero ERR-06 paths with identical test names for diff-test-names.sh parity (109:109)
- Full TS suite (123 tests), full Python suite (181 tests), diff-test-names.sh, and lint-errors.sh all green

## Task Commits

1. **Task 1: Remove exit-code guard in TS query + add ERR-06 unit tests** - `1510683` (feat)
2. **Task 2: Remove exit-code guard in Python query + add parity tests** - `214c06b` (feat)
3. **Task 3: Full phase verification** - verification-only, no commit needed

## Files Created/Modified

- `ts/src/query/query.ts` — ERR-06 block simplified: removed inner `if (exitCode !== 0)` guard; `exitCode ?? 0` coercion added
- `ts/src/query/query.spec.ts` — Two new ERR-06 tests; abort-mid-tool test updated to expect ProcessError after incomplete flush
- `ts/src/errors/ErrorMapper.ts` — Added `ProcessError` import; catch-all `return new GeminiError(...)` changed to `return new ProcessError(...)`
- `ts/src/errors/errorMapper.spec.ts` — Bucket assertion updated: `'unknown'` → `'crash'` for unmatched-stderr test
- `python/src/gemini_sdk/query/query.py` — ERR-06 block simplified: removed inner `if exit_code != 0:` guard; `code = exit_code if exit_code is not None else 0` coercion added
- `python/tests/test_query.py` — Two new parity ERR-06 tests with docstrings matching TS it() strings byte-for-byte; abort-mid-tool test updated
- `python/src/gemini_sdk/errors/error_mapper.py` — Added `ProcessError` import; catch-all `return GeminiError(...)` changed to `return ProcessError(...)`
- `python/tests/errors/test_error_mapper.py` — Bucket assertion updated: `'unknown'` → `'crash'` for unmatched-stderr test

## Decisions Made

- The 05-03 decision "zero-exit partial streams are benign" was deliberate drift from ROADMAP SC-2. Spec intent is authoritative; reversed.
- `ErrorMapper.fromExit` catch-all returns `ProcessError` (not `GeminiError`) because any unrecognized process exit in the ERR-06 path is a crash event, not an unknown generic error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ErrorMapper.fromExit catch-all returned GeminiError instead of ProcessError**
- **Found during:** Task 1 (running TS tests after removing exit-code guard)
- **Issue:** Tests asserting `instanceof ProcessError` failed because `ErrorMapper.fromExit` returned bare `GeminiError` for exit code 0 with empty stderr. The plan comment said "ProcessError for the generic no-result case" but the implementation did not match.
- **Fix:** Changed `return new GeminiError(...)` → `return new ProcessError(...)` in both `ErrorMapper.ts` and `error_mapper.py`; added `ProcessError` import in both files
- **Files modified:** `ts/src/errors/ErrorMapper.ts`, `python/src/gemini_sdk/errors/error_mapper.py`
- **Verification:** All 123 TS + 181 Python tests pass
- **Committed in:** `1510683` (Task 1), `214c06b` (Task 2)

**2. [Rule 1 - Bug] Pre-existing errorMapper spec tests asserted bucket='unknown' for catch-all**
- **Found during:** Task 1 (after fixing ErrorMapper catch-all)
- **Issue:** `errorMapper.spec.ts` and `test_error_mapper.py` both asserted `bucket == 'unknown'` for unmatched-stderr exits, which was correct before the fix but incorrect after
- **Fix:** Updated assertions to `bucket == 'crash'` with explanatory comments in both spec files
- **Files modified:** `ts/src/errors/errorMapper.spec.ts`, `python/tests/errors/test_error_mapper.py`
- **Verification:** Tests updated; full suites green
- **Committed in:** `1510683`, `214c06b`

**3. [Rule 1 - Bug] abort-mid-tool tests failed after SC-2 behavioral change**
- **Found during:** Task 1 (full TS suite run)
- **Issue:** The "abort mid-tool flushes incomplete tool chunk" tests in both languages used streams with no result event (`[INIT_LINE, TOOL_USE_LINE]`). After removing the exit-code guard, these streams now trigger ERR-06 and raise ProcessError. The tests called `collectChunks()` which throws when the generator throws, causing the tests to fail.
- **Fix:** Updated both tests to iterate manually with try/catch, assert the incomplete tool chunk was yielded, AND assert that ProcessError was raised — which is the correct SC-2 behavior
- **Files modified:** `ts/src/query/query.spec.ts`, `python/tests/test_query.py`
- **Verification:** All tests pass; behavior is correct per spec
- **Committed in:** `1510683`, `214c06b`

---

**Total deviations:** 3 auto-fixed (3 × Rule 1 — bugs/spec-mismatches triggered by the correct spec conformance change)
**Impact on plan:** All auto-fixes were necessary consequences of fixing ERR-06 correctly. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SC-2 gap from `05-VERIFICATION.md` is now closed; re-running `/gsd:verify-work` should flip ERR-06 from FAILED to VERIFIED
- Plans 05-01..05-05 all VERIFIED; Phase 5 is complete
- Phase 6 can proceed with full confidence in error taxonomy and query() SC-conformance
- No blockers from Phase 5

---
*Phase: 05-error-taxonomy-archon-5-bucket-mapping*
*Completed: 2026-04-15*
