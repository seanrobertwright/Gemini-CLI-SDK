---
phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection
plan: 02
subsystem: api
tags: [typescript, async-generator, subprocess, abort-signal, vitest, mock]

# Dependency graph
requires:
  - phase: 04-01
    provides: buildArgv, QueryOptions, QueryResult, AbortError, Model types
  - phase: 03-03
    provides: parseNdjson, dispatch async generators, MessageChunk types
  - phase: 02-02
    provides: ProcessManager, killTree, SpawnOptions2

provides:
  - query() async generator yielding MessageChunk stream with abort, temp file, model mismatch
  - queryRaw() async generator yielding RawEvent stream (dispatch bypassed)
  - queryFull() accumulator returning Promise<QueryResult>
  - ResultChunk extended with requestedModel/actualModel optional fields (MDL-04)
  - 13 mock-spawn tests covering all behaviors including mid-tool abort flush
  - query module wired into package root barrel (ts/src/index.ts)

affects:
  - phase-05 (error taxonomy — will replace generic Error throw with GeminiError)
  - phase-07 (session resumption — builds on query() entry point)
  - phase-10 (Archon adapter — consumes query() directly)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.hoisted() for variables referenced inside vi.mock() factories in Vitest ESM"
    - "clearAllMocks() resets mock implementations — re-apply mockResolvedValue in beforeEach"
    - "Abort flush contract: pending tool_use chunks yielded with incomplete:true before AbortError"
    - "Model mismatch detection: requestedModel vs actualModel captured from init event, enriched on ResultChunk"

key-files:
  created:
    - ts/src/query/query.ts
    - ts/src/query/query.spec.ts
  modified:
    - ts/src/parser/types.ts
    - ts/src/query/index.ts
    - ts/src/index.ts

key-decisions:
  - "vi.hoisted() required for mock variables used inside vi.mock() factory: Vitest hoists vi.mock() calls to top-of-file but const declarations are not hoisted — vi.hoisted() solves the TDZ problem"
  - "vi.clearAllMocks() resets mockResolvedValue implementations — must re-apply in beforeEach after clearAllMocks"
  - "pendingToolChunks in query() tracks tool_use/tool_result pairing independently from dispatch, enabling abort flush at query layer"
  - "query() yields ResultChunk with requestedModel/actualModel only when both defined and different; model=auto skips detection entirely"

patterns-established:
  - "Mock pattern: vi.hoisted() + vi.mock() factory closure for ESM mocks with shared state"
  - "Abort pattern: aborted flag + finally block for subprocess cleanup; flush incomplete tool chunks before throwing"
  - "Temp file pattern: writeTempSystemPrompt() returns path or undefined; finally block always calls unlink(tempPath) with catch ignore"

requirements-completed:
  - API-01
  - API-03
  - API-04
  - API-05
  - API-06
  - SYS-01
  - SYS-02
  - CWD-01
  - MDL-04

# Metrics
duration: 25min
completed: 2026-04-13
---

# Phase 04 Plan 02: Public Query API Summary

**query/queryRaw/queryFull async generators wired over ProcessManager+parseNdjson+dispatch with abort/temp-file lifecycle, model mismatch detection, and 13 mock-spawn tests**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-13T17:00:00Z
- **Completed:** 2026-04-13T17:05:00Z
- **Tasks:** 3 completed
- **Files modified:** 5

## Accomplishments
- Implemented `query()` async generator with full lifecycle: temp system prompt file, subprocess spawn, parseNdjson+dispatch pipeline, abort signal support with tool chunk flush, model downgrade detection on ResultChunk
- Implemented `queryRaw()` that bypasses dispatch for raw RawEvent access, and `queryFull()` accumulator wrapper
- Extended `ResultChunk` with `requestedModel?` and `actualModel?` fields for MDL-04 model mismatch surfacing
- 13 mock-spawn tests covering all behaviors (stream, cwd, systemPrompt, temp cleanup, abort, mid-tool flush, model downgrade, queryRaw, queryFull) — all 98 tests in suite pass
- Wired `query`, `queryRaw`, `queryFull` into `ts/src/query/index.ts` and `ts/src/index.ts` package root

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ResultChunk and implement query functions** - `48de466` (feat)
2. **Task 2: Mock-spawn tests for query, queryRaw, queryFull** - `4d902e3` (test)
3. **Task 3: Update barrel exports and wire into package root** - `a835caa` (feat)

## Files Created/Modified
- `ts/src/query/query.ts` - query, queryRaw, queryFull async generators with full lifecycle
- `ts/src/query/query.spec.ts` - 13 mock-spawn integration tests
- `ts/src/parser/types.ts` - ResultChunk extended with requestedModel/actualModel
- `ts/src/query/index.ts` - barrel updated with query, queryRaw, queryFull exports
- `ts/src/index.ts` - package root adds `export * from './query/index.js'`

## Decisions Made
- `vi.hoisted()` required for variables referenced inside `vi.mock()` factories — Vitest hoists `vi.mock()` to top-of-file but `const` declarations are not hoisted, causing TDZ errors; `vi.hoisted()` solves this cleanly
- `vi.clearAllMocks()` in `beforeEach` resets `mockResolvedValue` implementations — re-apply `mockResolvedValue(undefined)` for `writeFile` and `unlink` after `clearAllMocks()` to avoid `undefined.catch()` errors
- Tool chunk buffering in `query()` via `pendingToolChunks` array tracks paired tool_use/tool_result at the query layer, independent of dispatch's internal pending map — enables abort flush before throwing AbortError
- ResultChunk enrichment skips model mismatch when `requestedModel === 'auto'` or undefined, ensuring no false-positive downgrade warnings

## Deviations from Plan

None - plan executed exactly as written. The only fixes were to the test file itself (vi.hoisted() usage and clearAllMocks behavior), not to the implementation.

## Issues Encountered
- Vitest ESM mock hoisting: `vi.mock()` factory references `mockKillTree` which isn't initialized yet due to TDZ. Fixed with `vi.hoisted()` — see Decision 1 above.
- `vi.clearAllMocks()` resets mock implementations (not just call history): `unlink.mockResolvedValue(undefined)` was cleared before each test, causing `unlink()` to return `undefined` instead of a Promise. Fixed by re-applying implementations in `beforeEach`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 04 Plan 02 complete: `query()`, `queryRaw()`, `queryFull()` are fully implemented and tested
- Phase 5 (error taxonomy) can now replace the generic `throw new Error(...)` in dispatch.ts with `GeminiError` instances
- Phase 7 (session resumption) can build on `query()` as the primary entry point
- All 98 tests in the TS SDK test suite pass

---
*Phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection*
*Completed: 2026-04-13*
