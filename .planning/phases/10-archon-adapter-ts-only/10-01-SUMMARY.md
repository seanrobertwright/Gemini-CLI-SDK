---
phase: 10-archon-adapter-ts-only
plan: 01
subsystem: infra
tags: [archon, adapter, typescript, vitest, pnpm-workspace, type-mirror]

requires:
  - phase: 09-mcp-passthrough-isolated-config-dir
    provides: "Complete @gemini-sdk/core public API (QueryOptions, MCP passthrough) consumed by adapter-archon"
provides:
  - "Local Archon IAgentProvider TypeScript type mirror (avoids @archon/providers npm dep)"
  - "Pinned Archon dev SHA (.archon-compat) for plan 10-05 contract test"
  - "Canonical OPTION_MAPPING triage doc (spec/archon/mapping.md) with 25 prefixed keys"
  - "adapter-archon wired into pnpm + vitest workspace"
affects: [10-02, 10-03, 10-04, 10-05, 10-06]

tech-stack:
  added: [vitest (adapter-archon), "@types/node (adapter-archon)"]
  patterns: ["Local type mirror with SHA pin + contract test for upstream drift guard", "Prefixed nodeConfig.<field> keys in OPTION_MAPPING (not collapsed with top-level duplicates)"]

key-files:
  created:
    - adapter-archon/src/types.ts
    - adapter-archon/vitest.config.ts
    - .archon-compat
    - spec/archon/mapping.md
  modified:
    - adapter-archon/package.json

key-decisions:
  - "Mirror Archon types locally rather than depending on @archon/providers (Archon publishes source .ts only, not a compiled npm package)"
  - "Pin Archon SHA 7ea321419f0cd48e71e9ebf12968f539bc4166bc (dev @ 2026-04-21) in .archon-compat; contract test in 10-05 clones this commit"
  - "NodeConfig duplicates (systemPrompt, maxBudgetUsd, fallbackModel) registered as DISTINCT prefixed rows in OPTION_MAPPING — keeps drift test meaningful at 25 keys"
  - "Vitest pinned to ^3.2 matching ts/ workspace (Node 18 compatibility)"

patterns-established:
  - "Type mirror header comment cites raw.githubusercontent.com URL + SHA + verification date; linked to .archon-compat"
  - "Triage buckets: honored / partial / deferred / ignored — partial/ignored/deferred fields silent in production, dev-warn under NODE_ENV=development or DEBUG=gemini-sdk:*"

requirements-completed: [ARC-05]

duration: 10min
completed: 2026-04-21
---

# Phase 10 Plan 01: Archon Adapter TS Foundation Summary

**Local Archon IAgentProvider type mirror (verified @ dev SHA 7ea321419f) + 25-key OPTION_MAPPING triage doc + adapter-archon wired into pnpm/vitest workspace.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-21T22:29:00Z
- **Completed:** 2026-04-21T22:39:16Z
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `adapter-archon/src/types.ts` — 8-variant MessageChunk + IAgentProvider/SendQueryOptions/NodeConfig/ProviderCapabilities mirrors compile standalone
- `.archon-compat` — pinned Archon dev SHA for plan 10-05 contract test to clone
- `spec/archon/mapping.md` — 25-row canonical triage table (11 honored / 5 partial / 4 deferred / 5 ignored) with NodeConfig prefixed-key convention
- adapter-archon `pnpm typecheck` and `pnpm test` (vitest, 0 tests, passWithNoTests) both green
- `@gemini-sdk/core` linked as `workspace:*` dep — unblocks plan 10-02 provider.ts import

## Task Commits

1. **Task 1: Wire adapter-archon into pnpm+vitest workspace** — `09fece7` (chore)
2. **Task 2: Author local type mirror + pin Archon SHA** — `9b45bc3` (feat)
3. **Task 3: Author spec/archon/mapping.md triage** — `545c13e` (docs)

**Plan metadata:** (final commit below)

## Files Created/Modified
- `adapter-archon/package.json` — add @gemini-sdk/core workspace dep, vitest ^3.2, @types/node; add test script
- `adapter-archon/vitest.config.ts` — vitest config with src/tests include globs
- `adapter-archon/src/types.ts` — local Archon IAgentProvider type mirror (~100 lines, verbatim from dev @ 7ea321419f)
- `.archon-compat` — pinned SHA + verification date (repo root)
- `spec/archon/mapping.md` — canonical OPTION_MAPPING triage (25 prefixed keys, bucket totals, drift-test contract)

## Decisions Made
- Mirror Archon types locally — Archon's `@archon/providers` is source-only TypeScript, no published npm package during Archon's current draft window; drift protected by contract test in plan 10-05
- NodeConfig duplicate fields (`systemPrompt`, `maxBudgetUsd`, `fallbackModel`) get DISTINCT prefixed rows in OPTION_MAPPING — NOT collapsed — so the plan 10-03 drift test can assert exactly 25 keys
- Dev-warn behavior gated by `NODE_ENV=development` OR `DEBUG=gemini-sdk:*` — silent in production, matches existing SDK warn convention

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met on first pass.

## Issues Encountered

- `pnpm install` surfaced pre-existing peer warning: `@fast-check/vitest 0.4.0` unmet peer `vitest@^4.1.0` (found 3.2.4). Out of scope (Phase 04 decision: vitest pinned to ^3.2 for Node 18 CI). No action taken.
- Local verification used `grep -c '^| \`'` in bash — shell stripped the backtick, returning 0. Re-verified via ripgrep (`Grep` tool) which correctly reported 25 rows. Plan's acceptance criterion met.

## Self-Check: PASSED

- `adapter-archon/src/types.ts` — FOUND
- `adapter-archon/vitest.config.ts` — FOUND
- `.archon-compat` — FOUND
- `spec/archon/mapping.md` — FOUND (25 triage rows verified via ripgrep)
- `adapter-archon/package.json` — MODIFIED (workspace dep + vitest + test script)
- Commit `09fece7` — FOUND
- Commit `9b45bc3` — FOUND
- Commit `545c13e` — FOUND
- `pnpm typecheck` — green
- `pnpm test` — green (0 tests, passWithNoTests)

## Next Phase Readiness
- Plan 10-02 unblocked: can import types from `adapter-archon/src/types.ts` to build `provider.ts`
- Plan 10-03 unblocked: `spec/archon/mapping.md` defines the 25-key EXPECTED_KEYS set + 11/5/4/5 bucket counts for the drift test
- Plan 10-05 unblocked: `.archon-compat` SHA pin ready for contract test clone step

---
*Phase: 10-archon-adapter-ts-only*
*Completed: 2026-04-21*
