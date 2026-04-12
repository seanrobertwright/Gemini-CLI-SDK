---
phase: 02-process-foundation-workspace-scaffolding-ci-matrix
plan: "02"
subsystem: infra
tags: [typescript, vitest, subprocess, process-management, windows, cross-platform]

# Dependency graph
requires:
  - phase: 02-01
    provides: ts/ package scaffold with Vitest and TypeScript configured

provides:
  - GeminiNotFoundError class with helpful install message
  - ProcessStrategy interface (single spawn() method, public escape-hatch)
  - BinaryResolver: cliPath > GEMINI_BIN_PATH > PATH resolution with .cmd on Windows
  - EnvBuilder: allowlist-based clean subprocess env dict with caller override merge
  - SpawnPerCallStrategy: Windows shell:true+windowsHide:true (CVE-2024-27980); Unix shell:false
  - ProcessManager: pluggable strategy, BinaryResolver + EnvBuilder integration
  - killTree: taskkill /T /F on Windows; SIGTERM -> 5s grace -> SIGKILL on Unix
  - 24 unit/integration tests across 4 spec files, all passing

affects:
  - 02-03 (Python port — mirrors this TS canonical implementation)
  - 04 (query() wraps ProcessManager.spawn)
  - 07 (sessions use ProcessManager for resume spawning)

# Tech tracking
tech-stack:
  added:
    - "@types/node ^20 (devDependency) — TypeScript node type definitions"
  patterns:
    - "Allowlist-based env filtering: iterate Set<string>, copy from process.env, merge overrides"
    - "ESM-safe mocking: vi.mock() at module top with factory + _actualSpawn escape hatch for integration"
    - "CVE-2024-27980 mitigation: pre-built command string with shell:true for Windows .cmd shims"
    - "Pluggable ProcessStrategy injected into ProcessManager constructor with default"

key-files:
  created:
    - ts/src/errors/GeminiNotFoundError.ts
    - ts/src/errors/index.ts
    - ts/src/process/ProcessStrategy.ts
    - ts/src/process/BinaryResolver.ts
    - ts/src/process/EnvBuilder.ts
    - ts/src/process/SpawnPerCallStrategy.ts
    - ts/src/process/ProcessManager.ts
    - ts/src/process/index.ts
    - ts/src/process/BinaryResolver.spec.ts
    - ts/src/process/EnvBuilder.spec.ts
    - ts/src/process/SpawnPerCallStrategy.spec.ts
    - ts/src/process/ProcessManager.spec.ts
  modified:
    - ts/src/index.ts (added process/ and errors/ re-exports)
    - ts/package.json (added @types/node devDependency)
    - pnpm-lock.yaml

key-decisions:
  - "vi.spyOn() cannot spy on ESM named exports — use vi.mock() factory with _actualSpawn escape hatch for integration tests"
  - "@types/node was missing from ts/package.json devDependencies — added ^20 to fix tsc --noEmit"
  - "BinaryResolver uses path.delimiter for PATH splitting (OS-native separator) not hardcoded colon"

patterns-established:
  - "ProcessStrategy: single spawn(argv, env, options) method — all process spawning flows through this interface"
  - "EnvBuilder allowlist: allowlist is a const Set, not configurable, with GEMINI_API_KEY + PATH always included"
  - "killTree: Windows=taskkill /T /F (tree-kill); Unix=SIGTERM + 5s grace + SIGKILL; ESRCH silenced"

requirements-completed:
  - FDN-01
  - FDN-02
  - FDN-03
  - FDN-04
  - FDN-05
  - FDN-06
  - FDN-07
  - FDN-08
  - FDN-09
  - PAR-01

# Metrics
duration: 10min
completed: 2026-04-12
---

# Phase 02 Plan 02: Process Foundation Summary

**TS subprocess foundation: BinaryResolver (cliPath>GEMINI_BIN_PATH>PATH), EnvBuilder (allowlist+merge), SpawnPerCallStrategy (Windows .cmd CVE-2024-27980 mitigation), ProcessManager (pluggable strategy + killTree), 24 tests green**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-12T21:44:49Z
- **Completed:** 2026-04-12T21:55:00Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- 6 source files implementing the complete TS process infrastructure used by Phase 4 query()
- 4 spec files with 24 tests covering all behaviors from the plan's must_haves.truths
- ESM-compatible mocking pattern established using vi.mock() factory with _actualSpawn escape hatch
- TypeScript compiles cleanly with tsc --noEmit after adding missing @types/node

## Task Commits

Each task was committed atomically:

1. **Task 1: ProcessStrategy, GeminiNotFoundError, BinaryResolver, EnvBuilder** - `1303bbb` (feat)
2. **Task 2: SpawnPerCallStrategy, ProcessManager, killTree, index exports** - `8633129` (feat)

## Files Created/Modified

- `ts/src/errors/GeminiNotFoundError.ts` - Error class with npm install-g install message
- `ts/src/errors/index.ts` - Re-exports GeminiNotFoundError
- `ts/src/process/ProcessStrategy.ts` - Public interface: spawn(argv, env, options): ChildProcess
- `ts/src/process/BinaryResolver.ts` - Resolution: cliPath > GEMINI_BIN_PATH > PATH (.cmd on Windows)
- `ts/src/process/EnvBuilder.ts` - Allowlist env builder with 26-key allowlist + caller override merge
- `ts/src/process/SpawnPerCallStrategy.ts` - Default strategy: shell:true+windowsHide:true on Windows, shell:false on Unix
- `ts/src/process/ProcessManager.ts` - Orchestrates spawn + killTree (SIGTERM->SIGKILL / taskkill)
- `ts/src/process/index.ts` - Barrel exports for all process modules
- `ts/src/index.ts` - Updated to re-export process/ and errors/
- `ts/src/process/BinaryResolver.spec.ts` - 5 tests: cliPath, GEMINI_BIN_PATH, PATH lookup, not-found, precedence
- `ts/src/process/EnvBuilder.spec.ts` - 7 tests: allowlist filtering, leak prevention, override merge, key precedence
- `ts/src/process/SpawnPerCallStrategy.spec.ts` - 5 tests: interface check, Windows shell:true/windowsHide, Unix shell:false, integration
- `ts/src/process/ProcessManager.spec.ts` - 7 tests: pluggability, resolveBinary+buildEnv integration, gemini --version, killTree
- `ts/package.json` - Added @types/node ^20 devDependency
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made

- **ESM vi.spyOn limitation:** vi.spyOn() cannot spy on ESM named exports (module namespaces are not configurable). Used vi.mock() factory pattern instead, with `_actualSpawn` escape hatch exposed in the mock for integration tests that need the real spawn behavior.
- **Missing @types/node:** tsc --noEmit failed with "Cannot find type definition file for 'node'". Added @types/node ^20 as a devDependency. This was a Rule 3 auto-fix (blocking issue).
- **path.delimiter usage:** BinaryResolver uses `path.delimiter` (OS-native PATH separator) instead of hardcoded `:` to correctly handle Windows PATH splitting (`;`-separated).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added @types/node devDependency**
- **Found during:** Task 2 verification (npx tsc --noEmit)
- **Issue:** TypeScript compilation failed: "Cannot find type definition file for 'node'"
- **Fix:** `pnpm add -D @types/node@^20` in ts/
- **Files modified:** ts/package.json, pnpm-lock.yaml
- **Verification:** tsc --noEmit exits 0
- **Committed in:** 8633129 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed ESM spy incompatibility in test files**
- **Found during:** Task 2 initial test run
- **Issue:** vi.spyOn() on ESM named exports throws "Cannot redefine property" — 5 tests failing
- **Fix:** Rewrote test mocking to use vi.mock() factory pattern at module top; unit tests use no-op mock spawn; integration test uses _actualSpawn escape hatch
- **Files modified:** ts/src/process/SpawnPerCallStrategy.spec.ts, ts/src/process/ProcessManager.spec.ts
- **Verification:** All 24 tests pass, EXIT: 0
- **Committed in:** 8633129 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing dependency, 1 test tooling bug)
**Impact on plan:** Both fixes necessary for correctness and compilation. No scope creep.

## Issues Encountered

- ESM module mock incompatibility with vi.spyOn() required restructuring test approach — resolved by switching to vi.mock() factory with _actualSpawn escape hatch pattern. This pattern is now established for all future TS tests in this project.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All TS process infrastructure ready for Phase 4 (query() wraps ProcessManager.spawn)
- Python port (Plan 02-03) can mechanically mirror this TS implementation
- All 10 requirements from plan frontmatter satisfied
- TypeScript compiles cleanly, all 24 tests pass

---
*Phase: 02-process-foundation-workspace-scaffolding-ci-matrix*
*Completed: 2026-04-12*
