---
phase: 11-docs-site-compat-matrix-release
plan: "01"
subsystem: compat
tags: [semver, packaging, compat-probe, runtime-check, tdd]

# Dependency graph
requires:
  - phase: 01-feasibility-spike
    provides: .gemini-cli-compat file (pinned version 0.37.1)
  - phase: 04-public-query-api
    provides: query()/queryRaw()/queryFull() entry points to wire probe into
provides:
  - once-per-process gemini-cli version compat probe in TS and Python
  - checkCompatOnce / check_compat_once exported from each package's public barrel
  - warn/strict/silent mode controlled via GEMINI_SDK_COMPAT env var
  - 8+8 unit tests validating all probe behavior modes
affects:
  - 11-04 (compat matrix page consumes .gemini-cli-compat version-range format established here)

# Tech tracking
tech-stack:
  added:
    - semver ^7.7.4 (TS runtime dep)
    - "@types/semver ^7.7.1 (TS devDep)"
    - packaging>=23.0 (Python runtime dep)
  patterns:
    - once-per-process module-level flag with _resetXxxForTesting() escape hatch
    - warn/strict/silent three-mode env-var override pattern (GEMINI_SDK_COMPAT)
    - vi.hoisted() + vi.mock() factory pattern for mocking child_process in ESM
    - vi.resetAllMocks() (not clearAllMocks) required to reset mockReturnValue implementations

key-files:
  created:
    - ts/src/compat.ts
    - ts/src/compat.spec.ts
    - python/src/gemini_sdk/compat.py
    - python/tests/test_compat.py
  modified:
    - ts/src/index.ts
    - ts/src/query/query.ts
    - ts/package.json
    - python/src/gemini_sdk/__init__.py
    - python/src/gemini_sdk/query/query.py
    - python/pyproject.toml

key-decisions:
  - "vi.resetAllMocks() required instead of vi.clearAllMocks() in TS beforeEach: clearAllMocks only resets call counts, not mockReturnValue implementations"
  - "TS probe inserts checkCompatOnce in both query() and queryRaw() (not just query()) since both independently spawn subprocesses; cache ensures only one actual probe per process"
  - "Python probe uses subprocess.run (not subprocess.check_output) for consistency with run-mode API and timeout support"
  - "resolveBinary(options.cliPath) called before spawn to get the resolved binary path for the probe — avoids duplicating resolution logic"

patterns-established:
  - "Pattern: once-per-process probe with module-level _checked flag + _resetXxxForTesting() for test isolation — established by TS compat.ts, mirrored in Python compat.py"
  - "PAR-03: Python test docstrings copy TS it() description strings verbatim for diff-test-names.sh parity"

requirements-completed: [REL-05, REL-06]

# Metrics
duration: 5min
completed: 2026-04-22
---

# Phase 11 Plan 01: Runtime Compat Probe Summary

**semver-based once-per-process gemini-cli version probe (warn/strict/silent) in both TS and Python, wired into query() before first subprocess spawn**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-22T08:24:35Z
- **Completed:** 2026-04-22T08:29:05Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- Created `ts/src/compat.ts` implementing `checkCompatOnce()` with semver range ~0.37.1, warn/strict/silent modes, process-lifetime caching, and `_resetCompatCacheForTesting()` for test isolation
- Created `python/src/gemini_sdk/compat.py` as a mechanical Python port using `packaging.Version` instead of `semver`
- 8 Vitest + 8 pytest tests covering all behavior modes (warn/strict/silent, cache hit, binary-not-found, cache reset)
- Wired probe into `query()` and `queryRaw()` in both languages; full suites remain green (249 TS + 353 Python)

## Task Commits

Each task was committed atomically:

1. **Task 1: TS compat probe + vitest suite** - `a72bc22` (feat)
2. **Task 2: Python compat probe + pytest suite** - `81deebf` (feat)
3. **Task 3: Wire compat probe into query()** - `0c682a3` (feat)

**Plan metadata:** (created below)

_Note: TDD tasks had integrated RED+GREEN in single commits — implementation and tests written together._

## Files Created/Modified
- `ts/src/compat.ts` - checkCompatOnce() + _resetCompatCacheForTesting() + CompatProbeOptions interface
- `ts/src/compat.spec.ts` - 8 vitest tests (warn/strict/silent/cache/binary-failure/reset)
- `ts/src/index.ts` - Added `export * from './compat.js'` barrel export
- `ts/src/query/query.ts` - Added checkCompatOnce call in query() and queryRaw() before spawn
- `ts/package.json` - Added semver runtime dep and @types/semver devDep
- `python/src/gemini_sdk/compat.py` - check_compat_once() + _reset_compat_cache_for_testing() + _in_range()
- `python/tests/test_compat.py` - 8 pytest tests mirroring TS cases with PAR-03 docstrings
- `python/src/gemini_sdk/__init__.py` - Added check_compat_once to public API and __all__
- `python/src/gemini_sdk/query/query.py` - Added check_compat_once call in query() and query_raw() before spawn
- `python/pyproject.toml` - Added packaging>=23.0 runtime dep

## Decisions Made
- `vi.resetAllMocks()` required instead of `vi.clearAllMocks()` in TS `beforeEach`: `clearAllMocks` resets call counts but NOT `mockReturnValue` implementations, causing test pollution across the suite
- Both `query()` and `queryRaw()` independently receive `checkCompatOnce` calls since both spawn their own subprocesses; the module-level cache ensures only one actual `--version` probe fires per process
- `resolveBinary(options.cliPath)` called before passing to the probe to get the exact resolved path (same resolution used by ProcessManager)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test isolation failure in cache-hit test**
- **Found during:** Task 1 (TS vitest suite)
- **Issue:** `vi.clearAllMocks()` does not reset `mockReturnValue` implementations; a previous test's `mockReturnValue('0.39.2')` bled into the cache-hit test causing a spurious warn
- **Fix:** Changed `vi.clearAllMocks()` to `vi.resetAllMocks()` in `beforeEach`
- **Files modified:** ts/src/compat.spec.ts
- **Verification:** All 8 tests green in isolation
- **Committed in:** a72bc22 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test isolation)
**Impact on plan:** Minor test-infrastructure fix; no production code changes. No scope creep.

## Issues Encountered
- Python `uv run pytest` initially failed with `program not found`; resolved by running `uv add --dev pytest` which also installed the full dev dependency group including hypothesis, enabling the full 353-test suite to pass.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Compat probe is complete and wired; plan 11-04 (compat matrix doc page) can now reference `.gemini-cli-compat` version-range format
- `GEMINI_SDK_COMPAT` env var is live — users can set `strict` to gate on exact version match or `silent` to suppress warnings

## Self-Check: PASSED

All files present, all commits verified.

---
*Phase: 11-docs-site-compat-matrix-release*
*Completed: 2026-04-22*
