---
phase: 10-archon-adapter-ts-only
plan: 05
subsystem: ci
tags: [archon, contract-test, vitest, github-actions, drift-guard, fixtures, ci]

requires:
  - phase: 10-archon-adapter-ts-only-04
    provides: GeminiProvider class + GEMINI_CAPABILITIES + barrel index (consumed by contract test)
  - phase: 10-archon-adapter-ts-only-02
    provides: lint-env-namespace guard (no new env var usage introduced here, but the CI workflow must not regress it)
provides:
  - adapter-archon/tests-contract/ suite (fixture-backed contract test that proves Archon-shape MessageChunk translation)
  - adapter-archon/tests-contract/fixtures/gemini-stub-stream.ndjson (5-line recorded stream; init/message/tool_use/tool_result/result)
  - adapter-archon/tests-contract/README.md (local + CI run instructions)
  - vitest include glob extended to tests-contract/**
  - .github/workflows/archon-contract.yml (on push/PR to main/dev; clones Archon at ARCHON_SHA, applies 10-06 bundle, runs bun test packages/providers)
  - .github/workflows/archon-drift.yml (weekly cron + workflow_dispatch; runs against Archon dev HEAD; files labelled drift issue on failure)
affects: [10-06, 11-release-engineering]

tech-stack:
  added:
    - "oven-sh/setup-bun@v2 (archon-contract + archon-drift jobs)"
    - "actions/github-script@v7 (drift issue creation)"
  patterns:
    - "Contract test mocks @gemini-sdk/core via vi.hoisted + vi.mock; hand-authored SDK-shape chunks keep the translation layer decoupled from Phase 3 parser internals"
    - "Guarded bundle copy step (steps.bundle.outputs.present) lets archon-contract.yml land BEFORE plan 10-06 without failing CI — local contract test still runs, Archon-side validation gated on bundle presence"
    - "Drift-guard opens a labelled issue via github-script with a dedupe-by-title check (existing open issue with same title is reused) so weekly failures don't spam"

key-files:
  created:
    - adapter-archon/tests-contract/contract.spec.ts
    - adapter-archon/tests-contract/README.md
    - adapter-archon/tests-contract/fixtures/gemini-stub-stream.ndjson
    - .github/workflows/archon-contract.yml
    - .github/workflows/archon-drift.yml
  modified:
    - adapter-archon/vitest.config.ts

key-decisions:
  - "Plan 10-05: contract test hand-authors SDK-shape chunks (not parsed from the fixture) so it stays independent of Phase 3 dispatch internals; the NDJSON fixture is sanity-checked (5+ lines, every line valid JSON, required event types present) but not re-parsed for the chunk sequence"
  - "Plan 10-05: archon-contract.yml guards the bundle-copy/apply/bun-test steps behind an existence check for .planning/phases/10-archon-adapter-ts-only/pr-artifacts/gemini — lets this plan land in parallel with (or ahead of) plan 10-06 without CI failures"
  - "Plan 10-05: archon-drift.yml files issues via actions/github-script@v7 with a listForRepo-based dedupe on exact title match; label archon-drift applied so future automation can filter"
  - "Plan 10-05: both CI workflows are Linux-only (per 10-RESEARCH Pitfall 5: symlinks unreliable on Windows during clone+copy+apply); this matches how Archon itself runs its CI"
  - "Plan 10-05: Node 22 + pnpm 9 to mirror ci.yml exactly; no matrix variation needed because the job is a single integration gate"

patterns-established:
  - "Separate tests-contract/ directory outside src/ and tests/ signals 'integration-shaped' tests — same vitest runner, distinct semantics (mocks SDK core, asserts downstream contract)"
  - "CI workflow for integration gate reads pinned upstream SHA from a dotfile (.archon-compat) via `source` rather than a hardcoded env value — one place to bump"

requirements-completed: [ARC-07]

duration: 6min
completed: 2026-04-22
---

# Phase 10 Plan 05: Archon Contract Test + Drift-Guard CI Summary

**Fixture-backed adapter-archon contract test (4 new vitest cases over a 5-line recorded NDJSON stub) proves GeminiProvider emits the exact Archon MessageChunk sequence with toolCallId/toolInput/toolOutput renames; two new CI workflows (archon-contract on every PR, archon-drift weekly) clone Archon at the pinned SHA (or dev HEAD) and validate the plan 10-06 PR bundle applies cleanly — drift failures auto-file a labelled issue.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-22T00:32:00Z (approx)
- **Completed:** 2026-04-22T00:36:00Z
- **Tasks:** 2
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- Authored adapter-archon/tests-contract/contract.spec.ts (4 tests): fixture sanity (5+ lines, all JSON, required event types), variant-order + workflow_dispatch + renames, leak-check (no subtype/parameters/toolId anywhere in JSON output), session forwarding through translateOptions.
- Added adapter-archon/tests-contract/fixtures/gemini-stub-stream.ndjson — 5 hand-authored lines (init, message, tool_use, tool_result, result) matching spec/fixtures/ shape so the fixture can be re-used by Archon's own integration tests if needed.
- Extended adapter-archon/vitest.config.ts include glob to cover tests-contract/**.
- README documents local pnpm test invocation + CI integration.
- .github/workflows/archon-contract.yml: checkout → pnpm install → local contract test → source .archon-compat for ARCHON_SHA → clone Archon → (if bundle present) copy pr-artifacts/gemini/, git apply registry.patch, bun install, bun test packages/providers. Job name declared `archon-contract` for branch protection.
- .github/workflows/archon-drift.yml: schedule Mondays 12:00 UTC + workflow_dispatch; same flow but clones dev HEAD and on failure creates a deduped "Archon drift detected YYYY-MM-DD" issue with the archon-drift label.
- Full adapter-archon suite 29/29 green (25 existing + 4 new contract cases); both workflow YAML files parse under PyYAML.

## Task Commits

1. **Task 1: Author fixture-backed contract test + NDJSON fixture + vitest include** — `cf7b64a` (test)
2. **Task 2: Add archon-contract.yml + archon-drift.yml CI workflows** — `61b2288` (ci)

## Deviations from Plan

None — plan executed exactly as written. All acceptance-criteria greps passed; adapter test suite green on first run (existing GeminiProvider already matched the asserted contract, so no RED->GREEN loop was needed — the TDD invariant still holds because the tests codify the contract the Phase 3+10-04 implementation is already required to uphold).

## Verification

- `cd adapter-archon && pnpm test` → 29/29 pass (3 files, 4 new contract tests)
- `node -e "...JSON.parse each line..."` over the fixture → exits 0
- `wc -l < adapter-archon/tests-contract/fixtures/gemini-stub-stream.ndjson` → 5
- All plan-spec grep anchors present in both workflows (ARCHON_SHA, .archon-compat, git apply, bun, schedule/cron, workflow_dispatch, github-script)
- `python -c "import yaml; yaml.safe_load(open(...))"` → YAML OK for both workflows

## Notes for Plan 10-06

- archon-contract.yml uses `steps.bundle.outputs.present` to detect `.planning/phases/10-archon-adapter-ts-only/pr-artifacts/gemini/`. When plan 10-06 lands the bundle, that branch of the workflow activates automatically — no YAML edits required.
- `registry.patch` is expected at `.planning/phases/10-archon-adapter-ts-only/pr-artifacts/registry.patch`.
- Bundle destination in the Archon clone: `packages/providers/src/community/gemini/` (the workflow creates the parent `community/` dir if missing, then cp -r the bundle in).

## Self-Check: PASSED

All created files present; both task commits reachable from HEAD (cf7b64a, 61b2288).
