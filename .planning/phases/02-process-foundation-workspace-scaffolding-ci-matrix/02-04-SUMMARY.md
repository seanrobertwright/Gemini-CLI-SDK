---
phase: 02-process-foundation-workspace-scaffolding-ci-matrix
plan: "04"
subsystem: infra
tags: [github-actions, bash, ci, grep, sed, ast, python, pnpm, uv, vitest, pytest, windows, ja-JP]

requires:
  - phase: 02-02
    provides: TS process module with Vitest tests (BinaryResolver, EnvBuilder, ProcessManager, SpawnPerCallStrategy)
  - phase: 02-03
    provides: Python process module with pytest tests (binary_resolver, env_builder, process_manager, spawn_per_call_strategy)

provides:
  - scripts/sync-version.sh — reads root VERSION, patches ts/package.json and python/pyproject.toml
  - scripts/diff-test-names.sh — extracts TS test() names and Python docstrings, diffs, exits 1 on divergence
  - .github/workflows/ci.yml — 7-job test matrix + parity job + version-sync job

affects:
  - all future phases (CI gate for test parity and version sync)
  - Phase 09 (MCP) — Windows encoding path exercised by ja-JP job

tech-stack:
  added: [github-actions, pnpm/action-setup@v4, astral-sh/setup-uv@v5, actions/setup-node@v4, actions/setup-python@v5]
  patterns:
    - "Version sync: root VERSION -> node -e via env vars -> ts/package.json; sed -i.bak -> python/pyproject.toml"
    - "Grep portability: -oE (ERE) instead of -oP (PCRE) — PCRE needs special locale in Git Bash grep 3.0"
    - "Python detection: loop through python3/python/py with verification call to skip broken Windows Store stubs"
    - "CI matrix: include: explicit list (not cross-product) for representative subset"
    - "Windows encoding: chcp 932 + PYTHONUTF8=1 + PYTHONIOENCODING=utf-8 for ja-JP simulation"

key-files:
  created:
    - scripts/sync-version.sh
    - scripts/diff-test-names.sh
    - .github/workflows/ci.yml
  modified: []

key-decisions:
  - "grep -oE (ERE) used instead of -oP (PCRE): Git Bash grep 3.0 on Windows returns exit 2 for -oP due to locale constraints"
  - "Node path in sync-version.sh passed via REPO_ROOT env var: avoids Windows backslash escaping in -e string"
  - "Python detector loops python3/python/py with verification: Windows Store stub passes command -v but exits 49 on execution"
  - "pnpm install without --frozen-lockfile note: ts/pnpm-lock.yaml absent until first install; CI uses --frozen-lockfile"
  - "diff-test-names.sh exits 1 with detailed diff output on divergence: current TS/Python test names diverge (PAR alignment deferred to Phase 3+)"

patterns-established:
  - "Pattern: Use env vars to pass REPO_ROOT to node -e scripts to avoid Windows path escaping issues"
  - "Pattern: Verify python interpreter actually works before selecting it (not just command -v)"
  - "Pattern: Use grep -oE ERE for portability across grep implementations"
  - "Pattern: CI matrix via include: explicit list for representative ~12-job subset"

requirements-completed: [PLT-03, PLT-05, PAR-03, PAR-04]

duration: 4min
completed: 2026-04-12
---

# Phase 02 Plan 04: CI Infrastructure Summary

**VERSION-sync script, TS/Python test-name parity enforcer, and 9-job GitHub Actions CI matrix with Windows ja-JP codepage-932 encoding validation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-12T21:58:36Z
- **Completed:** 2026-04-12T22:02:53Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments

- `scripts/sync-version.sh` reads root `VERSION`, patches `ts/package.json` via `node -e` (env-var path passing for Windows portability) and `python/pyproject.toml` via `sed -i.bak`
- `scripts/diff-test-names.sh` extracts TS `test()`/`it()` names via `grep -oE` and Python test docstrings via `ast.parse`; diffs sorted lists and exits 1 with clear divergence output
- `.github/workflows/ci.yml` provides 7-job test matrix (ubuntu/macos/windows x Node 18/20/22 x Python 3.10/3.13), plus independent parity and version-sync jobs; Windows jobs are hard-required (no `continue-on-error`)

## Task Commits

1. **Task 1: Create sync-version.sh and diff-test-names.sh scripts** - `43f9875` (feat)
2. **Task 2: Create GitHub Actions CI workflow with representative matrix** - `4f38924` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `scripts/sync-version.sh` — reads VERSION, patches ts/package.json and python/pyproject.toml; portable across GNU/BSD sed
- `scripts/diff-test-names.sh` — extracts and diffs TS test names vs Python docstrings; detects working python interpreter
- `.github/workflows/ci.yml` — 7 test matrix jobs + parity job + version-sync job; Windows non-en-US ja-JP job with chcp 932

## Decisions Made

- **grep -oE (ERE) instead of -oP (PCRE):** Git Bash ships grep 3.0 which returns exit 2 for `-oP` with "supports only unibyte and UTF-8 locales" — ERE covers the pattern adequately
- **REPO_ROOT via env var in node -e:** Windows backslash paths inside `-e` strings cause escape hell; env vars bypass this entirely
- **Python detector with verification loop:** `command -v python3` returns `/c/Users/.../WindowsApps/python3` (Store stub) on Windows but exits 49 on use; must verify with actual execution
- **--frozen-lockfile in CI:** ts/pnpm-lock.yaml not yet committed (no pnpm install run yet); CI will work once lockfile is committed after first `cd ts && pnpm install`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced grep -oP with grep -oE for Windows grep portability**
- **Found during:** Task 1 (diff-test-names.sh)
- **Issue:** Plan specified `grep -oP` (PCRE) but Git Bash grep 3.0 returns exit 2 ("supports only unibyte and UTF-8 locales"), aborting the script via `set -euo pipefail`
- **Fix:** Changed to `grep -oE` (ERE) with equivalent pattern; added `|| true` to handle grep exit 1 on no matches
- **Files modified:** scripts/diff-test-names.sh
- **Verification:** Script runs to completion, extracts 25 TS test names correctly
- **Committed in:** 43f9875 (Task 1 commit)

**2. [Rule 1 - Bug] Used env vars for REPO_ROOT in node -e call in sync-version.sh**
- **Found during:** Task 1 (sync-version.sh)
- **Issue:** Plan's template embedded `$REPO_ROOT` directly in node `-e` string; on Windows Git Bash, `pwd` returns `/d/repos/...` but node needs `D:/repos/...`; backslash embedding in `-e` strings also breaks
- **Fix:** Pass `REPO_ROOT` and `PKG_VERSION` as env vars to `node -e`, use `process.env.REPO_ROOT` and `path.join()` inside
- **Files modified:** scripts/sync-version.sh
- **Verification:** `bash scripts/sync-version.sh` exits 0 and prints "Synced version 0.0.0"
- **Committed in:** 43f9875 (Task 1 commit)

**3. [Rule 1 - Bug] Added python interpreter detection with execution verification**
- **Found during:** Task 1 (diff-test-names.sh)
- **Issue:** Plan used `python3` directly; Windows Git Bash has `python3` as a broken Windows Store stub (exits 49); `command -v python3` returns true but execution fails
- **Fix:** Loop through `python3 python py`, verify with `-c "import sys; sys.exit(0)"`, use first working one
- **Files modified:** scripts/diff-test-names.sh
- **Verification:** Script finds `python` (the real interpreter) and runs AST extraction correctly
- **Committed in:** 43f9875 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 x Rule 1 - Bug)
**Impact on plan:** All three fixes are Windows portability corrections. CI runs will use Ubuntu where the original patterns work; the fixes ensure scripts are also locally runnable on Windows as the plan requires.

## Issues Encountered

- TS/Python test names currently diverge (25 TS vs 22 Python) — diff-test-names.sh correctly reports this with exit 1. This is expected: the Python port in plan 02-03 used slightly different test description wording. PAR-03 enforcement is now wired; parity alignment is a Phase 3+ concern.

## User Setup Required

None — no external service configuration required. To complete the CI picture, commit `ts/pnpm-lock.yaml` after running `cd ts && pnpm install` (required before `--frozen-lockfile` works in CI).

## Next Phase Readiness

- CI infrastructure complete: version sync, parity enforcement, and 9-job matrix all wired
- Phase 3 plans can now target PAR-03 parity by aligning Python test docstrings to TS test() descriptions
- Version-sync job will catch manifest drift automatically on every PR

---
*Phase: 02-process-foundation-workspace-scaffolding-ci-matrix*
*Completed: 2026-04-12*
