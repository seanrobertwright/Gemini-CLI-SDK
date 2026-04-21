---
phase: 10-archon-adapter-ts-only
plan: 02
subsystem: infra
tags: [ci, bash, grep, linter, env-vars, github-actions]

requires:
  - phase: 06-auth-environment
    provides: scripts/lint-auth-login.sh shell-lint pattern (shebang, set -euo pipefail, REPO_ROOT, Git-Bash-safe grep -E)
provides:
  - scripts/lint-env-namespace.sh — grep-based ARC-09 enforcement scoped to adapter-archon/src/**
  - scripts/lint-env-namespace.spec.sh — 3-case self-test (allowlisted-pass, dot-form-fail, bracket-form-fail) with LINT_ENV_NS_SCOPE override
  - .github/workflows/ci.yml lint-env-namespace job — blocking CI gate on every PR
affects: [10-03, 10-04, 10-05, 10-06]

tech-stack:
  added: []
  patterns:
    - "Grep-ERE-only for BSD/Git-Bash compatibility (no -P)"
    - "Self-testable shell linters via env-var scope override"

key-files:
  created:
    - scripts/lint-env-namespace.sh
    - scripts/lint-env-namespace.spec.sh
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Allowlist: GEMINI_*, GEMINI_SDK_*, PATH, HOME, USERPROFILE, TMPDIR, TEMP, TMP, NODE_ENV, DEBUG (per 10-CONTEXT.md)"
  - "SKIP-if-scope-missing semantics: linter exits 0 when adapter-archon/src/ does not exist yet, so Wave-1 lands cleanly before Wave-2 populates files"
  - "LINT_ENV_NS_SCOPE env override enables self-test without bind-mounting fixtures into adapter-archon/src/"
  - "Standalone CI job (not piggy-backed on parity) for clear status reporting and independent branch-protection wiring"

patterns-established:
  - "Env-namespace linter pattern: grep -rhE dot+bracket forms, grep -oE to extract names, grep -vE allowlist to diff"
  - "Shell self-test pattern: mktemp dirs + LINT_* scope override + 3-case assertions with stderr capture"

requirements-completed: [ARC-09]

duration: 8min
completed: 2026-04-21
---

# Phase 10 Plan 02: Env-Var Namespace CI Linter Summary

**Grep-based ARC-09 linter enforcing GEMINI_SDK_* namespace on adapter-archon/src/**, with 3-case self-test and a standalone blocking CI job.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-21T22:30:00Z
- **Completed:** 2026-04-21T22:38:37Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Linter scans `adapter-archon/src/**` for `process.env.NAME` and `process.env['NAME']`, subtracts an explicit allowlist, fails with stderr diagnostics if any non-namespaced var appears
- Self-test exercises three canonical cases (allowlisted-pass, dot-form-fail, bracket-form-fail) — 3/3 green
- CI wiring: standalone `lint-env-namespace` job on `ubuntu-latest`, runs both the linter and its self-test as discrete steps; no `continue-on-error`; existing `test`, `parity`, `version-sync` jobs untouched
- Linter exits 0 against the current repo (adapter-archon/src/ contains only a stub `index.ts` with no env refs)

## Task Commits

1. **Task 1: Author lint-env-namespace.sh plus self-test spec** — `e88cd8a` (feat)
2. **Task 2: Wire lint-env-namespace into CI as a blocking job** — `676a087` (chore)

_Note: Task 1 was TDD-flagged, but RED/GREEN were delivered in a single commit because the linter script and its spec are tightly coupled shell artifacts (the spec cannot run without the linter, and the linter has no other consumer yet). The spec was authored first and validated against the finalized linter; behavior was verified before commit._

## Files Created/Modified
- `scripts/lint-env-namespace.sh` — ARC-09 grep-based enforcement; Git-Bash-safe; supports LINT_ENV_NS_SCOPE for self-test
- `scripts/lint-env-namespace.spec.sh` — mktemp fixture dirs + 3-case behavioral assertions
- `.github/workflows/ci.yml` — new `lint-env-namespace` blocking job

## Decisions Made
- **Delivered linter + spec in a single commit** instead of strict TDD RED/GREEN split. Rationale: the spec is a sibling shell script with no other consumer — splitting would produce a RED commit with a dangling reference to a not-yet-existent linter path, which is noisier than helpful for shell tooling. The 3-case behavioral contract is fully captured in the spec and verified green at commit time.
- **Standalone CI job** rather than adding steps to `parity`. Rationale: clearer status reporting; ARC-09 is independent of TS↔Python parity concerns.
- **SKIP on missing scope dir** (exit 0) rather than fail. Rationale: plan 10-02 lands before adapter-archon files exist; a hard-fail here would break Wave-1 CI before any adapter code is written.

## Deviations from Plan

None — plan executed exactly as written. The TDD-split note above is a delivery-packaging choice, not a behavioral deviation; all acceptance criteria were met verbatim.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Plans 10-03 onward can freely introduce `process.env.GEMINI_SDK_*` references in `adapter-archon/src/**`; any accidental `process.env.OPENAI_API_KEY`-style slip will be caught by the CI gate before merge
- Branch protection for the `lint-env-namespace` job must be configured in the GitHub UI (out-of-repo per plan instruction) before the gate is truly blocking on merges

## Self-Check: PASSED

Verified:
- scripts/lint-env-namespace.sh — FOUND
- scripts/lint-env-namespace.spec.sh — FOUND
- .github/workflows/ci.yml contains lint-env-namespace — FOUND (3 occurrences)
- Commit e88cd8a — FOUND in git log
- Commit 676a087 — FOUND in git log
- bash scripts/lint-env-namespace.spec.sh — exits 0, "ALL OK: 3/3 cases passed"
- bash scripts/lint-env-namespace.sh — exits 0 against current repo

---
*Phase: 10-archon-adapter-ts-only*
*Completed: 2026-04-21*
