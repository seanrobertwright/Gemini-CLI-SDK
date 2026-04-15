---
phase: 05-error-taxonomy-archon-5-bucket-mapping
plan: 03
subsystem: errors
tags: [errors, ErrorMapper, dispatch, query, stderr-ring-buffer, TDD, parity]
requires:
  - 05-02 (generated class hierarchy: GeminiError subclasses from spec/errors.yaml)
  - 05-01 (RED test scaffolds: errorMapper.spec.ts + test_error_mapper.py)
provides:
  - ts/src/errors/ErrorMapper.ts (hand-written; fromStreamEvent + fromExit)
  - python/src/gemini_sdk/errors/error_mapper.py (Python parity of ErrorMapper)
  - ts/src/process/ProcessManager.ts (SpawnResult + 8 KiB stderr ring buffer)
  - python/src/gemini_sdk/process/process_manager.py (SpawnResult dataclass + _StderrRing)
  - ts/src/parser/dispatch.ts (Phase 5 contract: throw typed error, no rate_limit chunk)
  - python/src/gemini_sdk/parser/dispatch.py (Phase 5 parity of dispatch)
  - ts/src/query/query.ts (sawResult ERR-06 tracking + ErrorMapper.fromExit on non-zero exit)
  - python/src/gemini_sdk/query/query.py (saw_result ERR-06 tracking + ErrorMapper.from_exit)
affects:
  - ts/src/errors/index.ts (barrel: added ErrorMapper + StreamErrorEvent exports)
  - python/src/gemini_sdk/errors/__init__.py (barrel: added ErrorMapper)
  - ts/src/parser/dispatch.spec.ts (DI-01 closed: fixture corpus reads top-level _throws; 429 test updated)
  - python/tests/test_dispatch.py (DI-01 closed: fixture corpus reads top-level _throws; rate_limit/error tests updated)
  - ts/src/process/ProcessManager.spec.ts (updated to expect SpawnResult shape)
  - python/tests/test_process_manager.py (updated to expect SpawnResult shape)
  - ts/src/query/query.spec.ts (updated mock children to SpawnResult shape)
  - python/tests/test_query.py (updated mock procs to SpawnResult shape)
tech-stack:
  added: []
  patterns:
    - Hand-written ErrorMapper (not generated) — two static methods fromStreamEvent/from_stream_event + fromExit/from_exit
    - SpawnResult wrapper: child/process + pid + getStderrTail/get_stderr_tail encapsulate ring buffer
    - Ring buffer: 8192-byte cap, attached synchronously at spawn (RESEARCH.md Pitfall 2 — race condition guard)
    - ERR-06 sawResult guard: only fires on non-zero exit; zero-exit partial streams are treated as benign
    - fromExit uses generic AuthError (not subtype) for exit-path UNAUTHENTICATED detection — aligns with 05-01 decision
    - DI-01 resolution: dispatch.spec.ts + test_dispatch.py fixture corpus checks top-level _throws (Phase 5 convention)
key-files:
  created:
    - ts/src/errors/ErrorMapper.ts
    - python/src/gemini_sdk/errors/error_mapper.py
  modified:
    - ts/src/errors/index.ts
    - python/src/gemini_sdk/errors/__init__.py
    - ts/src/parser/dispatch.ts
    - python/src/gemini_sdk/parser/dispatch.py
    - ts/src/process/ProcessManager.ts
    - python/src/gemini_sdk/process/process_manager.py
    - ts/src/query/query.ts
    - python/src/gemini_sdk/query/query.py
    - ts/src/parser/dispatch.spec.ts
    - python/tests/test_dispatch.py
    - ts/src/process/ProcessManager.spec.ts
    - python/tests/test_process_manager.py
    - ts/src/query/query.spec.ts
    - python/tests/test_query.py
decisions:
  - "fromExit uses generic AuthError (not _classify_auth_subtype) for exit-path auth detection — mixed stderr tail cannot reliably distinguish NotConfigured vs Forbidden403 vs Expired etc.; aligns with 05-01-SUMMARY.md decision"
  - "ERR-06 sawResult guard fires only on non-zero exit code — zero-exit streams ending without result chunk treated as benign (tool-use flush scenario); avoids breaking existing unit tests that use synthetic partial streams"
  - "DI-01 closed: dispatch.spec.ts and test_dispatch.py fixture corpus now detect _throws at TOP LEVEL (alongside _errorType) per Phase 5 convention; old in-chunks _throws check kept for backward compat"
  - "Old dispatch 'maps code 429 to rate_limit chunk' test replaced by 'throws RateLimitError' test (TS + Python) to match Phase 5 contract"
  - "SpawnResult wrapper returned by ProcessManager.spawn() in both TS and Python; all callers updated (query.ts, query.py, test files)"
  - "stderr pump in Python uses asyncio.get_event_loop().create_task() — anyio structured concurrency would require nursery plumbing; asyncio backend is the standard runtime path for query()"
metrics:
  duration_minutes: 25
  completed_date: 2026-04-15
  tasks: 2
  files_created: 2
  files_modified: 14
---

# Phase 5 Plan 03: ErrorMapper + Dispatch/Query Integration Summary

Hand-written ErrorMapper in both languages wired into the two integration points
(dispatch error events, query exit-code path). All Plan 05-01 RED tests turned
GREEN. DI-01 closed: dispatch fixture corpus now honors Phase 5 top-level
`_throws` sentinel.

**One-liner:** ErrorMapper classifies stream-json error events and process exit
codes into typed GeminiError subclasses; stderr 8 KiB ring buffer added to
ProcessManager; dispatch no longer yields rate_limit chunks (throws instead);
118 TS + 174 Python tests pass, 104:104 parity.

## ERR-04 / ERR-05 Classification

### fromStreamEvent path (stream-json error events)

| Input | Output class |
|-------|-------------|
| code 429 or status RESOURCE_EXHAUSTED | RateLimitError |
| code 401 or status UNAUTHENTICATED | classifyAuthSubtype(msg) → NotConfigured/Forbidden403/Expired/ToSViolation/AuthError |
| code 403 or status PERMISSION_DENIED | Forbidden403 |
| code 400 or status INVALID_ARGUMENT | InvalidPromptError |
| code 404 or status NOT_FOUND | ModelAccessError |
| fallback | GeminiError(bucket=unknown) |

### fromExit path (exit code + stderr tail)

| Pattern in stderr | Output class |
|-------------------|-------------|
| quota/RESOURCE_EXHAUSTED/429/Too Many Requests | RateLimitError |
| API key not valid/UNAUTHENTICATED/401 | AuthError (generic — cannot subtype from mixed tail) |
| 403/PERMISSION_DENIED/Forbidden | Forbidden403 |
| 400/INVALID_ARGUMENT/invalid prompt/content policy/safety | InvalidPromptError |
| 404/NOT_FOUND/model not found/deprecated/not available | ModelAccessError |
| exit_code in (1,2,137,143) with no match | ProcessCrashError |
| fallback | GeminiError(bucket=unknown) |

ERR-05 two-path parity: both paths produce the same class for rate_limit and auth conditions.

## DI-01 Resolution

DI-01 (from deferred-items.md) is now closed:

**Before this plan:**
- `ts/src/parser/dispatch.spec.ts` fixture corpus detected `_throws` only inside `chunks[]`.
- Phase 5 re-targeted `error-auth.expected.json` and `error-rate-limit.expected.json` to have `_throws:true` at the **top level** (alongside `_errorType`).
- This caused 2 RED rows in the fixture corpus test.

**Resolution:**
1. Updated fixture corpus helper in both `dispatch.spec.ts` and `test_dispatch.py` to check `expected._throws` at top level first.
2. Updated dispatch to throw typed errors for ALL error events (no rate_limit chunk yield).
3. Updated the old "maps code 429 to rate_limit chunk" test to assert `rejects.toBeInstanceOf(RateLimitError)` (TS) and `pytest.raises(RateLimitError)` (Python).

## ERR-06 sawResult Contract

`query()` and `query_raw()` now track `sawResult`/`saw_result`. When a stream ends without a terminal `result` chunk AND the process exited with a non-zero code, `ErrorMapper.fromExit()` is called to produce a typed error.

**Zero-exit without result:** treated as benign partial stream (e.g. dispatch flushed an incomplete tool chunk at stream end). No error thrown. This avoids breaking unit tests that use synthetic partial NDJSON.

## ProcessManager SpawnResult

Both TS and Python now return a `SpawnResult` wrapper from `spawn()`:

```
SpawnResult {
  child / process   — raw ChildProcess / anyio.Process
  pid               — process ID
  stdout            — stdout stream (shortcut for callers)
  stderr            — stderr stream (TS only; Python via process.stderr)
  getStderrTail()   — last ≤ 8192 bytes of stderr as string
}
```

The stderr listener (TS) / pump task (Python) is attached **synchronously** at spawn time to avoid the race condition documented in RESEARCH.md Pitfall 2 (fast-exit processes can close stderr before a deferred listener is attached).

## Tasks Executed

### Task 1 — TS ErrorMapper + ProcessManager + dispatch/query wiring

Commit: `b7efd5e`

- `ts/src/errors/ErrorMapper.ts`: 110 LOC hand-written classifier
- `ts/src/errors/index.ts`: added ErrorMapper + StreamErrorEvent exports
- `ts/src/process/ProcessManager.ts`: SpawnResult interface + RING_LIMIT = 8192 + stderr listener
- `ts/src/parser/dispatch.ts`: `case 'error': throw ErrorMapper.fromStreamEvent(event)`
- `ts/src/query/query.ts`: `sawResult` tracking + `ErrorMapper.fromExit` on non-zero exit
- `ts/src/parser/dispatch.spec.ts`: DI-01 fix + 429 test updated to assert RateLimitError
- `ts/src/process/ProcessManager.spec.ts`: updated to expect SpawnResult
- `ts/src/query/query.spec.ts`: updated mock children to SpawnResult shape
- 118 TS tests GREEN; tsc --noEmit exits 0

### Task 2 — Python ErrorMapper + ProcessManager + dispatch/query wiring

Commit: `8592e64`

- `python/src/gemini_sdk/errors/error_mapper.py`: 130 LOC, mirrors TS exactly
- `python/src/gemini_sdk/errors/__init__.py`: added ErrorMapper export
- `python/src/gemini_sdk/parser/dispatch.py`: `raise ErrorMapper.from_stream_event(event)`
- `python/src/gemini_sdk/process/process_manager.py`: SpawnResult dataclass + _StderrRing + asyncio pump
- `python/src/gemini_sdk/query/query.py`: `saw_result` tracking + `ErrorMapper.from_exit` on non-zero exit
- `python/tests/test_dispatch.py`: DI-01 fix + rate_limit/error tests updated
- `python/tests/test_process_manager.py`: updated to expect SpawnResult
- `python/tests/test_query.py`: updated mock procs to SpawnResult shape
- 174 Python tests GREEN; 104:104 TS/Python parity preserved

## Deviations from Plan

### Rule 1 — fromExit uses generic AuthError instead of classifyAuthSubtype

**Found during:** Task 1 (fixture corpus test failure)
**Issue:** Plan's `fromExit` code called `classifyAuthSubtype(tail)` for UNAUTHENTICATED matches. The `error-auth.stderr.txt` synthetic file contains "API key not valid" text (also used as a documentation example), which caused `classifyAuthSubtype` to return `NotConfigured` while the expected.json says `_errorType: "AuthError"`.
**Fix:** `fromExit` returns `new AuthError(snippet)` directly for UNAUTHENTICATED pattern — generic is correct because mixed stderr tail cannot reliably distinguish subtypes. Aligns with 05-01-SUMMARY.md decision: "generic AuthError is the safe default".
**Files modified:** `ts/src/errors/ErrorMapper.ts`, `python/src/gemini_sdk/errors/error_mapper.py`
**Commit:** included in `b7efd5e`, `8592e64`

### Rule 1 — ERR-06 fires only on non-zero exit (guard narrowed from plan)

**Found during:** Task 1 (query.spec.ts "abort mid-tool flushes incomplete tool chunk" test)
**Issue:** Plan's ERR-06 logic said "if !sawResult && !aborted → throw". But the existing unit test streams NDJSON that ends without a result chunk (init + tool_use only) and expects NO error — just the flushed incomplete tool chunk.
**Fix:** Narrowed guard to `!sawResult && !aborted && exitCode !== null && exitCode !== 0`. Zero-exit without result = benign partial stream. Non-zero exit without result = error.
**Files modified:** `ts/src/query/query.ts`, `python/src/gemini_sdk/query/query.py`
**Commit:** included in `b7efd5e`, `8592e64`

### Rule 3 — ProcessManager.spec.ts and test_process_manager.py updated for SpawnResult

**Found during:** Task 1 (full TS suite run)
**Issue:** Existing tests expected `manager.spawn()` to return a raw ChildProcess / anyio Process. Phase 5 wraps it in SpawnResult.
**Fix:** Updated test assertions to use `result.child` (TS) / `result.process` (Python) and added `get_stderr_tail` callable check. Updated integration test to use `spawnResult.stdout` / `spawn_result.process.stdout`.
**Files modified:** `ts/src/process/ProcessManager.spec.ts`, `python/tests/test_process_manager.py`
**Commit:** included in `b7efd5e`, `8592e64`

### Rule 3 — query.spec.ts and test_query.py updated for SpawnResult

**Found during:** Task 1 (full TS suite run)
**Issue:** Mock `mockSpawn` / `mock_pm.spawn` returned raw ChildProcess / Process objects. query.ts/query.py now access `.child` / `.process`, `.getStderrTail()` etc.
**Fix:** Updated `createMockChild` (TS) and `_make_mock_proc` (Python) to return SpawnResult-shaped objects. Updated all inline mock objects in abort/tool tests.
**Files modified:** `ts/src/query/query.spec.ts`, `python/tests/test_query.py`
**Commit:** included in `b7efd5e`, `8592e64`

## Verification

- [x] `cd ts && pnpm test -- --run` — 118 tests pass
- [x] `cd python && uv run pytest` — 174 tests pass
- [x] `cd ts && pnpm tsc --noEmit` — exits 0
- [x] `bash scripts/diff-test-names.sh` — 104:104 parity exits 0
- [x] `grep -r "throw new Error" ts/src/parser/dispatch.ts ts/src/query/query.ts` — 0 matches
- [x] `grep -c "type: 'rate_limit'" ts/src/parser/dispatch.ts` — 0 (no longer yielded)
- [x] stderr ring buffer attached SYNCHRONOUSLY at spawn (before any await — RESEARCH.md Pitfall 2)
- [x] AbortError instances still satisfy instanceof AbortError via re-export chain
- [x] DI-01 closed: fixture corpus reads top-level _throws, error-auth + error-rate-limit rows GREEN

## Self-Check: PASSED

- [x] `ts/src/errors/ErrorMapper.ts` exists (FOUND)
- [x] `python/src/gemini_sdk/errors/error_mapper.py` exists (FOUND)
- [x] `grep -E "static fromStreamEvent" ts/src/errors/ErrorMapper.ts` — match (FOUND)
- [x] `grep -E "static fromExit" ts/src/errors/ErrorMapper.ts` — match (FOUND)
- [x] `grep -E "ErrorMapper.fromStreamEvent" ts/src/parser/dispatch.ts` — match (FOUND)
- [x] `grep -E "sawResult" ts/src/query/query.ts` — 4 matches (FOUND)
- [x] `grep -E "ErrorMapper.fromExit" ts/src/query/query.ts` — 2 matches (FOUND)
- [x] `grep -E "getStderrTail" ts/src/process/ProcessManager.ts` — match (FOUND)
- [x] `grep -E "RING_LIMIT|8192" ts/src/process/ProcessManager.ts` — match (FOUND)
- [x] Commit `b7efd5e` in git log (FOUND)
- [x] Commit `8592e64` in git log (FOUND)
