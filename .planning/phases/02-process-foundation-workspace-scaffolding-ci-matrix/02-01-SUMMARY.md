---
phase: 02-process-foundation-workspace-scaffolding-ci-matrix
plan: "01"
subsystem: infra
tags: [pnpm, vitest, typescript, python, uv, pytest, anyio, workspace, monorepo]

# Dependency graph
requires:
  - phase: 01-feasibility-spike-fixture-capture
    provides: Root package.json (gemini-sdk-spec) and project layout established in Phase 1
provides:
  - VERSION file as single source of truth for SDK version (PAR-04)
  - pnpm-workspace.yaml declaring ts/ and adapter-archon/ as workspace packages
  - ts/ package scaffold with @gemini-sdk/core, Vitest 3.x, TypeScript 5.6 (ESM/NodeNext)
  - adapter-archon/ package stub for Phase 10 Archon adapter
  - python/ package scaffold with gemini-sdk 0.0.0, anyio>=4.0, psutil>=6.0, pytest>=8.0
  - Working test runners in both languages (0 tests, ready for Phase 2 Plans 02-04)
affects: [02-02, 02-03, 02-04, 03-parser-streaming-event-model, all subsequent phases]

# Tech tracking
tech-stack:
  added:
    - vitest@3.2.4 (pinned to ^3.2 for Node 18 compat per PLT-03)
    - "@vitest/coverage-v8@3.2.4"
    - typescript@5.9.3
    - anyio>=4.0 (Python async substrate)
    - psutil>=6.0 (process introspection)
    - pytest>=8.0
    - pytest-anyio@0.0.0
    - hatchling (Python build backend)
    - uv (Python package manager, not added to repo but used for venv)
    - pnpm@10.33.0 (workspace manager)
  patterns:
    - pnpm workspace with ts/ and adapter-archon/ as co-equal TS packages
    - uv project for python/ (separate from pnpm, no python/ in pnpm-workspace.yaml)
    - VERSION file as single version source synced at publish time (not build time)
    - vitest --passWithNoTests for CI-safe 0-test runs
    - pytest_plugins = ("anyio",) in conftest.py for anyio plugin registration

key-files:
  created:
    - VERSION
    - pnpm-workspace.yaml
    - ts/package.json
    - ts/tsconfig.json
    - ts/vitest.config.ts
    - ts/src/index.ts
    - adapter-archon/package.json
    - adapter-archon/tsconfig.json
    - adapter-archon/src/index.ts
    - pnpm-lock.yaml
    - python/pyproject.toml
    - python/src/gemini_sdk/__init__.py
    - python/src/gemini_sdk/process/__init__.py
    - python/tests/__init__.py
    - python/tests/conftest.py
  modified: []

key-decisions:
  - "vitest pinned to ^3.2 (not 4.x) because Vitest 4 drops Node 18 support and PLT-03 requires Node 18 CI coverage"
  - "vitest run uses --passWithNoTests flag so CI passes with 0 test files during scaffolding phase"
  - "asyncio_mode=auto removed from pytest config — this is a pytest-asyncio option, not pytest-anyio; caused PytestConfigWarning"
  - "python/ NOT added to pnpm-workspace.yaml — Python uses uv, not pnpm; mixing would break both toolchains"
  - "adapter-archon/ is a top-level TS package (not nested in ts/) per user constraint from CONTEXT.md"

patterns-established:
  - "ESM-mode TypeScript: module=NodeNext, moduleResolution=NodeNext in all TS tsconfigs"
  - "Python async: anyio as substrate, pytest-anyio for test collection, ProactorEventLoop default on Windows"
  - "Version sync pattern: root VERSION file is source of truth; ts/ and python/ both read 0.0.0 at publish time"

requirements-completed: [PAR-04]

# Metrics
duration: 15min
completed: 2026-04-12
---

# Phase 02 Plan 01: Workspace Scaffolding Summary

**pnpm workspace (ts/ + adapter-archon/) and uv Python package (python/) scaffolded with Vitest 3.x and pytest-anyio; both test runners operational with 0 test files**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-12T21:39:58Z
- **Completed:** 2026-04-12T21:55:00Z
- **Tasks:** 3
- **Files modified:** 15 created, 0 modified

## Accomplishments

- Root VERSION file (0.0.0) and pnpm-workspace.yaml created as foundational scaffolding
- @gemini-sdk/core TS package with Vitest 3.2.4, TypeScript 5.9.3, NodeNext ESM — pnpm install and vitest run both succeed
- @gemini-sdk/adapter-archon TS stub created as co-equal pnpm workspace package (Phase 10 placeholder)
- Python gemini-sdk 0.0.0 package with anyio, psutil, pytest-anyio installed via uv; pytest collection works cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Create root VERSION file and pnpm workspace config** - `84d8417` (chore)
2. **Task 2: Create TS package scaffold with Vitest and TypeScript config** - `84a6627` (feat)
3. **Task 3: Create Python package scaffold with pytest and anyio config** - `46ea799` (feat)

## Files Created/Modified

- `VERSION` - Single source of truth for SDK version (PAR-04), contains "0.0.0"
- `pnpm-workspace.yaml` - Declares ts/ and adapter-archon/ as pnpm workspace packages
- `ts/package.json` - @gemini-sdk/core with vitest ^3.2, typescript ^5.6.3, Node>=18 engine
- `ts/tsconfig.json` - NodeNext ESM mode, strict, outDir=dist, rootDir=src
- `ts/vitest.config.ts` - v8 coverage, node environment, src/**/*.{test,spec}.ts pattern
- `ts/src/index.ts` - Empty barrel export (package stub for Phase 2 implementation)
- `adapter-archon/package.json` - @gemini-sdk/adapter-archon stub, Phase 10 placeholder
- `adapter-archon/tsconfig.json` - NodeNext ESM config matching ts/ pattern
- `adapter-archon/src/index.ts` - Empty barrel export
- `pnpm-lock.yaml` - Workspace lockfile from pnpm install
- `python/pyproject.toml` - gemini-sdk 0.0.0 with anyio>=4.0, psutil>=6.0, pytest>=8.0 dev deps
- `python/src/gemini_sdk/__init__.py` - Package init with __version__ = "0.0.0"
- `python/src/gemini_sdk/process/__init__.py` - Process module stub
- `python/tests/__init__.py` - Empty test package init
- `python/tests/conftest.py` - pytest_plugins = ("anyio",) registration

## Decisions Made

- Vitest pinned to `^3.2` not `^4.x`: Vitest 4 drops Node 18 support; CI matrix (PLT-03) requires Node 18; must stay on 3.x
- Added `--passWithNoTests` to vitest run: Without it, vitest exits code 1 with 0 test files, breaking CI; this is correct behavior for scaffolding phase
- Removed `asyncio_mode = "auto"` from `[tool.pytest.ini_options]`: This is a `pytest-asyncio` option, not `pytest-anyio`; caused `PytestConfigWarning: Unknown config option`; removed to keep output clean
- Python not in pnpm workspace: Python uses uv, not pnpm; adding python/ to pnpm-workspace.yaml would cause pnpm to attempt installing a non-pnpm package

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added --passWithNoTests to vitest run script**
- **Found during:** Task 2 (TS package scaffold verification)
- **Issue:** `pnpm test` exited code 1 because vitest found no test files, causing verification to fail
- **Fix:** Changed `"test": "vitest run"` to `"test": "vitest run --passWithNoTests"` in ts/package.json
- **Files modified:** ts/package.json
- **Verification:** `pnpm test` exits 0 with "No test files found, exiting with code 0"
- **Committed in:** 84a6627 (Task 2 commit)

**2. [Rule 1 - Bug] Removed asyncio_mode from pytest ini_options**
- **Found during:** Task 3 (Python package scaffold verification)
- **Issue:** `asyncio_mode = "auto"` is a pytest-asyncio option; pytest-anyio does not recognize it; caused PytestConfigWarning on every pytest invocation
- **Fix:** Removed `asyncio_mode = "auto"` from `[tool.pytest.ini_options]` in pyproject.toml
- **Files modified:** python/pyproject.toml
- **Verification:** `uv run pytest --co` produces no warnings, exits cleanly
- **Committed in:** 46ea799 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs — incorrect behavior in scaffolding config)
**Impact on plan:** Both fixes necessary for CI to pass correctly. No scope creep.

## Issues Encountered

- pnpm install showed warnings about moving root node_modules packages (installed by npm) to `.ignored` — normal pnpm behavior when taking over an npm-managed workspace; no action needed

## User Setup Required

None - no external service configuration required. uv and pnpm must be installed on the host machine (assumed per project setup).

## Next Phase Readiness

- Plan 02-02 (BinaryResolver + EnvBuilder implementation) can now start with working TS and Python packages
- Plan 02-03 (ProcessManager + SpawnPerCallStrategy) likewise unblocked
- Plan 02-04 (CI matrix GitHub Actions) depends on this scaffold being in place
- No blockers

---
*Phase: 02-process-foundation-workspace-scaffolding-ci-matrix*
*Completed: 2026-04-12*
