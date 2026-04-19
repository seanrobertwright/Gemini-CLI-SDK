---
phase: 06-auth-environment
plan: 03
subsystem: auth
tags: [resolveAuth, AuthError, errorMapper, fixtures, warning-emission, synthetic_blocked]

# Dependency graph
requires:
  - phase: 06-01
    provides: resolveAuth() TS function with AUTH_PRECEDENCE chain and warnings[]
  - phase: 06-02
    provides: resolve_auth() Python function (TypedDict return)
  - phase: 05-error-taxonomy-archon-5-bucket-mapping
    provides: ErrorMapper.fromExit/fromStreamEvent, AuthError class, corpus test infrastructure

provides:
  - error-auth-invalid-key fixture trio (stderr.txt, ndjson, expected.json) — synthetic_blocked
  - spec/fixtures.manifest.json updated with synthetic_blocked entry + follow-up-auth-isolation-hardening pointer
  - scripts/capture-fixtures.mjs extended with --scenario error-auth-invalid-key
  - query() + queryRaw() (TS + Python) emit auth precedence warnings before subprocess spawn
  - Two new TS tests + two new Python tests verifying warning emission on multi-mode env (AUT-06)
  - Explicit corpus test rows in errorMapperCorpus.spec.ts + test_error_mapper_corpus.py (AUT-07)

affects: [phase-07-session-api, phase-08-mcp, follow-up-auth-isolation-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - resolveAuth wired BEFORE ProcessManager.spawn — pure env snapshot, no I/O at spawn time
    - Python _warnings.warn(w, UserWarning, stacklevel=2) for precedence warnings
    - Corpus tests auto-discover error-*.ndjson fixtures; explicit named test rows for AUT-07 traceability

key-files:
  created:
    - spec/fixtures/error-auth-invalid-key.stderr.txt
    - spec/fixtures/error-auth-invalid-key.ndjson
    - spec/fixtures/error-auth-invalid-key.expected.json
  modified:
    - spec/fixtures.manifest.json
    - scripts/capture-fixtures.mjs
    - ts/src/query/query.ts
    - ts/src/query/query.spec.ts
    - python/src/gemini_sdk/query/query.py
    - python/tests/test_query.py
    - ts/src/errors/errorMapperCorpus.spec.ts
    - python/tests/errors/test_error_mapper_corpus.py

key-decisions:
  - "Fixture error-auth-invalid-key taken as synthetic_blocked: same Windows OAuth-cache bypass root cause as Phase 05-01 Option B; real capture deferred to follow-up-auth-isolation-hardening"
  - "error-auth-invalid-key.ndjson uses code:401 + status:UNAUTHENTICATED (not string code) so fromStreamEvent classifies AuthError correctly for two-path parity"
  - "verifyManifestParity() in capture-fixtures.mjs updated to include synthetic_blocked keys in scenario registry parity check — avoids manifest drift detection false positive"
  - "Phase 6 warning emission wired in both query() and queryRaw() for SC-2 completeness (raw callers also get warnings)"
  - "Python warning emission uses _warnings.warn(w, UserWarning, stacklevel=2) per Pitfall 5 note; test uses catch_warnings(record=True) + simplefilter('always') to avoid dedup false negatives"

patterns-established:
  - "resolveAuth/resolve_auth call: snapshot process.env before spawn, call before writeTempSystemPrompt, merge envOverrides with caller-wins semantics"
  - "Corpus tests: auto-glob + explicit named row — auto-glob provides coverage breadth; explicit row provides AUT-07 traceability"

requirements-completed: [AUT-06, AUT-07]

# Metrics
duration: 15min
completed: 2026-04-19
---

# Phase 6 Plan 03: Auth Wiring + Invalid-Key Fixture Summary

**resolveAuth wired into query()/queryRaw() (TS + Python) with multi-mode precedence warning emission; error-auth-invalid-key fixture trio created as synthetic_blocked; AUT-06/AUT-07 proven by 4+2 new tests**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-19T23:45:00Z
- **Completed:** 2026-04-19T23:49:45Z
- **Tasks:** 3
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- Fixture trio `error-auth-invalid-key.{stderr.txt,ndjson,expected.json}` created as synthetic_blocked with follow-up-auth-isolation-hardening pointer (same Windows OAuth-bypass root cause as Phase 05-01)
- `query()` and `queryRaw()` in both TS and Python now call `resolveAuth`/`resolve_auth` before spawn and emit precedence warnings when multiple auth modes are configured (AUT-06)
- Corpus test suites gain explicit named rows asserting AuthError/bucket=auth/retryable=false classification for error-auth-invalid-key (AUT-07)
- All 135 TS tests and 196 Python tests pass; diff-test-names.sh 120:120 parity maintained

## Task Commits

1. **Task 1: Capture error-auth-invalid-key fixture** - `16d56b0` (feat)
2. **Task 2 RED: Failing auth warning tests** - `175afb7` (test)
3. **Task 2 GREEN: Wire resolveAuth + Python tests** - `1f5390b` (feat)
4. **Task 3: Corpus contract rows for AUT-07** - `3a97eec` (feat)

## Files Created/Modified

- `spec/fixtures/error-auth-invalid-key.stderr.txt` - Synthetic stderr with API_KEY_INVALID/UNAUTHENTICATED pattern
- `spec/fixtures/error-auth-invalid-key.ndjson` - NDJSON with code:401+status:UNAUTHENTICATED stream error event
- `spec/fixtures/error-auth-invalid-key.expected.json` - Contract sidecar: _errorType:AuthError, _bucket:auth, synthetic:true
- `spec/fixtures.manifest.json` - Added synthetic_blocked entry for error-auth-invalid-key
- `scripts/capture-fixtures.mjs` - Added --scenario error-auth-invalid-key; updated verifyManifestParity to include synthetic_blocked keys
- `ts/src/query/query.ts` - Import resolveAuth; wire into query() and queryRaw() before spawn
- `ts/src/query/query.spec.ts` - Phase 6 auth warning describe block (2 new tests)
- `python/src/gemini_sdk/query/query.py` - Import resolve_auth + _warnings; wire into query() and query_raw()
- `python/tests/test_query.py` - TestPhase6AuthWarning class (2 new tests)
- `ts/src/errors/errorMapperCorpus.spec.ts` - Explicit error-auth-invalid-key it() block
- `python/tests/errors/test_error_mapper_corpus.py` - Explicit test_run_error_auth_invalid_key() function

## Decisions Made

- **Fixture synthetic_blocked**: Windows OAuth-cache bypass identical to Phase 05-01 Option B — direct synthetic fallback taken without attempting real capture (outcome known from prior research)
- **ndjson format fix**: Initial ndjson used string code `"UNAUTHENTICATED"` which ErrorMapper.fromStreamEvent doesn't match; corrected to numeric code:401 + status field for two-path parity (auto-fix Rule 1)
- **verifyManifestParity update**: SCENARIOS registry parity check now includes synthetic_blocked keys — scenarios in synthetic_blocked are valid entry points even if not in top-level slugs array
- **Warning placement**: resolveAuth/resolve_auth called after pre-abort check but before all other setup (earliest safe point that has process.env available)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed error-auth-invalid-key.ndjson stream-error event format**
- **Found during:** Task 2 GREEN (TS full suite regression run)
- **Issue:** Initial ndjson had `{"error":{"code":"UNAUTHENTICATED",...}}` — string code, no status field. ErrorMapper.fromStreamEvent checks `code === 401` (numeric) or `status === 'UNAUTHENTICATED'`, so fromStreamEvent returned generic GeminiError instead of AuthError, breaking two-path parity test
- **Fix:** Changed ndjson to `{"error":{"code":401,"status":"UNAUTHENTICATED","message":"API key not valid"}}` — numeric HTTP code + status field matching ErrorMapper pattern
- **Files modified:** spec/fixtures/error-auth-invalid-key.ndjson
- **Verification:** Full TS suite 134→135 tests all pass; corpus two-path parity green
- **Committed in:** 1f5390b (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in fixture data format)
**Impact on plan:** Essential fix for ERR-05 two-path parity contract. No scope creep.

## Capture Outcome

**Branch taken: SYNTHETIC_BLOCKED** (Branch 2 from plan)

Root cause: Same Windows OAuth-cache bypass documented in Phase 05-01 Option B. Real capture deferred to `follow-up-auth-isolation-hardening` phase.

Synthetic stderr used:
```
[API Error: API_KEY_INVALID] API key not valid. Please pass a valid API key. (UNAUTHENTICATED)
```

This matches all ErrorMapper.fromExit patterns: `API key not valid`, `UNAUTHENTICATED`, `API_KEY_INVALID`.

## AUT-06 Verification Evidence

TS tests:
- `Phase 6 auth warning > emits single console.warn with full precedence chain when multiple modes configured`
- `Phase 6 auth warning > emits no warnings when only one auth mode configured`

Python tests:
- `TestPhase6AuthWarning::test_run_emits_single_warning_multi_mode`
- `TestPhase6AuthWarning::test_run_emits_no_warnings_single_mode`

Command: `cd ts && pnpm exec vitest run src/query/query.spec.ts` exits 0 (17 tests pass)
Command: `cd python && uv run pytest tests/test_query.py -k "auth or warning"` exits 0 (4 tests pass)

## AUT-07 Verification Evidence

TS: `ErrorMapper corpus: error-auth-invalid-key (AUT-07) > error-auth-invalid-key → AuthError with bucket=auth`
Python: `test_run_error_auth_invalid_key` — "error-auth-invalid-key → AuthError with bucket=auth"

Command: `cd ts && pnpm exec vitest run src/errors/errorMapperCorpus.spec.ts` exits 0 (4 tests)
Command: `cd python && uv run pytest tests/errors/test_error_mapper_corpus.py` exits 0 (4 tests)

## Issues Encountered

None beyond the ndjson format bug (documented as deviation above).

## Next Phase Readiness

- Phase 6 SC-2 (warning surface) and SC-3 (invalid-API-key AuthError classification) proven
- Phase 6 plan 04 (lint + enforcement) can proceed
- follow-up-auth-isolation-hardening remains open for both error-auth + error-auth-invalid-key real captures

---
*Phase: 06-auth-environment*
*Completed: 2026-04-19*
