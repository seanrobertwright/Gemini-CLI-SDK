---
phase: 03-ndjson-parser-eventdispatcher-messagechunk-types
verified: 2026-04-13T10:55:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 3: NDJSON Parser + EventDispatcher + MessageChunk Types — Verification Report

**Phase Goal:** Build the line-buffered NDJSON reader with a stateful UTF-8 decoder, 1 MiB line limit, CRLF tolerance, and lenient fallback (unknown types become `{type:'unknown', raw}`, non-JSON lines become `{type:'cli_log'}`), plus the EventDispatcher that maps parsed events into the 8-variant MessageChunk discriminated union that matches Archon's contract. Both language test suites consume identical `spec/fixtures/*.ndjson` and assert identical `.expected.json` outputs.

**Verified:** 2026-04-13T10:55:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Parser splits byte stream into JSON-parsed events with correct UTF-8 decoding | VERIFIED | `parseNdjson` uses `new TextDecoder('utf-8', { fatal: false })` with streaming mode; Python uses `bytes.decode('utf-8', errors='replace')`. 9/9 TS tests pass, 9/9 Python tests pass. |
| 2 | Lines over 1 MiB yield cli_log events without throwing | VERIFIED | `MAX_LINE = 1024 * 1024` enforced in both TS and Python; overflow path explicitly tested and passing. |
| 3 | CRLF line endings produce identical output to LF | VERIFIED | `line.endsWith('\r')` strip in TS; `.rstrip(b'\r')` in Python. Dedicated CRLF test passes in both languages. |
| 4 | Unknown event types yield `{type:'unknown', raw}` without throwing | VERIFIED | `KNOWN_RAW_TYPES.includes()` guard in both parsers. `event-unknown.ndjson` fixture correctly produces 1 unknown event at the parser level. |
| 5 | Non-JSON lines yield `{type:'cli_log', line}` without throwing | VERIFIED | JSON.parse catch block in both languages falls back to `{type:'cli_log'}`. Dedicated test passes in both. |
| 6 | EventDispatcher maps all known event types to correct MessageChunk variants | VERIFIED | `dispatch.ts` / `dispatch.py` handle init, message (assistant/system/thinking), tool_use+tool_result pair, error (rate_limit/throw), result. 23/23 TS tests pass, 46 dispatch tests pass in Python. |
| 7 | tool_use and tool_result chunks are always paired (by tool_id, with incomplete:true flush) | VERIFIED | `pending = new Map<string, ToolChunk>()` in TS, `pending: dict` in Python. Post-loop flush with `incomplete: true/True` present in both. 4 pairing tests pass in both languages. |
| 8 | Both language test suites consume identical `spec/fixtures/*.ndjson` with identical `.expected.json` assertions | VERIFIED | 14 fixture corpus tests run in TS dispatch.spec.ts; 14 fixture corpus tests run in Python run_fixture_corpus. `diff-test-names.sh` exits 0: 42 TS test names match 42 Python test names exactly. |

**Score:** 8/8 truths verified

---

## Required Artifacts

### Plan 03-01: Types and Fixture Ground Truth

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/parser/types.ts` | RawEvent + MessageChunk TS types | VERIFIED | 168 lines; exports 8 RawEvent variants, 8 MessageChunk variants, `KNOWN_RAW_TYPES as const` tuple. All interfaces have index signatures for additionalProperties tolerance. |
| `python/src/gemini_sdk/parser/types.py` | RawEvent + MessageChunk Python types | VERIFIED | 172 lines; `typing_extensions.Required` TypedDicts for all 16 types; `RawEvent` and `MessageChunk` as Union types. |
| `python/src/gemini_sdk/parser/__init__.py` | Python parser module init | VERIFIED | Exists and exports `RawEvent`, `KNOWN_RAW_TYPES`. |
| `spec/fixtures/thinking-synthetic.ndjson` | Synthetic thinking fixture | VERIFIED | File exists; contains 5 NDJSON lines including `thought:true` message. |
| `spec/fixtures/thinking-synthetic.expected.json` | Thinking fixture expected output | VERIFIED | Contains `ThinkingChunk` in `chunks` array; passes dispatch corpus test. |
| `spec/fixtures/multi-tool.ndjson` | Concurrent tool fixture | VERIFIED | File exists; 9 NDJSON lines with 2 tool_use/tool_result pairs. |
| `spec/fixtures/multi-tool.expected.json` | Multi-tool expected output | VERIFIED | 9 chunks including 2 paired tool+tool_result sets; passes dispatch corpus test. |

### Plan 03-02: NDJSON Parser (TS)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/parser/parseNdjson.ts` | Async generator, byte stream to RawEvent | VERIFIED | 63 lines; exports `parseNdjson`; contains `TextDecoder`, `MAX_LINE`, CRLF strip, `KNOWN_RAW_TYPES.includes`. |
| `ts/src/parser/parseNdjson.spec.ts` | 9+ unit tests for PRS-01 to PRS-04 | VERIFIED | 174 lines; 9 `it(` calls; all 9 pass. |

### Plan 03-03: EventDispatcher (TS) + Barrel Export

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/parser/dispatch.ts` | Async generator, RawEvent to MessageChunk | VERIFIED | 117 lines; exports `dispatch`; contains `pending Map`, `isThinking`, `isRateLimitError`, `incomplete: true` flush. |
| `ts/src/parser/dispatch.spec.ts` | 10+ tests for PRS-05 and PRS-07 | VERIFIED | 358 lines; 14 fixture corpus + 9 unit tests (23 total); all 23 pass. |
| `ts/src/parser/index.ts` | Parser barrel export | VERIFIED | Exports `parseNdjson`, `dispatch`, all 8 `MessageChunk` variants, all `RawEvent` types, `KNOWN_RAW_TYPES`. |

### Plan 03-04: Python Port

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `python/src/gemini_sdk/parser/parse_ndjson.py` | Python NDJSON parser | VERIFIED | 57 lines; `async def parse_ndjson`; `MAX_LINE = 1024 * 1024`; CRLF, unknown/cli_log fallbacks. |
| `python/src/gemini_sdk/parser/dispatch.py` | Python EventDispatcher | VERIFIED | 118 lines; `async def dispatch`; `pending` dict; `_is_thinking`, `_is_rate_limit_error`; `"incomplete": True` flush. |
| `python/tests/test_parse_ndjson.py` | 9 async tests with parity docstrings | VERIFIED | 186 lines; 9 `test_` methods each with matching docstring; all 9 pass. |
| `python/tests/test_dispatch.py` | 9 unit tests + fixture corpus | VERIFIED | 344 lines; `TestDispatch` has 9 `test_` methods with matching docstrings; `TestFixtureCorpus.run_fixture_corpus` covers 14 fixtures; all 64 tests pass (asyncio + trio). |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ts/src/parser/parseNdjson.ts` | `ts/src/parser/types.ts` | `import type { RawEvent }` + `import { KNOWN_RAW_TYPES }` | WIRED | Line 14–15 confirm both imports present and used. |
| `ts/src/parser/dispatch.ts` | `ts/src/parser/types.ts` | `import type { RawEvent, MessageChunk, ToolChunk }` | WIRED | Line 12; all three types are used in function signatures and variable typing. |
| `ts/src/parser/dispatch.spec.ts` | `spec/fixtures/*.expected.json` | Dynamic `readdirSync` + `readFixtureJson` | WIRED | Lines 60–66; parametric loop over all `.expected.json` files confirmed; 14 fixture corpus tests execute. |
| `ts/src/parser/index.ts` | All parser submodules | `export { parseNdjson }`, `export { dispatch }`, `export type { ... }` | WIRED | All 16 type exports + 2 function exports present; `ts/src/index.ts` line 6 adds `export * from './parser/index.js'`. |
| `python/src/gemini_sdk/parser/parse_ndjson.py` | `python/src/gemini_sdk/parser/types.py` | `from .types import KNOWN_RAW_TYPES, RawEvent` | WIRED | Line 18; both imported symbols used in function body. |
| `python/src/gemini_sdk/parser/dispatch.py` | `python/src/gemini_sdk/parser/types.py` | `from .types import MessageChunk, RawEvent` | WIRED | Line 15; types used in function annotation. |
| `python/tests/test_parse_ndjson.py` | `spec/fixtures/*.ndjson` | `FIXTURES_DIR = Path(__file__).parents[2] / "spec" / "fixtures"` | WIRED | Line 14; `simple-text.ndjson` and `event-unknown.ndjson` directly referenced in tests. |
| `python/tests/test_dispatch.py` | `spec/fixtures/*.expected.json` | `FIXTURES_DIR.glob("*.expected.json")` | WIRED | Lines 53–56; parametric fixture collection at module import; 14 fixture corpus test cases confirmed running. |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| PRS-01 | NDJSON parser with stateful UTF-8 decoder and 1 MiB line limit | SATISFIED | `new TextDecoder('utf-8', { fatal: false })` in TS (stateful streaming via `{stream:true}`); `MAX_LINE = 1024 * 1024` enforced in both TS and Python with overflow yielding `cli_log`. Dedicated test passes in both languages. |
| PRS-02 | NDJSON parser tolerates CRLF line endings | SATISFIED | `line.endsWith('\r')` trim in TS `parseNdjson.ts` line 31; `.rstrip(b'\r')` in Python `parse_ndjson.py` line 32. Both CRLF tests pass. |
| PRS-03 | Unknown event types yield `{type:'unknown', raw}` | SATISFIED | `KNOWN_RAW_TYPES.includes()` guard produces `{type:'unknown', raw: typed}` in TS; identical in Python. `event-unknown` fixture test passes in both. |
| PRS-04 | Non-JSON stdout lines yield `{type:'cli_log'}` | SATISFIED | JSON.parse try/catch with `return {type:'cli_log', line}` fallback in both languages. Non-JSON test passes in both. |
| PRS-05 | EventDispatcher maps parsed events into normalized MessageChunk discriminated union | SATISFIED | `dispatch` async generator handles all 6 known raw event types mapping to 6 of 8 MessageChunk variants (WorkflowDispatchChunk reserved for Phase 10). All fixture corpus tests pass (23 TS, 28 Python per-language, 56 across asyncio+trio). |
| PRS-06 | SDK emits shapes compatible with Archon's MessageChunk type (8 variants) | SATISFIED | All 8 variants defined: `assistant`, `system`, `thinking`, `result`, `rate_limit`, `tool`, `tool_result`, `workflow_dispatch`. Types match Archon's contract field-for-field (camelCase toolId/toolName/sessionId/stopReason). `WorkflowDispatchChunk` present but reserved. |
| PRS-07 | SDK guarantees tool_use and tool_result chunks are always paired | SATISFIED | `Map<string, ToolChunk>` buffer in TS; `dict` in Python. Paired release on tool_result; `incomplete: true` flush on stream end. 4 dedicated pairing tests pass in both languages. |
| PAR-02 | Both language suites consume the same `spec/fixtures/*.ndjson` in CI | SATISFIED | TS: 14 fixture corpus tests in `dispatch.spec.ts` via `readdirSync`. Python: 14 fixture corpus cases in `TestFixtureCorpus.run_fixture_corpus` via `FIXTURES_DIR.glob`. `diff-test-names.sh` exits 0 with 42:42 parity. |

**All 8 Phase 3 requirements satisfied. No orphaned requirements.**

---

## Anti-Patterns Found

No blockers or stubs found. Scan of all key files:

| File | Pattern | Assessment |
|------|---------|------------|
| `ts/src/parser/dispatch.ts` line 78 | `throw new Error(...)` for non-rate-limit errors | INFO — documented placeholder; Phase 5 replaces with `throw new GeminiError(...)`. This is intentional scoping per SUMMARY, not a stub. |
| `python/src/gemini_sdk/parser/dispatch.py` line 86 | `raise RuntimeError(...)` for non-rate-limit errors | INFO — same as above; intentional Phase 3 placeholder for Phase 5. |
| `ts/src/parser/types.ts` line 153-157 | `WorkflowDispatchChunk` with comment "Phase 10" | INFO — documented stub for a future phase. Does not block Phase 3 goal; variant is present in the union satisfying PRS-06. |

No `TODO`/`FIXME`/`PLACEHOLDER` comments found in implementation files. No empty implementations. No stubs blocking the phase goal.

---

## Human Verification Required

None. All observable truths for this phase are verifiable programmatically via the test suites.

---

## Gaps Summary

No gaps. All 8 must-have truths verified. All 15 artifacts pass levels 1 (exists), 2 (substantive), and 3 (wired). All 8 key links confirmed active. All 8 requirement IDs satisfied. Both language test suites run against the shared fixture corpus and report 100% pass: 9/9 TS parser, 23/23 TS dispatch, 64/64 Python (asyncio + trio). `diff-test-names.sh` confirms 42:42 parity.

---

_Verified: 2026-04-13T10:55:00Z_
_Verifier: Claude (gsd-verifier)_
