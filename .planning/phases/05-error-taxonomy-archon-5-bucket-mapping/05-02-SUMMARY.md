---
phase: 05-error-taxonomy-archon-5-bucket-mapping
plan: 02
subsystem: errors
tags: [errors, codegen, yaml, typescript, python, class-hierarchy]
requires:
  - 05-01 (RED test scaffolds)
provides:
  - spec/errors.yaml (single source of truth, 15 classes, 5-bucket enum)
  - scripts/gen-errors.mjs (Node ESM codegen for TS)
  - scripts/gen-errors.py (Python codegen)
  - ts/src/errors/errors.ts (AUTO-GENERATED, 173 LOC)
  - python/src/gemini_sdk/errors/errors.py (AUTO-GENERATED, 249 LOC)
  - Updated barrels (ts/src/errors/index.ts, python/src/gemini_sdk/errors/__init__.py)
affects:
  - ts/src/query/types.ts (AbortError re-exported from errors, not defined locally)
  - python/src/gemini_sdk/query/types.py (AbortError re-exported from errors)
  - ts/src/process/BinaryResolver{.ts,.spec.ts}, ProcessManager.spec.ts (import updated)
  - python/src/gemini_sdk/process/binary_resolver.py (import updated)
tech-stack:
  added:
    - js-yaml@^4.1 + @types/js-yaml@^4 (TS devDependencies)
    - pyyaml>=6.0 (Python dev dependency)
  patterns:
    - YAML-driven codegen: single spec/ YAML emits both language class files
    - Idempotent codegen scripts (second run = no diff)
    - Object.setPrototypeOf(this, new.target.prototype) in every TS error constructor
    - retryAfterMs only declared on GeminiError root; subclasses pass options to super()
    - AbortError relocated from query/types to errors module (reparented to ProcessError)
key-files:
  created:
    - spec/errors.yaml
    - scripts/gen-errors.mjs
    - scripts/gen-errors.py
    - ts/src/errors/errors.ts (generated)
    - python/src/gemini_sdk/errors/errors.py (generated)
  modified:
    - ts/src/errors/index.ts (barrel: export * from ./errors.js)
    - ts/src/errors/GeminiNotFoundError.ts (DELETED — class now in generated errors.ts)
    - python/src/gemini_sdk/errors/__init__.py (barrel: all 15 classes from .errors)
    - python/src/gemini_sdk/errors/not_found.py (DELETED — class now in generated errors.py)
    - ts/src/query/types.ts (AbortError: local class → re-export from errors)
    - python/src/gemini_sdk/query/types.py (AbortError: local class → re-export from errors)
    - ts/src/process/BinaryResolver.ts (import path: GeminiNotFoundError.js → index.js)
    - ts/src/process/BinaryResolver.spec.ts (import path updated)
    - ts/src/process/ProcessManager.spec.ts (import path updated)
    - python/src/gemini_sdk/process/binary_resolver.py (import path updated)
    - ts/package.json (js-yaml devDep added; gen:errors script added)
    - python/pyproject.toml (pyyaml dev dep added)
decisions:
  - "retry_after_ms_source left as 'error.retryAfter' with comment — field name unconfirmed (05-01 Option B blocker); ErrorMapper will skip dynamic extraction until follow-up-quota-capped-key"
  - "Option B for GeminiNotFoundError/AbortError reparenting: delete standalone files, route through barrel — simpler than generate_skip flag approach"
  - "retryAfterMs declared only on GeminiError root class (not on subclasses) to avoid TS2612 overwrite error; subclasses pass options through super() chain"
  - "AbortError relocated from query/types to errors module in both TS and Python (Rule 3: blocking issue — tests import AbortError from gemini_sdk.errors)"
metrics:
  duration_minutes: 6
  completed_date: 2026-04-15
  tasks: 2
  files_created: 5
  files_modified: 10
---

# Phase 5 Plan 02: YAML Source-of-Truth + Codegen Class Hierarchy Summary

Single YAML spec drives idempotent code generation for both TypeScript and
Python error class hierarchies. 15-class taxonomy with correct bucket and
retryable wiring; all Plan 05-01 RED tests turned GREEN.

**One-liner:** spec/errors.yaml drives two codegen scripts producing 173-LOC TS
+ 249-LOC Python class hierarchies; GeminiNotFoundError and AbortError
reparented to the generated GeminiError/ProcessError base; tsc --noEmit clean.

## YAML Schema Deviations

**retry_after_ms_source:** Left as `"error.retryAfter"` with inline comment
`# field name unconfirmed; dynamic extraction disabled in ErrorMapper`. No
adjustment made because 05-01-SUMMARY.md records `retry_after_field_observed:
null` (real 429 capture blocked by Option B path). ErrorMapper (Plan 05-03)
will treat the source field as informational only until the follow-up
`follow-up-quota-capped-key` phase resolves RESEARCH Open Question #3.

**No other YAML schema deviations.** The 15 entries, 5-bucket enum, parent:
fields, and stream_matchers/stderr_patterns match the plan verbatim.

## Generated File Sizes

| File | LOC |
|------|-----|
| `ts/src/errors/errors.ts` | 173 |
| `python/src/gemini_sdk/errors/errors.py` | 249 |

Both files begin with the required AUTO-GENERATED header comment.

## Deleted Files (reparenting cleanup)

- `ts/src/errors/GeminiNotFoundError.ts` — DELETED. Class now lives in generated
  `errors.ts`. All 3 import sites updated to `../errors/index.js` barrel.
- `python/src/gemini_sdk/errors/not_found.py` — DELETED. Class now lives in
  generated `errors.py`. All import sites updated to `gemini_sdk.errors` barrel.

## Remaining Call Sites Importing Deleted Files

**Zero remaining call sites** reference either deleted file.

Confirmed clean:
- `grep -r "GeminiNotFoundError.js" ts/src/` → 0 matches
- `grep -r "from.*not_found" python/src/` → 0 matches

## AbortError Relocation (Rule 3 Auto-fix)

**Found during:** Task 2 — tests import `AbortError` from `gemini_sdk.errors`, but
`AbortError` was defined in `query/types.py` (extending `Exception` directly).

**Fix:** Updated `ts/src/query/types.ts` and `python/src/gemini_sdk/query/types.py`
to re-export `AbortError` from the errors module rather than define it locally.
The old local `AbortError(Exception)` class removed; the generated
`AbortError(ProcessError)` is now the single canonical definition.

**Impact:** `AbortError` instances are now `isinstance(err, ProcessError)` and
`isinstance(err, GeminiError)`. Callers using `AbortError()` with no args still
work (the generated constructor has `message='Query aborted by caller'` as default).

## TS2612 Fix (Rule 1 Auto-fix)

**Found during:** Task 2 — `tsc --noEmit` failed with 14 TS2612 errors (`Property
'retryAfterMs' will overwrite the base property`).

**Fix:** Updated `scripts/gen-errors.mjs` to only emit `retryAfterMs?: number`
on the root `GeminiError` class (where `base === 'Error'`). Subclasses omit the
redundant declaration and instead pass `options` through the `super()` call, so
`GeminiError`'s constructor sets `this.retryAfterMs` for the full chain.

**Verified:** `new RateLimitError('msg', { retryAfterMs: 5000 }).retryAfterMs === 5000` passes.

## Tasks Executed

### Task 1 — spec/errors.yaml + YAML deps

Commit: `a35f186`

- spec/errors.yaml: 15 entries, buckets enum, stream_matchers, stderr_patterns, parent: links
- js-yaml@^4.1 + @types/js-yaml@^4 installed in ts/
- pyyaml>=6.0 installed in python/
- Both parsers validate: `OK 15 classes`

### Task 2 — Codegen scripts + generated files + reparenting

Commit: `57a1b6f`

- scripts/gen-errors.mjs: idempotent Node ESM script (~75 LOC)
- scripts/gen-errors.py: idempotent Python script (~55 LOC)
- ts/src/errors/errors.ts: 15 AUTO-GENERATED classes, 173 LOC
- python/src/gemini_sdk/errors/errors.py: 15 AUTO-GENERATED classes, 249 LOC
- Barrels updated; standalone GeminiNotFoundError.ts and not_found.py deleted
- AbortError relocated (Rule 3); TS2612 fixed (Rule 1)
- 8 TS + 8 Python errors tests GREEN; errorMapper tests remain RED (Plan 05-03)
- tsc --noEmit exits 0

## Deviations from Plan

### Rule 1 — Auto-fix: TS2612 retryAfterMs redeclaration

**Found during:** Task 2 (after running `tsc --noEmit`)
**Issue:** Generated codegen declared `retryAfterMs?` on every class, causing
TS2612 on 14 subclasses that inherited it from `GeminiError`.
**Fix:** Updated `gen-errors.mjs` to only emit `retryAfterMs` on root class
(`base === 'Error'`); subclasses pass `options` to `super()`.
**Files modified:** `scripts/gen-errors.mjs`, `ts/src/errors/errors.ts` (regenerated)
**Commit:** included in `57a1b6f`

### Rule 3 — Auto-fix: AbortError in query/types imported from errors

**Found during:** Task 2 (test import chain verification)
**Issue:** `test_errors.py` imports `AbortError` from `gemini_sdk.errors`, but
`AbortError` was defined in `query/types.py` extending bare `Exception`. Tests
would fail if errors barrel didn't re-export it. Additionally, the YAML/generated
hierarchy defines `AbortError(ProcessError)` which supersedes the old definition.
**Fix:** Removed local `AbortError` class from `ts/src/query/types.ts` and
`python/src/gemini_sdk/query/types.py`; added re-export from errors module.
Updated 3 TS import paths + 1 Python import path for `GeminiNotFoundError`.
**Files modified:** `ts/src/query/types.ts`, `python/src/gemini_sdk/query/types.py`,
`ts/src/process/BinaryResolver.ts`, `ts/src/process/BinaryResolver.spec.ts`,
`ts/src/process/ProcessManager.spec.ts`, `python/src/gemini_sdk/process/binary_resolver.py`
**Commit:** included in `57a1b6f`

## Verification

- [x] Both codegen scripts are idempotent (second run = no git diff)
- [x] `cd ts && npx vitest run src/errors/errors.spec.ts` passes (8 tests)
- [x] `cd python && uv run pytest tests/errors/test_errors.py` passes (8 tests)
- [x] `cd ts && pnpm run typecheck` exits 0 (no type errors)
- [x] `from gemini_sdk.errors import ...all 15 classes...` prints OK
- [x] `grep -c "^export class " ts/src/errors/errors.ts` returns 15
- [x] `grep -c "^class .*:" python/src/gemini_sdk/errors/errors.py` returns 15
- [x] errorMapper tests remain RED (ErrorMapper is Plan 05-03's responsibility)
- [x] DI-01 (dispatch.spec.ts 2 failures) pre-existing, unchanged

## Self-Check: PASSED

- [x] `spec/errors.yaml` exists (FOUND)
- [x] `scripts/gen-errors.mjs` exists (FOUND)
- [x] `scripts/gen-errors.py` exists (FOUND)
- [x] `ts/src/errors/errors.ts` exists and starts with AUTO-GENERATED (FOUND)
- [x] `python/src/gemini_sdk/errors/errors.py` exists and starts with AUTO-GENERATED (FOUND)
- [x] `ts/src/errors/GeminiNotFoundError.ts` DELETED (CONFIRMED)
- [x] `python/src/gemini_sdk/errors/not_found.py` DELETED (CONFIRMED)
- [x] Commit `a35f186` in git log (FOUND)
- [x] Commit `57a1b6f` in git log (FOUND)
