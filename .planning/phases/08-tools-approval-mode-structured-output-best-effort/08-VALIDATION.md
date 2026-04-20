---
phase: 8
slug: tools-approval-mode-structured-output-best-effort
status: draft
nyquist_compliant: false
wave_0_complete: false
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

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `approvalMode: 'yolo'` file-write against real `gemini-cli` | TOL-02 success criterion | Requires live subprocess + sandbox workspace + API cost | Run scripted integration test in a temp dir; assert file written + no prompt |
| Live `approvalMode: 'plan'` produces plan-only stream | TOL-02 success criterion | Same as above | Post-run `fs.stat` to prove no mutations |
| `allowedTools: ['read_file']` enforcement by live CLI | TOL-01 success criterion | Requires live subprocess + live model decision | Prompt that would call `write_file`; assert event log contains only `read_file` |

*Automated unit tests cover argv construction, schema injection, retry logic, and error mapping. Live gemini-cli behaviors are gated behind manual/integration runs.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (zod, pydantic, test stubs)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
