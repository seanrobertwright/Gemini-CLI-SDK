---
phase: 08-tools-approval-mode-structured-output-best-effort
plan: 03
subsystem: api
tags: [zod, zod-from-json-schema, structured-output, json-schema, validation, typescript]

# Dependency graph
requires:
  - phase: 08-02
    provides: QueryOptions.outputSchema + zod + zod-from-json-schema added to ts/package.json
provides:
  - buildSchemaInjectionBlock pure function (OUT-01) in ts/src/output/injectSchema.ts
  - stripMarkdownFences + validateWithSchema pure functions (OUT-02) in ts/src/output/schemaValidator.ts
  - buildRetryPrompt pure function (OUT-03 scaffolding) in ts/src/output/retry.ts
  - ts/src/output/index.ts barrel export
  - 25 unit tests covering happy-path, edge cases, fence variants, schema violations
affects: [08-04, phase-10-archon-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "output/ module follows Phase 6 auth/ + Phase 7 session/ pure-function directory pattern"
    - "ValidationResult discriminated union (success: true | false) for Zod safeParse return"
    - "FENCE_RE = /^```(?:json)?\\r?\\n?([\\s\\S]*?)\\r?\\n?```$/s — regex for LLM markdown fence stripping"

key-files:
  created:
    - ts/src/output/injectSchema.ts
    - ts/src/output/schemaValidator.ts
    - ts/src/output/retry.ts
    - ts/src/output/index.ts
    - ts/src/output/injectSchema.spec.ts
    - ts/src/output/schemaValidator.spec.ts
    - ts/src/output/retry.spec.ts
  modified:
    - ts/src/index.ts

key-decisions:
  - "Zod v4.3.6 confirmed working with zod-from-json-schema 0.5.2 — no v3 subpath aliasing needed; convertJsonSchemaToZod returns v4-compatible schema with .safeParse"
  - "ValidationResult error field is string (not Error object) — aligns with plan interface spec; error message extracted from ZodError.message"
  - "FENCE_RE captures inner content with optional 'json' tag and CRLF tolerance — partial fences pass through after trim (no closing ``` = no match)"

patterns-established:
  - "output/ module: pure functions only, no subprocess side effects, colocated .spec.ts files, index.ts barrel"
  - "stripMarkdownFences: trim first, then regex match — trim-before-match ensures leading/trailing whitespace doesn't prevent fence detection"

requirements-completed: [OUT-01, OUT-02]

# Metrics
duration: 2min
completed: 2026-04-20
---

# Phase 8 Plan 03: Output Module Pure Functions Summary

**Three pure functions (buildSchemaInjectionBlock, stripMarkdownFences, validateWithSchema, buildRetryPrompt) in ts/src/output/ via TDD — 25 tests passing, Zod v4 + zod-from-json-schema 0.5.2 confirmed compatible**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-20T03:28:24Z
- **Completed:** 2026-04-20T03:30:17Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 8

## Accomplishments
- Created `ts/src/output/` module with 3 source files + 3 spec files + barrel, mirroring Phase 6 auth/ + Phase 7 session/ pattern
- All 25 unit tests pass (6 injectSchema + 12 schemaValidator + 7 retry); full suite 202/202 green
- Zod v4.3.6 + zod-from-json-schema 0.5.2 confirmed working — no v3 subpath aliasing needed; convertJsonSchemaToZod returns v4-compatible schema
- Top-level ts/src/index.ts extended with `export * from './output/index.js'`

## Task Commits

Each task was committed atomically (TDD split):

1. **Task 1 RED: failing specs for output module** - `7def55e` (test)
2. **Task 1 GREEN: implement output module pure functions** - `ef668a1` (feat)

_TDD task has two commits: test (RED) → feat (GREEN)_

## Files Created/Modified
- `ts/src/output/injectSchema.ts` - buildSchemaInjectionBlock pure function; deterministic schema-guidance block with fixed wording
- `ts/src/output/schemaValidator.ts` - stripMarkdownFences + validateWithSchema; FENCE_RE regex; zod-from-json-schema integration
- `ts/src/output/retry.ts` - buildRetryPrompt pure function; constructs one-shot retry feedback prompt
- `ts/src/output/index.ts` - Barrel export for the output module
- `ts/src/output/injectSchema.spec.ts` - 6 tests: heading, directive, schema fence, MUST instruction, empty schema, determinism
- `ts/src/output/schemaValidator.spec.ts` - 12 tests: 6 stripMarkdownFences + 6 validateWithSchema (valid, parse error, type mismatch, missing field, fenced input, plain schema)
- `ts/src/output/retry.spec.ts` - 7 tests: first line, invalid notice, validator error prefix, code fence wrapping, ending directive, determinism, multiline prompt
- `ts/src/index.ts` - Added `export * from './output/index.js'` (Phase 8 comment added)

## Decisions Made
- **Zod v4 confirmed:** zod-from-json-schema 0.5.2 returns a v4-compatible ZodSchema; safeParse works as expected; error.message on ZodError is the human-readable summary. No v3 subpath aliasing needed.
- **ValidationResult.error is string:** Plan interface spec declares `error: string`; ZodError.message extracted directly. This is what buildRetryPrompt expects (validatorError: string). Consistent with plan interface.
- **FENCE_RE with CRLF tolerance:** `/^```(?:json)?\r?\n?([\s\S]*?)\r?\n?```$/s` — the `\r?` before `\n?` handles Windows CRLF endings from LLM responses.

## Deviations from Plan

None — plan executed exactly as written. All 10 implementation steps followed verbatim. Zod v4 compatibility confirmed without issues (Pitfall 1 did not manifest).

## Issues Encountered
None. The zod-from-json-schema + Zod v4 combination worked on first attempt. The `safeParse` API and `error.message` extraction were as expected.

## Zod Version Confirmation
- **Zod installed:** v4.3.6 (confirmed from ts/package.json `"zod": "^4.3.6"`)
- **zod-from-json-schema installed:** v0.5.2
- **API verified:** `convertJsonSchemaToZod(schema).safeParse(data)` works correctly
- **Error shape:** `result.error.message` produces human-readable summary (Zod v4 ZodError has `.issues` array but `.message` is the concatenated summary)
- **No v3 subpath aliasing needed:** Pitfall 1 from RESEARCH did not manifest

## Markdown Fence Regex Notes
- **FENCE_RE:** `/^```(?:json)?\r?\n?([\s\S]*?)\r?\n?```$/s`
- Partial fences (no closing ```) → regex does not match → trimmed input returned as-is (pass-through behavior confirmed by test)
- CRLF (`\r\n`) handled by `\r?\n?` before and after captured content
- The `s` flag enables `.` to match newlines within the captured group

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- All three pure functions are in place for 08-04 to wire into `queryFull()` + `writeTempSystemPrompt`
- 08-04 will: extend `writeTempSystemPrompt` to append schema block, add pre-spawn `UnsupportedFeatureError` guard to `query()`/`queryRaw()`, and implement the validate → retry → throw loop in `queryFull()`

---
*Phase: 08-tools-approval-mode-structured-output-best-effort*
*Completed: 2026-04-20*
