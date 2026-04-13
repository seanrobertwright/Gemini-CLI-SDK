---
phase: 03-ndjson-parser-eventdispatcher-messagechunk-types
plan: "02"
subsystem: parser
tags: [ndjson, parser, utf-8, streaming, tdd]
dependency_graph:
  requires: ["03-01"]
  provides: ["03-03", "03-04"]
  affects: ["ts/src/parser/parseNdjson.ts"]
tech_stack:
  added: []
  patterns: ["TDD red-green", "async generator", "TextDecoder streaming"]
key_files:
  created:
    - ts/src/parser/parseNdjson.ts
    - ts/src/parser/parseNdjson.spec.ts
  modified: []
decisions:
  - "KNOWN_RAW_TYPES.includes type cast uses (typeof KNOWN_RAW_TYPES)[number] to satisfy strict TS compilation — as const tuple's includes() requires literal union, not plain string"
metrics:
  duration_minutes: 1
  tasks_completed: 1
  files_created: 2
  files_modified: 0
  completed_date: "2026-04-13"
---

# Phase 03 Plan 02: parseNdjson Async Generator Summary

**One-liner:** NDJSON byte-stream parser using TextDecoder streaming with 1 MiB line limit, CRLF tolerance, and lenient JSON fallbacks for unknown types and non-JSON lines.

## What Was Built

`ts/src/parser/parseNdjson.ts` — async generator that converts `AsyncIterable<Uint8Array>` to `AsyncGenerator<RawEvent>`. All 4 parser requirements (PRS-01 through PRS-04) are satisfied:

- **PRS-01** — 1 MiB line overflow detected mid-stream; oversized content yields `{type:'cli_log'}` without throwing
- **PRS-02** — CRLF stripped before line processing; identical output to LF-only input
- **PRS-03** — JSON objects with unrecognised `type` fields yield `{type:'unknown', raw}` without throwing
- **PRS-04** — Non-JSON lines yield `{type:'cli_log', line}` without throwing

`ts/src/parser/parseNdjson.spec.ts` — 9 unit tests covering all PRS requirements, plus split UTF-8, empty-line skipping, buffer flush on stream end, and empty stream.

## Task Execution

### Task 1: Implement parseNdjson async generator (TDD)

**RED commit:** `daacdbe` — 9 failing tests (module not found)
**GREEN commit:** `8eb1e47` — implementation + type fix; all 9 tests pass, `tsc --noEmit` clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type Error] KNOWN_RAW_TYPES.includes strict type argument**
- **Found during:** Task 1 GREEN phase, `tsc --noEmit`
- **Issue:** `KNOWN_RAW_TYPES` is `as const` tuple; its `includes()` method requires the literal union type `(typeof KNOWN_RAW_TYPES)[number]`, not `string`. The plan's code sample passed `typed['type'] as string` which fails strict compilation.
- **Fix:** Cast to `typed['type'] as (typeof KNOWN_RAW_TYPES)[number]` — semantically equivalent, type-safe.
- **Files modified:** `ts/src/parser/parseNdjson.ts`
- **Commit:** `8eb1e47`

## Verification Results

```
npx vitest run --reporter=verbose src/parser/parseNdjson.spec.ts
  9/9 passed
npx tsc --noEmit
  0 errors
```

## Self-Check: PASSED

- ts/src/parser/parseNdjson.ts: FOUND
- ts/src/parser/parseNdjson.spec.ts: FOUND
- Commit daacdbe (RED): FOUND
- Commit 8eb1e47 (GREEN): FOUND
