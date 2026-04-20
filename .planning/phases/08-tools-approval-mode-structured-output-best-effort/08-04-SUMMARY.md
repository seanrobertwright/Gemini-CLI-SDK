---
phase: 08-tools-approval-mode-structured-output-best-effort
plan: "04"
subsystem: query
tags: [structured-output, schema-validation, zod, queryFull, retry, UnsupportedFeatureError, SchemaValidationError]

requires:
  - phase: 08-tools-approval-mode-structured-output-best-effort
    plan: "01"
    provides: "SchemaValidationError + UnsupportedFeatureError error classes"
  - phase: 08-tools-approval-mode-structured-output-best-effort
    plan: "03"
    provides: "buildSchemaInjectionBlock, validateWithSchema, buildRetryPrompt pure functions"

provides:
  - "queryFull() with outputSchema: schema injection, Zod validation, single-retry loop, SchemaValidationError on double failure"
  - "query() and queryRaw() UnsupportedFeatureError pre-spawn guards for outputSchema"
  - "18 new tests covering all outputSchema code paths"

affects: [phase-09-mcp, phase-10-archon-adapter, callers-of-queryFull]

tech-stack:
  added: []
  patterns:
    - "queryFull pre-processes outputSchema → combined systemPrompt before delegating to query() (avoids guard conflict)"
    - "Retry strips outputSchema: undefined (Pitfall-4 prevention for infinite recursion)"
    - "pre-spawn guard pattern: throw typed error before any async work for fast-fail on caller mistakes"

key-files:
  created: []
  modified:
    - ts/src/query/query.ts
    - ts/src/query/query.spec.ts

key-decisions:
  - "queryFull handles schema injection inline (via buildSchemaInjectionBlock) before calling query(), rather than passing outputSchema through query() — avoids conflict with the pre-spawn guard"
  - "writeTempSystemPrompt extended to accept outputSchema parameter for completeness + API symmetry, even though queryFull uses the inline path"
  - "Retry options explicitly set outputSchema: undefined (not delete) to satisfy Pitfall-4 guard; undefined is equivalent to absent for the !== undefined check"

patterns-established:
  - "Pattern: queryFull is the only structured-output entry point; query()/queryRaw() guards enforce this at the first await"

requirements-completed: [OUT-01, OUT-02, OUT-03]

duration: 4min
completed: 2026-04-20
---

# Phase 08 Plan 04: outputSchema Integration into query.ts Summary

**queryFull() structured output: UnsupportedFeatureError guards on query/queryRaw, schema injection via buildSchemaInjectionBlock, Zod validation, single-retry with feedback prompt + session reuse, SchemaValidationError on double failure**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-20T03:32:21Z
- **Completed:** 2026-04-20T03:36:20Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added `UnsupportedFeatureError` pre-spawn guard to `query()` and `queryRaw()` when `outputSchema` is set, saving a subprocess round-trip on caller mistakes
- Extended `writeTempSystemPrompt` to accept `outputSchema` and append the schema injection block (symmetry with the queryFull path)
- Implemented the validate-retry-throw loop in `queryFull()`: first validation success populates `QueryResult.structured`; failure triggers one retry with `buildRetryPrompt` + session reuse + `outputSchema: undefined` (Pitfall-4 prevention); second failure throws `SchemaValidationError`
- Added 18 new tests (total query.spec.ts: 27 → 45 tests) covering all branches: guards, happy path, retry path, double-fail, abort-before-retry, systemPrompt injection with and without schema

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pre-spawn guards + extend writeTempSystemPrompt + append queryFull retry loop** - `418dc15` (feat)

**Plan metadata:** *(see final commit below)*

## Files Created/Modified
- `ts/src/query/query.ts` — Added 3 UnsupportedFeatureError guard sites, extended writeTempSystemPrompt (accepts outputSchema), queryFull schema-injection + validate-retry-throw loop (3 output module imports added)
- `ts/src/query/query.spec.ts` — 18 new tests across 3 new describe blocks; added UnsupportedFeatureError/SchemaValidationError/buildSchemaInjectionBlock imports

## Insertion Points in query.ts

1. **Pre-spawn guard in query()** — Line ~82 (before existing session-id guard): throws `UnsupportedFeatureError` when `options.outputSchema !== undefined`
2. **writeTempSystemPrompt extension** — Lines ~48-61: signature extended with `outputSchema?: Record<string, unknown>`; uses `buildSchemaInjectionBlock` to build combined content
3. **Pre-spawn guard in queryRaw()** — Line ~253 (before session-id guard): same guard pattern as query()
4. **queryFull schema injection + retry loop** — Lines ~347-427: schema injection into `innerOptions.systemPrompt` before calling `query(innerOptions)`, then validate → retry → validate → throw

## Mock-Harness Adaptations

The existing spec file uses `mockSpawn` (vi.fn() via vi.hoisted()) with `createMockChild(ndjsonLines[])`. For retry tests (two-spawn sequence), `mockReturnValueOnce` was used twice:

```typescript
mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":123}')));  // first: invalid
mockSpawn.mockReturnValueOnce(createMockChild(makeNdjsonLines('s1', '{"x":"hi"}')));  // second: valid
```

A local `makeNdjsonLines(sessionId, assistantText)` helper was added in the new describe block for clean test setup.

## Test Count Added

18 new tests across 3 describe blocks:
- `describe('query() outputSchema guard (Phase 8)')` — 5 tests
- `describe('queryFull() outputSchema (Phase 8)')` — 9 tests
- `describe('queryFull() outputSchema → systemPrompt injection (Phase 8)')` — 4 tests

## TypeScript Strict Mode Notes

No strict-mode issues encountered. `options.outputSchema !== undefined` works correctly as a type guard. The `const { outputSchema: _stripped, ...rest } = options` destructuring used in queryFull to strip outputSchema compiles cleanly; `void _stripped` suppresses the unused-variable lint warning.

## Edge Case: Nested queryFull Call During Retry

The retry path calls `queryFull(retryOptions)` where `retryOptions.outputSchema === undefined`. When that inner `queryFull` runs, it skips the schema injection path (no `buildSchemaInjectionBlock` call), calls `query()` normally, and returns a plain `QueryResult` without `structured`. Validation then happens at the outer `queryFull` level against the outer `options.outputSchema`. This is exactly the desired behavior: the inner call is a plain text retrieval; the outer decides if it validates.

## Decisions Made

- **queryFull inline schema injection**: Rather than pass `outputSchema` through `query()` (which would conflict with the guard), `queryFull` calls `buildSchemaInjectionBlock` directly and passes the combined string as `systemPrompt`. The `writeTempSystemPrompt` extension is still shipped for API symmetry and acceptance-criteria compliance.
- **outputSchema: undefined in retryOptions**: Explicitly set (not deleted) per plan spec. The guard is `!== undefined` so undefined value is equivalent to absent, satisfying Pitfall-4 prevention.
- **abort test uses pre-aborted signal**: The abort-before-retry scenario tests a pre-aborted controller; `query()` throws `AbortError` immediately (pre-spawn check), which propagates through `queryFull`. This cleanly verifies the abort-honor contract without needing a controllable mid-stream abort.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] queryFull must inject schema before calling query(), not via writeTempSystemPrompt extension**

- **Found during:** Task 1 (implementation)
- **Issue:** query() now has a pre-spawn guard that throws UnsupportedFeatureError when outputSchema is set. The plan assumed writeTempSystemPrompt would receive outputSchema via query(), but query() blocks that path before reaching writeTempSystemPrompt.
- **Fix:** queryFull inlines the schema injection via `buildSchemaInjectionBlock` (same function writeTempSystemPrompt uses), builds a combined systemPrompt string, and strips outputSchema before passing innerOptions to query(). writeTempSystemPrompt is still extended as planned for API symmetry and acceptance criteria compliance.
- **Files modified:** ts/src/query/query.ts
- **Verification:** All 220 tests pass; typecheck exits 0; acceptance criteria all satisfied
- **Committed in:** 418dc15 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — architectural interaction between guard and writeTempSystemPrompt injection path)
**Impact on plan:** Deviation necessary for correctness. Guard + injection both work; the integration path changed slightly (inline in queryFull vs. via writeTempSystemPrompt). Plan success criteria fully met.

## Issues Encountered

None beyond the auto-fixed deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- OUT-01/02/03 complete: TypeScript callers can pass `outputSchema` to `queryFull()` and receive validated output or a well-typed `SchemaValidationError`
- 220 total tests pass; typecheck passes
- Phase 8 plan 04 closes the TS-side of structured output; Python-side parity (if planned) would need a follow-up phase
- Phase 9 (MCP passthrough) is unblocked by this plan

---
*Phase: 08-tools-approval-mode-structured-output-best-effort*
*Completed: 2026-04-20*
