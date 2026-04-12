---
phase: 01-feasibility-spike-fixture-capture
plan: 10
subsystem: spec
tags: [ndjson, wire-protocol, error-taxonomy, fixture-citations, gemini-cli]

# Dependency graph
requires:
  - phase: 01-09
    provides: spec/events.schema.json with 6 event types derived from fixture corpus
  - phase: 01-07
    provides: 12 captured fixtures including abort-midstream, thinking, multimodal, large-output
  - phase: 01-05
    provides: spec/feasibility.md with resume/config-dir/flush verdicts
provides:
  - "spec/protocol.md — 463-line normative draft with 60 fixture citations covering all 6 event types"
  - "spec/errors.md — 200-line error taxonomy draft with 24 fixture citations and Archon retry-bucket mapping"
  - "node scripts/validate-fixtures.mjs citations exits 0"
  - "Phase 1 is complete: all 8 validator commands pass"
affects:
  - "Phase 3 (parser) — protocol.md is the normative contract for PRS-01 through PRS-07"
  - "Phase 5 (error taxonomy) — errors.md is the pre-implementation contract for ERR-01 through ERR-07"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Citation-per-claim: every normative statement in spec docs names the fixture that evidences it"
    - "Two-signal error classification: stream-json error events + exit-code/stderr tail both resolve to same typed error"
    - "tool_id as stable correlation key for tool_use/tool_result pairing (not positional)"

key-files:
  created: []
  modified:
    - spec/protocol.md
    - spec/errors.md

key-decisions:
  - "tool_use/tool_result pairing is by tool_id identity (not positional) — confirmed from spec/fixtures/tool-use-builtin.ndjson"
  - "thinking events absent in gemini-cli headless mode — Phase 3 must synthesize thinking-variant fixture"
  - "error-auth and error-rate-limit remain synthetic — real stderr format deferred to Phase 5 on API-key-only host"
  - "abort-midstream is empty NDJSON (1 byte) on Windows SIGTERM before first flush — ERR-06 test case confirmed"
  - "multimodal @path syntax is embedded in user message content, not a separate event type"

patterns-established:
  - "Pattern 1: Every normative claim in spec docs cites spec/fixtures/<slug>.ndjson (enforced by citations validator)"
  - "Pattern 2: Synthetic fixture limitations are documented inline with NOTE: markers, not hidden"
  - "Pattern 3: Open questions section explicitly tracks unresolved items from RESEARCH.md with fixture evidence bounds"

requirements-completed:
  - PRS-09

# Metrics
duration: 20min
completed: 2026-04-11
---

# Phase 1, Plan 10: Spec Documentation Summary

**Normative spec/protocol.md (463 lines, 60 fixture citations) and spec/errors.md (200 lines, 24 citations) drafted as the wire-protocol and error-taxonomy contracts for Phase 3 (parser) and Phase 5 (error taxonomy).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-11T22:00:00Z (approximate)
- **Completed:** 2026-04-11
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `spec/protocol.md` fully drafted with 11 sections covering all 6 event types, tool pairing mechanics,
  session resume, thinking (absent), multimodal, abort semantics, unknown event handling, and open gaps
- `spec/errors.md` fully drafted with 3 observed error patterns (auth, rate-limit, subprocess crash),
  classification dimensions table, per-pattern detail sections, gaps table, and Phase 5 handoff section
- All 8 Phase 1 validator commands pass: citations, parse, schema, pairs, manifest, pin, feasibility, TS schema, Python schema, audit

## Task Commits

Each task was committed atomically:

1. **Task 1: Draft spec/protocol.md** - `fd7758b` (feat)
2. **Task 2: Draft spec/errors.md** - `78ab263` (feat)
3. **Task 3: Run all 8 validators** - (no separate commit — validators passed immediately after tasks 1 & 2)

## Files Created/Modified

- `spec/protocol.md` — 463-line normative wire-protocol draft, 60 fixture citations, sections for all 6 event types
- `spec/errors.md` — 200-line error taxonomy draft, 24 fixture citations, 3 pattern rows, Phase 5 handoff section

## Event Types Covered by protocol.md

| Section | Event type | Fixture(s) cited |
|---------|------------|-----------------|
| 4.1 | `init` | simple-text.ndjson, thinking.ndjson, resume-session-turn2.ndjson |
| 4.2 | `message` | simple-text.ndjson, large-output.ndjson, thinking.ndjson |
| 4.3 | `tool_use` | tool-use-builtin.ndjson, resume-session-turn1.ndjson |
| 4.4 | `tool_result` | tool-use-builtin.ndjson, resume-session-turn1.ndjson |
| 4.5 | `error` | error-auth.ndjson, error-rate-limit.ndjson |
| 4.6 | `result` | simple-text.ndjson, tool-use-builtin.ndjson, large-output.ndjson |

## Error Patterns Covered by errors.md

| Pattern | Fixture | Proposed typed error | Archon bucket |
|---------|---------|---------------------|---------------|
| Auth failure (401) | error-auth.ndjson + error-auth.stderr.txt | `AuthError` (NotConfigured/Forbidden403) | `auth` |
| Rate limit (429) | error-rate-limit.ndjson + error-rate-limit.stderr.txt | `RateLimitError` | `rate_limit` |
| Subprocess crash / abort | abort-midstream.ndjson | `ProcessError` / `AbortError` | `crash` |

## Gaps Documented

| Gap | Where documented |
|-----|-----------------|
| thinking events absent in headless mode | protocol.md §7 + open questions §11 |
| error-auth / error-rate-limit are synthetic (OAuth host limitation) | errors.md §1, §4.1, §4.2 |
| Real stderr format for 401/429 TBD | errors.md §5 gaps table |
| Retry-After header in rate-limit response — unknown | errors.md §4.2 + §5 |
| Concurrent tool calls not in fixture corpus | protocol.md §11 open questions |
| result.status values other than "success" not observed | protocol.md §11 open questions |

## Validator Results

All 8 validator commands pass:

| Command | Result |
|---------|--------|
| `node scripts/validate-fixtures.mjs citations` | PASS (60 + 24 fixture citations) |
| `node scripts/validate-fixtures.mjs` (parse, schema, pairs, manifest) | PASS |
| `node scripts/validate-schema-ts.mjs` | PASS |
| `bash scripts/validate-schema-py.sh` | PASS |
| `bash scripts/audit-fixtures.sh` | PASS (0 secrets) |
| `node scripts/validate-fixtures.mjs feasibility` | PASS (3 verdicts) |
| `node scripts/validate-fixtures.mjs pin` | PASS (0.37.1) |
| `node scripts/validate-fixtures.mjs manifest` | PASS (12/12) |

## Decisions Made

- **tool_id as correlation key:** `tool_use` and `tool_result` pair by `tool_id` identity
  (format `{tool_name}_{unix_ms}_{counter}`), not positionally. Confirmed from
  `spec/fixtures/tool-use-builtin.ndjson` lines 4–5. Phase 3 PRS-07 must use this.
- **thinking gap:** No `thinking` event type in headless mode; Phase 3 synthesizes variant fixture.
- **Synthetic error fixtures stay synthetic for now:** Phase 5 re-captures on API-key-only host.
- **Multimodal via @path inline:** No separate attachment event type; Phase 3 needs no special handling.
- **Phase 5 gets errors.yaml as SSOT:** errors.md is the human-readable contract; Phase 5 translates to YAML.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Phase 1 Closure Note

This plan (01-10) is the final plan in Phase 1. All Phase 1 success criteria from ROADMAP.md are now met:

1. 12 fixture files with sibling `.expected.json` sidecars (PRS-09) — completed in plans 01-06 + 01-07
2. `spec/events.schema.json` pinned and compiles in TS + Pydantic — completed in plan 01-09 (PRS-08)
3. Pinned gemini-cli version in `.gemini-cli-compat` + 3 feasibility verdicts — completed in plans 01-04 + 01-05
4. `spec/protocol.md` + `spec/errors.md` drafts cite fixture filenames — completed in this plan (01-10)

Phase 1 is READY for `/gsd:verify-work` sign-off.

## Next Phase Readiness

- Phase 3 (parser) can proceed: `spec/protocol.md` is the normative contract for PRS-01 through PRS-07
- Phase 5 (error taxonomy) can proceed: `spec/errors.md` is the pre-implementation contract for ERR-01 through ERR-07
- Blocker for Phase 3: need to synthesize `thinking` variant fixture (no real capture exists)
- Blocker for Phase 5: need API-key-only capture host for real auth/rate-limit stderr format

---
*Phase: 01-feasibility-spike-fixture-capture*
*Completed: 2026-04-11*
