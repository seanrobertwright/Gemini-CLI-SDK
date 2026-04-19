---
phase: 06-auth-environment
plan: "02"
subsystem: auth
tags: [python, pytest, pure-function, env-detection, auth-mode, parity]

# Dependency graph
requires:
  - phase: 06-auth-environment-01
    provides: python/src/gemini_sdk/auth/resolve_auth.py + auth/__init__.py (committed in 06-01)
  - phase: 02-process-foundation
    provides: build_env() Python pure function with allowlisted env passthrough
  - phase: 05-error-taxonomy-archon-5-bucket-mapping
    provides: GeminiError subclass vocabulary for auth errors
provides:
  - python/tests/auth/test_resolve_auth.py: 8-test pytest suite with parity docstrings matching TS it() descriptions
  - diff-test-names.sh: UTF-8 + PYTHONIOENCODING fix for Windows sort compatibility
  - 117:117 TS:Python test parity (up from 109:109)
affects: [06-auth-environment-03, 06-auth-environment-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Python parity convention: docstring first line equals TS it() description verbatim
    - _clean_env autouse fixture: deletes all 6 auth env vars before each test via monkeypatch.delenv
    - resolve_auth() called with dict(os.environ) snapshot for deterministic test isolation
    - AUTH_PRECEDENCE constant referenced in both chain assertion and test body (single source of truth)

key-files:
  created:
    - python/tests/auth/__init__.py
    - python/tests/auth/test_resolve_auth.py
  modified:
    - scripts/diff-test-names.sh
    - ts/src/auth/resolveAuth.spec.ts

key-decisions:
  - "Python auth module (resolve_auth.py + auth/__init__.py) was already committed in plan 06-01; plan 06-02 work was creating the pytest test suite"
  - "diff-test-names.sh needed two fixes for Windows: LC_ALL=C.utf8 for sort (em-dash sort failure) and PYTHONIOENCODING=utf-8 for Python subprocess stdout (cp1252 vs UTF-8)"
  - "TS spec test #8 description fixed from 'AUTH_PRECEDENCE constant equals exact documented chain' to plan-specified parity string"
  - "Tests calling build_env pass dict(os.environ) snapshot after monkeypatch.setenv; pure resolve_auth tests pass explicit dicts directly (no monkeypatch needed)"

patterns-established:
  - "Pattern: autouse _clean_env fixture deletes all 6 auth vars so each test starts from known state"
  - "Pattern: PYTHONIOENCODING=utf-8 + LC_ALL=C.utf8 needed in diff-test-names.sh when test names contain non-ASCII (e.g. em-dash)"

requirements-completed: [AUT-01, AUT-02, AUT-03, AUT-04, AUT-06]

# Metrics
duration: 6min
completed: 2026-04-19
---

# Phase 6 Plan 02: Auth Environment Python Parity Summary

**Python resolve_auth() test suite (8 tests) with verbatim TS parity docstrings; fixed diff-test-names.sh for UTF-8 Windows compatibility; 117:117 parity achieved**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-19T23:33:51Z
- **Completed:** 2026-04-19T23:39:51Z
- **Tasks:** 2 (Task 1: Python auth module — already done in 06-01; Task 2: pytest suite + parity fixes)
- **Files modified:** 4

## Accomplishments
- 8 pytest tests covering all 4 auth modes + multi-mode warning + GCP passthrough + AUTH_PRECEDENCE constant
- Test docstring first lines match TS it() descriptions verbatim for PAR-03 compliance
- Fixed diff-test-names.sh for Windows em-dash sort failure (LC_ALL=C.utf8 + PYTHONIOENCODING=utf-8)
- Parity maintained at 117:117 (up from 109:109 before phase 6)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create python/src/gemini_sdk/auth/ module** — Already committed in plan 06-01 (commit `1e124c5`); Task 1 work was a no-op (verified identical content)
2. **Task 2: Python test suite + parity script fix** — `3a03b83` (feat)

## Files Created/Modified
- `python/tests/auth/__init__.py` — Empty package marker
- `python/tests/auth/test_resolve_auth.py` — 8 pytest functions with parity docstrings, _clean_env autouse fixture
- `scripts/diff-test-names.sh` — LC_ALL=C.utf8 + PYTHONIOENCODING=utf-8 for Windows UTF-8 sort support
- `ts/src/auth/resolveAuth.spec.ts` — Fixed test #8 description for plan-specified parity string

## Decisions Made
- Plan 06-01 executor created Python auth module (`resolve_auth.py`, `auth/__init__.py`) as part of its Task 2 commit — confirmed identical to plan 06-02 spec; no re-creation needed
- PYTHONIOENCODING=utf-8: Python on Windows uses cp1252 by default; this makes em-dash (U+2014 = 0xE2 0x80 0x94 in UTF-8) output as 0x97, diverging from grep's UTF-8 output of the same character from TS source files
- LC_ALL=C.utf8: Git Bash sort on Windows fails with "Invalid or incomplete multibyte or wide character" for non-ASCII sort unless locale explicitly supports UTF-8

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed diff-test-names.sh for Windows UTF-8 compatibility with em-dash in test names**
- **Found during:** Task 2 (parity check after writing Python tests)
- **Issue:** `sort` in Git Bash fails with "Invalid or incomplete multibyte or wide character" when test names contain em-dash (U+2014). Python subprocess stdout uses Windows code page cp1252 (em-dash = 0x97) while TS grep uses UTF-8 (em-dash = 0xE2 0x80 0x94), causing diff to see them as different bytes.
- **Fix:** Added `LC_ALL=C.utf8` export at script start (uses glibc C.utf8 locale which handles UTF-8 in sort); added `PYTHONIOENCODING=utf-8` before Python invocation to force UTF-8 stdout output matching TS grep output.
- **Files modified:** scripts/diff-test-names.sh
- **Verification:** `bash scripts/diff-test-names.sh` outputs "OK: TS and Python test names match (117 tests)."
- **Committed in:** `3a03b83` (Task 2 commit)

**2. [Rule 1 - Bug] TS resolveAuth.spec.ts test #8 description corrected for parity**
- **Found during:** Task 2 (parity check)
- **Issue:** TS test #8 description was `'AUTH_PRECEDENCE constant equals exact documented chain'` but the plan specified `"AUTH_PRECEDENCE constant equals [GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_API_KEY, ADC]"` — this divergence would require Python docstring to use the wrong description.
- **Fix:** Updated the TS it() description to match the plan-specified parity string.
- **Files modified:** ts/src/auth/resolveAuth.spec.ts
- **Verification:** `bash scripts/diff-test-names.sh` passes; `pnpm exec vitest run src/auth/resolveAuth.spec.ts` passes 8/8.
- **Committed in:** `3a03b83` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes essential for parity CI compliance. No scope creep.

## Issues Encountered
- Plan 06-01 already created the Python auth module (`python/src/gemini_sdk/auth/`), so plan 06-02 Task 1 was effectively already done. Confirmed identical content; Task 1 recognized as complete with existing commit `1e124c5`.

## Parity Check Output
```
TS tests found: 117
Python tests found: 117
OK: TS and Python test names match (117 tests).
```

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Python auth module + tests complete; ready for plan 06-03 (query() wiring)
- diff-test-names.sh now supports em-dash and other non-ASCII characters in test names for future phases

## Self-Check: PASSED

### Files Created
- python/tests/auth/__init__.py: FOUND
- python/tests/auth/test_resolve_auth.py: FOUND

### Commits
- 3a03b83: FOUND

---
*Phase: 06-auth-environment*
*Completed: 2026-04-19*
