---
phase: 11-docs-site-compat-matrix-release
plan: 02
subsystem: docs
tags: [vitepress, mkdocs-material, typedoc, mkdocstrings, documentation, license]

requires:
  - phase: 10-archon-adapter-ts-only
    provides: completed TypeScript SDK with public ts/src/index.ts entry point
  - phase: 01-feasibility-spike
    provides: python/src/gemini_sdk package with public __init__.py surface

provides:
  - VitePress site scaffold at docs/ with TypeDoc API reference integration
  - MkDocs-material Python docs at docs-python/ rendering to docs/public/python/
  - MIT LICENSE at repo root
  - Three working build commands: pnpm docs:typedoc, pnpm docs:build, uv run mkdocs build --strict

affects:
  - 11-03-compat-matrix (needs VitePress running to add compat-matrix page)
  - 11-04-content-authoring (fills placeholder stubs created here)
  - 11-05-ci-deploy (wires build commands into GitHub Actions)

tech-stack:
  added:
    - vitepress@1.6.4
    - typedoc@0.28
    - typedoc-plugin-markdown@4.4
    - typedoc-vitepress-theme@1.1
    - mkdocs-material>=9.5
    - mkdocstrings[python]>=0.29
    - griffe>=1.0
  patterns:
    - TypeDoc generates markdown into docs/ts/api/; VitePress imports typedoc-sidebar.json at build time
    - MkDocs builds static HTML into docs/public/python/; VitePress serves it as /python/ via public/ passthrough
    - ignoreDeadLinks regex list for repo cross-references outside docs tree
    - JSDoc comments must use {placeholder} not <placeholder> to avoid Vue template compiler errors

key-files:
  created:
    - docs/.vitepress/config.mts
    - docs/index.md
    - docs/package.json
    - docs/ts/quickstart.md
    - typedoc.json
    - mkdocs.yml
    - docs-python/index.md
    - docs-python/api.md
    - LICENSE
  modified:
    - pnpm-workspace.yaml (added docs workspace)
    - package.json (added docs scripts + typedoc devDeps)
    - .gitignore (added docs generated artifact patterns)
    - python/pyproject.toml (added docs optional-dependencies)
    - python/uv.lock (updated after uv sync --extra docs)
    - docs/structured-output.md (fixed nested code-fence syntax)
    - ts/src/process/ProcessManager.ts (fixed JSDoc <pid> angle bracket)
    - ts/src/query/types.ts (fixed JSDoc <dir>/<mode> angle brackets)
    - ts/src/session/Session.ts (fixed JSDoc Readonly<interface> angle bracket)

key-decisions:
  - "TypeDoc runs before VitePress in CI (plan 11-05); docs:typedoc must precede docs:build locally"
  - "ignoreDeadLinks uses regex list for repo cross-references (ts/tests-live/, .planning/) rather than true (ignores all)"
  - "JSDoc angle-bracket placeholders changed to {curly-brace} style to avoid Vue template compiler treating them as HTML tags"
  - "MkDocs --strict passes with unrecognized relative link warning (non-fatal); docs-python/index.md ../  link intentional"

patterns-established:
  - "Pattern 1: JSDoc comments must not use bare <angle-bracket> tokens outside code fences — use {curly-brace} or backtick-quoted form"
  - "Pattern 2: pnpm docs:typedoc always precedes pnpm docs:build (TypeDoc sidebar JSON required by VitePress config import)"

requirements-completed: [DOC-01, DOC-03, REL-03]

duration: 7min
completed: 2026-04-22
---

# Phase 11 Plan 02: Docs Toolchain Scaffold Summary

**VitePress + TypeDoc + MkDocs-material three-pipeline docs scaffold: all three build commands exit 0 and MIT LICENSE committed at repo root.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-22T12:24:37Z
- **Completed:** 2026-04-22T12:31:42Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments

- VitePress site builds from docs/ with TypeDoc API reference sidebar auto-imported from typedoc-sidebar.json
- TypeDoc generates markdown pages + sidebar JSON from ts/src/index.ts (full public surface: process, errors, parser, query, auth, session, output)
- MkDocs-material builds Python API reference HTML into docs/public/python/ using mkdocstrings-python rendering gemini_sdk public surface
- MIT LICENSE created at repo root with 2026 copyright (REL-03)

## Task Commits

1. **Task 1: Scaffold VitePress + TypeDoc + LICENSE** - `c015fb5` (feat)
2. **Task 2: Scaffold MkDocs-material + mkdocstrings-python** - `6b71040` (feat)

**Plan metadata:** (final commit below)

## Files Created/Modified

- `docs/.vitepress/config.mts` - VitePress config with base='/Gemini-SDK/', TypeDoc sidebar import, ignoreDeadLinks
- `docs/index.md` - Landing page hero with TypeScript + Python quickstart links
- `docs/package.json` - VitePress workspace package (private, docs scripts)
- `docs/ts/quickstart.md` - Stub for plan 11-04 content authoring
- `typedoc.json` - TypeDoc config targeting ts/src/index.ts, markdown + vitepress-theme plugins
- `mkdocs.yml` - MkDocs-material config with mkdocstrings plugin, site_dir=docs/public/python
- `docs-python/index.md` - Python section landing stub
- `docs-python/api.md` - mkdocstrings rendering stub for ::: gemini_sdk
- `LICENSE` - MIT license with copyright (c) 2026 Sean Robert Wright
- `pnpm-workspace.yaml` - Added "docs" workspace entry
- `package.json` - Added docs:dev, docs:build, docs:typedoc scripts; typedoc devDependencies
- `.gitignore` - Added docs/ts/api/, docs/public/python/, docs/.vitepress/dist|cache/, docs/node_modules/
- `python/pyproject.toml` - Added docs optional-dependencies group
- `python/uv.lock` - Updated after uv sync --extra docs
- `docs/structured-output.md` - Fixed nested ``` code fences (VitePress Vue parser breakage)
- `ts/src/process/ProcessManager.ts` - Fixed JSDoc `<pid>` to `{pid}`
- `ts/src/query/types.ts` - Fixed JSDoc `<dir>`, `<mode>` to `{dir}`, `{mode}`
- `ts/src/session/Session.ts` - Fixed JSDoc `Readonly<interface>` to `Readonly interface`

## Decisions Made

- Used `ignoreDeadLinks` regex list (not `true`) so only known cross-repo links are ignored; real broken docs links still fail CI
- JSDoc `<angle-bracket>` placeholders changed to `{curly-brace}` style — Vue 3 template compiler in VitePress parses markdown HTML and chokes on unknown element tags
- `pnpm docs:typedoc` must run before `pnpm docs:build` because config.mts statically imports typedoc-sidebar.json; CI plan 11-05 will enforce order

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed nested code-fence syntax in docs/structured-output.md**
- **Found during:** Task 1 (VitePress build smoke test)
- **Issue:** Existing doc file had ``` code fences nested inside ``` fences; VitePress Vue parser threw "Element is missing end tag" at line 76
- **Fix:** Changed outer fences from ` ``` ` to `~~~` in two locations
- **Files modified:** docs/structured-output.md
- **Verification:** VitePress build passes
- **Committed in:** c015fb5 (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed JSDoc angle-bracket tokens causing Vue parser errors**
- **Found during:** Task 1 (second VitePress build attempt)
- **Issue:** TypeDoc-generated markdown from JSDoc comments contained `<pid>`, `<dir>`, `<mode>`, `Readonly<interface>` — VitePress's Vue template compiler treated these as HTML tags and errored with "Element is missing end tag"
- **Fix:** Changed all occurrences in JSDoc source to curly-brace or backtick form; regenerated TypeDoc
- **Files modified:** ts/src/process/ProcessManager.ts, ts/src/query/types.ts, ts/src/session/Session.ts
- **Verification:** TypeDoc regenerated; VitePress build passes
- **Committed in:** c015fb5 (Task 1 commit)

**3. [Rule 3 - Blocking] Added ignoreDeadLinks to VitePress config**
- **Found during:** Task 1 (third VitePress build attempt)
- **Issue:** Pre-existing docs (auth.md, tools.md, mcp.md, structured-output.md) contain links to repo files outside the docs tree (ts/tests-live/README, .planning/REQUIREMENTS); VitePress strict mode fails on dead links
- **Fix:** Added `ignoreDeadLinks` with regex list matching the two patterns
- **Files modified:** docs/.vitepress/config.mts
- **Verification:** VitePress build exits 0
- **Committed in:** c015fb5 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 blocking — pre-existing content incompatible with new VitePress build)
**Impact on plan:** All fixes necessary to make VitePress build pass. Zero scope creep; no architectural changes.

## Issues Encountered

- esbuild native build scripts blocked by pnpm `approve-builds` interactive prompt; VitePress still worked because platform binary was present at node_modules/.pnpm/esbuild@0.27.7/node_modules/@esbuild/win32-x64/esbuild.exe. No action needed.

## Next Phase Readiness

- All three build commands verified working; plan 11-03 (compat matrix page) can add docs/compat-matrix.md to the VitePress site
- Plan 11-04 (content authoring) can replace stub files (docs/ts/quickstart.md, docs-python/index.md)
- Plan 11-05 (CI/deploy) can wire `pnpm docs:typedoc && pnpm docs:build` + mkdocs build into GitHub Actions

---
*Phase: 11-docs-site-compat-matrix-release*
*Completed: 2026-04-22*
