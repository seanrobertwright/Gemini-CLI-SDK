---
phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection
plan: "03"
subsystem: api
tags: [python, async, query, anyio, hypothesis, property-testing, parity]

# Dependency graph
requires:
  - phase: 04-01
    provides: TS query types, buildArgv, Model const-object (canonical to port)
  - phase: 04-02
    provides: TS query/queryRaw/queryFull async generators (canonical to port)
  - phase: 03-ndjson-parser-eventdispatcher-messagechunk-types
    provides: Python parser/dispatch/parse_ndjson + MessageChunk types used in query pipeline

provides:
  - Python query() async generator yielding MessageChunk stream
  - Python query_raw() async generator yielding RawEvent stream (no dispatch)
  - Python query_full() accumulator returning QueryResult dict
  - Python build_argv() pure function matching TS buildArgv output exactly
  - Python Model str enum with 6 Gemini model identifiers
  - Python QueryOptions TypedDict, QueryResult TypedDict, AbortError exception
  - ResultChunk extended with optional requestedModel/actualModel (MDL-04)
  - 29 unit tests for build_argv + 13 tests for query functions
  - 84:84 TS/Python parity verified by diff-test-names.sh

affects:
  - 05-error-taxonomy (AbortError is one of the error types to unify)
  - 10-archon-adapter (query() is the primary entry point for Archon)

# Tech tracking
tech-stack:
  added:
    - hypothesis>=6.0 (property-based fuzz testing for Python)
  patterns:
    - Python cancel_scope pattern: checks getattr(cancel_scope, 'cancel_called', False) vs TS AbortSignal.aborted
    - Model str enum: class Model(str, enum.Enum) - use .value for comparison not str() which gives 'Model.AUTO'
    - Cancellation check after yield: check cancel_scope after yielding chunk (outer consumer sets flag)
    - Tool chunk buffering: pending_tool_chunks list mirrors TS pendingToolChunks array
    - Incomplete flush contract: on cancel, yield {**chunk, 'incomplete': True} for each pending tool chunk

key-files:
  created:
    - python/src/gemini_sdk/query/__init__.py
    - python/src/gemini_sdk/query/types.py
    - python/src/gemini_sdk/query/build_argv.py
    - python/src/gemini_sdk/query/query.py
    - python/tests/test_build_argv.py
    - python/tests/test_query.py
  modified:
    - python/src/gemini_sdk/parser/types.py (ResultChunk extended with requestedModel/actualModel)
    - python/src/gemini_sdk/__init__.py (query module exports added)
    - python/pyproject.toml (hypothesis dev dependency added)
    - ts/src/query/buildArgv.spec.ts (7 test names updated to remove inner quotes for parity script compatibility)

key-decisions:
  - "Python Model uses str enum (class Model(str, enum.Enum)) not const-object like TS; str(Model.AUTO) returns 'Model.AUTO' not 'auto' — must use .value or isinstance(m, enum.Enum) check in build_argv and query"
  - "Cancellation check in query() must occur AFTER yielding each chunk, not before — the outer async for consumer sets cancel_scope.cancel_called after receiving a chunk, before requesting the next one"
  - "TS test names with inner quotes ('Model.AUTO is the string \"auto\"') were truncated by diff-test-names.sh grep pattern [^'\"]+; updated 7 TS descriptions and Python docstrings to remove inner quotes for 84:84 parity"
  - "hypothesis added to dev dependencies for property-based fuzz testing matching TS fast-check tests"
  - "query_raw() uses cancel_scope pattern (not AbortSignal) consistent with anyio patterns; no tool chunk buffering in raw mode (raw events are unprocessed)"

patterns-established:
  - "Python enum value comparison: use model.value if isinstance(model, enum.Enum) else str(model)"
  - "Post-yield cancellation check: check cancel flag after yield to handle outer consumer setting it"
  - "Mock process stdout for tests: class with __aiter__/__anext__ yielding bytes, consumed once"
  - "Patch at source location: patch('gemini_sdk.query.query.ProcessManager') not 'gemini_sdk.process.ProcessManager'"

requirements-completed: [API-01, API-02, API-03, API-04, API-05, API-06, SYS-01, SYS-02, CWD-01, CWD-02, MDL-01, MDL-02, MDL-03, MDL-04]

# Metrics
duration: 7min
completed: 2026-04-13
---

# Phase 4 Plan 03: Python query module with build_argv, query/queryRaw/queryFull, and parity tests Summary

**Python async query pipeline with cancel-scope abort, tool-chunk incomplete flush, model downgrade detection, and 84:84 TS/Python test parity verified by diff-test-names.sh**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-13T21:03:27Z
- **Completed:** 2026-04-13T21:11:11Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Created Python `query/` subpackage with `types.py`, `build_argv.py`, `query.py`, `__init__.py`
- Extended `ResultChunk` in `parser/types.py` with optional `requestedModel`/`actualModel` fields (MDL-04)
- Implemented `query()`, `query_raw()`, `query_full()` async generators matching TS behavior
- Implemented pending tool chunk buffering + incomplete flush on cancellation (Phase 3 contract)
- Created 29 build_argv unit tests + 3 hypothesis fuzz tests matching TS buildArgv.spec.ts
- Created 13 query tests (query/query_raw/query_full) matching TS query.spec.ts
- Achieved 84:84 TS/Python test parity; diff-test-names.sh exits 0
- All 154 Python tests pass; all 98 TS tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Python query module (types, build_argv, query) and extend ResultChunk** - `e7078f6` (feat)
2. **Task 2: Python tests with parity-matching test names** - `41de592` (test)
3. **Task 3: Parity fixes for TS inner-quote test descriptions** - `89816e7` (chore)

## Files Created/Modified

- `python/src/gemini_sdk/query/__init__.py` - Barrel export for query module
- `python/src/gemini_sdk/query/types.py` - Model enum, QueryOptions, QueryResult, AbortError
- `python/src/gemini_sdk/query/build_argv.py` - Pure argv builder matching TS buildArgv
- `python/src/gemini_sdk/query/query.py` - query/query_raw/query_full async generators
- `python/src/gemini_sdk/parser/types.py` - ResultChunk extended with requestedModel/actualModel
- `python/src/gemini_sdk/__init__.py` - query module exports added to package root
- `python/pyproject.toml` - hypothesis>=6.0 added to dev dependencies
- `python/tests/test_build_argv.py` - 29+3 tests matching TS buildArgv.spec.ts names
- `python/tests/test_query.py` - 13 tests matching TS query.spec.ts names
- `ts/src/query/buildArgv.spec.ts` - 7 test descriptions updated (removed inner quotes for parity)

## Decisions Made

- `Model` is implemented as `class Model(str, enum.Enum)` in Python. Unlike TS const-object, Python `str(Model.AUTO)` returns `'Model.AUTO'` not `'auto'` — fixed by using `model.value` when `isinstance(model, enum.Enum)` in `build_argv()` and `query()`.
- Cancellation check in `query()` must happen AFTER yielding each chunk (not before): the outer async consumer sets `cancel_scope.cancel_called` after receiving a yielded chunk, before requesting the next. Checking before yield means the flag is always `False` at the point of check.
- 7 TS `buildArgv.spec.ts` test descriptions used inner double/single quotes (e.g., `'Model.AUTO is the string "auto"'`) that caused the parity script's `[^'\"]+` grep to truncate them. Updated TS descriptions to remove inner quotes and matched Python docstrings accordingly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Model enum str() comparison in build_argv and query**
- **Found during:** Task 2 (test_omits_model_when_model_auto failing)
- **Issue:** `str(Model.AUTO)` returns `'Model.AUTO'` not `'auto'` in Python str enums; build_argv was adding `--model Model.AUTO` flag
- **Fix:** Changed comparison to use `model.value if isinstance(model, enum.Enum) else str(model)` in both `build_argv.py` and `query.py`
- **Files modified:** `python/src/gemini_sdk/query/build_argv.py`, `python/src/gemini_sdk/query/query.py`
- **Verification:** All 29 build_argv tests pass including Model.AUTO omission test
- **Committed in:** `41de592` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed cancellation detection ordering in query()**
- **Found during:** Task 2 (test_temp_file_deleted_after_abort failing)
- **Issue:** Cancel flag checked at TOP of loop before yielding; outer consumer sets flag AFTER receiving chunk; if stream ends right after cancel is set, the post-loop check also needed
- **Fix:** Moved cancel check to AFTER yield statement; added post-loop check for cancel flag set during last chunk
- **Files modified:** `python/src/gemini_sdk/query/query.py`
- **Verification:** test_temp_file_deleted_after_abort and test_abort_mid_stream_throws_abort_error pass
- **Committed in:** `41de592` (Task 2 commit)

**3. [Rule 1 - Bug] Fixed hypothesis fuzz test assertion too broad**
- **Found during:** Task 2 (test_fuzz_auto_undefined_no_model_flag failing)
- **Issue:** Hypothesis found that when `prompt='--model'` and no model, `'--model' not in result` fails because prompt itself is `'--model'` at index 3
- **Fix:** Changed assertion to check `result[4:]` (flags section only, after fixed 4-element header)
- **Files modified:** `python/tests/test_build_argv.py`
- **Verification:** Fuzz test passes with 100 hypothesis examples
- **Committed in:** `41de592` (Task 2 commit)

**4. [Rule 1 - Bug] Fixed parity script incompatibility with inner-quoted TS test names**
- **Found during:** Task 3 (diff-test-names.sh exits 1)
- **Issue:** 7 TS `it()` descriptions contained inner `"` or `'` characters; parity script grep `[^'\"]+` truncates at first inner quote giving `Model.AUTO is the string ` (with trailing space); Python `.strip()` gives `Model.AUTO is the string`; irreconcilable mismatch
- **Fix:** Updated 7 TS test descriptions to remove inner quotes; updated matching Python docstrings
- **Files modified:** `ts/src/query/buildArgv.spec.ts`, `python/tests/test_build_argv.py`
- **Verification:** diff-test-names.sh exits 0 with 84:84 match
- **Committed in:** `89816e7` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (all Rule 1 bugs)
**Impact on plan:** All fixes necessary for correctness and parity compliance. No scope creep.

## Issues Encountered

None beyond the auto-fixed bugs above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Python `query()`, `query_raw()`, `query_full()`, `build_argv()` exported from `gemini_sdk` package root
- All 14 requirements (API-01 through MDL-04) completed
- Phase 5 (error taxonomy) can import `AbortError` from `gemini_sdk.query` and extend it with `GeminiError` hierarchy
- Phase 10 (Archon adapter) can use `query()` as primary entry point

---
*Phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection*
*Completed: 2026-04-13*
