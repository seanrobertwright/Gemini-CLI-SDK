---
phase: 10
slug: archon-adapter-ts-only
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-21
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.2 (pinned to match ts/package.json; Node 18 compat preserved) |
| **Config file** | `adapter-archon/vitest.config.ts` (wired in plan 10-01) |
| **Quick run command** | `cd adapter-archon && pnpm test` |
| **Full suite command** | `cd adapter-archon && pnpm typecheck && pnpm test && bash scripts/lint-env-namespace.sh` |
| **Estimated runtime** | ~10 seconds (adapter tests are all mocked; no process spawn) |

Note: Phase 10 is TS-only. No Python mirror. Parity diff script is N/A for this phase per [Phase 08-07] precedent.

---

## Sampling Rate

- **After every task commit:** `cd adapter-archon && pnpm test`
- **After every plan wave:** `cd adapter-archon && pnpm typecheck && pnpm test && bash scripts/lint-env-namespace.sh`
- **Before `/gsd:verify-work`:** Full suite green + `gh pr list --repo coleam00/Archon --head gemini-sdk-integration --state open` returns 1 PR
- **Max feedback latency:** ~15 seconds for unit + contract; the `gh pr list` check is external and gated by plan 10-05 checkpoint

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | ARC-05 (foundation) | structural | `cd adapter-archon && pnpm typecheck && pnpm test` | Wave 0 creates | pending |
| 10-01-02 | 01 | 1 | ARC-05 (foundation) | typecheck | `cd adapter-archon && pnpm typecheck` | Wave 0 creates | pending |
| 10-01-03 | 01 | 1 | ARC-05 | doc check | grep checks from acceptance_criteria | Wave 0 creates | pending |
| 10-02-01 | 02 | 1 | ARC-09 | shell self-test | `bash scripts/lint-env-namespace.spec.sh` | Wave 0 creates | pending |
| 10-02-02 | 02 | 1 | ARC-09 | YAML parse + grep | python yaml.safe_load + grep anchors | Wave 0 creates | pending |
| 10-03-01 | 03 | 2 | ARC-05 | unit + typecheck | `cd adapter-archon && pnpm typecheck && bash scripts/lint-env-namespace.sh` | Wave 0 creates | pending |
| 10-03-02 | 03 | 2 | ARC-05 | unit (drift) | `cd adapter-archon && pnpm test` | Wave 0 creates | pending |
| 10-04-01 | 04 | 3 | ARC-01, ARC-02, ARC-03, ARC-04, ARC-06 | unit + LOC | `cd adapter-archon && pnpm typecheck && wc -l adapter-archon/src/provider.ts` | Wave 0 creates | pending |
| 10-04-02 | 04 | 3 | ARC-01, ARC-02 | unit | `cd adapter-archon && pnpm test` | Wave 0 creates | pending |
| 10-05-01 | 05 | 4 | ARC-07 | integration (fixture) | `cd adapter-archon && pnpm test` | Wave 0 creates | pending |
| 10-05-02 | 05 | 4 | ARC-08 | structural | file-exists + grep checks | Wave 0 creates | pending |
| 10-05-03 | 05 | 4 | ARC-07, ARC-08 | YAML parse | python yaml.safe_load + grep anchors | Wave 0 creates | pending |
| 10-05-04 | 05 | 4 | ARC-08 | integration (external) | `gh pr list --repo coleam00/Archon --head gemini-sdk-integration --state open` | external | checkpoint |

*Status: pending = awaiting execution; green = automated command passes; red = failing; checkpoint = human-verify gate.*

---

## Wave 0 Requirements

- [ ] `adapter-archon/package.json` — add `@gemini-sdk/core` workspace dep + vitest devDep + `test` script (plan 10-01 Task 1)
- [ ] `adapter-archon/vitest.config.ts` — create (plan 10-01 Task 1; extended in plan 10-05 Task 1 for tests-contract glob)
- [ ] `adapter-archon/src/types.ts` — local IAgentProvider mirror (plan 10-01 Task 2)
- [ ] `spec/archon/mapping.md` — canonical options triage (plan 10-01 Task 3)
- [ ] `.archon-compat` — pinned Archon SHA (plan 10-01 Task 2)
- [ ] `scripts/lint-env-namespace.sh` + `scripts/lint-env-namespace.spec.sh` (plan 10-02 Task 1)
- [ ] `.github/workflows/ci.yml` — lint-env-namespace job wired (plan 10-02 Task 2)
- [ ] `adapter-archon/src/options-translator.ts` + `.spec.ts` (plan 10-03)
- [ ] `adapter-archon/src/{capabilities,provider,registration,index}.ts` + `provider.spec.ts` (plan 10-04)
- [ ] `adapter-archon/tests-contract/contract.spec.ts` + fixture + README (plan 10-05 Task 1)
- [ ] `.planning/phases/10-archon-adapter-ts-only/pr-artifacts/` bundle (plan 10-05 Task 2)
- [ ] `.github/workflows/archon-contract.yml` + `archon-drift.yml` (plan 10-05 Task 3)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Draft PR open on coleam00/Archon | ARC-08 | PR creation requires authenticated `gh` session + fork; not reproducible in SDK repo CI | `gh pr list --repo coleam00/Archon --head gemini-sdk-integration --state open --json url,isDraft` returns 1 result, isDraft=true |
| `bun test packages/providers` green in Archon clone | ARC-07 (deep) | Runs in archon-contract.yml CI, not directly in local dev (requires clone + bun install, 2+ min) | archon-contract CI job green on PR |
| Weekly drift guard files issue on break | ARC-07 (drift) | Scheduled workflow, cannot be verified synchronously | Wait 1 week after merge; check Issues tab for "Archon drift detected" |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has either a pnpm test, pnpm typecheck, bash script, or YAML parse check)
- [x] Wave 0 covers all MISSING references (listed above)
- [x] No watch-mode flags (all commands use `vitest run`, not `vitest` default watch)
- [x] Feedback latency < 30s for unit + contract suite
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (awaits plan 10-05 checkpoint completion)
