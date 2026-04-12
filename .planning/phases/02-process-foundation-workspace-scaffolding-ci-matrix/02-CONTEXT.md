# Phase 2: Process Foundation + Workspace Scaffolding + CI Matrix - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the polyglot monorepo (TS + Python packages), implement the core subprocess infrastructure (`BinaryResolver` + `ProcessManager` + `EnvBuilder` behind a pluggable `ProcessStrategy` interface), and wire up the `{ubuntu, macos, windows} x {node, python}` CI matrix with a non-en-US Windows runner. This phase ships the first real SDK code but it is all internal plumbing — no public API surface yet (that's Phase 4). Deliverables: working `ts/` and `python/` packages that can spawn `gemini --version` on all three OSes, kill subprocess trees cleanly, and pass a representative CI matrix.

</domain>

<decisions>
## Implementation Decisions

### Monorepo layout + tooling
- **Directory layout:** `ts/` + `python/` + `spec/` + `adapter-archon/` at repo root, with `scripts/` (Phase 1 capture tools) alongside
- **TS package manager:** pnpm with workspace config
- **Python package manager:** uv (virtualenvs + lockfiles + publishing)
- **Shared version source:** Root `VERSION` file (plain text, e.g. `1.0.0`). Both `ts/package.json` and `python/pyproject.toml` read from it at build/publish time via a pre-publish sync script or CI step
- **adapter-archon/:** Lives at repo root as its own TS package (not nested inside `ts/`), has its own `package.json`

### ProcessStrategy interface
- **Visibility:** Public but documented as advanced/escape-hatch. Export the interface so power users can swap in a mock for testing or a custom strategy for non-standard environments. Mirrors Claude Agent SDK's exported `SubprocessCLITransport` pattern.
- **Granularity:** Single `spawn(argv, env, options) -> ChildProcess` method. `BinaryResolver` and `EnvBuilder` are separate utilities consumed by the strategy, not part of the interface. `ProcessManager` owns kill/cleanup lifecycle uniformly regardless of strategy. This mirrors both Claude Agent SDK and Codex SDK patterns.
- **BinaryResolver:** PATH-only + `GEMINI_BIN_PATH` override. No platform-specific guessing of install locations. If binary isn't found, throw `GeminiNotFoundError` with a helpful message. Simple, predictable, matches Archon's Codex pattern.
- **EnvBuilder:** Opaque with merge option. Builds a clean env dict internally via allowlist (mirrors Archon's `buildCleanSubprocessEnv`). Users can pass `options.env` to merge additional vars. Allowlist is an implementation detail, not configurable.

### CI matrix
- **Matrix strategy:** Representative subset (~12 jobs), not full cross-product (36). Each OS gets latest Node + Python; oldest supported versions tested on one OS; Windows non-en-US locale job. Can expand later if gaps surface.
- **Non-en-US locale:** Japanese (ja-JP) — CJK with Shift_JIS legacy codepage, most aggressive UTF-8 stress test. If it works with Japanese Windows, it works everywhere.
- **Parity enforcement:** Block merge on divergence (PAR-03). `scripts/diff-test-names.sh` enforced from day one.
- **Runner:** `windows-latest` (standard GitHub-hosted). Sufficient for subprocess + encoding tests.

### Test framework + parity
- **TS test framework:** Vitest — native ESM, fast, built-in coverage, pnpm-workspace compatible
- **Python test framework:** pytest (standard)
- **Parity enforcement method:** Match test descriptions. Extract `test('description')` from TS and test function names/docstrings from Python, diff sorted lists. Tests must use matching human-readable names, not matching file paths.
- **Fixture consumption:** Relative paths from test files (e.g. `../../spec/fixtures/*.ndjson`). No symlinks (fragile on Windows), no copies (stale risk). CI checks out the full repo.
- **VERSION consumption:** Build-time injection. Pre-publish script or CI step syncs `VERSION` into `ts/package.json` and `python/pyproject.toml`. Source of truth is always the root file.

### Claude's Discretion
- Exact pnpm workspace config and root `pnpm-workspace.yaml` structure
- pytest config details (markers, fixtures, conftest patterns)
- Vitest config (coverage thresholds, test file patterns)
- EnvBuilder allowlist contents (derive from Archon's `buildCleanSubprocessEnv` + gemini-cli needs)
- CI job naming, caching strategy, artifact handling
- ProcessManager kill semantics implementation details (SIGTERM grace window, taskkill flags, orphan detection approach)
- `diff-test-names.sh` exact parsing and diff algorithm

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Process foundation
- `spec/protocol.md` -- Wire protocol spec with fixture citations; defines event types ProcessManager will encounter
- `spec/errors.md` -- Error patterns; defines the stderr/exit-code signals ProcessManager must surface
- `spec/feasibility.md` -- Feasibility verdicts (resume=pass, config_dir=pass, flush=partial); flush=partial affects Phase 4's forcePty default but ProcessManager must handle PTY vs pipe stdout
- `.gemini-cli-compat` -- Pinned gemini-cli version (0.37.1); BinaryResolver version probe compares against this

### Archon reference patterns
- `https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts` -- `IAssistantClient`, `MessageChunk` definitions; adapter-archon/ must implement this interface
- `https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/claude.ts` -- Reference subprocess wrapping; `buildCleanSubprocessEnv` pattern that EnvBuilder mirrors

### Claude Agent SDK (transport pattern reference)
- `https://github.com/anthropics/claude-agent-sdk-python` -- `_internal/transport/subprocess_cli.py` has directly applicable spawn/kill primitives; ProcessStrategy mirrors this single-method transport pattern

### Requirements
- `.planning/REQUIREMENTS.md` -- FDN-01 through FDN-09 (foundation), PLT-03/04/05 (platform), PAR-01/03/04 (parity)
- `.planning/ROADMAP.md` SS"Phase 2" -- Goal, success criteria, dependencies

### Phase 1 outputs (consumed by Phase 2)
- `spec/events.schema.json` -- Frozen JSON Schema 2020-12 with 6 event types; validate-schema-ts.mjs and validate-schema-py.sh confirm codegen works
- `spec/fixtures/*.ndjson` -- 12 fixture files consumed by test suites via relative paths
- `.planning/phases/01-feasibility-spike-fixture-capture/01-CONTEXT.md` -- Phase 1 decisions and patterns established

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/validate-fixtures.mjs` — 7-subcommand validator; tests can invoke subcommands to verify fixture integrity
- `scripts/validate-schema-ts.mjs` — JSON Schema to TS codegen smoke test; can be adapted for Phase 2's TS type generation CI step
- `scripts/validate-schema-py.sh` — JSON Schema to Python codegen smoke test; same for Python side
- `scripts/_redactor.mjs` — 8-pattern regex redactor; reusable if ProcessManager needs to redact logs
- `spec/events.schema.json` — Frozen schema; TS types and Pydantic models generated from this

### Established Patterns
- ESM (`"type": "module"` in root `package.json`) — Phase 2 TS package should follow ESM
- Windows `.cmd` + `shell:true` + pre-built command string for subprocess spawning (discovered in Phase 1 capture engine)
- `spec/` directory as shared, language-neutral ground truth

### Integration Points
- Phase 2 creates `ts/` and `python/` directories; both consume `spec/` via relative paths
- Phase 2's `ProcessManager` is the foundation that Phase 4's `query()` wraps
- Phase 2's CI matrix is extended (not replaced) by every subsequent phase
- Root `package.json` (currently `gemini-sdk-spec`) will need updating or coexisting with `ts/package.json`

</code_context>

<specifics>
## Specific Ideas

- **"Mirrors Claude Agent SDK pattern"** — ProcessStrategy is a single-method interface like `SubprocessCLITransport`, not a full lifecycle object. Keeps it familiar to developers who've used the Claude SDK.
- **"PATH-only, no magic"** — BinaryResolver doesn't guess install locations. If `gemini` isn't on PATH, the error message tells you what to do. Matches Archon's Codex pattern and the project's "require pre-installed" constraint.
- **"Japanese locale is the stress test"** — ja-JP on Windows is the most aggressive non-en-US test because Shift_JIS legacy codepage exercises multi-byte encoding edge cases that Latin locales don't.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 02-process-foundation-workspace-scaffolding-ci-matrix*
*Context gathered: 2026-04-12*
