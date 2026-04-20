---
phase: 08-tools-approval-mode-structured-output-best-effort
plan: "06"
subsystem: docs
tags: [docs, tools, approval-mode, structured-output, TOL-03, TOL-04, OUT-04]
dependency_graph:
  requires: [08-04, 08-05]
  provides: [docs/tools.md, docs/structured-output.md]
  affects: []
tech_stack:
  added: []
  patterns: [docs/auth.md precedent structure, TS+Python side-by-side examples]
key_files:
  created:
    - docs/tools.md
    - docs/structured-output.md
  modified: []
decisions:
  - "docs/tools.md: NOT supported (lowercase s) used in heading to satisfy `grep -c 'NOT supported'` acceptance criterion"
  - "docs/structured-output.md: OUT-04 satisfied via @experimental callout block + Known Limitations #13388 section"
metrics:
  duration_seconds: 137
  completed_date: "2026-04-20"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 8 Plan 06: User-Facing Docs (tools.md + structured-output.md) Summary

Two user-facing docs pages covering tools/approval-mode API and best-effort structured output with experimental status, single-retry policy, and upstream issue links.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write docs/tools.md | e4a4359 | docs/tools.md (107 lines) |
| 2 | Write docs/structured-output.md | fa0830b | docs/structured-output.md (193 lines) |

## Artifact Summary

### docs/tools.md (107 lines)

Sections: Quick Start, `allowedTools`/`allowed_tools`, `approvalMode`/`approval_mode`, Caller-Defined Custom Tools (TOL-04), Policy Engine Migration (TOL-03), Known Issues, See Also.

Key content:
- TOL-01: `allowedTools` → `--allowed-tools <csv>` passthrough with empty-array omission table
- TOL-02: `approvalMode` → `--approval-mode` with 4 known values table
- TOL-03: `--allowed-tools` deprecated in gemini-cli 0.30.0; SDK pinned to 0.37.1; Phase 11 REL-06 compat probe is the bulwark (no runtime `--help` probe, no dual-emit)
- TOL-04: Explicit "NOT supported in v1" for caller-defined custom tools; v2 pointer to CTL-01..03
- Known Issues: #16012 headless "denied by policy" regression + non-TTY approval blocking
- Links: 6 total (2 upstream issues, 2 related docs, 2 upstream docs)

### docs/structured-output.md (193 lines)

Sections: @experimental callout, Quick Start, How It Works (4 sub-steps), Markdown Fence Stripping, JSON Schema Support, Known Limitations (5 items), See Also.

Key content:
- OUT-04: @experimental callout at top + Known Limitations citing #13388 twice (in-section + See Also)
- OUT-03: Single retry documented; OUT-01/OUT-02 implicit in injection + validation flow
- Schema injection template shown verbatim
- Retry prompt template shown verbatim
- Phase 7 `--resume` session reuse documented
- Markdown fence stripping table with partial-fence pass-through edge case
- Zod (TS, draft-07 subset) vs jsonschema (Python, full draft-07) noted for parity awareness
- 5 Known Limitations: no native enforcement (#13388), one retry only, no streaming, no template customization, plan mode incompatibility

## Requirement Traceability

| Requirement | Status | Evidence |
|-------------|--------|----------|
| TOL-03 | Closed | docs/tools.md §Policy Engine Migration: deprecation note + REL-06 compat probe strategy |
| TOL-04 | Closed | docs/tools.md §Caller-Defined Custom Tools: "NOT supported in v1" + CTL-01..03 v2 pointer |
| OUT-04 | Closed | docs/structured-output.md: @experimental callout + Known Limitations #13388 section |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed heading casing for acceptance criterion grep match**
- **Found during:** Task 1 verification
- **Issue:** Heading `NOT Supported in v1` had uppercase 'S', but acceptance criterion `grep -c "NOT supported"` requires lowercase 's'
- **Fix:** Changed heading to `NOT supported in v1` (lowercase 's')
- **Files modified:** docs/tools.md
- **Commit:** e4a4359

## Link Count

External links across both files (≥ 6 required):
1. docs/tools.md → #16012 (headless regression)
2. docs/tools.md → gemini-cli CLI reference
3. docs/tools.md → gemini-cli Policy Engine
4. docs/tools.md → docs/structured-output.md
5. docs/tools.md → docs/auth.md
6. docs/structured-output.md → #13388 (×3 occurrences)
7. docs/structured-output.md → JSON Schema draft-07
8. docs/structured-output.md → Zod docs
9. docs/structured-output.md → jsonschema Python docs
10. docs/structured-output.md → docs/tools.md
11. docs/structured-output.md → docs/auth.md

Total: 11 links (≥ 6 requirement met).

## Self-Check: PASSED

All files found on disk. Both commits verified in git log.
