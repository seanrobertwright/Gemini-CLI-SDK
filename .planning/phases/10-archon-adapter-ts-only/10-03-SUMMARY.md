---
phase: 10-archon-adapter-ts-only
plan: 03
subsystem: adapter
tags: [archon, options-translation, drift-test, vitest, option-mapping, message-chunk]

requires:
  - phase: 10-archon-adapter-ts-only-01
    provides: "adapter-archon workspace package + local IAgentProvider type mirror (SendQueryOptions, NodeConfig, MessageChunk)"
  - phase: 10-archon-adapter-ts-only-02
    provides: "env-namespace CI linter + allowlist for NODE_ENV, DEBUG (gates warnIgnoredOptions)"
provides:
  - "OPTION_MAPPING: 25-key prefixed Record<string, 'honored'|'partial'|'deferred'|'ignored'> constant (buckets 7/5/4/9)"
  - "translateOptions(prompt, cwd, resumeSessionId, opts) -> QueryOptions — pure adapter core"
  - "translateChunk(sdk) -> Archon MessageChunk — rename toolId->toolCallId, parameters->toolInput, rate_limit wrap, system content normalisation"
  - "warnIgnoredOptions(opts) — dev-only, once-per-field console.warn with module-level WARNED Set dedupe"
  - "Drift guard test: 25-key set-equality + bucket-count assertions pinned to spec/archon/mapping.md"
  - "_resetWarnedForTesting() escape hatch for hermetic specs"
affects: [10-archon-adapter-ts-only-04, 10-archon-adapter-ts-only-05, 10-archon-adapter-ts-only-06]

tech-stack:
  added: []
  patterns:
    - "Prefixed-key OPTION_MAPPING (nodeConfig.<field>) keeps NodeConfig duplicates distinct from top-level"
    - "`as const satisfies Record<string, BucketUnion>` for literal-preserving typed mapping constants"
    - "Module-level Set + test-only reset helper for once-per-process side effects under vitest"
    - "Triage-table-wins: spec/archon/mapping.md row-by-row IS the source of truth; Counts Audit derives from it"

key-files:
  created:
    - "adapter-archon/src/options-translator.ts (166 LOC) — pure adapter core"
    - "adapter-archon/src/options-translator.spec.ts (20 passing vitest cases incl. drift guard)"
  modified:
    - "spec/archon/mapping.md — Counts Audit reconciled from 11/5/4/5 to 7/5/4/9"
    - ".planning/phases/10-archon-adapter-ts-only/10-03-PLAN.md — drift test expectations + acceptance copy updated to 7/5/4/9"

key-decisions:
  - "Triage table wins over Counts Audit: mapping.md table rows sum to 7/5/4/9; the earlier 11/5/4/5 claim was an arithmetic mistake. Fixed mapping.md + drift test expectations rather than re-labelling table rows to match the wrong count."
  - "Added _resetWarnedForTesting() one-line export: WARNED Set is module-level (by design, once-per-process dedupe), so spec needs an explicit reset to keep each warnIgnoredOptions test hermetic without vi.resetModules() churn."
  - "tool_result.toolName emitted as '' (Archon requires toolName field, SDK ToolResultChunk doesn't carry one) — documented in mapping.md + inline code comment; provider layer (plan 10-04) may later carry toolName forward via tool-call state tracking."
  - "translateOptions returns `approvalMode: 'yolo'` unconditionally (headless-only SDK per mapping.md); no user-override path added in this plan — provider.ts in 10-04 can revisit if Archon passes approvalMode explicitly."

patterns-established:
  - "OPTION_MAPPING prefixed form: top-level keys unprefixed, NodeConfig keys as 'nodeConfig.<field>' — drift test set-equality rejects collapses"
  - "Drift test triad: length === 25, set-equality with EXPECTED_KEYS, value-domain guard against the 4 bucket literals"
  - "Bucket-count drift test: separate it() block so failure message names the diverging bucket"
  - "Dev-gate for warnings: NODE_ENV === 'development' OR DEBUG.includes('gemini-sdk') — silent in prod; documented in mapping.md Ignored-field Runtime Behavior"

requirements-completed: [ARC-05]

duration: 30min
completed: 2026-04-22
---

# Phase 10 Plan 03: Options Translator Core Summary

**Pure-function adapter core — 25-key OPTION_MAPPING (buckets 7/5/4/9), translateOptions + translateChunk + warnIgnoredOptions + drift guard — at 166 LOC (under the 180 budget) so provider.ts in plan 10-04 can stay under its 250 LOC cap.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-04-21T23:54:00Z
- **Completed:** 2026-04-22T00:24:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 created + 2 modified during reconciliation)

## Accomplishments

- Reconciled `spec/archon/mapping.md` Counts Audit arithmetic mistake (11/5/4/5 -> 7/5/4/9) with the row-by-row triage table
- Shipped `adapter-archon/src/options-translator.ts` (166 LOC): OPTION_MAPPING constant, translateOptions, translateChunk, warnIgnoredOptions
- Shipped `adapter-archon/src/options-translator.spec.ts` with 20 passing vitest cases incl. two drift-guard assertions (key set equality + bucket counts)
- Drift test now fails loudly and with a clear message on any uncategorized key or diverging bucket count
- Typecheck + lint-env-namespace remain green

## Task Commits

1. **Reconciliation (pre-Task 1):** `f959926` (docs) — mapping.md + 10-03-PLAN.md counts 11/5/4/5 → 7/5/4/9
2. **Task 1: options-translator.ts:** `2bc29f6` (feat) — OPTION_MAPPING + translateOptions + translateChunk + warnIgnoredOptions + _resetWarnedForTesting
3. **Task 2: options-translator.spec.ts:** `9dabf17` (test) — 20 vitest cases including drift guard

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `adapter-archon/src/options-translator.ts` — pure adapter core (166 LOC, under 180 budget)
- `adapter-archon/src/options-translator.spec.ts` — unit suite + drift guard (274 LOC, 20 tests)
- `spec/archon/mapping.md` — Counts Audit reconciled to 7/5/4/9 with per-bucket member lists
- `.planning/phases/10-archon-adapter-ts-only/10-03-PLAN.md` — drift expectations + acceptance copy aligned

## Decisions Made

- **Arithmetic fix over taxonomy change:** mapping.md triage table is the canonical source; the 11/5/4/5 Counts Audit was a manual tally error. Fixing the counts keeps the 25-key triage rationale intact; changing the table to hit 11/5/4/5 would have forced re-classifying rows against SDK reality.
- **`approvalMode: 'yolo'` unconditional** in translateOptions: headless-only SDK per mapping.md; no override surface added yet.
- **`tool_result.toolName = ''`** because SDK ToolResultChunk has no toolName; provider layer (10-04) may carry it forward via call-state tracking later.
- **`_resetWarnedForTesting()` exported** to keep spec hermetic without `vi.resetModules()` churn; zero-cost escape hatch.

## Deviations from Plan

None beyond the explicit checkpoint-resolution reconciliation (handled as a dedicated commit preceding Task 1, per the resolution instruction).

## Issues Encountered

- **Arithmetic inconsistency in mapping.md Counts Audit** — surfaced at plan-time during 10-02 review; resolved here via planner-approved reconciliation commit. Triage table rows sum to 7/5/4/9 exactly; 11/5/4/5 was editorial drift in the Counts Audit line only.
- **LOC budget overrun on first draft** (195 LOC) — trimmed redundant section-divider comments to land at 166 LOC (under 180 acceptance budget).

## Verification

- `cd adapter-archon && pnpm typecheck` — green
- `cd adapter-archon && pnpm test` — 20/20 tests pass (1 file, 508ms)
- `bash scripts/lint-env-namespace.sh` — green (adapter-archon/src clean; only NODE_ENV and DEBUG referenced, both allowlisted)
- `wc -l adapter-archon/src/options-translator.ts` → 166 (≤ 180)
- All 13 plan acceptance greps for options-translator.ts and all 7 for options-translator.spec.ts pass

## Next Phase Readiness

- Plan 10-04 (provider.ts) can now import OPTION_MAPPING, translateOptions, translateChunk, warnIgnoredOptions directly — the ~30 LOC delegation target is achievable because heavy lifting is in this translator
- Drift test is the guardrail: if 10-05 adds Archon SDK fields without also updating types.ts + OPTION_MAPPING + mapping.md, vitest fails with a clear `missing OPTION_MAPPING key: ...` or `unknown OPTION_MAPPING key: ...` message
- No blockers

## Self-Check

Files verified to exist on disk:
- FOUND: adapter-archon/src/options-translator.ts
- FOUND: adapter-archon/src/options-translator.spec.ts
- FOUND: spec/archon/mapping.md (modified)
- FOUND: .planning/phases/10-archon-adapter-ts-only/10-03-PLAN.md (modified)

Commits verified to exist in git log:
- FOUND: f959926 (docs: reconciliation)
- FOUND: 2bc29f6 (feat: options-translator.ts)
- FOUND: 9dabf17 (test: options-translator.spec.ts)

## Self-Check: PASSED

---
*Phase: 10-archon-adapter-ts-only*
*Plan: 03*
*Completed: 2026-04-22*
