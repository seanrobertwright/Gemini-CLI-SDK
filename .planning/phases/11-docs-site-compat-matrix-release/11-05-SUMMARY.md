---
phase: 11-docs-site-compat-matrix-release
plan: 05
subsystem: infra
tags: [github-actions, github-pages, changesets, pypi, npm, trusted-publishing, mkdocs, vitepress, typedoc]

# Dependency graph
requires:
  - phase: 11-02
    provides: docs scaffolding (docs:build, docs:typedoc scripts, VitePress config, mkdocs.yml)
  - phase: 11-03
    provides: release infrastructure (changesets config, ci:publish script, version-packages script, mirror-changelog.sh, check-pypi-name.sh)
provides:
  - .github/workflows/docs.yml — build + deploy docs to GitHub Pages on push-to-master
  - .github/workflows/release.yml — changesets action for npm publish of @gemini-sdk/core
  - .github/workflows/pypi-publish.yml — uv trusted publishing on GitHub Release creation
affects: [11-06]

# Tech tracking
tech-stack:
  added:
    - changesets/action@v1 (npm release automation)
    - actions/deploy-pages@v4 (GitHub Pages deployment)
    - actions/upload-pages-artifact@v3 (Pages artifact upload)
    - actions/configure-pages@v5 (Pages configuration)
  patterns:
    - PyPI trusted publishing via OIDC (id-token: write + environment: release)
    - GitHub Pages deploy via artifact upload pattern (build job + deploy job)
    - changesets version PR + publish workflow

key-files:
  created:
    - .github/workflows/docs.yml
    - .github/workflows/release.yml
    - .github/workflows/pypi-publish.yml
  modified: []

key-decisions:
  - "docs.yml uses separate build + deploy jobs as required by GitHub Pages OIDC deployment pattern"
  - "release.yml: mirror-changelog.sh step runs only when changesets.outputs.published == true to avoid spurious commits"
  - "pypi-publish.yml: check-pypi-name.sh gate runs before build to fail fast if PyPI name is taken"
  - "pypi-publish.yml: dry_run input allows manual workflow_dispatch without publishing, using python/dist/ artifacts for inspection"

patterns-established:
  - "Pattern: GitHub Pages OIDC deploy — permissions: pages/id-token write at workflow level; build uploads artifact, deploy job consumes it"
  - "Pattern: changesets release — version-packages script chains changeset version + sync-version.sh; ci:publish chains sync-version + changeset publish"
  - "Pattern: PyPI trusted publishing — environment: release + id-token: write; no secret tokens required at publisher config time"

requirements-completed: [REL-01, REL-02]

# Metrics
duration: 5min
completed: 2026-04-22
---

# Phase 11 Plan 05: CI/CD Workflows (Docs + npm Release + PyPI) Summary

**Three GitHub Actions workflows wired: docs deploy to GitHub Pages (mkdocs + TypeDoc + VitePress), changesets npm release with CHANGELOG mirror, and PyPI trusted publishing on GitHub Release.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-22T12:34:17Z
- **Completed:** 2026-04-22T12:39:00Z
- **Tasks:** 1 of 2 complete (Task 2 is human-action checkpoint)
- **Files modified:** 3

## Accomplishments

- docs.yml: two-job pipeline (build + deploy) that runs mkdocs, TypeDoc, and VitePress then deploys artifact to GitHub Pages via OIDC; path-filtered to only trigger on relevant file changes
- release.yml: changesets/action@v1 workflow on master push; opens version PR or publishes to npm; mirrors CHANGELOG to python/ after successful publish
- pypi-publish.yml: uv build + trusted publishing on GitHub Release creation; check-pypi-name.sh gate runs first; dry_run input for manual inspection

## Task Commits

1. **Task 1: Write docs.yml + release.yml + pypi-publish.yml** - `42bf973` (feat)

## Files Created/Modified

- `.github/workflows/docs.yml` - Build mkdocs + TypeDoc + VitePress, deploy to GitHub Pages on push-to-master or workflow_dispatch
- `.github/workflows/release.yml` - changesets/action npm release; mirror CHANGELOG to python/ after publish
- `.github/workflows/pypi-publish.yml` - uv publish with PyPI trusted publishing on GitHub Release; dry_run support

## Decisions Made

- docs.yml uses separate `build` and `deploy` jobs (required by GitHub Pages OIDC deployment — only deploy job needs pages environment)
- release.yml mirror-changelog step guarded by `steps.changesets.outputs.published == 'true'` to avoid spurious git commits on every master push
- pypi-publish.yml check-pypi-name.sh runs before build to fail fast on name conflicts
- pypi-publish.yml dry_run conditional uses `inputs.dry_run != 'true'` so release events always publish regardless of input

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — all three YAML files parse cleanly; all 15 acceptance criteria pass.

## User Setup Required

**External services require manual configuration before workflows can green.** Complete these steps:

1. **GitHub Pages enablement**
   - URL: https://github.com/seanrobertwright/Gemini-SDK/settings/pages
   - Action: Source → "GitHub Actions"

2. **NPM_TOKEN secret**
   - URL: https://github.com/seanrobertwright/Gemini-SDK/settings/secrets/actions
   - Action: npmjs.com → Account → Access Tokens → Generate "Automation" token → Add as repo secret `NPM_TOKEN`

3. **PyPI trusted publisher**
   - URL: https://pypi.org/manage/account/publishing/
   - Action: Add pending publisher with: project=gemini-sdk, owner=seanrobertwright, repo=Gemini-SDK, workflow=pypi-publish.yml, environment=release

4. **GitHub environment "release"** (optional but recommended)
   - URL: https://github.com/seanrobertwright/Gemini-SDK/settings/environments
   - Action: New environment "release" with required reviewers

**Verification after setup:**
- Trigger workflow_dispatch on docs.yml → confirm green run → confirm site at https://seanrobertwright.github.io/Gemini-SDK/
- On next master push with pending changeset: confirm release.yml opens/updates version PR
- On next GitHub Release creation: confirm pypi-publish.yml triggers and publishes to PyPI

## Next Phase Readiness

- Three workflow YAMLs committed and YAML-valid; ready to run once user completes external setup
- Plan 11-06 (smoke test / tag cut) can proceed after user configures Pages + NPM_TOKEN + PyPI trusted publisher and dispatches docs.yml to confirm green

---
*Phase: 11-docs-site-compat-matrix-release*
*Completed: 2026-04-22*
