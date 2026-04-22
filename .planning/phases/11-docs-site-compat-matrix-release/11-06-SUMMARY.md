---
phase: 11-docs-site-compat-matrix-release
plan: 06
subsystem: release
tags: [release, changeset, versioning, smoke-test, archon, powershell, npm, pypi]

# Dependency graph
requires:
  - phase: 11-docs-site-compat-matrix-release
    provides: CI/CD workflows (release.yml, pypi-publish.yml) and docs site
  - phase: 10-archon-adapter-ts-only
    provides: pr-artifacts bundle for REL-07 smoke gate
provides:
  - scripts/local-release-smoke.sh — REL-07 gate (local-fork Archon integration smoke)
  - scripts/local-release-smoke.spec.sh — self-test for smoke script
  - scripts/local-release-smoke.ps1 — PowerShell port for Windows users
  - scripts/local-release-smoke.spec.ps1 — PowerShell self-test companion
  - .changeset/v1-0-0-release.md — major changeset that drove 0.0.0 → 1.0.0 version bump
  - VERSION bumped to 1.0.0 (propagated to ts/package.json, python/pyproject.toml)
  - "@gemini-sdk/core@1.0.0 published to npm"
  - "gemini-sdk@1.0.0 published to PyPI"
  - "v1.0.0 git tag applied"
affects: [downstream consumers, Archon fork integration]

# Tech tracking
tech-stack:
  added: [hypothesis>=6.151.13 (Python dev dep)]
  patterns: [local-smoke-script-as-release-gate, changeset-driven-versioning]

key-files:
  created:
    - scripts/local-release-smoke.sh
    - scripts/local-release-smoke.spec.sh
    - scripts/local-release-smoke.ps1
    - scripts/local-release-smoke.spec.ps1
    - .changeset/v1-0-0-release.md
  modified:
    - VERSION (0.0.0 → 1.0.0)
    - ts/package.json (version 0.0.0 → 1.0.0)
    - python/pyproject.toml (version 0.0.0 → 1.0.0, hypothesis added to dev deps)
    - python/uv.lock

key-decisions:
  - "REL-07 reframed as local-fork smoke gate (not upstream Archon PR merge) per Phase 10 user direction — adapter stays local"
  - "PowerShell port of smoke script added out-of-band as user request between Task 1 and Task 2"
  - "hypothesis dev dep added to pyproject.toml to fix pytest collection failure on version-bump commit"
  - "v1.0.0 release shipped: npm + PyPI both live, git tag applied, CI matrix green"

patterns-established:
  - "Smoke script as release gate: local-release-smoke.sh must exit 0 before any v1.0.0 tag is created"
  - "sync-version.sh: single VERSION file as truth; node + sed propagation to ts/package.json and python/pyproject.toml"
  - "Changesets-driven version PR: human merges PR → release.yml publishes npm + tags → GitHub Release triggers PyPI"

requirements-completed: [PLT-01, PLT-02, REL-07]

# Metrics
duration: 25min (Tasks 1-3 execution; Task 4 spanned external CI + human merge)
completed: 2026-04-22
---

# Phase 11 Plan 06: Local Release Smoke + v1.0.0 Release Summary

**Shipped v1.0.0 to npm (@gemini-sdk/core@1.0.0) and PyPI (gemini-sdk@1.0.0) via local-fork Archon smoke gate, changesets-driven Version Packages PR, and dual CI/CD release workflows**

## Performance

- **Duration:** ~25 min executor time (Tasks 1-3); Task 4 gated on external CI + human merge
- **Started:** 2026-04-22
- **Completed:** 2026-04-22
- **Tasks:** 4/4 complete (3 auto + 1 human-verify gate)
- **Files modified:** 8

## Accomplishments

- Local Archon integration smoke script (Bash + PowerShell) satisfies REL-07 without requiring upstream Archon PR merge
- Smoke script passed against user's live Archon fork (exit 0, "SMOKE TEST PASSED" banner)
- VERSION bumped to 1.0.0 and propagated to ts/package.json and python/pyproject.toml via sync-version.sh
- v1.0.0 changeset consumed by changesets/action; Version Packages PR merged on master
- `@gemini-sdk/core@1.0.0` published to npm via release.yml `ci:publish`
- `gemini-sdk@1.0.0` published to PyPI via pypi-publish.yml (triggered by GitHub Release creation)
- `v1.0.0` git tag applied; CI matrix (ubuntu/macos/windows × node 18/20/22 × python 3.10-3.13) green — satisfies PLT-01 + PLT-02
- Both test suites green on the v1.0.0 commit: 249 TS tests, 249 Python tests

## Task Commits

1. **Task 1: Write local-release-smoke.sh + self-test spec** - `c3c437a` (feat)
2. **Pre-Task-3 chore: PowerShell port of smoke scripts** - `9263a5c` (chore, out-of-band user request)
3. **Task 2: REL-07 smoke gate (run against Archon fork)** — manual verification (no commit; resume signal `smoke-passed`)
4. **Task 3: Bump VERSION to 1.0.0 + write v1.0.0 changeset** - `4f22b59` (feat)
5. **Task 4: Merge version PR + tag v1.0.0 + trigger PyPI release** — manual verification (resume signal `v1-tagged`); release-bot commits + tag pushed by release.yml

**Plan metadata commits:** `ff9fa8e` (Tasks 1-3 partial summary), final commit (this plan completion)

## Files Created/Modified

- `scripts/local-release-smoke.sh` — REL-07 gate; applies pr-artifacts bundle to local Archon fork, installs SDK, runs live query
- `scripts/local-release-smoke.spec.sh` — Self-test for smoke script (3/3 cases pass)
- `scripts/local-release-smoke.ps1` — PowerShell equivalent of smoke script for Windows users
- `scripts/local-release-smoke.spec.ps1` — PowerShell self-test companion (3/3 cases pass)
- `.changeset/v1-0-0-release.md` — Major changeset for @gemini-sdk/core; consumed by release.yml to open Version Packages PR
- `VERSION` — bumped from `0.0.0` to `1.0.0`
- `ts/package.json` — version `0.0.0` → `1.0.0`
- `python/pyproject.toml` — version `0.0.0` → `1.0.0`; hypothesis added to dev deps
- `python/uv.lock` — updated lockfile

## Decisions Made

- REL-07 reframed as local-fork smoke gate (not upstream Archon PR merge) — per Phase 10 user direction; the adapter stays local to the user's Archon fork and will not be submitted as an upstream PR to coleam00/Archon
- PowerShell port committed as a standalone chore commit (out-of-band user request between Task 1 and Task 2 checkpoints)
- `hypothesis` dev dep added to fix pytest collection failure on version-bump commit (Rule 3 auto-fix)
- v1.0.0 shipped to both registries; project transitions from "planning/dev" to "released" status

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added hypothesis to Python dev deps**
- **Found during:** Task 3 (running pytest after version bump)
- **Issue:** `ModuleNotFoundError: No module named 'hypothesis'` blocked pytest collection; tests could not run to verify no version-bump regression
- **Fix:** `uv add --dev hypothesis>=6.151.13`; pyproject.toml and uv.lock updated
- **Files modified:** python/pyproject.toml, python/uv.lock
- **Verification:** `uv run pytest --tb=short` exits 0 with 249 tests passing
- **Committed in:** `4f22b59` (Task 3 commit)

### Out-of-band User Request

**PowerShell port of smoke scripts** — between Task 1 and Task 2, user requested a PowerShell equivalent of the Bash smoke script for Windows-native execution. Created and committed as `chore(11-06): add PowerShell port of local-release-smoke` (`9263a5c`). Not part of the plan's must-haves; treated as additive infrastructure.

---

**Total deviations:** 1 auto-fixed (1 blocking), 1 out-of-band addition
**Impact on plan:** No scope creep on the release path itself. The auto-fix was required for test verification; the PowerShell port is additive for Windows DX.

## Issues Encountered

- Hypothesis package was missing from pyproject.toml dev deps despite being imported in tests; previously installed in the uv environment from prior runs but not declared. Fixed via Rule 3 auto-fix.

## User Setup Required

None — release is shipped. Downstream consumers can now:

```bash
npm install @gemini-sdk/core      # → 1.0.0
uv add gemini-sdk                  # → 1.0.0
```

## Next Phase Readiness

- All 11 phases complete; project shipped at v1.0.0
- Two known follow-up gap-closure phases tracked in STATE.md blockers (`follow-up-auth-isolation-hardening`, `follow-up-quota-capped-key`) — neither blocks v1.0.0 since both error fixtures are documented as `synthetic_blocked` in spec/fixtures.manifest.json
- Future minor/patch versions will follow the same changesets-driven flow established here

## Self-Check: PASSED

**Files verified:**
- FOUND: scripts/local-release-smoke.sh
- FOUND: scripts/local-release-smoke.spec.sh
- FOUND: scripts/local-release-smoke.ps1
- FOUND: scripts/local-release-smoke.spec.ps1
- FOUND: .changeset/v1-0-0-release.md
- FOUND: VERSION (contains `1.0.0`)
- FOUND: ts/package.json (`"version": "1.0.0"`)
- FOUND: python/pyproject.toml (`version = "1.0.0"`)

**Commits verified:**
- FOUND: c3c437a (Task 1: smoke script + spec)
- FOUND: 9263a5c (PowerShell port chore)
- FOUND: 4f22b59 (Task 3: VERSION bump + changeset)
- FOUND: ff9fa8e (interim plan summary, Tasks 1-3)

**Release artifacts verified (per user resume signal `v1-tagged`):**
- LIVE: `npm view @gemini-sdk/core version` → `1.0.0`
- LIVE: `pip index versions gemini-sdk` → lists `1.0.0`
- APPLIED: `v1.0.0` git tag (pushed by release.yml on Version Packages PR merge)
- GREEN: CI matrix on v1.0.0 commit (PLT-01 + PLT-02 satisfied)

---
*Phase: 11-docs-site-compat-matrix-release*
*Completed: 2026-04-22*
