---
phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection
plan: "01"
subsystem: api
tags: [typescript, fast-check, property-testing, model-selection, argv-builder]

# Dependency graph
requires:
  - phase: 03-ndjson-parser-eventdispatcher-messagechunk-types
    provides: MessageChunk type used in QueryResult.chunks

provides:
  - QueryOptions interface with prompt, model, systemPrompt, cwd, additionalDirectories, abortSignal, cliPath, env
  - QueryResult interface with text, sessionId, stopReason, chunks
  - Model const object with 6 known Gemini model identifiers (2 deprecated)
  - AbortError class with retryable=false
  - buildArgv pure function mapping QueryOptions to string[] argv
  - query barrel export at ts/src/query/index.ts

affects:
  - 04-02 (query/queryRaw/queryFull implementations consume QueryOptions/QueryResult/buildArgv)
  - 04-03 (systemPrompt handling may extend buildArgv)
  - 05-error-taxonomy (AbortError is one of the error types to unify)

# Tech tracking
tech-stack:
  added:
    - fast-check ^4.6.0 (property-based fuzz testing)
    - "@fast-check/vitest ^0.4.0 (installed but unused due to vitest 3.2 peer dep)"
  patterns:
    - Model-as-const-object pattern: export const Model = {...} as const + export type Model = (typeof Model)[keyof typeof Model]
    - Omit-flag-on-sentinel: model='auto' or undefined skips --model flag (MDL-03)
    - Repeated-flag pattern: additionalDirectories maps to N instances of --include-directories (CWD-02)
    - Property-based fuzz via fc.assert(fc.property(...)) in spec files

key-files:
  created:
    - ts/src/query/types.ts
    - ts/src/query/buildArgv.ts
    - ts/src/query/buildArgv.spec.ts
    - ts/src/query/index.ts
  modified:
    - ts/package.json (added fast-check, @fast-check/vitest devDependencies)
    - pnpm-lock.yaml

key-decisions:
  - "@fast-check/vitest 0.4.0 requires vitest ^4.1.0 but project pins ^3.2 (Node 18 CI); use fast-check directly via fc.assert/fc.property in spec — @fast-check/vitest installed but not used in imports"
  - "Model type uses const-object pattern instead of const enum: enables runtime iteration and string comparison without TypeScript enum pitfalls"
  - "AbortError sets Object.setPrototypeOf for correct instanceof checks across transpiler targets"

patterns-established:
  - "const-object + type alias: export const Foo = {...} as const; export type Foo = (typeof Foo)[keyof typeof Foo]"
  - "Fuzz test in spec: fc.assert(fc.property(fc.record({...}), (opts) => { ... })) to prove no-throw invariants"
  - "Omit-flag-on-sentinel: check model !== undefined && model !== 'auto' before pushing --model flag"

requirements-completed: [API-02, MDL-01, MDL-02, MDL-03, CWD-02]

# Metrics
duration: 12min
completed: 2026-04-13
---

# Phase 4 Plan 01: QueryOptions, Model enum, buildArgv, and barrel export Summary

**Model const-object with 6 Gemini models, QueryOptions/QueryResult/AbortError types, and pure buildArgv with 29 unit + fuzz tests confirming 100% branch coverage and no-throw invariants**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-13T16:46:00Z
- **Completed:** 2026-04-13T16:54:50Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Created `ts/src/query/types.ts` with Model const (6 values, 2 deprecated), QueryOptions, QueryResult, and AbortError
- Created `ts/src/query/buildArgv.ts` — pure function, zero I/O, maps QueryOptions to argv with correct flag omission for 'auto'/undefined model
- Created `ts/src/query/buildArgv.spec.ts` — 29 tests covering all branches plus 3 property-based fuzz tests via fast-check
- Created `ts/src/query/index.ts` barrel re-exporting all Plan 01 artifacts
- Installed fast-check dev dependency; full tsc --noEmit clean; all 85 project tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create query/types.ts with QueryOptions, QueryResult, Model, AbortError** - `6c6ce86` (feat)
2. **Task 2: Create buildArgv pure function with unit + fuzz tests** - `75b1d41` (feat)
3. **Task 3: Create query/index.ts barrel export** - `74896ec` (feat)

## Files Created/Modified

- `ts/src/query/types.ts` - Model const, QueryOptions, QueryResult, AbortError
- `ts/src/query/buildArgv.ts` - Pure argv builder function
- `ts/src/query/buildArgv.spec.ts` - Unit tests + 3 fast-check fuzz tests (29 tests total)
- `ts/src/query/index.ts` - Barrel export for query module
- `ts/package.json` - Added fast-check and @fast-check/vitest devDependencies
- `pnpm-lock.yaml` - Updated with new packages

## Decisions Made

- `@fast-check/vitest 0.4.0` has a peer dep requiring vitest `^4.1.0`, but the project pins `^3.2` for Node 18 CI matrix support. Used `fast-check` directly via `fc.assert`/`fc.property` in the spec file; `@fast-check/vitest` is installed as specified by the plan but not imported.
- Model type uses const-object + type alias pattern instead of TypeScript `const enum` to enable runtime iteration and avoid enum pitfalls with module bundlers.
- `AbortError` calls `Object.setPrototypeOf(this, new.target.prototype)` to preserve correct `instanceof` behavior across TypeScript compilation targets.

## Deviations from Plan

None — plan executed exactly as written. The `@fast-check/vitest` peer dep warning was handled by using `fast-check` directly (same fc API, no behavior difference).

## Issues Encountered

`@fast-check/vitest 0.4.0` unmet peer vitest `^4.1.0`: vitest is pinned at `^3.2` in this project (Node 18 CI matrix requirement from Phase 02-01 decision). Resolved by using `fast-check` directly in tests — the `fc.assert`/`fc.property` API is identical, no `@fast-check/vitest` integration is needed for these unit tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `QueryOptions`, `QueryResult`, `Model`, `AbortError`, and `buildArgv` are all exported from `ts/src/query/index.ts`
- Plan 04-02 can immediately import `buildArgv` + types to implement `query()`, `queryRaw()`, `queryFull()` async generators
- Plan 04-03 (systemPrompt) may extend `buildArgv` with a `--system-prompt` flag; the function's simple array-push pattern supports this cleanly

---
*Phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection*
*Completed: 2026-04-13*
