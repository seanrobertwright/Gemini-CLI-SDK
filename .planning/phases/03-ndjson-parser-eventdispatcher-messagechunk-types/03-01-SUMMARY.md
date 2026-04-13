---
phase: 03-ndjson-parser-eventdispatcher-messagechunk-types
plan: "01"
subsystem: parser-types
tags: [types, fixtures, typescript, python, messagechunk]
dependency_graph:
  requires: []
  provides:
    - ts/src/parser/types.ts (RawEvent + MessageChunk TS types)
    - python/src/gemini_sdk/parser/types.py (RawEvent + MessageChunk Python types)
    - spec/fixtures/*.expected.json (14 ground-truth fixture files)
    - spec/fixtures/thinking-synthetic.ndjson
    - spec/fixtures/multi-tool.ndjson
  affects:
    - Phase 3 Plan 2 (NDJSON parser implementation)
    - Phase 3 Plan 3 (EventDispatcher implementation)
    - Phase 3 Plan 4 (parser/dispatcher tests)
tech_stack:
  added: []
  patterns:
    - Discriminated union types with literal `type` fields (TS + Python TypedDict)
    - Required fields in partial TypedDicts via typing_extensions.Required
    - EventDispatcher output shape: camelCase (toolId, toolName, sessionId, stopReason)
key_files:
  created:
    - ts/src/parser/types.ts
    - python/src/gemini_sdk/parser/__init__.py
    - python/src/gemini_sdk/parser/types.py
    - spec/fixtures/thinking-synthetic.ndjson
    - spec/fixtures/thinking-synthetic.expected.json
    - spec/fixtures/multi-tool.ndjson
    - spec/fixtures/multi-tool.expected.json
  modified:
    - spec/fixtures/simple-text.expected.json
    - spec/fixtures/tool-use-builtin.expected.json
    - spec/fixtures/resume-session-turn1.expected.json
    - spec/fixtures/resume-session-turn2.expected.json
    - spec/fixtures/thinking.expected.json
    - spec/fixtures/error-rate-limit.expected.json
    - spec/fixtures/error-auth.expected.json
    - spec/fixtures/event-unknown.expected.json
    - spec/fixtures/multimodal-image.expected.json
    - spec/fixtures/multimodal-pdf.expected.json
    - spec/fixtures/large-output.expected.json
decisions:
  - "Python types use typing_extensions.Required to mark required fields in total=False TypedDicts — avoids verbose total=True/False split"
  - "event-unknown.expected.json raw field now contains full cosmic_ray_hit object (not placeholder comment)"
  - "error-auth.expected.json uses _throws:true sentinel marker — non-rate-limit errors throw GeminiError, not yield a chunk"
  - "abort-midstream.expected.json unchanged — empty chunks array is correct (NDJSON file has 1 byte, no events)"
  - "thinking.expected.json: user message fixed to system chunk; no thinking events in real capture (confirmed Phase 1)"
metrics:
  duration_minutes: 4
  completed_date: "2026-04-13"
  tasks_completed: 3
  files_created: 7
  files_modified: 11
---

# Phase 3 Plan 01: MessageChunk Types and Fixture Ground Truth Summary

**One-liner:** 8-variant MessageChunk + RawEvent discriminated unions in TS and Python, with all 14 expected.json fixture files corrected to final EventDispatcher output shapes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Define RawEvent and MessageChunk types in TS and Python | 35e1fb0 | ts/src/parser/types.ts, python/.../parser/types.py, __init__.py |
| 2 | Update all 12 expected.json files to final EventDispatcher output shapes | e30035a | 11 spec/fixtures/*.expected.json |
| 3 | Create thinking-synthetic and multi-tool synthetic fixtures | 526d517 | 4 new spec/fixtures files |

## What Was Built

### TypeScript Types (`ts/src/parser/types.ts`)

- **RawEvent** — 8-type discriminated union: InitEvent, MessageEvent, ResultEvent, ToolUseEvent, ToolResultEvent, ErrorEvent, UnknownEvent, CliLogEvent
- **MessageChunk** — 8-variant discriminated union: AssistantChunk, SystemChunk, ThinkingChunk, ResultChunk, RateLimitChunk, ToolChunk, ToolResultChunk, WorkflowDispatchChunk
- **KNOWN_RAW_TYPES** — const array of the 6 structured event types
- All interfaces use `[key: string]: unknown` index signatures for additionalProperties tolerance

### Python Types (`python/src/gemini_sdk/parser/types.py`)

- Equivalent TypedDict definitions for all 8 MessageChunk variants and 8 RawEvent types
- Uses `typing_extensions.Required` to mark required fields in `total=False` TypedDicts
- RawEvent and MessageChunk defined as Union types
- KNOWN_RAW_TYPES list matches TS counterpart

### Expected.json Fixture Updates (12 files)

All Phase 1 placeholder shapes replaced with final EventDispatcher output:

| Fixture | Change |
|---------|--------|
| simple-text | user → system/message |
| tool-use-builtin | unknown tool_use/tool_result → paired tool/tool_result |
| resume-session-turn1 | unknown tool_use/tool_result → paired tool/tool_result (with error field) |
| resume-session-turn2 | user → system/message |
| thinking | user → system/message (no thinking events in real capture) |
| error-rate-limit | type:error → type:rate_limit (code 429, status RESOURCE_EXHAUSTED) |
| error-auth | type:error → _throws:true (non-rate-limit throws GeminiError) |
| event-unknown | placeholder _comment → full cosmic_ray_hit raw object |
| multimodal-image | user → system/message |
| multimodal-pdf | user → system/message |
| large-output | user → system/message |
| abort-midstream | no change (already correct: empty chunks) |

### Synthetic Fixtures (2 new pairs)

- **thinking-synthetic.ndjson/expected.json** — 5-line stream with `thought:true` discriminator; expected output includes ThinkingChunk
- **multi-tool.ndjson/expected.json** — 9-line stream with 2 concurrent tool_use/tool_result pairs; expected output verifies Map-based tool_id pairing

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `npx tsc --noEmit src/parser/types.ts` exits 0
- `python -c "from gemini_sdk.parser.types import MessageChunk, RawEvent"` exits 0
- All 14 expected.json files are valid JSON
- No `"type": "user"` chunks remain in any expected.json
- No `"type": "unknown"` for tool events (only cosmic_ray_hit in event-unknown)
- Synthetic fixtures: valid NDJSON, correct chunk counts

## Self-Check: PASSED

Files exist:
- ts/src/parser/types.ts: FOUND
- python/src/gemini_sdk/parser/types.py: FOUND
- python/src/gemini_sdk/parser/__init__.py: FOUND
- spec/fixtures/thinking-synthetic.ndjson: FOUND
- spec/fixtures/thinking-synthetic.expected.json: FOUND
- spec/fixtures/multi-tool.ndjson: FOUND
- spec/fixtures/multi-tool.expected.json: FOUND

Commits:
- 35e1fb0: feat(03-01): define RawEvent and MessageChunk types in TS and Python
- e30035a: feat(03-01): update all 12 expected.json files to final EventDispatcher output shapes
- 526d517: feat(03-01): create thinking-synthetic and multi-tool synthetic fixtures
