---
phase: 10-archon-adapter-ts-only
plan: 04
subsystem: api
tags: [archon, provider, adapter, typescript, vitest, gemini-cli]

requires:
  - phase: 10-archon-adapter-ts-only-03
    provides: translateOptions / translateChunk / warnIgnoredOptions (options-translator core)
  - phase: 10-archon-adapter-ts-only-02
    provides: lint-env-namespace guard enforcing GEMINI_*/platform allowlist
  - phase: 10-archon-adapter-ts-only-01
    provides: adapter-archon workspace scaffold + local IAgentProvider/MessageChunk mirror
provides:
  - GeminiProvider class implementing IAgentProvider (getType, getCapabilities, sendQuery)
  - GEMINI_CAPABILITIES static matrix for Archon registry
  - registerGeminiProvider(registry) with structural ProviderRegistryLike param (DI for standalone + Archon-drop)
  - Barrel index.ts surfacing GeminiProvider, registerGeminiProvider, GEMINI_CAPABILITIES and type re-exports
  - provider.spec.ts with 5 behavior tests + compile-time ARC-02 structural check
affects: [10-05, 10-06, 11-release-engineering]

tech-stack:
  added: []
  patterns:
    - "Provider class = thin shim over pure translator functions (translateOptions/translateChunk); no business logic in provider.ts"
    - "workflow_dispatch emission cadence: one per SDK tool chunk, workerConversationId:'' (matches Claude/Codex providers)"
    - "registerGeminiProvider uses dependency injection for registry API — parameter form for standalone, direct imports after Archon drop"
    - "vi.hoisted + vi.mock('@gemini-sdk/core') ESM stub for query() in provider.spec.ts"

key-files:
  created:
    - adapter-archon/src/capabilities.ts
    - adapter-archon/src/provider.ts
    - adapter-archon/src/registration.ts
    - adapter-archon/src/provider.spec.ts
  modified:
    - adapter-archon/src/index.ts

key-decisions:
  - "Plan 10-04: provider.ts stays a pure delegation loop (49 LOC, well under 250 cap); translation logic stays in options-translator.ts per plan 10-03"
  - "Plan 10-04: registerGeminiProvider takes ProviderRegistryLike as structural parameter (not direct Archon import) — enables standalone typecheck/test AND drops cleanly into Archon's source tree via 1-line header swap"
  - "Plan 10-04: workflow_dispatch sentinel emitted BEFORE translated tool chunk; workerConversationId always '' (Archon expectation, see 10-RESEARCH Pattern 3)"
  - "Plan 10-04: errors from query() propagate with object identity preserved — GeminiError .bucket field already maps to Archon's 5 retry buckets (Phase 5), so no wrapping needed"
  - "Plan 10-04: compile-time ARC-02 check via const _structuralCheck: IAgentProvider = new GeminiProvider() — tsc catches signature drift at module load, not runtime"

patterns-established:
  - "Adapter provider shape: getType (static string) + getCapabilities (static matrix) + sendQuery (delegation generator) — no mutable state"
  - "Registry injection: structural ProviderRegistryLike interface avoids coupling to Archon source during standalone dev"

requirements-completed: [ARC-01, ARC-02, ARC-03, ARC-04, ARC-06]

duration: 5min
completed: 2026-04-22
---

# Phase 10 Plan 04: Adapter Provider + Capabilities + Registration Summary

**GeminiProvider class (49 LOC) delegating to @gemini-sdk/core.query(), with GEMINI_CAPABILITIES matrix, DI-based registerGeminiProvider shell, and 5 vitest cases covering getType/capabilities/delegation/error propagation — all 25 adapter-archon tests green.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-22T00:26:00Z (approx)
- **Completed:** 2026-04-22T00:29:06Z
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 overwritten)

## Accomplishments

- GeminiProvider class implements IAgentProvider with getType/getCapabilities/sendQuery; sendQuery emits workflow_dispatch before every tool chunk, mirroring Claude/Codex cadence
- GEMINI_CAPABILITIES static matrix: sessionResume/mcp/toolRestrictions/structuredOutput/envInjection=true; hooks/skills/agents/cost/effort/thinking/fallback/sandbox=false
- registerGeminiProvider(registry) shell with ProviderRegistryLike structural param — avoids @archon/providers dep while keeping Archon-drop path trivial
- Barrel index.ts exports the provider, registration, capabilities, plus IAgentProvider/SendQueryOptions/MessageChunk/ProviderCapabilities types
- provider.spec.ts: 5 tests + compile-time ARC-02 structural check; full adapter suite 25/25 green

## Task Commits

1. **Task 1: Implement capabilities.ts, provider.ts, registration.ts, index.ts** — `2f5f0ed` (feat)
2. **Task 2: Author provider.spec.ts** — `09aa542` (test)

## Files Created/Modified

- `adapter-archon/src/capabilities.ts` — GEMINI_CAPABILITIES: ProviderCapabilities (created)
- `adapter-archon/src/provider.ts` — GeminiProvider class implements IAgentProvider (created, 49 LOC)
- `adapter-archon/src/registration.ts` — registerGeminiProvider(registry) + ProviderRegistryLike (created)
- `adapter-archon/src/index.ts` — barrel re-exports (overwritten; was `export {}` from Phase 2)
- `adapter-archon/src/provider.spec.ts` — 5 vitest cases + compile-time signature check (created)

## Decisions Made

- provider.ts stays a thin delegation shim — 49 LOC, well under 250 cap. All translation lives in options-translator.ts (plan 10-03). sendQuery body: warnIgnoredOptions → translateOptions → for-await query() → yield workflow_dispatch (for tool chunks) + translateChunk output.
- registerGeminiProvider accepts the registry API as a structural parameter rather than importing `../../registry.js` from Archon. This keeps standalone typecheck/test green without an npm dep and reduces the PR-packaging change in plan 10-05 to a one-line import swap.
- workflow_dispatch emission strategy: emit sentinel BEFORE the translated tool chunk so consumers see the dispatch intention before the payload; workerConversationId is always '' (provider-level scheduling is Archon's job).
- Compile-time ARC-02 check (`const _structuralCheck: IAgentProvider = new GeminiProvider()`) at module scope — if signature drifts, tsc fails and the whole suite fails, which is stricter than any runtime assertion could be.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met (files present, grep markers present, typecheck + lint + tests green, provider.ts line count 49 ≤ 250).

## Issues Encountered

None.

## User Setup Required

None — purely library-level work.

## Next Phase Readiness

- Plan 10-05 can now clone Archon, import real types from the cloned source, and run the drift/contract test against this provider implementation. The single file that needs a header swap when dropped into Archon is registration.ts (the ProviderRegistryLike param becomes direct imports of `../../registry.js`).
- ARC-01/02/03/04/06 closed. ARC-05 was closed in 10-03. Remaining: ARC-07+ (plan 10-05 contract test + PR package) and ARC-08+ (plan 10-06 docs).

## Self-Check

- FOUND: adapter-archon/src/capabilities.ts
- FOUND: adapter-archon/src/provider.ts
- FOUND: adapter-archon/src/registration.ts
- FOUND: adapter-archon/src/index.ts
- FOUND: adapter-archon/src/provider.spec.ts
- FOUND commit: 2f5f0ed
- FOUND commit: 09aa542
- provider.ts LOC = 49 (≤ 250)
- pnpm typecheck: PASS
- pnpm test: 25/25 PASS (20 translator + 5 provider)
- lint-env-namespace.sh: PASS

## Self-Check: PASSED

---
*Phase: 10-archon-adapter-ts-only*
*Completed: 2026-04-22*
