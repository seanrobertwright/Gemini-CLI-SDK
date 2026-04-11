---
phase: 01-feasibility-spike-fixture-capture
plan: 02
subsystem: testing
tags: [node, esm, ajv, json-schema, ndjson, trufflehog, uvx, datamodel-code-generator, typescript, pydantic]

# Dependency graph
requires:
  - phase: 01-feasibility-spike-fixture-capture
    plan: 01
    provides: "package.json devDependencies, spec/ skeleton, spec/fixtures.manifest.json, spec/events.schema.json seed, spec/feasibility.md seed, .gemini-cli-compat seed"

provides:
  - "scripts/validate-fixtures.mjs: Node ESM multi-subcommand validator (parse, schema, pairs, manifest, pin, feasibility, citations)"
  - "scripts/validate-schema-ts.mjs: JSON Schema to TS codegen smoke test (json-schema-to-typescript + tsc)"
  - "scripts/validate-schema-py.sh + .cmd: Python codegen smoke test (datamodel-code-generator via uvx + Pydantic import)"
  - "scripts/audit-fixtures.sh + .cmd: TruffleHog filesystem audit with docker fallback"

affects:
  - "01-03 through 01-10: all subsequent plans use validate-fixtures.mjs for per-task verification"
  - "01-04: pin subcommand validates .gemini-cli-compat after W1 writes the version"
  - "01-05: feasibility subcommand validates spec/feasibility.md after W2 populates verdicts"
  - "01-07/01-08: parse, schema, pairs, manifest subcommands validate fixture corpus as W3 populates"
  - "01-09: validate-schema-ts.mjs and validate-schema-py.sh verify schema codegen after W4 populates oneOf"

# Tech tracking
tech-stack:
  added:
    - "ajv@^8.17.1 (Ajv 2020-12 dialect for JSON Schema validation)"
    - "ajv-formats@^3.0.1 (format validators for Ajv)"
    - "json-schema-to-typescript@15.0.4 (JS schema to TypeScript codegen)"
    - "typescript@^5.6.3 (tsc for TS validation)"
    - "uvx / datamodel-code-generator==0.30.2 (Pydantic v2 codegen from JSON Schema)"
    - "trufflehog (secret detection; invoked from audit-fixtures.sh)"
  patterns:
    - "Each validation script returns { ok: boolean, messages: string[] } for composable verification"
    - "Seed-state guards: scripts handle W0 empty/pending state without failing (enables incremental population)"
    - "Import guard pattern: fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) prevents side effects on import"
    - "Windows compatibility: bash wrappers for .sh scripts; spawn with shell: false for security (CVE-2024-27980)"

key-files:
  created:
    - scripts/validate-fixtures.mjs
    - scripts/validate-schema-ts.mjs
    - scripts/validate-schema-py.sh
    - scripts/validate-schema-py.cmd
    - scripts/audit-fixtures.sh
    - scripts/audit-fixtures.cmd

key-decisions:
  - "validate-fixtures.mjs uses import guard so it can be imported without triggering execution — enables future test harness use"
  - "feasibility subcommand skips Verdict: body check when all verdicts are pending (W0 seed state has no body content yet)"
  - "audit-fixtures.sh exits 0 with INFO when spec/fixtures/ has no fixture files (W3 populates incrementally)"
  - "validate-schema-ts.mjs uses npx -y typescript@5 tsc to avoid requiring global tsc install"
  - "validate-schema-py.sh uses TMPDIR_LOCAL (not TMPDIR) as local variable to avoid clobbering the env var"

patterns-established:
  - "Subcommand dispatch pattern: validate-fixtures.mjs runs all defaults or one named subcommand via process.argv[2]"
  - "Seed-state tolerance: W0 scripts must handle empty/pending state gracefully — no failures before W1-W4 populate data"

requirements-completed:
  - PRS-08
  - PRS-09

# Metrics
duration: 3min
completed: 2026-04-11
---

# Phase 01 Plan 02: Validation Toolchain Summary

**Seven-subcommand Node ESM validator plus TS/Python codegen smoke tests and TruffleHog audit scripts, all handling W0 seed state without failures**

## Performance

- **Duration:** ~3 minutes
- **Started:** 2026-04-11T21:40:09Z
- **Completed:** 2026-04-11T21:43:09Z
- **Tasks:** 3
- **Files modified/created:** 6 scripts

## Accomplishments

- `scripts/validate-fixtures.mjs` implements all seven subcommands (parse, schema, pairs, manifest, pin, feasibility, citations) with seed-state tolerance; default run executes parse + schema + pairs + manifest
- `scripts/validate-schema-ts.mjs` compiles `spec/events.schema.json` with `json-schema-to-typescript@15.0.4`, writes temp `.d.ts`, validates with `tsc --noEmit --strict --target es2022`, and cleans up
- Four shell/batch scripts for Python codegen smoke test and TruffleHog audit, all passing `bash -n` syntax check and handling the W0 empty-fixtures case

## Validate-fixtures.mjs Invocation Contract

| Subcommand | Description | Runs Immediately? |
|------------|-------------|-------------------|
| `parse` | Every `spec/fixtures/*.ndjson` is valid NDJSON | Yes — exits 0 with INFO when dir is empty |
| `schema` | Every fixture event validates against `spec/events.schema.json` via Ajv 2020 | Yes — exits 0 with WARN when oneOf is empty (plan 09 populates it) |
| `pairs` | Every `.ndjson` has a sibling `.expected.json` | Yes — exits 0 with INFO when dir is empty |
| `manifest` | `spec/fixtures.manifest.json` is valid; reports present/missing slugs | Yes — exits 0 even when all 12 slugs are missing (W3 populates them) |
| `pin` | `.gemini-cli-compat` exists with semver content | Yes — exits 0 with INFO when file is empty (W1 writes version) |
| `feasibility` | `spec/feasibility.md` has three verdict keys and body content | Yes — exits 0 when all verdicts are pending (W2 populates body) |
| `citations` | `spec/protocol.md` and `spec/errors.md` cite fixture filenames | Yes — exits 0 with INFO when files are still placeholders |

**Default (no arg):** runs `parse` + `schema` + `pairs` + `manifest` in sequence. Exit 0 iff all pass.

## Task Commits

1. **Task 0 (prerequisite): spec/ skeleton files from plan 01-01** - `0ed1f04` (chore)
2. **Task 1: validate-fixtures.mjs with all seven subcommands** - `23cc715` (feat)
3. **Task 2: validate-schema-ts.mjs codegen smoke test** - `4999133` (feat)
4. **Task 3: validate-schema-py and audit-fixtures scripts + Windows wrappers** - `8ced92d` (feat)

## Files Created

- `scripts/validate-fixtures.mjs` — Node ESM, 511 lines, seven subcommands, seed-state tolerant
- `scripts/validate-schema-ts.mjs` — Node ESM, 127 lines, json-schema-to-typescript + tsc smoke test
- `scripts/validate-schema-py.sh` — bash, 42 lines, datamodel-code-generator==0.30.2 via uvx + Pydantic import smoke test
- `scripts/validate-schema-py.cmd` — 6 lines, Windows wrapper delegating to validate-schema-py.sh via bash
- `scripts/audit-fixtures.sh` — bash, 42 lines, trufflehog filesystem scan with docker fallback, no-op when fixtures dir is empty
- `scripts/audit-fixtures.cmd` — 6 lines, Windows wrapper delegating to audit-fixtures.sh via bash

## Decisions Made

- Import guard pattern (`fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`) ensures `validate-fixtures.mjs` and `validate-schema-ts.mjs` can be imported by future test harnesses without triggering execution or `process.exit()` side effects.
- The `feasibility` subcommand skips the "Verdict:" body-line count check when all three frontmatter verdicts are `pending`, matching the W0 seed state where the body has no populated content yet.
- The `citations` subcommand detects placeholder files via the literal string `(Drafted in Phase 1` and skips citation checks for those files, avoiding false failures before W4 populates them.
- `validate-schema-py.sh` uses `TMPDIR_LOCAL` rather than `TMPDIR` as the local variable name to avoid clobbering the `$TMPDIR` shell environment variable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] spec/ skeleton not committed before plan 01-02 execution**
- **Found during:** Start (pre-execution dependency check)
- **Issue:** Plan 01-01 Task 2 (create spec/ directory skeleton) was never committed; the spec/ files existed on disk but git status showed them as untracked. Plan 01-02 depends on `spec/fixtures.manifest.json`, `spec/events.schema.json`, `spec/feasibility.md`, and `spec/protocol.md` / `spec/errors.md` existing and being committed.
- **Fix:** Committed the pre-existing spec/ files as plan 01-01 Task 2 completion before executing plan 01-02 tasks.
- **Files committed:** spec/capture.md, spec/errors.md, spec/events.schema.json, spec/feasibility.md, spec/fixtures.manifest.json, spec/fixtures/.gitkeep, spec/fixtures/_assets/.gitkeep, spec/protocol.md
- **Commit:** 0ed1f04

**2. [Rule 1 - Bug] feasibility subcommand exited non-zero against seed state**
- **Found during:** Task 1 verification
- **Issue:** The `feasibility` subcommand required at least 3 `Verdict: ` lines in the body, but the W0 seed `spec/feasibility.md` has no body content yet (only frontmatter). The plan's `<done>` criteria specifies exit 0 when all verdicts are pending.
- **Fix:** Added `allPending` check before the body "Verdict: " line count assertion, mirroring the existing matrix table assertion logic already described in the plan pseudocode.
- **Files modified:** scripts/validate-fixtures.mjs
- **Committed in:** 23cc715 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking prerequisite, 1 bug)
**Impact on plan:** Both fixes were necessary for correctness. No scope creep.

## Subcommand Readiness Matrix

| Subcommand | Runs immediately? | Needs `npm install`? | Needs `uvx`? | Needs fixtures? |
|------------|-------------------|---------------------|--------------|-----------------|
| `manifest` | Yes | No | No | No |
| `pin` | Yes | No | No | No |
| `feasibility` | Yes | No | No | No |
| `citations` | Yes | No | No | No |
| `parse` | Yes (no-ops gracefully) | No | No | W3 populates |
| `pairs` | Yes (no-ops gracefully) | No | No | W3 populates |
| `schema` | Yes (WARN, skip validation) | No (Ajv not imported when oneOf empty) | No | W3 populates |
| validate-schema-ts | No | **Yes** | No | W4 (oneOf populated) |
| validate-schema-py | No | No | **Yes** | W4 (oneOf populated) |
| audit-fixtures | Yes (no-op) | No | No | W3 populates |

## Next Phase Readiness

- All W0 validation scripts are in place — downstream waves (W1-W4) can use `node scripts/validate-fixtures.mjs <subcommand>` for per-task verification
- `npm install` is the next required step (plan 01-03 or equivalent) before `validate-schema-ts.mjs` can be run end-to-end
- `uvx` must be available on the capture host before `validate-schema-py.sh` can run end-to-end

---
*Phase: 01-feasibility-spike-fixture-capture*
*Completed: 2026-04-11*
