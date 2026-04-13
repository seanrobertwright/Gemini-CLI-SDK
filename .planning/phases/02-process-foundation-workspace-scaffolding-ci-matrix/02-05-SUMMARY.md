---
phase: 02-process-foundation-workspace-scaffolding-ci-matrix
plan: "05"
subsystem: testing
tags: [pytest, vitest, parity, ci, grep, docstrings]

# Dependency graph
requires:
  - phase: 02-process-foundation-workspace-scaffolding-ci-matrix
    provides: Python test files and diff-test-names.sh from plans 02-03 and 02-04

provides:
  - 24 Python test docstrings exactly matching TS test descriptions (PAR-03 parity enforced)
  - 2 new Python tests (test_spawn_calls_resolve_binary_and_build_env, test_throws_gemini_not_found_error)
  - Robust two-pass grep in diff-test-names.sh that ignores emit/on event handler strings
  - Windows CRLF normalization via tr -d '\r' in both TS and Python pipelines
  - CI pnpm cache-dependency-path pointing to root pnpm-lock.yaml

affects: [phase-03-parser-and-streaming, ci-matrix, parity-enforcement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-pass grep: first filter lines by ^[[:space:]]*(test|it)\\(, then extract name — prevents false substring matches"
    - "tr -d '\\r' normalization for CRLF safety on Windows in both grep and Python pipelines"

key-files:
  created: []
  modified:
    - python/tests/test_spawn_per_call.py
    - python/tests/test_process_manager.py
    - scripts/diff-test-names.sh
    - .github/workflows/ci.yml

key-decisions:
  - "Two-pass grep added tr -d '\\r' to both TS and Python pipelines: Python subprocess on Windows emits CRLF output even inside bash heredoc; tr normalization makes diff byte-identical"
  - "CI cache-dependency-path fixed from ts/pnpm-lock.yaml to pnpm-lock.yaml: pnpm workspace lockfile lives at repo root"

patterns-established:
  - "diff-test-names.sh two-pass grep pattern: filter by line-start anchor first, then extract — never single-pass -oE on full file"

requirements-completed: [FDN-01, FDN-02, FDN-03, FDN-04, FDN-05, FDN-06, FDN-07, FDN-08, FDN-09, PLT-03, PLT-04, PLT-05, PAR-01, PAR-03, PAR-04]

# Metrics
duration: 30min
completed: 2026-04-12
---

# Phase 02 Plan 05: Gap Closure — Test Parity + CI Fix Summary

**24 Python test docstrings now exactly match TS via docstring rename + two-pass grep with CRLF normalization; CI pnpm cache unblocked by correcting lockfile path to repo root**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-04-12T22:10:00Z
- **Completed:** 2026-04-12T22:32:59Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Renamed all 9 mismatched Python test docstrings across test_spawn_per_call.py and test_process_manager.py to exactly match TS spec descriptions
- Added 2 missing Python tests (test_spawn_calls_resolve_binary_and_build_env, test_throws_gemini_not_found_error) bringing ProcessManager test count to 7 (matching TS)
- Fixed diff-test-names.sh grep to use two-pass approach (line-start anchor + extract) eliminating false positive from `emit('close')` substring
- Added `tr -d '\r'` normalization in both TS and Python grep pipelines to handle Windows CRLF output from Python subprocess in bash heredoc
- Fixed CI workflow cache-dependency-path from `ts/pnpm-lock.yaml` to `pnpm-lock.yaml` (root workspace lockfile)
- `bash scripts/diff-test-names.sh` exits 0 with "OK: TS and Python test names match (24 tests)."

## Task Commits

Each task was committed atomically:

1. **Task 1: Align Python test docstrings + add 2 missing tests** - `4807d63` (feat)
2. **Task 2: Fix diff-test-names.sh grep pattern + CI lockfile path** - `9c19dfb` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `python/tests/test_spawn_per_call.py` - Renamed 5 docstrings to match TS exactly
- `python/tests/test_process_manager.py` - Renamed 4 docstrings + added 2 new tests
- `scripts/diff-test-names.sh` - Two-pass grep + CRLF normalization via tr -d '\r'
- `.github/workflows/ci.yml` - Fixed cache-dependency-path from ts/pnpm-lock.yaml to pnpm-lock.yaml

## Decisions Made
- Added `tr -d '\r'` to both pipelines (not just Python): Windows Git Bash can also produce CRLF in intermediate output; normalizing both sides ensures byte-identical comparison on all platforms
- Two-pass grep chosen over word-boundary approach: `^[[:space:]]*(test|it)\(` line-start filter uses POSIX ERE (portable), then second `grep -oE` extracts the name — more readable than a single complex ERE

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added CRLF normalization (tr -d '\r') to both grep pipelines**
- **Found during:** Task 2 (diff-test-names.sh grep fix)
- **Issue:** Python subprocess launched via bash heredoc on Windows produced CRLF output; diff saw 24 vs 24 lines but all 24 differed due to trailing \r
- **Fix:** Added `tr -d '\r'` to both the Python pipeline and the TS grep pipeline for symmetric normalization
- **Files modified:** scripts/diff-test-names.sh
- **Verification:** bash scripts/diff-test-names.sh exits 0 with "OK: TS and Python test names match (24 tests)."
- **Committed in:** 9c19dfb (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug: CRLF line endings in Python subprocess output on Windows)
**Impact on plan:** Essential for correctness on Windows. No scope creep.

## Issues Encountered
- Python subprocess launched in bash heredoc on Windows produces CRLF output regardless of shell settings; `tr -d '\r'` is the minimal portable fix without requiring `PYTHONUTF8=1` or `text=True` changes

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 02 gap closure complete: diff-test-names.sh exits 0, all 35 Python tests pass, CI lockfile path correct
- Phase 03 (Parser and Streaming) can proceed with full CI matrix operational

---
*Phase: 02-process-foundation-workspace-scaffolding-ci-matrix*
*Completed: 2026-04-12*
