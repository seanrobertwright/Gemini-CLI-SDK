---
phase: 08-tools-approval-mode-structured-output-best-effort
plan: "01"
subsystem: errors
tags: [yaml-codegen, error-taxonomy, typescript, python, schema-validation]

# Dependency graph
requires:
  - phase: 05-error-taxonomy-archon-5-bucket-mapping
    provides: "PAR-05 invariant: spec/errors.yaml single-source codegen pipeline; lint-errors.sh 3-way YAML/TS/Python sync"

provides:
  - "SchemaValidationError class in TS at ts/src/errors/errors.ts"
  - "SchemaValidationError class in Python at python/src/gemini_sdk/errors/errors.py"
  - "source: sdk|stderr discriminator in spec/errors.yaml + both codegen scripts"
  - "16-class sync enforced by lint-errors.sh"

affects:
  - 08-04-query-wiring-ts
  - 08-05-python-port

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "source discriminator in YAML taxonomy: stderr (default, from stderr/exit) vs sdk (thrown directly by SDK code)"
    - "codegen emits # source / // source comment per class for human readability + metadata"

key-files:
  created: []
  modified:
    - spec/errors.yaml
    - scripts/gen-errors.mjs
    - scripts/gen-errors.py
    - ts/src/errors/errors.ts
    - python/src/gemini_sdk/errors/errors.py
    - python/src/gemini_sdk/errors/__init__.py

key-decisions:
  - "source discriminator is metadata-only in v1: codegen emits comment above class but does not change class body shape; ErrorMapper will use it in 08-04"
  - "lint-errors.sh required no changes: 3-way set-equality check automatically extends to 16 classes once all three sources agree"
  - "TS barrel (export * from errors.js) auto-picks up SchemaValidationError; no index.ts edit needed"

patterns-established:
  - "New SDK-thrown errors: add to spec/errors.yaml with source: sdk; codegen handles class generation identically to stderr-classified errors"

requirements-completed: []

# Metrics
duration: 15min
completed: "2026-04-20"
---

# Phase 8 Plan 01: SchemaValidationError + source Discriminator Summary

**SchemaValidationError generated from YAML taxonomy with source:sdk discriminator; importable in both TS and Python with bucket=unknown, retryable=false; lint-errors.sh extended to 16-class 3-way sync**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-20T03:09:00Z
- **Completed:** 2026-04-20T03:24:41Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `SchemaValidationError` entry to `spec/errors.yaml` with `source: sdk`, `bucket: unknown`, `retryable: false`, `message_template: "Schema validation failed after retry"`
- Extended both codegen scripts (`gen-errors.mjs` and `gen-errors.py`) to emit `// source: {source}` / `# source: {source}` comment line before each class (one-line addition per script)
- Regenerated both language files — 16 classes each, all source comments present, SchemaValidationError correctly shaped
- Updated Python barrel (`errors/__init__.py`) to explicitly import and re-export SchemaValidationError
- `bash scripts/lint-errors.sh` exits 0: "16 classes in sync across YAML, TS, Python" — no linter code changes needed
- `cd ts && pnpm typecheck` passes; codegen is idempotent (second run produces no git diff)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SchemaValidationError to errors.yaml + source discriminator in codegen** - `1614db1` (feat)
2. **Task 2: Python barrel + lint-errors.sh verification** - `03c8840` (feat)

## Files Created/Modified

- `spec/errors.yaml` - Added `SchemaValidationError` entry with `source: sdk` discriminator
- `scripts/gen-errors.mjs` - Added one-line `source` comment emission before each class loop iteration
- `scripts/gen-errors.py` - Added one-line `source` comment emission (Python mirror)
- `ts/src/errors/errors.ts` - Regenerated: 16 classes, each prefixed with `// source: stderr|sdk`
- `python/src/gemini_sdk/errors/errors.py` - Regenerated: 16 classes, each prefixed with `# source: stderr|sdk`
- `python/src/gemini_sdk/errors/__init__.py` - Added `SchemaValidationError` to import list and `__all__`

## errors.yaml Entry Added

```yaml
  - name: SchemaValidationError
    base: GeminiError
    source: sdk
    bucket: unknown
    retryable: false
    message_template: "Schema validation failed after retry"
```

## Codegen Script Changes

**gen-errors.mjs** (inside `for (const entry of doc.errors)` loop, before class emit):
```js
const source = entry.source || 'stderr';
out += `// source: ${source}\n`;
```

**gen-errors.py** (inside `for entry in doc["errors"]:` loop, before class emit):
```python
source = entry.get("source", "stderr")
out += f"# source: {source}\n"
```

## Linter Output

```
[lint-errors] Regenerating TS...
[lint-errors] Regenerating Python...
[lint-errors] OK: 16 classes in sync across YAML, TS, Python.
```

## Decisions Made

- **source discriminator is metadata-only in v1:** codegen emits a comment per class but does not change class body shape or constructor signature. ErrorMapper will consume the `source` field in 08-04 to skip class-from-stderr pattern matching for SDK-thrown errors.
- **lint-errors.sh needed no changes:** The 3-way set-equality check automatically covers 16 classes once YAML, TS, and Python all agree. The linter is agnostic to the `source` field.
- **TS barrel unchanged:** `export * from './errors.js'` auto-exports SchemaValidationError. Only the Python barrel required an explicit addition since it uses an explicit import list.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- CRLF/LF line-ending warnings from git on Windows during staging — expected and benign (Git configured to normalize on checkout).
- Idempotency check path issue during verification: `(cd python && uv run python ../scripts/gen-errors.py)` resolves `../scripts` relative to `python/` subdir — needed absolute path when verifying from bash. Actual codegen invocation pattern `(cd python && uv run python ../scripts/gen-errors.py)` works from repo root as documented in plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `SchemaValidationError` is available at `import { SchemaValidationError } from './errors/index.js'` (TS) and `from gemini_sdk.errors import SchemaValidationError` (Python)
- Plan 08-04 (TS query wiring) can import and throw `SchemaValidationError` directly from the errors module
- Plan 08-05 (Python port) mirrors the same import path
- PAR-05 invariant preserved: single YAML source continues to generate both language implementations

---
*Phase: 08-tools-approval-mode-structured-output-best-effort*
*Completed: 2026-04-20*
