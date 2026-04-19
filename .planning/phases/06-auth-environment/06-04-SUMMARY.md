---
phase: 06-auth-environment
plan: "04"
subsystem: auth
tags: [bash, ci, github-actions, documentation, linting]

requires:
  - phase: 05-error-taxonomy-archon-5-bucket-mapping
    provides: "AuthError subtype hierarchy (NotConfigured, Forbidden403, Expired, ToSViolation) referenced in docs/auth.md"
  - phase: 02-process-foundation
    provides: "EnvBuilder ALLOWED_KEYS allowlist (GOOGLE_AUTH_TOKEN deliberately absent — AUT-09 enforcement)"

provides:
  - "scripts/lint-auth-login.sh — AUT-05 CI enforcement (grep source-only, exits 0 clean / 1 on match)"
  - ".github/workflows/ci.yml parity job extended with 'Lint auth login prohibition' blocking step"
  - "docs/auth.md — precedence chain, AUT-08 rationale (#22970 + ToS), AUT-09 rationale (GOOGLE_AUTH_TOKEN non-existence)"

affects:
  - phase: 06-auth-environment (plans 06-01/02/03 — resolveAuth implementation)
  - phase: 11-release (doc-site build can render docs/auth.md directly)

tech-stack:
  added: []
  patterns:
    - "Standalone bash lint script pattern: set -euo pipefail + grep -E only + REPO_ROOT + source-only scope"
    - "CI parity job as the single extension point for project-wide source-code enforcement linters"

key-files:
  created:
    - scripts/lint-auth-login.sh
    - docs/auth.md
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Lint scope is source-only (ts/src + python/src) — tests and docs may reference 'auth login' in prohibition prose without tripping the linter"
  - "AUT-09 enforcement is doc-only + allowlist exclusion — GOOGLE_AUTH_TOKEN absent from ALLOWED_KEYS IS the gate; no runtime check needed"
  - "AUT-08 documented via #22970 citation + ToS note — API key is canonical for headless/SDK contexts"

patterns-established:
  - "Lint script shape: mirrors lint-errors.sh (set -euo pipefail, REPO_ROOT, grep -E, source-only scope)"
  - "CI step placement: immediately after lint-errors.sh in the parity job (not the test matrix)"

requirements-completed: [AUT-05, AUT-08, AUT-09]

duration: 2min
completed: 2026-04-19
---

# Phase 6 Plan 04: CI Auth-Login Linter + docs/auth.md Summary

**CI grep linter blocking `auth login` from SDK source (AUT-05), plus docs/auth.md covering precedence chain, discussion #22970 ToS rationale (AUT-08), and GOOGLE_AUTH_TOKEN non-existence (AUT-09)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-19T23:32:42Z
- **Completed:** 2026-04-19T23:34:41Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `scripts/lint-auth-login.sh` (100755) matching the `lint-errors.sh` pattern: `set -euo pipefail`, `grep -E` compatible, source-only scope (`ts/src` + `python/src`), exits 0 on clean tree
- Wired the linter into `.github/workflows/ci.yml` parity job as a blocking step immediately after `lint-errors.sh`
- Authored `docs/auth.md` (76 lines) with all required sections: precedence chain, #22970 + ToS rationale (AUT-08), `GOOGLE_AUTH_TOKEN` absence rationale (AUT-09), `AuthError` hierarchy, `AUTH_PRECEDENCE` constant reference

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scripts/lint-auth-login.sh + wire into CI** - `f976155` (feat)
2. **Task 2: Author docs/auth.md** - `9bd0ca3` (feat)

**Plan metadata:** (final docs commit below)

## Files Created/Modified

- `scripts/lint-auth-login.sh` — AUT-05 / SC-4 enforcement linter; grep source-only; 100755
- `.github/workflows/ci.yml` — Added `Lint auth login prohibition` step to parity job
- `docs/auth.md` — Auth documentation: precedence chain, AUT-08, AUT-09, AuthError hierarchy

## Decisions Made

- `AUT-09` is doc-only + allowlist: `GOOGLE_AUTH_TOKEN` absent from `ALLOWED_KEYS` is the architectural gate; documenting "we never added this" is more honest than a runtime check that duplicates existing enforcement
- Lint scope source-only: tests and docs legitimately use "auth login" in prohibition prose (e.g. "SDK NEVER calls auth login") — false positives would be self-defeating
- `AUT-08` citation links to discussion #22970 and the Google FAQ ToS note; no fetch at author time (URL cited only)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added AUT-08 citation to docs/auth.md**
- **Found during:** Task 2 (docs/auth.md verification)
- **Issue:** Automated verification node command checked for literal string `AUT-08` — initial draft had the ToS note without an explicit `(AUT-08)` tag
- **Fix:** Added `(AUT-08)` annotation to the Google FAQ ToS note line
- **Files modified:** docs/auth.md
- **Verification:** `node -e "...checks.filter..."` passes with all 11 strings present
- **Committed in:** 9bd0ca3 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing annotation caught by verification command)
**Impact on plan:** Trivial annotation addition — no scope change.

## Issues Encountered

- `git update-index --chmod=+x` requires the file to be staged first (`git add` before `--chmod`); staged then set exec bit successfully — `git ls-files --stage` confirms `100755`

## Next Phase Readiness

- AUT-05 enforcement mechanism in CI is live; plans 06-01/02/03 can freely use `resolveAuth()` without risk of `auth login` slipping into source
- `docs/auth.md` is ready for doc-site rendering (Phase 11)
- Plans 06-01/02/03 (resolveAuth implementation) are independent Wave 1 deliverables; this plan (06-04) is now complete

---
*Phase: 06-auth-environment*
*Completed: 2026-04-19*
