---
phase: 02-process-foundation-workspace-scaffolding-ci-matrix
plan: 03
subsystem: process
tags: [python, anyio, psutil, subprocess, process-management, binary-resolver, env-builder]

# Dependency graph
requires:
  - phase: 02-01
    provides: Python package scaffold (pyproject.toml, uv, src layout, anyio/psutil deps)
  - phase: 02-02
    provides: TypeScript canonical process module implementations to port from
provides:
  - GeminiNotFoundError exception class (errors/not_found.py)
  - ProcessStrategy Protocol (process/process_strategy.py)
  - resolve_binary() with cli_path > GEMINI_BIN_PATH > PATH precedence (process/binary_resolver.py)
  - build_env() with ALLOWED_KEYS allowlist filtering os.environ (process/env_builder.py)
  - SpawnPerCallStrategy using anyio.open_process with CREATE_NO_WINDOW on Windows (process/spawn_per_call.py)
  - ProcessManager orchestrating spawn/env/binary with pluggable strategy (process/process_manager.py)
  - kill_tree() with taskkill on Windows, SIGTERM->grace->SIGKILL + psutil on Unix (process/process_manager.py)
  - 31 passing tests with PAR-03 parity docstrings matching TS test descriptions
affects:
  - Phase 03 (Python parser tests — imports ProcessManager)
  - Phase 09 (MCP passthrough — kill_tree orphan detection)
  - PAR-03 CI parity check (diff-test-names.sh compares docstrings to TS test names)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "typing.Protocol (not ABC) for ProcessStrategy — matches TS interface pattern"
    - "anyio.open_process with string command on Windows (triggers cmd.exe for .cmd shims)"
    - "anyio.open_process with list argv on Unix (no shell, clean argument handling)"
    - "PAR-03 parity: every Python test function has a docstring matching the TS test description"
    - "TDD red-green: write failing tests first, then implement, verify GREEN"

key-files:
  created:
    - python/src/gemini_sdk/errors/__init__.py
    - python/src/gemini_sdk/errors/not_found.py
    - python/src/gemini_sdk/process/process_strategy.py
    - python/src/gemini_sdk/process/binary_resolver.py
    - python/src/gemini_sdk/process/env_builder.py
    - python/src/gemini_sdk/process/spawn_per_call.py
    - python/src/gemini_sdk/process/process_manager.py
    - python/tests/test_binary_resolver.py
    - python/tests/test_env_builder.py
    - python/tests/test_spawn_per_call.py
    - python/tests/test_process_manager.py
  modified:
    - python/src/gemini_sdk/process/__init__.py
    - python/src/gemini_sdk/__init__.py

key-decisions:
  - "anyio.open_process does not accept shell=True — pass command as a string on Windows to trigger cmd.exe shell behavior"
  - "ProcessStrategy uses typing.Protocol (not ABC) to mirror TS interface structural typing"
  - "kill_tree() calls psutil for recursive child cleanup before SIGTERM/SIGKILL on Unix (FDN-09)"
  - "anyio Process.stdout is already a ByteReceiveStream — do not wrap with anyio.wrap_file()"

patterns-established:
  - "PAR-03: Python test docstrings must match TS test() description strings exactly for diff-test-names.sh"
  - "TDD: tests written first (RED), then implementation (GREEN), per plan tdd=true"
  - "SpawnPerCallStrategy: pre-built string command on Windows, list argv on Unix"

requirements-completed: [FDN-01, FDN-02, FDN-03, FDN-04, FDN-05, FDN-06, FDN-07, FDN-08, FDN-09, PLT-04]

# Metrics
duration: 22min
completed: 2026-04-12
---

# Phase 02 Plan 03: Python Process Module Port Summary

**Python process infrastructure ported 1:1 from TypeScript: GeminiNotFoundError, ProcessStrategy Protocol, resolve_binary(), build_env(), SpawnPerCallStrategy via anyio, ProcessManager, and kill_tree() with psutil orphan detection — 31 tests all green with PAR-03 parity docstrings**

## Performance

- **Duration:** 22 min
- **Started:** 2026-04-12T21:52:21Z
- **Completed:** 2026-04-12T22:14:00Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Ported 7 source files from TypeScript canonical implementations with matching API shapes
- 31 pytest tests pass (asyncio + trio backends) with PAR-03 parity docstrings matching TS `it('...')` descriptions
- anyio.open_process used correctly: string command on Windows (triggers cmd.exe for .cmd shims), list argv on Unix
- kill_tree() uses psutil for recursive child cleanup on Unix + taskkill /T /F on Windows
- gemini_sdk top-level __init__.py re-exports all public symbols for clean import surface

## Task Commits

Each task was committed atomically:

1. **Task 1: Port BinaryResolver, EnvBuilder, ProcessStrategy, GeminiNotFoundError** - `82fe999` (feat)
2. **Task 2: Port SpawnPerCallStrategy, ProcessManager, kill_tree** - `1269a94` (feat)

**Plan metadata:** (created below)

_Note: TDD tasks — tests written first (RED import errors), then implementation (GREEN)_

## Files Created/Modified

- `python/src/gemini_sdk/errors/__init__.py` - Re-exports GeminiNotFoundError
- `python/src/gemini_sdk/errors/not_found.py` - GeminiNotFoundError exception class
- `python/src/gemini_sdk/process/process_strategy.py` - ProcessStrategy Protocol (typing.Protocol)
- `python/src/gemini_sdk/process/binary_resolver.py` - resolve_binary() with 3-tier precedence
- `python/src/gemini_sdk/process/env_builder.py` - build_env() with ALLOWED_KEYS allowlist
- `python/src/gemini_sdk/process/spawn_per_call.py` - SpawnPerCallStrategy via anyio.open_process
- `python/src/gemini_sdk/process/process_manager.py` - ProcessManager + kill_tree()
- `python/src/gemini_sdk/process/__init__.py` - Updated with all public exports
- `python/src/gemini_sdk/__init__.py` - Updated to re-export entire public API
- `python/tests/test_binary_resolver.py` - 5 tests with TS parity docstrings
- `python/tests/test_env_builder.py` - 7 tests with TS parity docstrings
- `python/tests/test_spawn_per_call.py` - 5 tests with TS parity docstrings (run asyncio+trio)
- `python/tests/test_process_manager.py` - 5 tests with TS parity docstrings (run asyncio+trio)

## Decisions Made

- anyio.open_process does NOT accept `shell=True` — on Windows, pass command as a string (interpreted by cmd.exe) and set `creationflags=subprocess.CREATE_NO_WINDOW`
- ProcessStrategy uses `typing.Protocol` (not ABC) to mirror TypeScript's structural interface typing
- kill_tree() uses psutil for recursive children before SIGTERM so orphan grandchildren are caught first (FDN-09)
- anyio `Process.stdout` is already a `ByteReceiveStream` — `anyio.wrap_file()` cannot be used on it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect anyio stream wrapping in integration test**
- **Found during:** Task 2 (test_spawns_gemini_version_and_captures_non_empty_output)
- **Issue:** Test used `anyio.wrap_file(proc.stdout)` but anyio Process.stdout is already a ByteReceiveStream with no `.close()` — raised AttributeError
- **Fix:** Replaced with direct `await stdout.receive(4096)` loop with `anyio.fail_after(15)` and `anyio.EndOfStream` catch
- **Files modified:** python/tests/test_process_manager.py
- **Verification:** Test passes for both asyncio and trio backends
- **Committed in:** 1269a94 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary fix for correct async stream usage pattern. No scope creep.

## Issues Encountered

- anyio.open_process signature differs from Node.js child_process.spawn — no `shell=` param; Windows shell behavior achieved by passing a string command instead of a list

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Python process infrastructure complete and fully tested — ready for Phase 03 (Python parser tests)
- PAR-03 parity foundation established: all test docstrings match TS descriptions
- kill_tree() orphan detection via psutil ready for Phase 09 (MCP passthrough)

---
*Phase: 02-process-foundation-workspace-scaffolding-ci-matrix*
*Completed: 2026-04-12*
