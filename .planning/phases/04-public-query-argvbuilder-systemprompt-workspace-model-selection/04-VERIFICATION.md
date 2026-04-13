---
phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection
verified: 2026-04-13T17:30:00Z
status: passed
score: 15/15 must-haves verified
re_verification: false
---

# Phase 4: Public query() + ArgvBuilder + systemPrompt + Workspace + Model Selection — Verification Report

**Phase Goal:** Ship the public `query(options): AsyncIterable<MessageChunk>` async generator — the SDK's only public entry point — wired to the pure-function `buildArgv(options): string[]`, cancellation via abortSignal/cancel_scope, temp-file GEMINI_SYSTEM_MD (cleaned up in finally), cwd + --include-directories for workspace context, and the typed model enum with @deprecated 2.5-series markings + string escape hatch + silent-downgrade detection via the init event. First real gemini-cli round-trip happens here. Non-streaming helper is a thin wrapper. Raw-event API is exposed alongside the mapped generator.

**Verified:** 2026-04-13T17:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | buildArgv produces correct argv for every combinatoric option input without throwing | VERIFIED | `ts/src/query/buildArgv.ts` implements pure function with correct flag rules; 29 unit tests + 3 fast-check fuzz tests all pass; Python parity in `build_argv.py` with hypothesis fuzz tests |
| 2 | Model enum contains all known Gemini models with 2.5 series marked @deprecated | VERIFIED | `ts/src/query/types.ts` exports `Model` const object with 6 values; FLASH_25 and PRO_25 have `@deprecated` JSDoc; Python `Model(str, enum.Enum)` with same 6 values |
| 3 | Model 'auto' and undefined both omit --model flag from argv | VERIFIED | `buildArgv.ts` line 27: `if (options.model !== undefined && options.model !== 'auto')`; confirmed by multiple unit tests and fuzz tests |
| 4 | Raw string model values are passed through to --model flag | VERIFIED | MDL-02 implemented; test `buildArgv: string escape hatch` passes for 'custom-future-model' and 'gemini-99-ultra' |
| 5 | additionalDirectories maps to repeated --include-directories flags | VERIFIED | `buildArgv.ts` lines 32-36; test confirms `['dir1','dir2']` → two `--include-directories` flags |
| 6 | query() yields a MessageChunk stream backed by a subprocess pipeline | VERIFIED | `ts/src/query/query.ts` wires ProcessManager → parseNdjson → dispatch; mock-spawn test `yields MessageChunk stream from subprocess` passes |
| 7 | queryRaw() yields RawEvent stream skipping dispatch | VERIFIED | `queryRaw()` pipelines only `parseNdjson`, no `dispatch()`; test `queryRaw: yields RawEvent stream (not MessageChunks)` passes confirming `session_id` field (raw) not `sessionId` (mapped) |
| 8 | queryFull() accumulates chunks into a QueryResult with .text, .sessionId, .stopReason | VERIFIED | `queryFull()` wraps `query()` accumulating content; test confirms `text='Hello, world!'`, `sessionId='s1'`, `stopReason='end_turn'` |
| 9 | Aborting mid-stream kills subprocess, deletes temp file, flushes pending tool_use chunks with incomplete: true, then throws AbortError | VERIFIED | `pendingToolChunks` tracked; finally block calls `killTree()` + `unlink()`; abort flush loop at lines 143-147; 4 abort-related tests all pass |
| 10 | systemPrompt creates a temp .md file and sets GEMINI_SYSTEM_MD env var | VERIFIED | `writeTempSystemPrompt()` creates file at `gemini-sdk-system-{hex}.md`; sets `envOverrides['GEMINI_SYSTEM_MD']`; test confirms writeFile called + spawn receives GEMINI_SYSTEM_MD |
| 11 | Temp system-prompt file is deleted in finally even on error or abort | VERIFIED | `finally` block at lines 149-157 calls `unlink(tempPath)`; tests for normal completion AND abort both verify unlink called |
| 12 | cwd option is passed to subprocess spawnOptions.cwd | VERIFIED | `manager.spawn({ ..., spawnOptions: { cwd: options.cwd } })`; test `passes cwd to spawn spawnOptions` passes |
| 13 | Model mismatch from init event surfaces requestedModel/actualModel on ResultChunk | VERIFIED | `ResultChunk` extended with `requestedModel?` and `actualModel?`; `query()` enriches on mismatch; test `model downgrade detection` confirms both fields populated; `model: 'auto'` test confirms no false positive |
| 14 | Python query() yields MessageChunk stream matching TS behavior | VERIFIED | `python/src/gemini_sdk/query/query.py` implements same lifecycle; 13 tests pass for asyncio and trio backends (26 total) |
| 15 | 84:84 TS/Python test parity verified | VERIFIED | `bash scripts/diff-test-names.sh` exits 0 with output "OK: TS and Python test names match (84 tests)" |

**Score:** 15/15 truths verified

---

### Required Artifacts

#### TypeScript — Plan 01

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/query/types.ts` | QueryOptions, QueryResult, Model const enum, AbortError | VERIFIED | 99 lines; exports all 4 items; Model has 6 values with 2x @deprecated; AbortError uses Object.setPrototypeOf |
| `ts/src/query/buildArgv.ts` | Pure function mapping QueryOptions to string[] argv | VERIFIED | 39 lines; zero I/O; all branches covered |
| `ts/src/query/buildArgv.spec.ts` | Unit tests + fuzz test | VERIFIED | 251 lines (>80 min); 29 tests including 3 fast-check fuzz properties |
| `ts/src/query/index.ts` | Barrel export | VERIFIED | Exports buildArgv, query, queryRaw, queryFull, Model, AbortError, QueryOptions, QueryResult |

#### TypeScript — Plan 02

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/query/query.ts` | query, queryRaw, queryFull async generators | VERIFIED | 241 lines; all 3 functions implemented with full lifecycle |
| `ts/src/query/query.spec.ts` | Mock-spawn integration tests | VERIFIED | 413 lines (>150 min); 13 tests covering stream, cwd, systemPrompt, temp cleanup, abort, mid-tool flush, model downgrade |
| `ts/src/parser/types.ts` | Extended ResultChunk with requestedModel/actualModel | VERIFIED | Lines 128-130 confirm `requestedModel?: string` and `actualModel?: string` present |
| `ts/src/index.ts` | Package root barrel includes query module | VERIFIED | `export * from './query/index.js'` present at line 8 |

#### Python — Plan 03

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `python/src/gemini_sdk/query/types.py` | QueryOptions TypedDict, QueryResult TypedDict, Model enum, AbortError | VERIFIED | Model(str, enum.Enum) with 6 values; QueryOptions with Required[str] prompt; AbortError extends Exception |
| `python/src/gemini_sdk/query/build_argv.py` | Pure build_argv function | VERIFIED | Handles Model enum .value correctly; matches TS behavior |
| `python/src/gemini_sdk/query/query.py` | query, query_raw, query_full async generators | VERIFIED | 266 lines; cancel_scope pattern; GEMINI_SYSTEM_MD; kill_tree; pending_tool_chunks; incomplete flush |
| `python/src/gemini_sdk/query/__init__.py` | Barrel export | VERIFIED | Exports all 8 symbols; `__all__` complete |
| `python/src/gemini_sdk/__init__.py` | Package root includes query exports | VERIFIED | `from .query import (...)` block present; all query names in `__all__` |
| `python/src/gemini_sdk/parser/types.py` | ResultChunk with requestedModel/actualModel | VERIFIED | Lines 131-132 confirm both optional fields present |
| `python/tests/test_build_argv.py` | Unit tests for build_argv | VERIFIED | 256 lines (>60 min); 29 tests including 3 hypothesis fuzz tests |
| `python/tests/test_query.py` | Mock-spawn tests for query functions | VERIFIED | 523 lines (>100 min); 13 test functions; each runs asyncio + trio = 26 total |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ts/src/query/buildArgv.ts` | `ts/src/query/types.ts` | `import type { QueryOptions } from './types.js'` | WIRED | Line 8 of buildArgv.ts |
| `ts/src/query/buildArgv.spec.ts` | `ts/src/query/buildArgv.ts` | `import { buildArgv } from './buildArgv.js'` | WIRED | Line 10 of spec |
| `ts/src/query/query.ts` | `ts/src/process/index.js` | `import { ProcessManager, killTree }` | WIRED | Line 25 of query.ts |
| `ts/src/query/query.ts` | `ts/src/parser/index.js` | `import { parseNdjson, dispatch }` | WIRED | Line 26 of query.ts |
| `ts/src/query/query.ts` | `ts/src/query/buildArgv.ts` | `import { buildArgv }` | WIRED | Line 30 of query.ts |
| `ts/src/index.ts` | `ts/src/query/index.ts` | `export * from './query/index.js'` | WIRED | Line 8 of index.ts |
| `python/src/gemini_sdk/query/query.py` | `python/src/gemini_sdk/process/process_manager.py` | `from ..process.process_manager import ProcessManager, kill_tree` | WIRED | Line 34 of query.py |
| `python/src/gemini_sdk/query/query.py` | `python/src/gemini_sdk/parser` | `from ..parser.dispatch import dispatch` + `from ..parser.parse_ndjson import parse_ndjson` | WIRED | Lines 31-32 of query.py |
| `python/src/gemini_sdk/__init__.py` | `python/src/gemini_sdk/query` | `from .query import (...)` | WIRED | Lines 14-23 of `__init__.py` |

---

### Requirements Coverage

All 14 Phase 4 requirement IDs declared across Plans 01, 02, and 03 are satisfied:

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| API-01 | 04-02, 04-03 | Public `query()` is the only public entry point | SATISFIED | `query()` exported from package root barrel; raw-event and full-accumulator are derivatives |
| API-02 | 04-01, 04-03 | Pure-function `buildArgv()` translates typed options to argv | SATISFIED | `buildArgv.ts` and `build_argv.py` both zero-I/O; fuzz tests confirm no-throw invariants |
| API-03 | 04-02, 04-03 | `query()` owns subprocess lifecycle | SATISFIED | Spawns on first iteration; kills in finally on break/cancel; `killTree()` always called |
| API-04 | 04-02, 04-03 | Accepts abortSignal (TS) / cancel_scope (Python) for cancellation | SATISFIED | `abortSignal` in QueryOptions; event listener + `aborted` flag; cancel_scope check in Python |
| API-05 | 04-02, 04-03 | Non-streaming helper wraps `query()` | SATISFIED | `queryFull()` / `query_full()` are thin wrappers; test confirms text accumulation |
| API-06 | 04-02, 04-03 | Raw-event API alongside mapped generator | SATISFIED | `queryRaw()` / `query_raw()` skip dispatch; return raw InitEvent/MessageEvent/ResultEvent |
| SYS-01 | 04-02, 04-03 | systemPrompt writes temp .md and sets GEMINI_SYSTEM_MD env var | SATISFIED | `writeTempSystemPrompt()` + `envOverrides['GEMINI_SYSTEM_MD']` in both TS and Python |
| SYS-02 | 04-02, 04-03 | Temp system-prompt file cleaned up in finally | SATISFIED | `finally` block unconditionally calls `unlink(tempPath)` / `anyio.Path(temp_path).unlink()` |
| CWD-01 | 04-02, 04-03 | `options.cwd` sets subprocess working directory | SATISFIED | `spawnOptions: { cwd: options.cwd }` in TS; `cwd=options.get('cwd')` in Python |
| CWD-02 | 04-01, 04-03 | `additionalDirectories` maps to `--include-directories` flag | SATISFIED | One flag per directory in both implementations; empty array omits flag |
| MDL-01 | 04-01, 04-03 | Typed model enum with known Gemini models | SATISFIED | Model const-object (TS) / Model str enum (Python) with 6 identifiers |
| MDL-02 | 04-01, 04-03 | Raw string model escape hatch | SATISFIED | `model?: Model | string` in QueryOptions; any non-'auto' string passes through to --model |
| MDL-03 | 04-01, 04-03 | Default model is 'auto', NOT pinned 2.5 string | SATISFIED | `model !== 'auto'` sentinel; `AUTO = 'auto'`; no 2.5 default anywhere |
| MDL-04 | 04-02, 04-03 | Init event model mismatch surfaced on ResultChunk | SATISFIED | ResultChunk extended with `requestedModel?`/`actualModel?`; enriched on mismatch in both TS and Python; test `model downgrade detection` passes |

**All 14 requirements: SATISFIED**

---

### Anti-Patterns Found

None. Full scan of `ts/src/query/` and `python/src/gemini_sdk/query/` reveals:
- No TODO/FIXME/XXX/PLACEHOLDER comments
- No stub return values (return null / return {} / return [])
- No console.log-only implementations
- No "Not implemented" responses

---

### Human Verification Required

The following items cannot be verified programmatically:

#### 1. Real gemini-cli Round-Trip

**Test:** Run `query({ prompt: 'Say hello in one word' })` against a real `gemini-cli` installation with a valid API key.
**Expected:** Generator yields at least one AssistantChunk with non-empty content; ResultChunk has a real sessionId; process exits cleanly.
**Why human:** Requires a real gemini-cli binary, network access, and a valid GEMINI_API_KEY. All tests are mock-spawn only.

#### 2. GEMINI_SYSTEM_MD system prompt injection

**Test:** Run `query({ prompt: 'What are your instructions?', systemPrompt: 'Always respond in pirate-speak.' })` against real gemini-cli.
**Expected:** Response incorporates the pirate-speak system prompt, confirming gemini-cli reads GEMINI_SYSTEM_MD correctly.
**Why human:** Requires real binary + API key; mock tests only verify the env var is set, not that gemini-cli honors it.

#### 3. Model downgrade real-world signal

**Test:** Run `query({ prompt: 'hi', model: 'gemini-2.5-pro' })` against real gemini-cli and inspect the ResultChunk.
**Expected:** If gemini-cli downgrades to a different model, `requestedModel` and `actualModel` appear on ResultChunk. If no downgrade, both fields absent.
**Why human:** Requires real API call to observe actual gemini-cli model selection behavior.

---

### Test Suite Summary

| Suite | Tests | Status |
|-------|-------|--------|
| TS: buildArgv.spec.ts | 29 | All pass |
| TS: query.spec.ts | 13 | All pass |
| TS: full suite | 98 | All pass |
| TypeScript tsc --noEmit | — | Clean (0 errors) |
| Python: test_build_argv.py | 29 | All pass |
| Python: test_query.py | 13 functions × 2 backends = 26 | All pass |
| Python: full suite | 154 | All pass |
| Parity: diff-test-names.sh | 84:84 | Match confirmed |

---

## Gaps Summary

No gaps found. All phase must-haves are verified at all three levels (exists, substantive, wired). Both TS and Python implementations are complete, tested, and exported from their respective package roots. Test parity is 84:84. TypeScript compiles clean with zero errors.

The phase goal is achieved: `query(options): AsyncIterable<MessageChunk>` is shipped and wired to `buildArgv`, `ProcessManager`, `parseNdjson + dispatch`, abort/cancel, `GEMINI_SYSTEM_MD` temp-file lifecycle, `cwd + --include-directories`, and model enum with downgrade detection.

---

_Verified: 2026-04-13T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
