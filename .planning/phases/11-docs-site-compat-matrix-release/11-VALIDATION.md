---
phase: 11
slug: docs-site-compat-matrix-release
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | vitest ^3.2 |
| **Framework (Python)** | pytest >= 8.0 |
| **Config file (TS)** | `ts/vitest.config.ts` |
| **Config file (Python)** | `python/pyproject.toml` `[tool.pytest.ini_options]` |
| **Quick run command (TS)** | `cd ts && pnpm test` |
| **Quick run command (Python)** | `cd python && uv run pytest --tb=short` |
| **Full suite command** | `cd ts && pnpm test && cd ../python && uv run pytest --tb=short` |
| **Docs build command** | `cd docs && pnpm docs:build` + `cd python && uv run mkdocs build --strict` |
| **TypeDoc command** | `cd ts && pnpm typedoc` |
| **Estimated runtime** | ~90 seconds (unit) + ~60 seconds (docs builds) |

---

## Sampling Rate

- **After every task commit:** Run `cd ts && pnpm test` (fastest gate — catches compat probe regressions)
- **After every plan wave:** Run full suite + `pnpm docs:build` + `pnpm typedoc`
- **Before `/gsd:verify-work`:** Full suite green, both docs builds exit 0, TypeDoc exits 0
- **Max feedback latency:** 90 seconds (unit); 180 seconds (with docs build)

---

## Per-Task Verification Map

> Populated by the planner once plans are written. Each automated task gets a row; manual-only tasks go in the Manual-Only table below.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD-01 | TBD | 0 | REL-06 | unit | `cd ts && pnpm test -- ts/src/compat.spec.ts` | ❌ W0 | ⬜ pending |
| TBD-02 | TBD | 0 | REL-06 | unit | `cd python && uv run pytest tests/test_compat.py -x` | ❌ W0 | ⬜ pending |
| TBD-03 | TBD | 0 | DOC-01 | build | `cd docs && pnpm docs:build` | ❌ W0 | ⬜ pending |
| TBD-04 | TBD | 0 | DOC-03 | build | `cd ts && pnpm typedoc` | ❌ W0 | ⬜ pending |
| TBD-05 | TBD | 0 | REL-03 | file-exists | `test -f LICENSE` | ❌ W0 | ⬜ pending |
| TBD-06 | TBD | 0 | REL-05 | static | `node -e "const p=require('./ts/package.json'); if(p.dependencies?.['@google/gemini-cli']) process.exit(1)"` | n/a | ⬜ pending |
| TBD-07 | TBD | 0 | REL-07 | smoke | `bash scripts/local-release-smoke.sh` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `ts/src/compat.ts` — compat probe implementation (REL-06)
- [ ] `ts/src/compat.spec.ts` — vitest suite: warn/strict/silent modes + cache behavior
- [ ] `python/src/gemini_sdk/compat.py` — Python compat probe equivalent
- [ ] `python/tests/test_compat.py` — pytest suite mirroring TS cases
- [ ] `docs/.vitepress/config.mts` + `docs/index.md` — VitePress scaffolding
- [ ] `typedoc.json` — TypeDoc config targeting `ts/src/index.ts`
- [ ] `mkdocs.yml` + `python/docs/` — MkDocs config for Python section
- [ ] `.changeset/config.json` — `pnpm changeset init` output with `"access": "public"`
- [ ] `LICENSE` — MIT license text at repo root
- [ ] `scripts/local-release-smoke.sh` — REL-07 pre-release gate
- [ ] `.github/workflows/docs.yml` — docs build + GitHub Pages deploy
- [ ] `.github/workflows/release.yml` — changesets action for npm
- [ ] `.github/workflows/pypi-publish.yml` — `uv publish` with trusted publishing

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Quickstart flow completes end-to-end in <15 min on Win/mac/Linux | DOC-02 | Content quality + human workflow timing | Fresh VM per OS → follow quickstart verbatim → time to first successful `query()` |
| Compat matrix page lists tested `gemini-cli` range and upstream issue links | DOC-04 | Content correctness is visual | Deploy preview → verify issue numbers #14180, #13388, #3485, #22970, #4945 render as links |
| Migration guide translates Claude Agent SDK / Codex SDK call sites | DOC-05 | Narrative quality | Peer review against sample Claude/Codex snippets |
| Archon integration guide matches Phase-10 adapter shape | DOC-06 | Cross-phase narrative | Cross-check against `ts/packages/adapter-archon/` exports |
| Known-issues appendix links live upstream bugs | DOC-07 | External link validity | Click each link; ensure non-404 |
| npm publish succeeds and `npm install @gemini-sdk/core` works | REL-01, PLT-01 | Registry state is external | Post-publish: fresh VM → `npm i @gemini-sdk/core` → import smoke |
| PyPI publish succeeds and `uv add gemini-sdk` works | REL-02, PLT-02 | Registry state is external | Post-publish: fresh VM → `uv add gemini-sdk` → import smoke |
| `v1.0.0` tag cut **after** Phase-10 Archon PR merges | REL-04 | Ordering gate (external GitHub state) | `gh pr view <archon-pr> --json state` == `MERGED` BEFORE `git tag v1.0.0` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s (unit) / < 180s (with docs build)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
