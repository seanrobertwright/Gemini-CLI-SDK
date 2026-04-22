# Phase 11: Docs Site + Compat Matrix + Release - Research

**Researched:** 2026-04-21
**Domain:** Documentation toolchain (VitePress + mkdocs-material + TypeDoc + mkdocstrings), release publishing (changesets + uv publish + PyPI trusted publishing), runtime compat probe
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Release target
- Public SDK. npm publish + PyPI publish are real deliverables (not local-artifact-only).
- User's earlier "keep local" direction applied to Archon integration ONLY — the SDK itself ships publicly.

#### v1.0.0 release gate (REL-07 reframed)
- Original REL-07 text is obsolete — the Archon PR is not being opened upstream per user direction from Phase 10.
- New gate: Tag `v1.0.0` only after the `pr-artifacts/` bundle is applied to the user's local Archon fork, `DEFAULT_AI_ASSISTANT=gemini` is set, and one real end-to-end `query()` succeeds.
- Delivery mechanism: Ship `scripts/local-release-smoke.sh` (or equivalent documented manual steps) that applies the bundle to a local Archon checkout, runs one query, asserts success. Script passing is the tag gate. Runs locally, not in CI.
- Intent preserved: The original REL-07 existed to prove the SDK works end-to-end through a real consumer before cutting 1.0 — local smoke test delivers the same guarantee without upstream dependency.

#### Doc site destination & structure (DOC-01)
- Single combined site on GitHub Pages. One URL, one deploy pipeline.
- VitePress is the shell; sections at `/ts/` and `/python/`.
- mkdocs-material builds its output into `/python/` as static HTML (not a separate site).
- Zero hosting cost, no external account sprawl (Vercel/Netlify explicitly rejected).

#### Compat probe behavior (REL-06, DOC-04)
- Default: Warn to stderr when detected `gemini-cli` version is outside tested range. Format: `[gemini-sdk] tested against gemini-cli 0.37.x–0.Y.z, detected 0.Z.z — proceeding`.
- Override env var: `GEMINI_SDK_COMPAT`
  - `strict` → throw instead of warn
  - `silent` → suppress warning entirely
  - unset or any other value → default warn behavior
- Probe location: Runs once on first `query()` invocation (cached for process lifetime), not per-call.

#### Migration guide scope (DOC-06)
- Cover both Claude Agent SDK AND Codex SDK, short-form (one page per source SDK).
- Per-page focus: map the top ~5 call-site patterns — (1) construct client, (2) send query, (3) stream chunks, (4) tool use, (5) session resume.
- Not a comprehensive API cross-reference — that rots fast and nobody reads it.

#### Known-issues appendix (DOC-05)
- Live GitHub links in doc site appendix, auto-generated from a YAML source of truth.
- Source file: `docs/known-issues.yml` with schema `{upstream_issue: "#14180", title, sdk_defense, status: open|fixed}`.
- Rendered into a sortable table on the doc site.
- Initial entries consolidate refs already cited in code/specs: #14180, #13388, #3485, #22970, #4945, plus encoding issues and OAuth 403.
- One edit point per bug — when a bug is fixed upstream, flip `status: fixed` in the YAML, all doc pages reflect it.

### Claude's Discretion
- Exact VitePress theme/styling choices
- Whether to use changesets' default config or a custom release script (REL-01)
- PyPI trusted publishing OIDC setup details (REL-02)
- Exact structure of the Archon integration guide (DOC-07) — follows from whatever the `pr-artifacts/` README already documents
- Format/wording of the changelog mirror between changesets (TS) and Python release notes (REL-04)
- Local smoke-test script implementation details (shell vs Node, exact assertions)

### Deferred Ideas (OUT OF SCOPE)
- Full API cross-reference tables (Claude SDK ↔ Gemini SDK, Codex SDK ↔ Gemini SDK) — rejected; high-value patterns only.
- RC / beta release flow (0.9.0, 1.0.0-rc.1) — straight to 1.0.0 when local smoke-test gate passes.
- Publishing under a personal npm scope vs `@gemini-sdk/*` — left as Claude's discretion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOC-01 | Hosted doc site published (VitePress + mkdocs-material, single site two sections) | VitePress as shell + mkdocs static HTML copy into public/python/ pattern documented below |
| DOC-02 | Quickstart guide covers gemini-cli prerequisite, API key, first query(), multi-turn, first MCP server | Content authoring task; no library research needed; structure documented in Architecture Patterns |
| DOC-03 | API reference auto-generated from types (typedoc for TS, mkdocstrings for Python) | typedoc-plugin-markdown + typedoc-vitepress-theme for TS; mkdocstrings-python for Python |
| DOC-04 | Compat matrix page with runtime gemini --version warning | Probe reads `.gemini-cli-compat`, uses semver package, cached process-lifetime flag |
| DOC-05 | Known-issues appendix with live upstream bug links | YAML source file + VitePress data loading pattern documented |
| DOC-06 | Migration guide from Claude Agent SDK / Codex SDK | Content authoring; 5-pattern-per-page scope defined in constraints |
| DOC-07 | Archon integration guide for DEFAULT_AI_ASSISTANT=gemini | Sourced from pr-artifacts/README.md and PR_BODY.md |
| REL-01 | TS package published to npm via changesets | changesets + changesets/action workflow; access:public for scoped package; private packages excluded via package.json private:true |
| REL-02 | Python package published to PyPI via uv publish + trusted publishing | uv publish --trusted-publishing always; id-token:write permission; PyPI pending publisher setup |
| REL-03 | MIT license in root LICENSE file | Simple file write; standard MIT text |
| REL-04 | CHANGELOG.md via changesets (TS), mirrored to Python release notes | changesets generates CHANGELOG.md; mirror script copies/formats into python/CHANGELOG.md |
| REL-05 | gemini-cli declared runtime prerequisite (not bundled, not auto-installed) | peerDependencies or explicit note in package.json engines; doc-only for Python |
| REL-06 | Runtime version probe warns on gemini-cli version outside tested range | semver.satisfies() against range from .gemini-cli-compat; process-level cache |
| REL-07 | v1.0.0 tagged only after local smoke-test passes | scripts/local-release-smoke.sh applies pr-artifacts/ bundle, runs one query(), asserts success |
| PLT-01 | TS package works on Windows, macOS, Linux at v1 launch | Verified by existing CI matrix; release workflow must gate on CI green |
| PLT-02 | Python package works on Windows, macOS, Linux at v1 launch | Same CI matrix gate; uv publish runs on ubuntu-latest only |
</phase_requirements>

---

## Summary

Phase 11 is the capstone release phase: build and deploy a documentation site, implement a runtime compatibility probe, and dual-publish the SDK to npm and PyPI. The work divides into three independent streams that can proceed in parallel — (1) docs toolchain setup and content authoring, (2) compat probe implementation, and (3) release pipeline wiring.

The doc site architecture is locked: VitePress is the outer shell serving the full site from GitHub Pages. mkdocs-material builds Python API docs as static HTML independently, then the output is copied into VitePress's `public/python/` directory during CI before VitePress builds. TypeDoc generates TS API reference as Markdown pages that sit inside the VitePress source tree. This pattern requires no iframe or cross-site linking — both sections are served from the same origin.

The release pipelines follow current best practice: changesets for npm versioning/changelogs, uv publish with PyPI OIDC trusted publishing eliminating the need for stored tokens. The existing `VERSION` file and `scripts/sync-version.sh` already handle the single-source-of-truth version requirement. The v1.0.0 gate is a local smoke-test script (not CI) that applies the Phase 10 pr-artifacts bundle to a local Archon fork and exercises one real `query()` call.

**Primary recommendation:** Implement the docs build as a two-stage CI pipeline (mkdocs build → VitePress build) within a single GitHub Actions workflow that also runs the existing CI matrix as a prerequisite before pushing to gh-pages. Wire changesets action for npm and a separate release workflow (triggered by GitHub release creation) for PyPI.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitepress | ^1.6 | Static site generator, outer shell | Locked decision; Vue/Vite-powered, fast, sidebar nav built-in |
| typedoc | ^0.28 | Extract TS docs from source | Industry standard for TypeScript API docs; zero-config with tsconfig.json |
| typedoc-plugin-markdown | ^4.x | Render TypeDoc output as Markdown | Required to feed TypeDoc output into VitePress source tree (not standalone HTML) |
| typedoc-vitepress-theme | ^1.x | Auto-generate VitePress sidebar JSON from TypeDoc | Eliminates manual sidebar config for API reference pages |
| mkdocs-material | ^9.x | Python docs site builder (builds Python section) | Locked decision; polished theme, mkdocstrings integration |
| mkdocstrings[python] | ^0.29 | Auto-generate Python API reference from docstrings | Uses Griffe for AST extraction; supports Google/Numpydoc/Sphinx styles |
| @changesets/cli | ^2.27 | Semver versioning + CHANGELOG.md generation for npm | Standard for pnpm monorepos; integrates with changesets/action |
| @changesets/action | ^1.4 | GitHub Actions bot for release PRs and publishing | Pairs with CLI; opens version-bump PR, publishes on merge |
| semver | ^7.x | Parse and compare version strings in compat probe | Already transitively available via pnpm; authoritative npm semver parser |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uv | >=0.6 | Build and publish Python package to PyPI | Already in CI via astral-sh/setup-uv@v5; use `uv build && uv publish --trusted-publishing always` |
| js-yaml | ^4.x | Load `docs/known-issues.yml` at VitePress build time | Already in devDependencies of ts/; used for rendering known-issues table |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| typedoc-plugin-markdown + typedoc-vitepress-theme | Standalone TypeDoc HTML | Standalone HTML requires iframe or separate subdomain; Markdown integrates cleanly into VitePress nav |
| mkdocs-material (separate build, copy output) | VitePress-only with custom Python API pages | mkdocstrings doesn't have a VitePress equivalent; Python community expects MkDocs-style output |
| changesets | semantic-release | semantic-release is more opinionated about commit message format; changesets integrates with pnpm workspaces and gives explicit per-package control |
| uv publish --trusted-publishing | pypa/gh-action-pypi-publish | uv publish is already in the CI stack (astral-sh/setup-uv@v5 present); avoids adding another third-party action |

### Installation
```bash
# Root docs toolchain
pnpm add -D vitepress typedoc typedoc-plugin-markdown typedoc-vitepress-theme @changesets/cli

# Python docs (in python/ dev dependencies, via uv)
uv add --dev mkdocs-material mkdocstrings[python]

# semver for compat probe (already transitively available, add explicitly)
pnpm add semver
pnpm add -D @types/semver
```

---

## Architecture Patterns

### Recommended Project Structure
```
docs/                          # VitePress root (source)
  .vitepress/
    config.mts                 # VitePress config: imports typedoc-sidebar.json
    theme/                     # Optional custom theme components
  public/
    python/                    # mkdocs-material build output copied here during CI
  ts/
    api/                       # TypeDoc markdown output (generated, git-ignored)
      typedoc-sidebar.json     # Auto-generated sidebar (git-ignored)
    quickstart.md
    migration-claude.md
    migration-codex.md
  python/
    quickstart.md
    migration-claude.md
    migration-codex.md
  compat-matrix.md             # Links to REL-06 probe behavior
  known-issues.md              # Rendered from docs/known-issues.yml via VitePress data loading
  archon-integration.md        # DOC-07: sourced from pr-artifacts content
  index.md                     # Landing page
docs/known-issues.yml          # YAML source of truth for DOC-05
typedoc.json                   # TypeDoc config (points at ts/src/index.ts)
mkdocs.yml                     # MkDocs config (builds python/ section)
.changeset/
  config.json                  # Changesets config: access:public, ignore:[adapter-archon]
scripts/
  local-release-smoke.sh       # REL-07 gate: applies pr-artifacts, runs one query()
  mirror-changelog.sh          # REL-04: copies TS CHANGELOG.md changes to Python
.github/workflows/
  docs.yml                     # Build mkdocs → VitePress → deploy GitHub Pages
  release.yml                  # changesets action: version PR + npm publish
  pypi-publish.yml             # uv publish to PyPI on GitHub release creation
```

### Pattern 1: Two-Stage Docs Build (mkdocs → VitePress)
**What:** mkdocs builds Python API HTML independently, output is copied to `docs/public/python/` before VitePress builds. VitePress serves the complete site including the static Python HTML under `/python/`.
**When to use:** Any time you need to combine two static site generators under one origin without iframes.
**Example:**
```yaml
# .github/workflows/docs.yml (condensed)
# Source: https://vitepress.dev/guide/deploy
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.13" }
      - uses: astral-sh/setup-uv@v5
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with: { version: 9 }
      - name: Install Python docs deps
        run: uv pip install mkdocs-material mkdocstrings[python]
      - name: Build Python docs (mkdocs)
        run: mkdocs build --config-file mkdocs.yml --site-dir docs/public/python
      - name: Install TS deps
        run: pnpm install --frozen-lockfile
      - name: Generate TypeDoc markdown
        run: pnpm typedoc
      - name: Build VitePress
        run: pnpm docs:build
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with: { path: docs/.vitepress/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    permissions:
      pages: write
      id-token: write
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

### Pattern 2: TypeDoc + VitePress Sidebar Integration
**What:** typedoc-vitepress-theme emits `docs/ts/api/typedoc-sidebar.json` which VitePress config imports directly. No manual sidebar maintenance for API reference.
**When to use:** Any TypeScript project using VitePress for docs.
**Example:**
```typescript
// docs/.vitepress/config.mts
// Source: https://typedoc-plugin-markdown.org/plugins/vitepress/quick-start
import { defineConfig } from 'vitepress'
import typedocSidebar from '../ts/api/typedoc-sidebar.json'

export default defineConfig({
  base: '/Gemini-SDK/', // repo name — set to match GitHub Pages URL
  themeConfig: {
    nav: [
      { text: 'TypeScript', link: '/ts/quickstart' },
      { text: 'Python', link: '/python/' },  // serves static HTML from public/python/
    ],
    sidebar: {
      '/ts/api/': typedocSidebar,
      '/ts/': [/* hand-authored TS guides */],
    }
  }
})
```

```json
// typedoc.json
// Source: https://typedoc-plugin-markdown.org/plugins/vitepress/quick-start
{
  "entryPoints": ["ts/src/index.ts"],
  "out": "docs/ts/api",
  "plugin": ["typedoc-plugin-markdown", "typedoc-vitepress-theme"],
  "tsconfig": "ts/tsconfig.json"
}
```

### Pattern 3: Compat Probe — Cached Process-Lifetime Check
**What:** Spawn `gemini --version` once on first `query()` call, compare against the range in `.gemini-cli-compat`, cache result in a module-level variable. Respect `GEMINI_SDK_COMPAT` env var.
**When to use:** Any SDK that wraps a versioned external binary with a tested range.
**Example:**
```typescript
// ts/src/compat.ts
import { execSync } from 'child_process'
import semver from 'semver'
import { readFileSync } from 'fs'
import { resolve } from 'path'

let _checked = false

export function checkCompatOnce(cliPath: string): void {
  if (_checked) return
  _checked = true

  const mode = process.env.GEMINI_SDK_COMPAT ?? 'warn'
  if (mode === 'silent') return

  try {
    const rawVersion = execSync(`"${cliPath}" --version`, { encoding: 'utf-8' }).trim()
    const detected = semver.coerce(rawVersion)?.version
    // .gemini-cli-compat contains the pinned tested version e.g. "0.37.1"
    const pinnedFile = resolve(__dirname, '../../.gemini-cli-compat')
    const pinned = readFileSync(pinnedFile, 'utf-8').trim()
    const range = `~${pinned}` // e.g. ~0.37.1 matches 0.37.x

    if (detected && !semver.satisfies(detected, range)) {
      const msg = `[gemini-sdk] tested against gemini-cli ${pinned}, detected ${detected} — proceeding`
      if (mode === 'strict') throw new Error(msg)
      console.warn(msg)
    }
  } catch (err) {
    if (mode === 'strict') throw err
    // silent on probe failure — binary not found etc. handled elsewhere
  }
}
```

### Pattern 4: Changesets Config for Selective npm Publishing
**What:** The pnpm workspace has two packages — `@gemini-sdk/core` (public) and `@gemini-sdk/adapter-archon` (private). Changesets must publish only `@gemini-sdk/core`. The adapter has `"private": true` in its package.json, which changesets respects automatically.
**When to use:** Monorepo with a mix of publishable and private packages.
**Example:**
```json
// .changeset/config.json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "master",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```
Note: `access: "public"` is required for scoped packages (`@gemini-sdk/core`) — npm defaults to `restricted` for scoped packages. The `adapter-archon` package's `"private": true` in its `package.json` prevents changesets from publishing it regardless of the changeset config.

### Pattern 5: PyPI Trusted Publishing with uv
**What:** No stored API tokens. GitHub Actions requests a short-lived OIDC token from GitHub, which PyPI accepts in exchange for a publish token. Requires one-time setup on PyPI to register the GitHub repo + workflow as a trusted publisher.
**When to use:** Any new PyPI project; preferred over API token approach since March 2024.
**Example:**
```yaml
# .github/workflows/pypi-publish.yml
# Source: https://dump.zech.sh/automate-uv-with-trusted-publisher
name: Publish to PyPI
on:
  release:
    types: [created]
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: release
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: cd python && uv build
      - run: cd python && uv publish --trusted-publishing always
```
PyPI setup (one-time, manual): Go to pypi.org → Account → Publishing → Add pending publisher. Fields: PyPI project name = `gemini-sdk`, GitHub owner = `<username>`, repo = `Gemini-SDK`, workflow filename = `pypi-publish.yml`, environment = `release`.

### Pattern 6: Known-Issues YAML → VitePress Data Loading
**What:** VitePress supports `createContentLoader` for data files. Load `docs/known-issues.yml` in a `.data.ts` loader file, render as a table in `docs/known-issues.md`.
**When to use:** Any doc site content that should be auto-rendered from a structured data source.
**Example:**
```typescript
// docs/known-issues.data.ts
import { readFileSync } from 'fs'
import yaml from 'js-yaml'

export default {
  load() {
    const raw = readFileSync('./docs/known-issues.yml', 'utf-8')
    return yaml.load(raw) as KnownIssue[]
  }
}
```
```markdown
<!-- docs/known-issues.md -->
<script setup>
import { data as issues } from './known-issues.data.ts'
</script>

<table>
  <tr v-for="issue in issues" :key="issue.upstream_issue">
    <td><a :href="`https://github.com/google-gemini/gemini-cli/issues/${issue.upstream_issue.replace('#','')}`">{{ issue.upstream_issue }}</a></td>
    <td>{{ issue.title }}</td>
    <td>{{ issue.sdk_defense }}</td>
    <td>{{ issue.status }}</td>
  </tr>
</table>
```

### Pattern 7: CHANGELOG Mirror Script (REL-04)
**What:** changesets generates/updates `CHANGELOG.md` at the repo root. A small script copies the latest-version section into `python/CHANGELOG.md`, replacing the existing entry for the same version.
**When to use:** Polyglot repo where both packages share a version number and the same release notes are semantically correct for both.
**Approach:** Keep it simple — `scripts/mirror-changelog.sh` reads the top section from root `CHANGELOG.md` (from `## 1.0.0` to next `## ` line) and prepends it to `python/CHANGELOG.md`. Python release notes in PyPI are sourced from this file via `[project] readme = "CHANGELOG.md"` or as release description.

### Anti-Patterns to Avoid
- **Separate GitHub Pages sites for TS and Python docs:** Two deploy pipelines, two URLs, broken cross-links. Use single VitePress site with Python section as static HTML in `public/`.
- **Storing PyPI API token as GitHub secret:** Use trusted publishing (OIDC). API tokens are long-lived and revocation requires manual action.
- **Storing npm token as GitHub secret for scoped packages:** npm now supports OIDC trusted publishing for specific workflow files (npm >= 11.5). Preferred over long-lived `NPM_TOKEN`. However, changesets/action currently requires `NPM_TOKEN` — use that until changesets adds OIDC support.
- **Running compat probe on every `query()` call:** Parse `gemini --version` once and cache in a module-level variable; repeated spawning adds 50–200ms latency.
- **Publishing adapter-archon to npm:** It has `"private": true` and is Archon-specific. changesets respects `private: true` and skips it automatically.
- **Committing TypeDoc output and mkdocs output to git:** Both should be generated artifacts. Add `docs/ts/api/` and `docs/public/python/` to `.gitignore`. Generate in CI only.
- **Using `rc1.0.0` or `0.9.0` tags:** User explicitly deferred pre-release flow. Tag directly to `v1.0.0` after smoke test passes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript API reference | Custom markdown generator | typedoc + typedoc-plugin-markdown + typedoc-vitepress-theme | TypeDoc handles JSDoc, @deprecated, @experimental, type unions, generics correctly; manual generators miss edge cases |
| Python API reference | Jinja2 templates from AST | mkdocstrings[python] (uses Griffe) | Griffe handles type annotations, overloads, dataclasses, PEP 695 aliases; battle-tested on FastAPI/Pydantic |
| Semver range matching | String comparison or regex | `semver` npm package + Python `packaging.version` | Semver edge cases (prerelease ordering, coercion) are non-trivial; npm's semver is the reference implementation |
| npm version bump + CHANGELOG | Custom release script | changesets | changesets handles linked packages, commit message, git tags, and the release PR flow atomically |
| PyPI upload with short-lived tokens | Custom OIDC token exchange | `uv publish --trusted-publishing always` | OIDC exchange protocol requires specific JWT claims; uv handles the exchange correctly against PyPI's implementation |
| Sorting known-issues table | Custom sort logic | Vue `v-for` + data computed property | Trivial with VitePress's Vue data loading; no custom sort infrastructure needed |

**Key insight:** Every "infrastructure" problem in this phase (API reference extraction, semver comparison, publish authentication) has a canonical solution that handles edge cases that manual implementations routinely miss. The implementation work is configuration, not coding.

---

## Common Pitfalls

### Pitfall 1: VitePress base Path Misconfiguration
**What goes wrong:** Links to assets and navigation break on GitHub Pages because assets are served at `/{repo-name}/` not `/`.
**Why it happens:** GitHub Pages project pages are served at `https://<user>.github.io/<repo>/`; VitePress defaults `base` to `/`.
**How to avoid:** Set `base: '/Gemini-SDK/'` (exact repo name, case-sensitive) in `docs/.vitepress/config.mts`. The GitHub Pages workflow also requires `pages: write` and `id-token: write` permissions and a repository setting of "Source: GitHub Actions".
**Warning signs:** Images and CSS 404 in deployed site but work locally.

### Pitfall 2: Python Section 404 on Static HTML Subpaths
**What goes wrong:** Navigating directly to `/python/some-page/` returns 404 because GitHub Pages doesn't know to serve the mkdocs-generated index.html.
**Why it happens:** mkdocs-material generates clean URLs by placing content in `some-page/index.html`. GitHub Pages serves these correctly only if the path is accessed with a trailing slash.
**How to avoid:** mkdocs-material generates a 404.html; include it in the VitePress public directory copy so GitHub Pages uses it as the error page. Alternatively, configure mkdocs with `use_directory_urls: true` (default) and ensure internal links from VitePress to the Python section use the exact mkdocs-generated paths.
**Warning signs:** Direct navigation to Python API reference pages 404s; navigating from VitePress nav works.

### Pitfall 3: changesets Publishes adapter-archon
**What goes wrong:** `changeset publish` attempts to publish `@gemini-sdk/adapter-archon` to npm and fails (or worse, succeeds if the package name is available).
**Why it happens:** If `"private": true` is not set in `adapter-archon/package.json`, changesets treats it as publishable.
**How to avoid:** `adapter-archon/package.json` already has `"private": true`. Verify this before running `changeset publish`. Add a CI check: `node -e "const p = require('./adapter-archon/package.json'); if (!p.private) process.exit(1)"`.
**Warning signs:** `changeset status` shows adapter-archon as a publishable package.

### Pitfall 4: Compat Probe on Cached gemini-cli Path
**What goes wrong:** The compat probe spawns `gemini --version` using a bare binary name, but in some environments (Windows, custom installs) the binary is only findable via the path that the BinaryResolver already resolved.
**Why it happens:** `execSync('gemini --version')` relies on PATH; if user passed an explicit `cliPath` option, the probe should use that same resolved path.
**How to avoid:** `checkCompatOnce(cliPath: string)` takes the already-resolved binary path from the BinaryResolver. Call it from inside `query()` after BinaryResolver resolves the path, before spawning the actual query process.
**Warning signs:** Probe works in dev but silently skips in environments where gemini is not on PATH (e.g. installed to `~/.local/bin` with a `GEMINI_BIN_PATH` override).

### Pitfall 5: PyPI Package Name Already Taken
**What goes wrong:** `uv publish` fails with "403 Package 'gemini-sdk' already exists and belongs to another user."
**Why it happens:** `gemini-sdk` is a plausible name that may already be registered on PyPI.
**How to avoid:** Check https://pypi.org/project/gemini-sdk/ before the publish workflow runs. If taken, alternative: `gemini-cli-sdk` or a scoped equivalent. The PyPI "pending publisher" setup for trusted publishing actually registers the name atomically with the first publish — verify the name is available first.
**Warning signs:** uv publish fails on first run with 403 or 409 status.

### Pitfall 6: TypeDoc Sidebar JSON Not Git-Ignored Causes Merge Conflicts
**What goes wrong:** `docs/ts/api/typedoc-sidebar.json` is generated on every `pnpm typedoc` run. If committed, every doc build creates a new commit, causing noise and merge conflicts.
**Why it happens:** `typedoc-vitepress-theme` regenerates the sidebar file on every run.
**How to avoid:** Add `docs/ts/api/` to `.gitignore`. Generate it in CI as part of the build step. VitePress config imports it at build time via `import typedocSidebar from '../ts/api/typedoc-sidebar.json'` — this works in CI where the file is generated, and locally when developers run `pnpm typedoc` first.
**Warning signs:** `git status` shows `docs/ts/api/typedoc-sidebar.json` modified after every docs build.

### Pitfall 7: VERSION File Drift at Tag Time
**What goes wrong:** `VERSION` file says `1.0.0` but `ts/package.json` and `python/pyproject.toml` still say `0.0.0` because `sync-version.sh` was not run.
**Why it happens:** The version-sync CI job catches drift on PR merge but doesn't run the sync automatically.
**How to avoid:** The release workflow should run `bash scripts/sync-version.sh` as the first step before running `changeset version`. The existing `version-sync` CI job will catch any remaining drift.
**Warning signs:** `changeset publish` tags `@gemini-sdk/core@0.0.0` instead of `@gemini-sdk/core@1.0.0`.

### Pitfall 8: Smoke Test Script Windows Path Handling
**What goes wrong:** `scripts/local-release-smoke.sh` uses Unix paths for the Archon clone location; user runs it on Windows with Git Bash.
**Why it happens:** Phase 10 precedent: Windows path handling requires careful attention (see `[Phase 01]` and `[Phase 02]` decisions in STATE.md).
**How to avoid:** Follow the same pattern as `scripts/lint-env-namespace.sh` — bash script that uses `$(pwd)` and relative paths. Accept an optional `ARCHON_DIR` env var override for the Archon checkout location. Document the Windows Git Bash requirement in the script header.
**Warning signs:** Script exits with "No such file or directory" on Windows even when Archon directory exists.

---

## Code Examples

Verified patterns from official sources:

### VitePress GitHub Pages Deploy Workflow (minimal)
```yaml
# Source: https://vitepress.dev/guide/deploy
name: Deploy Docs

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: actions/setup-python@v5
        with: { python-version: "3.13" }
      - uses: astral-sh/setup-uv@v5
      - uses: actions/configure-pages@v4
      - name: Install Python docs deps
        run: uv pip install mkdocs-material "mkdocstrings[python]"
      - name: Build Python docs
        run: mkdocs build --config-file mkdocs.yml --site-dir docs/public/python
      - name: Install TS deps
        run: pnpm install --frozen-lockfile
      - name: Generate TypeDoc
        run: pnpm run docs:typedoc
      - name: Build VitePress
        run: pnpm run docs:build
        env:
          NODE_OPTIONS: --max_old_space_size=4096
      - uses: actions/upload-pages-artifact@v3
        with: { path: docs/.vitepress/dist }
  deploy:
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

### changesets Release Workflow
```yaml
# Source: https://github.com/changesets/action
name: Release (npm)

on:
  push:
    branches: [master]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm, registry-url: "https://registry.npmjs.org" }
      - run: pnpm install --frozen-lockfile
      - uses: changesets/action@v1
        with:
          publish: pnpm run ci:publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
The `ci:publish` script in root `package.json`:
```json
{
  "scripts": {
    "ci:publish": "bash scripts/sync-version.sh && changeset publish"
  }
}
```

### Known-Issues YAML Schema (exact)
```yaml
# docs/known-issues.yml
# Schema: {upstream_issue, title, sdk_defense, status: open|fixed}
- upstream_issue: "#14180"
  title: "--resume + -p interop broken in some gemini-cli versions"
  sdk_defense: "Transcript-prepend fallback in Session + ArgvBuilder (SES-04)"
  status: open
- upstream_issue: "#13388"
  title: "No native JSON schema enforcement in output"
  sdk_defense: "Best-effort schema injection + Zod/Pydantic retry (OUT-01..04); marked @experimental"
  status: open
- upstream_issue: "#3485"
  title: "MCP server config format drift across versions"
  sdk_defense: "Isolated temp GEMINI_CONFIG_DIR per query; no mutation of user settings"
  status: open
- upstream_issue: "#22970"
  title: "OAuth ToS risk in headless/SDK contexts"
  sdk_defense: "GEMINI_API_KEY canonical default; OAuth auto-login explicitly forbidden (AUT-05)"
  status: open
- upstream_issue: "#4945"
  title: "Encoding issues in non-UTF-8 environments"
  sdk_defense: "Force UTF-8 at spawn; decode with replacement (FDN-04)"
  status: open
```

### mkdocs.yml (Python section)
```yaml
# mkdocs.yml (repo root)
site_name: Gemini SDK — Python
docs_dir: docs-python        # Source .md files for python section
site_dir: docs/public/python # Output merged into VitePress public/

theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - content.code.copy

plugins:
  - search
  - mkdocstrings:
      handlers:
        python:
          paths: [python/src]
          options:
            docstring_style: google
            show_source: true
            show_signature_annotations: true
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| npm API tokens in GitHub secrets | npm OIDC trusted publishing (npm >= 11.5) | 2024–2025 | Short-lived tokens; changesets/action still needs NPM_TOKEN for now |
| PyPI API tokens | PyPI trusted publishing (OIDC via pypa/gh-action-pypi-publish or uv publish) | 2023 (generally available 2024) | No stored token; automatic expiry |
| TypeDoc HTML output embedded via iframe | typedoc-plugin-markdown + VitePress theme | 2023+ | Native VitePress pages; same nav, same search index |
| Separate doc sites per language | Single origin, two build tools feeding one deploy | 2024+ | One URL, one deploy, cross-links work |
| lerna for monorepo versioning | changesets | 2020+ | Per-package changelogs, better pnpm integration |

**Deprecated/outdated:**
- `twine upload` for PyPI: Still works but uv publish is the uv-ecosystem standard and handles OIDC natively.
- `npm version` + manual CHANGELOG: Replaced by changesets for any project with a CHANGELOG requirement.

---

## Open Questions

1. **npm Package Name: `@gemini-sdk/core` vs unscoped `gemini-sdk`**
   - What we know: Current `ts/package.json` uses `@gemini-sdk/core` (scoped). Scoped packages require `access: "public"` to publish publicly.
   - What's unclear: Whether user wants to publish under a personal npm scope (e.g. `@seanrw/gemini-sdk`) or an org scope. CONTEXT.md marks this as "Claude's discretion".
   - Recommendation: Use `@gemini-sdk/core` as-is (already in package.json). Set `access: "public"` in `.changeset/config.json`. Scoped public packages are standard for SDK libraries.

2. **PyPI Package Name Availability**
   - What we know: `python/pyproject.toml` uses `name = "gemini-sdk"`. This is an unscoped PyPI name.
   - What's unclear: Whether `gemini-sdk` is already taken on PyPI. PyPI has no scoping.
   - Recommendation: Verify `https://pypi.org/project/gemini-sdk/` before planning the publish workflow. If taken, use `gemini-cli-sdk` as fallback. Plan task should include a "verify PyPI name" step as Task 1 gate.

3. **`.gemini-cli-compat` version range format**
   - What we know: File contains `0.37.1` (a point version). The compat probe needs a range (e.g. `~0.37.1` = 0.37.x, or `>=0.37.1 <0.39.0`).
   - What's unclear: How broad the tested range should be. The file currently contains only the pinned capture version.
   - Recommendation: Keep the file as a single pinned version (the "lower bound of tested range"). The probe derives the range as `~{pinned}` (patch-compatible). When future captures add a new pinned version, update the file. Keep it simple — one version = "this is what we tested against".

4. **GitHub Pages URL / base path**
   - What we know: VitePress requires `base` to match the deployment URL. For project pages, it's `/<repo-name>/`.
   - What's unclear: The exact GitHub repo name used for the deployment URL. It's likely `Gemini-SDK` (the current directory name) but may differ.
   - Recommendation: Planner should note: derive `base` from `GITHUB_REPOSITORY` env var in the VitePress build step, or hardcode `/Gemini-SDK/` and document that it must be updated if the repo is renamed/transferred.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (TS) | vitest ^3.2 |
| Framework (Python) | pytest >= 8.0 |
| Config file (TS) | `ts/vitest.config.ts` |
| Config file (Python) | `python/pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command (TS) | `cd ts && pnpm test` |
| Quick run command (Python) | `cd python && uv run pytest --tb=short` |
| Full suite command | `cd ts && pnpm test && cd ../python && uv run pytest --tb=short` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-06 | `checkCompatOnce()` warns to stderr when version outside range | unit | `cd ts && pnpm test -- --reporter=verbose ts/src/compat.spec.ts` | ❌ Wave 0 |
| REL-06 | `checkCompatOnce()` throws when `GEMINI_SDK_COMPAT=strict` | unit | same file | ❌ Wave 0 |
| REL-06 | `checkCompatOnce()` suppresses when `GEMINI_SDK_COMPAT=silent` | unit | same file | ❌ Wave 0 |
| REL-06 | Python equiv: `check_compat_once()` warn/strict/silent | unit | `cd python && uv run pytest tests/test_compat.py -x` | ❌ Wave 0 |
| REL-05 | `gemini-cli` not in dependencies (peerDependencies or absent) | static | `node -e "const p=require('./ts/package.json'); if(p.dependencies?.['@google/gemini-cli']) process.exit(1)"` | n/a — CI assertion |
| PLT-01 | TS package installable and `query()` importable on all platforms | smoke | existing CI matrix | ✅ (CI matrix) |
| PLT-02 | Python package installable and `query()` importable on all platforms | smoke | existing CI matrix | ✅ (CI matrix) |
| DOC-01 | VitePress builds without error | build | `pnpm docs:build` (exits 0) | ❌ Wave 0 |
| DOC-03 | TypeDoc generates API markdown without type errors | build | `pnpm typedoc` (exits 0) | ❌ Wave 0 |
| REL-03 | MIT LICENSE file exists at repo root | file-exists | `test -f LICENSE` | ❌ Wave 0 |
| REL-07 | local-release-smoke.sh exits 0 after applying pr-artifacts | smoke (local only) | `bash scripts/local-release-smoke.sh` | ❌ Wave 0 |

DOC-02, DOC-04 (compat matrix page), DOC-05, DOC-06, DOC-07: Manual-only — content quality is not automatable; correct rendering is validated visually in the deployed doc site.

REL-01, REL-02, REL-04: Manual-only — npm/PyPI publish workflows verified by dry-run (`--dry-run` flag for changeset publish; `uv publish --dry-run`) and by observing release PR creation.

### Sampling Rate
- **Per task commit:** `cd ts && pnpm test` (TS unit tests including new compat.spec.ts)
- **Per wave merge:** `cd ts && pnpm test && cd ../python && uv run pytest --tb=short`
- **Phase gate:** Full suite green + VitePress build exits 0 + TypeDoc exits 0 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `ts/src/compat.ts` — compat probe implementation (REL-06)
- [ ] `ts/src/compat.spec.ts` — unit tests for warn/strict/silent modes + cache behavior
- [ ] `python/src/gemini_sdk/compat.py` — Python compat probe equivalent
- [ ] `python/tests/test_compat.py` — Python unit tests for compat probe
- [ ] `docs/` VitePress scaffolding — `docs/.vitepress/config.mts`, `docs/index.md`
- [ ] `typedoc.json` — TypeDoc config pointing at `ts/src/index.ts`
- [ ] `mkdocs.yml` — MkDocs config for Python section
- [ ] `.changeset/config.json` — `pnpm changeset init` output
- [ ] `LICENSE` — MIT license text at repo root
- [ ] `scripts/local-release-smoke.sh` — REL-07 gate script
- [ ] `.github/workflows/docs.yml` — docs build + GitHub Pages deploy
- [ ] `.github/workflows/release.yml` — changesets action for npm
- [ ] `.github/workflows/pypi-publish.yml` — uv publish for PyPI

---

## Sources

### Primary (HIGH confidence)
- [VitePress Deploy Guide](https://vitepress.dev/guide/deploy) — GitHub Pages workflow, base config, artifact upload steps
- [typedoc-vitepress-theme Quick Start](https://typedoc-plugin-markdown.org/plugins/vitepress/quick-start) — typedoc.json config, VitePress sidebar import pattern
- [mkdocstrings Python Overview](https://mkdocstrings.github.io/python/) — Python handler configuration, Griffe-based extraction
- [changesets config-file-options](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md) — access field, ignore field, private package behavior
- [PyPI Trusted Publishers](https://docs.pypi.org/trusted-publishers/) — OIDC setup, pending publisher workflow
- [uv publish + trusted publisher](https://dump.zech.sh/automate-uv-with-trusted-publisher) — Complete GitHub Actions workflow YAML

### Secondary (MEDIUM confidence)
- [pnpm + changesets guide](https://pnpm.io/using-changesets) — pnpm workspace changesets integration
- [changesets/action README](https://github.com/changesets/action) — release workflow structure

### Tertiary (LOW confidence)
- [VitePress + MkDocs two-stage pattern] — derived from VitePress public directory documentation + MkDocs site-dir option; no single authoritative source for this exact combined pattern. LOW confidence on exact mkdocs.yml `site_dir` target path — verify against mkdocs-material behavior.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified against official docs and Context7-adjacent sources
- Architecture: HIGH — VitePress/mkdocs pattern is standard; changesets/uv patterns verified against official docs
- Pitfalls: MEDIUM — base path and Python 404 pitfalls are well-documented; npm name/PyPI name availability is runtime-uncertain
- Validation architecture: HIGH — test framework and existing test file paths verified against actual repo structure

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days; stable toolchain)
