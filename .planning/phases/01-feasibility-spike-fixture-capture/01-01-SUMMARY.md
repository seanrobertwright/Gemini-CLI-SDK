---
phase: 01-feasibility-spike-fixture-capture
plan: "01"
subsystem: infra
tags: [json-schema, ajv, json-schema-to-typescript, fixtures, ndjson, spec]

# Dependency graph
requires: []
provides:
  - "package.json with pinned dev deps: ajv@^8.17.1, ajv-formats@^3.0.1, json-schema-to-typescript@15.0.4, typescript@^5.6.3"
  - ".gitattributes disabling CRLF normalization for spec/fixtures/** (byte-exact NDJSON on Windows)"
  - ".gemini-cli-compat empty seed file (W1/plan-04 writes pinned version)"
  - "spec/ directory tree with all 8 seeded placeholder files"
  - "spec/events.schema.json minimal JSON Schema 2020-12 skeleton (empty oneOf for plan-09 population)"
  - "spec/fixtures.manifest.json with all 12 canonical fixture slugs"
affects:
  - "01-02 (validate-fixtures.mjs reads spec/fixtures.manifest.json manifest subcommand)"
  - "01-04 (writes .gemini-cli-compat version string)"
  - "01-09 (populates spec/events.schema.json oneOf array)"
  - "all W1+ tasks (append to spec/ placeholder files atomically)"

# Tech tracking
tech-stack:
  added:
    - "ajv@^8.17.1 (JSON Schema 2020-12 runtime validator)"
    - "ajv-formats@^3.0.1 (format validators for ajv)"
    - "json-schema-to-typescript@15.0.4 (JSON Schema -> TS type generation)"
    - "typescript@^5.6.3 (TS compiler for schema codegen smoke tests)"
  patterns:
    - "ESM-first package.json (type: module) — all scripts are .mjs or import-style"
    - "Fixture byte-exactness guaranteed via .gitattributes -text rule per path pattern"
    - "Spec files seeded as stubs so downstream tasks append atomically without file creation races"

key-files:
  created:
    - "package.json"
    - ".gitattributes"
    - ".gemini-cli-compat"
    - "spec/protocol.md"
    - "spec/errors.md"
    - "spec/feasibility.md"
    - "spec/capture.md"
    - "spec/events.schema.json"
    - "spec/fixtures/.gitkeep"
    - "spec/fixtures/_assets/.gitkeep"
    - "spec/fixtures.manifest.json"
  modified: []

key-decisions:
  - "resume-session split into turn1+turn2 fixture pair (12 slugs total, not 11) per CONTEXT.md two-turn session design"
  - "spec/events.schema.json starts with empty oneOf array — intentional; ajv compile succeeds but matches nothing until plan-09 populates it"
  - ".gemini-cli-compat created as empty seed; actual version pinned by plan-04 after host verification of gemini --version"
  - "spec/fixtures/_assets/ marked as -text binary in .gitattributes so image/PDF assets are never text-diffed"

patterns-established:
  - "Stub-first: create known-path placeholder files before any wave writes to them — eliminates file-creation races in parallel tasks"
  - "CRLF guard: .gitattributes -text per fixture directory ensures byte-exact NDJSON round-trips on Windows capture host"

requirements-completed:
  - PRS-08
  - PRS-09

# Metrics
duration: 15min
completed: 2026-04-11
---

# Phase 1 Plan 01: Repo-Root Scaffold and spec/ Skeleton Summary

**ESM package manifest pinning json-schema-to-typescript@15.0.4 + ajv@8, byte-exact fixture corpus CRLF guard via .gitattributes, and full spec/ directory tree with 12-slug fixture manifest and JSON Schema 2020-12 skeleton**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-11T22:00:00Z
- **Completed:** 2026-04-11T22:15:00Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Created `package.json` as an ESM private package with exact dev dependency pins required for Phase 1 toolchain (ajv, ajv-formats, json-schema-to-typescript@15.0.4, typescript)
- Created `.gitattributes` with `spec/fixtures/** -text` and `spec/fixtures/_assets/** -text binary` rules to guarantee byte-exact NDJSON on Windows across git round-trips
- Created all 8 spec/ placeholder files including the load-bearing `spec/fixtures.manifest.json` (12 slugs) and `spec/events.schema.json` (valid JSON Schema 2020-12 skeleton with empty oneOf)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create repo-root dev manifest, .gitattributes, and .gemini-cli-compat seed** - `77b5801` (chore)
2. **Task 2: Create spec/ directory skeleton with seeded placeholder files** - `0ed1f04` (chore)

## Files Created/Modified

- `package.json` - ESM private package with dev deps: ajv@^8.17.1, ajv-formats@^3.0.1, json-schema-to-typescript@15.0.4, typescript@^5.6.3; validate and validate:all npm scripts
- `.gitattributes` - Disables CRLF normalization for `spec/fixtures/**` (byte-exact NDJSON) and marks `_assets/` as binary
- `.gemini-cli-compat` - Empty seed file (0 bytes); plan-04 writes pinned gemini-cli version after host verification
- `spec/protocol.md` - Seed placeholder for event wire protocol draft (W4 population)
- `spec/errors.md` - Seed placeholder for error pattern draft (W4 population)
- `spec/feasibility.md` - Frontmatter with resume_verdict/config_dir_verdict/flush_verdict/captured_against all set to `pending`; required by plan-02 `feasibility` validator subcommand
- `spec/capture.md` - Seed placeholder for fixture capture procedure doc (W2/W3 population)
- `spec/events.schema.json` - Minimal valid JSON Schema 2020-12 skeleton: `$schema`, `$id`, `title`, `description`, empty `oneOf` array; plan-09 populates oneOf
- `spec/fixtures/.gitkeep` - Empty file to track fixtures directory in git
- `spec/fixtures/_assets/.gitkeep` - Empty file to track _assets directory in git (test images/PDFs for multimodal fixtures)
- `spec/fixtures.manifest.json` - Canonical 12-slug list: simple-text, tool-use-builtin, resume-session-turn1, resume-session-turn2, error-rate-limit, error-auth, event-unknown, thinking, multimodal-image, multimodal-pdf, large-output, abort-midstream

## Fixture Slug Reference (for downstream plans)

```json
[
  "simple-text",
  "tool-use-builtin",
  "resume-session-turn1",
  "resume-session-turn2",
  "error-rate-limit",
  "error-auth",
  "event-unknown",
  "thinking",
  "multimodal-image",
  "multimodal-pdf",
  "large-output",
  "abort-midstream"
]
```

## Decisions Made

- `resume-session` is split into `resume-session-turn1` and `resume-session-turn2` (12 total slugs, not 11) per CONTEXT.md two-turn session design; plan-02's manifest validator checks for exactly 12
- `spec/events.schema.json` intentionally uses `oneOf: []` — valid JSON Schema 2020-12 that passes ajv compile but matches nothing; plan-09 populates it after empirical fixture capture
- `.gemini-cli-compat` created as an empty seed (0 bytes) rather than writing the version now — plan-04 verifies `gemini --version` on the capture host before pinning, preventing stale version assumption

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All skeleton files are in place for W1+ tasks to append content atomically
- plan-02 (validate-fixtures.mjs) can reference `spec/fixtures.manifest.json` for the manifest subcommand
- plan-04 can write `gemini --version` output to `.gemini-cli-compat`
- plan-09 can populate `spec/events.schema.json` oneOf array
- `npm install` must be run before any Node script executes (not done in this plan per plan action instructions)

---
*Phase: 01-feasibility-spike-fixture-capture*
*Completed: 2026-04-11*
