---
phase: 01-feasibility-spike-fixture-capture
plan: 03
subsystem: scripts
tags: [capture-engine, redactor, cli-scaffold, fixture-pipeline, wave-0]
dependency_graph:
  requires:
    - spec/fixtures.manifest.json (plan 01-01)
    - scripts/_redactor.mjs (this plan, task 1)
  provides:
    - scripts/_redactor.mjs
    - scripts/capture-fixtures.mjs
    - scripts/capture-fixtures.sh
    - scripts/capture-fixtures.cmd
  affects:
    - W1 (plan 01-04): fills in feasibility + simple-text spawn logic by editing capture-fixtures.mjs
    - W2 (plan 01-05): fills in smoke test scenarios
    - W3 (plan 01-07+): fills in remaining fixture scenarios
tech_stack:
  added: []
  patterns:
    - Node ESM modules, stdlib-only (no npm deps in scripts/)
    - Regex-first + structure-aware JSON redaction (belt-and-braces, per CONTEXT.md)
    - POSIX exec-based wrapper (signal propagation for SIGTERM in abort-midstream)
    - Windows %~dp0 wrapper (absolute path resolution, exit code passthrough)
key_files:
  created:
    - scripts/_redactor.mjs
    - scripts/capture-fixtures.mjs
    - scripts/capture-fixtures.sh
    - scripts/capture-fixtures.cmd
  modified: []
decisions:
  - "Windows path regex corrected from /C:\\Users\\/ to /C:\\\\Users\\\\/ — the plan spec regex was wrong due to JS regex literal semantics where \\U is not a valid escape and silently matches just U. Fixed to double-escape so the pattern source is C:\\\\Users\\\\ which correctly matches double-backslash JSON-escaped Windows paths (e.g. C:\\\\Users\\\\alice from JSON.stringify)"
  - "spec/fixtures.manifest.json created inline as a prerequisite (plan 01-01 artifact was missing from the working tree); manifest content matched the interface definition in plan 01-01 exactly (12 slugs)"
metrics:
  duration: ~25 minutes
  completed: "2026-04-11"
  tasks_completed: 3
  files_created: 4
  commits: 3
---

# Phase 1 Plan 03: Capture Engine Scaffold Summary

Capture engine scaffold plus redactor module, all four `scripts/` files complete, all Wave 0 stubs in place for W1/W2/W3 to edit.

## What Was Built

**scripts/_redactor.mjs** (163 lines) — Standalone Node ESM secrets-redaction module, no third-party dependencies.
- `REDACTORS` array: 8 regex patterns applied in order (specific `AIzaSy` prefix before broader `AIza`, per RESEARCH.md ordering requirement)
- `redact(text)`: string -> string, applies all 8 patterns
- `redactJsonValue(value)`: deep-walks parsed JSON; keys in `SENSITIVE_KEYS` get `'<REDACTED>'`; string values run through `redact()`; arrays recurse; numbers/booleans/null pass through unchanged
- Self-test (6 assertions) runs on direct invocation (`node scripts/_redactor.mjs`); exits 0 with `_redactor self-test: OK`

**scripts/capture-fixtures.mjs** (259 lines) — Capture engine scaffold.
- CLI dispatcher with distinct exit codes (see Exit-Code Contract below)
- `SCENARIOS` registry: all 12 slugs, all `stubbed: true` at end of W0
- `verifyManifestParity()`: reads `spec/fixtures.manifest.json`, cross-checks slug sets, exits 3 on drift — proves scenario registry stays in sync with plan 01-01's manifest
- Re-exports `redact` and `redactJsonValue` as a facade (ensures the import is tree-shaker-visible)

**scripts/capture-fixtures.sh** (2 lines) — POSIX thin wrapper.
- `exec node "$(dirname "$0")/capture-fixtures.mjs" "$@"` — `exec` replaces the shell process so SIGTERM propagates directly to Node (critical for `abort-midstream` scenario)

**scripts/capture-fixtures.cmd** (3 lines) — Windows thin wrapper.
- `%~dp0capture-fixtures.mjs` expands to absolute path regardless of cwd
- `exit /b %ERRORLEVEL%` preserves Node exit code to the Windows caller

## Exit-Code Contract for capture-fixtures.mjs

| Exit Code | Meaning |
|-----------|---------|
| 0 | `--help` / `-h` / no arg: usage printed successfully |
| 1 | Unknown argument (not a slug, not a recognized subcommand) |
| 2 | NOT_IMPLEMENTED: stubbed subcommand (`feasibility`, `all`) or stubbed scenario (`<slug>`) |
| 3 | Manifest/scenario drift: SCENARIOS keys and manifest slugs do not match exactly |
| 99 | Uncaught runtime error (caught by `main().catch`) |

## Scenario Registry — Field Status

All 12 scenarios marked `stubbed: true`. Fields populated in W0:

| Field | Populated | Pending |
|-------|-----------|---------|
| `slug` | All 12 | — |
| `description` | All 12 | — |
| `args` | All except event-unknown (synthetic) | event-unknown has no args |
| `cwd` | tool-use-builtin only | All others default to REPO_ROOT |
| `env` | error-auth only | All others inherit process.env |
| `timeoutMs` | large-output (180000ms) | All others default 60000ms (set by W1) |
| `captureStderr` | error-rate-limit, error-auth | All others default false |
| `expectNonZeroExit` | error-rate-limit, error-auth | All others expect exit 0 |
| `synthetic` | event-unknown | — |
| `pairWith` | resume-session-turn1 ↔ turn2 | — |
| `abortAtMs` | abort-midstream (2000ms) | — |
| `stubbed` | All 12 (true) | W1 removes from simple-text; W3 removes remainder |

## Scenario Deviations from Template

- **tool-use-builtin cwd**: Set to `spec/fixtures/_assets/workspace`. This directory does not exist in W0 (plan 01-07 creates it with `test.txt`). The cwd field is present and correct but the path will produce an error if spawn logic runs before plan 01-07 executes. No change needed — spawn logic is not exercised in W0.
- **event-unknown**: Marked `synthetic: true`. Has no `args` array (it's constructed synthetically from `simple-text`'s init line with `type` mutated to `cosmic_ray_hit`). Skipped by the `all` subcommand.
- **resume-session-turn2 `args`**: Contains the literal placeholder string `<SESSION_ID_FROM_TURN1>`. W3 implementation will replace this with the actual session ID extracted from turn1's captured output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Windows path regex pattern corrected**
- **Found during:** Task 1 self-test (Test 3 failed: `regex 5 failed`)
- **Issue:** The plan spec provided the pattern `/C:\\Users\\[^\\"]+/gi`. In a JS regex literal, `\U` is not a valid escape sequence and silently matches just `U` (the backslash is discarded). So the pattern source was `C:\Users\[^\\"]+` which matches `C:Users` (no backslash), not `C:\Users\`. The plan's test input `'path is C:\\\\Users\\\\alice\\\\Documents'` produces the string `path is C:\\Users\\alice\\Documents` (double backslashes, simulating a JSON-escaped path), which requires a pattern that matches double backslashes.
- **Fix:** Changed to `/C:\\\\Users\\\\[^\\"]+/gi` which has source `C:\\Users\\[^\\"]+` and correctly matches `C:\\Users\\alice` (double-backslash form).
- **Files modified:** `scripts/_redactor.mjs` line 25
- **Commit:** af34359

**2. [Rule 3 - Blocking] Created spec/fixtures.manifest.json as prerequisite**
- **Found during:** Pre-execution check (spec/fixtures.manifest.json was expected from plan 01-01 but not found in working tree)
- **Issue:** `verifyManifestParity()` reads the manifest; without it the script exits 3 immediately on any non-help subcommand. The file was subsequently discovered to exist from prior plan execution (git history showed plan 01-01 was completed).
- **Fix:** Created manifest with the 12 slugs from the plan 01-01 interface definition. The file was already tracked — the creation was redundant but harmless.
- **Commit:** af34359 (staged alongside `_redactor.mjs` but file was already in index)

## Self-Check: PASSED

All four files exist on disk. All three task commits verified in git history.

| Check | Result |
|-------|--------|
| scripts/_redactor.mjs exists | FOUND |
| scripts/capture-fixtures.mjs exists | FOUND |
| scripts/capture-fixtures.sh exists | FOUND |
| scripts/capture-fixtures.cmd exists | FOUND |
| commit af34359 (_redactor.mjs) | FOUND |
| commit 66c103a (capture-fixtures.mjs) | FOUND |
| commit fd074a0 (platform wrappers) | FOUND |
