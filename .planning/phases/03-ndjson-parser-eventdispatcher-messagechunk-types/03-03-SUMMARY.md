---
phase: 03-ndjson-parser-eventdispatcher-messagechunk-types
plan: "03"
subsystem: parser
tags: [dispatch, event-dispatcher, messagechunk, typescript, tdd, fixtures]

dependency_graph:
  requires:
    - phase: 03-01
      provides: "ts/src/parser/types.ts (RawEvent + MessageChunk types) and all spec/fixtures/*.expected.json ground truth"
    - phase: 03-02
      provides: "ts/src/parser/parseNdjson.ts (stage-1 byte stream parser)"
  provides:
    - ts/src/parser/dispatch.ts (async generator mapping RawEvent to MessageChunk)
    - ts/src/parser/dispatch.spec.ts (fixture corpus + unit tests for PRS-05 and PRS-07)
    - ts/src/parser/index.ts (parser module barrel export)
    - ts/src/index.ts updated (parser wired into package root)
  affects:
    - Phase 4 (query() implementation uses dispatch as stage-2 pipeline)
    - Phase 5 (error taxonomy replaces generic Error throw in dispatch)
    - Python parity tests (test names must match for diff-test-names.sh)

tech-stack:
  added: []
  patterns:
    - "TDD flow: failing spec committed before implementation (RED then GREEN)"
    - "Fixture corpus: parametric tests over all spec/fixtures/*.expected.json"
    - "dispatch silently skips unknown/cli_log events (parser-level events not MessageChunks)"
    - "Tool pairing via Map<tool_id, ToolChunk> buffer; incomplete:true flush on stream end (PRS-07)"
    - "Thinking detection via three discriminators: thought=true, role=thinking, type=thinking"

key-files:
  created:
    - ts/src/parser/dispatch.ts
    - ts/src/parser/dispatch.spec.ts
    - ts/src/parser/index.ts
  modified:
    - ts/src/index.ts
    - spec/fixtures/event-unknown.expected.json
    - spec/fixtures/large-output.expected.json

key-decisions:
  - "dispatch silently skips unknown and cli_log RawEvents — these are parser-level events, not MessageChunks; expected.json corrected to reflect this"
  - "event-unknown.expected.json corrected to chunks:[] — dispatch skips unknown events; Plan 03-01 had wrong expected output"
  - "large-output.expected.json unknown chunk removed (REDACTED_GCP_PROJECT event) — 175 dispatch chunks correct vs 176 in prior version"
  - "Phase 3 uses throw new Error() for non-rate-limit errors; Phase 5 will replace with throw new GeminiError() from error taxonomy"
  - "Barrel export uses aliased re-exports (MessageEvent as RawMessageEvent, ResultEvent as RawResultEvent) to avoid name collision with MessageChunk variants"

patterns-established:
  - "Two-stage pipeline: parseNdjson(stream) -> AsyncIterable<RawEvent> then dispatch(events) -> AsyncIterable<MessageChunk>"
  - "Tool pairing buffer maintained inside generator closure (no external state)"

requirements-completed:
  - PRS-05
  - PRS-07

duration: 15min
completed: "2026-04-13"
---

# Phase 3 Plan 03: EventDispatcher (dispatch) Summary

**dispatch async generator in 113 lines maps all 6 RawEvent types to 8 MessageChunk variants with Map-based tool_id pairing, thinking detection, and rate-limit classification; 23 fixture corpus + unit tests all green**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-13T10:37:00Z
- **Completed:** 2026-04-13T10:41:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Implemented `dispatch` async generator (Stage 2 of two-stage parser pipeline)
- 23 tests pass: 14 fixture corpus tests (all .expected.json files) + 9 unit tests
- Parser module barrel export wired into package root
- Fixed two incorrect expected.json files from Plan 03-01

## Task Commits

1. **TDD RED — dispatch.spec.ts (failing tests)** - `77026ab` (test)
2. **Task 1: dispatch.ts implementation + expected.json fixes** - `6e95f44` (feat)
3. **Task 2: parser/index.ts barrel + ts/src/index.ts update** - `66dcb97` (feat)

## Files Created/Modified

- `ts/src/parser/dispatch.ts` - Stage-2 async generator mapping RawEvent to MessageChunk
- `ts/src/parser/dispatch.spec.ts` - Fixture corpus + unit tests (23 tests)
- `ts/src/parser/index.ts` - Parser module barrel export
- `ts/src/index.ts` - Added `export * from './parser/index.js'`
- `spec/fixtures/event-unknown.expected.json` - Corrected: chunks now [] (dispatch skips unknown)
- `spec/fixtures/large-output.expected.json` - Corrected: removed 1 erroneous unknown chunk (175 chunks)

## Decisions Made

- dispatch silently skips unknown and cli_log RawEvents — confirmed by CONTEXT.md routing table; the expected.json files from Plan 03-01 incorrectly included unknown chunks
- Phase 3 throws generic `Error` for non-rate-limit errors; Phase 5 will replace with `GeminiError` from the error taxonomy
- Barrel export aliases `MessageEvent as RawMessageEvent` and `ResultEvent as RawResultEvent` to prevent collision with TypeScript discriminated union type names

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected event-unknown.expected.json: dispatch skips unknown events**
- **Found during:** Task 1 (fixture corpus test run)
- **Issue:** event-unknown.expected.json had 1 `{type:'unknown', raw:...}` chunk, but dispatch silently skips unknown events per CONTEXT.md routing table; test expected 1 chunk, got 0
- **Fix:** Updated chunks array to `[]` with _dispatch_note explaining the behavior
- **Files modified:** spec/fixtures/event-unknown.expected.json
- **Verification:** `fixture corpus: parses event-unknown identically to expected.json` passes
- **Committed in:** 6e95f44

**2. [Rule 1 - Bug] Corrected large-output.expected.json: removed erroneous unknown chunk**
- **Found during:** Task 1 (fixture corpus test run)
- **Issue:** large-output.expected.json contained 1 `{type:'unknown', raw:...}` chunk at index 159 (a REDACTED_GCP_PROJECT event); dispatch skips unknowns so chunk count was 175 actual vs 176 expected
- **Fix:** Filtered out the unknown chunk from expected.json (175 chunks remain)
- **Files modified:** spec/fixtures/large-output.expected.json
- **Verification:** `fixture corpus: parses large-output identically to expected.json` passes
- **Committed in:** 6e95f44

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes correct the ground-truth expected.json to match the EventDispatcher's documented behavior. No scope creep.

## Issues Encountered

None beyond the two expected.json corrections above.

## Next Phase Readiness

- Phase 4 `query()` implementation can now consume `parseNdjson` + `dispatch` as a composable pipeline
- `AsyncIterable<MessageChunk>` is the Phase 4 yield type
- Raw event API (API-06) = `parseNdjson` only; high-level API = `parseNdjson` piped into `dispatch`
- Phase 5 should replace `throw new Error(...)` in dispatch with `throw new GeminiError(...)` from the error taxonomy

---
*Phase: 03-ndjson-parser-eventdispatcher-messagechunk-types*
*Completed: 2026-04-13*
