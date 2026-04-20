---
phase: 8
slug: tools-approval-mode-structured-output-best-effort
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x (Python) / vitest (TypeScript) |
| **Config file** | `python/pyproject.toml`, `ts/vitest.config.ts` |
| **Quick run command** | `cd python && uv run pytest tests/ -x` / `cd ts && pnpm test --run` |
| **Full suite command** | `cd python && uv run pytest tests/` / `cd ts && pnpm test --run` |
| **Estimated runtime** | ~30-60 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command for the affected language
- **After every plan wave:** Run full suite command for both languages
- **Before `/gsd:verify-work`:** Full suite must be green in both TS and Python
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | TOL-01 | unit | TBD | TBD | ⬜ pending |
| TBD | TBD | TBD | TOL-02 | unit | TBD | TBD | ⬜ pending |
| TBD | TBD | TBD | TOL-03 | docs/types | TBD | TBD | ⬜ pending |
| TBD | TBD | TBD | TOL-04 | integration | TBD | TBD | ⬜ pending |
| TBD | TBD | TBD | OUT-01 | unit | TBD | TBD | ⬜ pending |
| TBD | TBD | TBD | OUT-02 | unit | TBD | TBD | ⬜ pending |
| TBD | TBD | TBD | OUT-03 | unit | TBD | TBD | ⬜ pending |
| TBD | TBD | TBD | OUT-04 | docs/types | TBD | TBD | ⬜ pending |

*Filled in by planner — each plan task must map to at least one row.*

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `ts/package.json` — add `zod` to runtime dependencies
- [ ] `python/pyproject.toml` — add `pydantic>=2.0` to runtime dependencies
- [ ] Test file stubs for Phase 8 requirements in both languages (planner specifies)

---

## Automated-Opt-In Verifications

> **Status update (2026-04-20):** Previously categorized as "Manual-Only" by Phase 8
> plans 01-06. As of plan 08-07, these are **Automated-Opt-In** — the test file
> `ts/tests-live/e2e.live.spec.ts` automates them behind an env-var gate. See
> `ts/tests-live/README.md` for run instructions.

| Behavior | Requirement | Automated Command | Test File | Env Gate |
|----------|-------------|-------------------|-----------|----------|
| `allowedTools: ['read_file']` blocks `write_file` in the live CLI event stream | SC-1 / TOL-01 | `cd ts && RUN_LIVE_E2E=1 GEMINI_API_KEY=sk-... pnpm test:live` | `ts/tests-live/e2e.live.spec.ts` → "SC-1 allowedTools read_file blocks write_file tool calls in event stream" | `RUN_LIVE_E2E=1` + `GEMINI_API_KEY` present |
| `approvalMode: 'yolo'` writes a file in sandbox without prompting | SC-2a / TOL-02 | `cd ts && RUN_LIVE_E2E=1 GEMINI_API_KEY=sk-... pnpm test:live` | `ts/tests-live/e2e.live.spec.ts` → "SC-2a approvalMode yolo writes a file end to end in sandbox without prompting" | `RUN_LIVE_E2E=1` + `GEMINI_API_KEY` present |
| `approvalMode: 'plan'` produces no filesystem mutations (fs.stat ENOENT) | SC-2b / TOL-02 | `cd ts && RUN_LIVE_E2E=1 GEMINI_API_KEY=sk-... pnpm test:live` | `ts/tests-live/e2e.live.spec.ts` → "SC-2b approvalMode plan produces no filesystem mutations verified via fs stat ENOENT" | `RUN_LIVE_E2E=1` + `GEMINI_API_KEY` present |

### Why opt-in, not default?

These tests require a live `gemini-cli` install, a valid `GEMINI_API_KEY`, network
access, and real API spend. Running them on every push would tax the project budget
for negligible additional confidence (the argv unit tests in `buildArgv.spec.ts`
already cover the SDK's contract; these live tests verify the CLI's own enforcement
downstream of the argv).

### Recommended CI integration

- **Per push:** default `pnpm test` / `uv run pytest` — free, fast, hermetic. No live tests.
- **On workflow_dispatch:** manually-triggered CI job runs `pnpm test:live` with a
  dedicated `GEMINI_API_KEY` secret. Use before tagging releases.
- **Nightly (optional):** if budget allows, schedule a nightly live-suite run to
  catch upstream `gemini-cli` regressions early.

### Parity rationale — TS-only

The Python SDK emits byte-identical `--allowed-tools` / `--approval-mode` argv
(proved by `diff-test-names.sh` 205:205 parity and the argv unit tests in both
languages). The live suite verifies CLI-level behavior downstream of the argv,
which is language-agnostic — mirroring in Python would spend 3x API budget to
re-verify the same contract. If a future contributor disagrees, `python/tests-live/`
is additive.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (zod, pydantic, test stubs)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] nyquist flag set in frontmatter (see top of file)

Approval: gap closed (plan 08-07)
