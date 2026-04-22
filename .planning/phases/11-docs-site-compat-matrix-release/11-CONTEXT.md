# Phase 11: Docs Site + Compat Matrix + Release - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Publish the public documentation site, ship the runtime compat probe, dual-publish the SDK to npm + PyPI, and tag v1.0.0. Covers DOC-01..07, REL-01..07, PLT-01..02. This is a **public** SDK release — npm + PyPI are the real distribution channels.

</domain>

<decisions>
## Implementation Decisions

### Release target
- **Public SDK.** npm publish + PyPI publish are real deliverables (not local-artifact-only).
- User's earlier "keep local" direction applied to Archon integration ONLY — the SDK itself ships publicly.

### v1.0.0 release gate (REL-07 reframed)
- **Original REL-07 text is obsolete** — the Archon PR is not being opened upstream per user direction from Phase 10.
- **New gate:** Tag `v1.0.0` only after the `pr-artifacts/` bundle is applied to the user's local Archon fork, `DEFAULT_AI_ASSISTANT=gemini` is set, and one real end-to-end `query()` succeeds.
- **Delivery mechanism:** Ship `scripts/local-release-smoke.sh` (or equivalent documented manual steps) that applies the bundle to a local Archon checkout, runs one query, asserts success. Script passing is the tag gate. Runs locally, not in CI.
- **Intent preserved:** The original REL-07 existed to prove the SDK works end-to-end through a real consumer before cutting 1.0 — local smoke test delivers the same guarantee without upstream dependency.

### Doc site destination & structure (DOC-01)
- **Single combined site on GitHub Pages.** One URL, one deploy pipeline.
- VitePress is the shell; sections at `/ts/` and `/python/`.
- mkdocs-material builds its output into `/python/` as static HTML (not a separate site).
- Zero hosting cost, no external account sprawl (Vercel/Netlify explicitly rejected).

### Compat probe behavior (REL-06, DOC-04)
- **Default:** Warn to stderr when detected `gemini-cli` version is outside tested range. Format: `[gemini-sdk] tested against gemini-cli 0.37.x–0.Y.z, detected 0.Z.z — proceeding`.
- **Override env var:** `GEMINI_SDK_COMPAT`
  - `strict` → throw instead of warn
  - `silent` → suppress warning entirely
  - unset or any other value → default warn behavior
- **Probe location:** Runs once on first `query()` invocation (cached for process lifetime), not per-call.

### Migration guide scope (DOC-06)
- **Cover both Claude Agent SDK AND Codex SDK**, short-form (one page per source SDK).
- Per-page focus: map the top ~5 call-site patterns — (1) construct client, (2) send query, (3) stream chunks, (4) tool use, (5) session resume.
- **Not** a comprehensive API cross-reference — that rots fast and nobody reads it.

### Known-issues appendix (DOC-05)
- **Live GitHub links in doc site appendix**, auto-generated from a YAML source of truth.
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Documentation — DOC-01..07
- `.planning/REQUIREMENTS.md` §Release & Publishing — REL-01..07
- `.planning/REQUIREMENTS.md` §Cross-Platform — PLT-01, PLT-02 (v1 launch gates)

### Phase spec
- `.planning/ROADMAP.md` §"Phase 11: Docs Site + Compat Matrix + Release" — success criteria, goal statement

### Predecessor artifacts (consumed by this phase)
- `.planning/phases/10-archon-adapter-ts-only/pr-artifacts/` — bundle applied during local smoke test (REL-07 new gate)
- `.planning/phases/10-archon-adapter-ts-only/pr-artifacts/PR_BODY.md` — source material for Archon integration guide (DOC-07)
- `.archon-compat` — pinned Archon SHA the adapter was verified against
- `.gemini-cli-compat` — pinned gemini-cli version, source of the "tested range" shipped by the compat probe
- `spec/events.schema.json`, `spec/protocol.md`, `spec/errors.md` — source material for API reference + known-issues context

### Prior project-level decisions carried forward
- `C:/Users/seanr/.claude/projects/D--repos-Gemini-SDK/memory/project_archon_integration_local_only.md` — no upstream PRs to coleam00/Archon (this is why REL-07 was reframed)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/lint-env-namespace.sh` — precedent for shell-based CI guardrails; the local smoke-test script can follow the same pattern (small bash script + self-test)
- `.github/workflows/archon-contract.yml`, `.github/workflows/archon-drift.yml` — established pattern for release-adjacent CI workflows; doc-deploy workflow should follow the same shape
- `adapter-archon/` is standalone-testable with 29/29 vitest — gives the local smoke test something concrete to exercise end-to-end
- `pr-artifacts/README.md` already documents the apply sequence — the smoke-test script just needs to automate what the README describes

### Established Patterns
- Polyglot monorepo: `ts/` + `python/` + `adapter-archon/` — doc site needs to stitch API ref from both without forcing one language's tooling onto the other
- Pinned SHA/version compat files (`.archon-compat`, `.gemini-cli-compat`) — compat probe reads the same source of truth the release process pins against (single source, no drift)
- CI matrix `{ubuntu, macos, windows} × {node 18/20/22} × {python 3.10–3.13}` with Windows required — publishing workflow must green on this matrix before tagging

### Integration Points
- `ts/package.json` — changesets config goes here; dual-package publish config lives here
- `python/pyproject.toml` — PyPI metadata, trusted-publishing OIDC config
- `.github/workflows/` — new workflows for doc deploy (GitHub Pages) + release (npm + PyPI via OIDC)
- `docs/` directory needs to be created — doesn't exist yet; VitePress + mkdocs-material scaffolding is greenfield
- Root `LICENSE` file (MIT) — doesn't exist yet (REL-03)
- `CHANGELOG.md` — changesets will generate; mirror script into Python release notes (REL-04)

</code_context>

<specifics>
## Specific Ideas

- Compat warning format (explicit): `[gemini-sdk] tested against gemini-cli 0.37.x–0.Y.z, detected 0.Z.z — proceeding` — set `GEMINI_SDK_COMPAT=strict` to fail hard, `=silent` to suppress.
- Known-issues YAML schema (explicit): `{upstream_issue, title, sdk_defense, status: open|fixed}`.
- Doc site URL: single combined site on GitHub Pages (project pages under whatever repo slug ends up canonical).

</specifics>

<deferred>
## Deferred Ideas

- Full API cross-reference tables (Claude SDK ↔ Gemini SDK, Codex SDK ↔ Gemini SDK) — rejected as part of this phase; high-value patterns only. Full cross-ref would be a follow-up phase if adoption demands it.
- RC / beta release flow (0.9.0, 1.0.0-rc.1) — considered and rejected; straight to 1.0.0 when the local smoke-test gate passes.
- Publishing under a personal npm scope vs `@gemini-sdk/*` — left as Claude's discretion during planning; no signal from user either way.

</deferred>

---

*Phase: 11-docs-site-compat-matrix-release*
*Context gathered: 2026-04-22*
