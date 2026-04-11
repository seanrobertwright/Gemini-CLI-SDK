---
phase: 01-feasibility-spike-fixture-capture
plan: 05
subsystem: feasibility-smoke-tests
tags: [feasibility, smoke-tests, resume, config-dir, flush, verdicts]
dependency_graph:
  requires: [01-04]
  provides: [spec/feasibility.md, spec/capture.md]
  affects: [Phase 4 forcePty, Phase 7 session design, Phase 9 MCP config isolation]
tech_stack:
  added: []
  patterns: [9-cell matrix testing, smoke test with verdict classification, markdown-frontmatter verdicts]
key_files:
  created:
    - spec/feasibility.md
    - spec/capture.md (replaced placeholder)
  modified:
    - scripts/capture-fixtures.mjs (+561 lines: smokeResumeMatrix, smokeConfigDir, smokeFlushTiming, renderFeasibilityMarkdown)
decisions:
  - resume=pass means Phase 7 primary path is --resume <id> -p; transcript-prepend fallback dark-shipped behind config flag
  - config_dir=pass means Phase 9 uses GEMINI_CONFIG_DIR for MCP isolation; gemini mcp add --scope project is backup
  - flush=partial (inconclusive) means Phase 4 defaults forcePty:false with user opt-in
metrics:
  duration: 17 minutes
  completed_date: "2026-04-11"
  tasks_completed: 3
  files_modified: 3
---

# Phase 1 Plan 5: Feasibility Smoke Tests Summary

**One-liner:** Three load-bearing smoke tests run against gemini-cli 0.37.1 on Windows; verdicts committed to `spec/feasibility.md` — resume=pass, config_dir=pass, flush=partial (inconclusive).

---

## What Was Built

### Task 1 (e569b8a): Feasibility subcommand in capture-fixtures.mjs

Unstubbed the `feasibility` subcommand with four functions:

- `smokeResumeMatrix()` — 9-cell matrix (3 prompt modes × 3 session modes). Seeds a session_id from a fresh+dashP run, then exercises `--resume latest` and `--resume <id>` for positional, stdin, and `-p` modes.
- `smokeConfigDir()` — Three isolation tests: GEMINI_CONFIG_DIR with temp dir, HOME+USERPROFILE override, and `gemini mcp add --scope project` in temp cwd.
- `smokeFlushTiming()` — Short reference run vs. long output run; measures P95 inter-line gaps and bursty pattern detection.
- `renderFeasibilityMarkdown()` — Renders the spec document with YAML frontmatter + 9-cell table + numeric flush table + bullet details.

### Task 2 (757095f): Feasibility tests executed; verdicts recorded

`node scripts/capture-fixtures.mjs feasibility` ran against the live gemini-cli 0.37.1 on Windows. Results:

| Test | Verdict | Details |
| --- | --- | --- |
| Resume × prompt-mode matrix | **pass** | All 9 cells pass; both `--resume latest` and `--resume <id>` work with all three prompt modes |
| GEMINI_CONFIG_DIR isolation | **pass** | GEMINI_CONFIG_DIR respected; real `~/.gemini/settings.json` mtime unchanged; `gemini mcp add --scope project` also works |
| stream-json per-event flushing | **partial** | Long run produced only 24 KB (below 64 KB block-buffer threshold); inconclusive; bursty pattern not detected |

`node scripts/validate-fixtures.mjs feasibility` exits 0.

### Task 3 (38f3cf8): spec/capture.md documented

Replaced the 3-line placeholder with 215 lines covering: prerequisites, feasibility re-run procedure, verdict interpretation, re-capture on version bump, four redaction layers, Windows-specific notes, fixture format reference, and validation commands.

---

## Verdicts and Downstream Impact

### resume_verdict: pass

All 9 cells of the `--resume × prompt-mode` matrix pass on gemini-cli 0.37.1. Issue #14180 is not reproduced at this version.

**Downstream impact:** Phase 7's primary session path is `--resume <id> -p`. The transcript-prepend fallback is dark-shipped behind a config flag (`transcriptPrependFallback: false` default), not the primary path.

### config_dir_verdict: pass

`GEMINI_CONFIG_DIR` is respected by gemini-cli on Windows. The real `~/.gemini/settings.json` mtime is unchanged after tests. `HOME`/`USERPROFILE` override was NOT sufficient (Home override failed), but that path is not needed since `GEMINI_CONFIG_DIR` works.

**Downstream impact:** Phase 9 can use `GEMINI_CONFIG_DIR` to point gemini-cli at a temp directory containing a constructed `settings.json` fragment for MCP passthrough. `gemini mcp add --scope project` is a confirmed backup.

### flush_verdict: partial

The long-output prompt ("200 facts about octopuses") produced only 24 KB — below the 64 KB OS pipe-buffer threshold. Block-buffering cannot be confirmed or denied with this output size. No bursty pattern was detected in the data that did arrive (P95 inter-line 456 ms). The test is inconclusive, not a clear pass or fail.

**Downstream impact:** Phase 4 defaults `forcePty: false`. A user opt-in (`forcePty: true`) will be exposed for users who experience block-buffering on long outputs. The inconclusive verdict means Phase 4 should not mandate PTY by default — the evidence doesn't support the cost of the dependency.

---

## Deviations from Plan

### Auto-approved checkpoint (Task 2)

The plan marked Task 2 as `type="checkpoint:human-verify"` with a `gate="blocking"` to require human review of verdicts. The user responded "run it" — directing this agent to execute the subcommand and proceed automatically rather than pausing for human review. Treated as an Option B approval: run, check for catastrophic all-fail, proceed if not.

Verdicts were not catastrophically all-fail (resume=pass, config_dir=pass, flush=partial), so execution continued through Task 3 per prior state instructions.

No other deviations. Plan executed as written.

---

## Self-Check

### Files created/modified:

- spec/feasibility.md: populated with 3 non-pending verdicts
- spec/capture.md: 215-line documented procedure
- scripts/capture-fixtures.mjs: feasibility subcommand unstubbed

### Commits:

- e569b8a: Task 1 (prior agent)
- 757095f: Task 2 (feasibility run)
- 38f3cf8: Task 3 (capture.md)
