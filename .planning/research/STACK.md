# Stack Research

**Domain:** Dual-language (TypeScript + Python) SDK wrapping a Node CLI binary via subprocess, with NDJSON streaming, typed errors, cross-platform (Windows-first), and hosted docs.
**Researched:** 2026-04-11
**Confidence:** HIGH on individual tools, HIGH on repo structure (verified against Archon + Claude Agent SDK), MEDIUM on a few "pick A vs B" calls where both are defensible.

---

## Executive Summary

Ship a **single polyglot monorepo** (`pnpm` workspace for TS + `uv` workspace-member for Python) with parallel `packages/gemini-sdk-ts/` and `packages/gemini-sdk-python/` trees, a `packages/gemini-sdk-shared/` directory holding a JSON Schema of the NDJSON event envelope plus a golden-fixture corpus (shared source of truth for cross-language parity), and a `packages/archon-adapter/` directory holding the `GeminiClient` that plugs into Archon's `IAssistantClient` interface. GitHub Actions drives CI and dual publishing (changesets for npm, `uv publish` for PyPI).

**TypeScript surface** mirrors the Claude Agent SDK TypeScript package's choices: tsup for builds (ESM+CJS+`.d.ts` in one shot), Vitest 4 for tests, TypeScript 5.6+, typedoc for API reference, VitePress for the hosted doc site. Subprocess spawning uses Node's native `child_process.spawn` (NOT execa) because we need fine-grained control over stdin/stdout NDJSON streams, Windows `CREATE_NO_WINDOW` flags, and graceful signal handling — and because shipping an SDK with a heavy subprocess dependency is exactly the kind of thing the Claude Agent SDK team chose to avoid. NDJSON parsing uses a hand-rolled line-splitter (about 40 lines) rather than `stream-json` or `ndjson`, because the protocol is simple enough that a dependency isn't justified and the Claude Agent SDK itself hand-rolls its JSON reassembly.

**Python surface** mirrors `claude-agent-sdk-python` almost exactly: `hatchling` build backend driven by `uv`, `anyio>=4.10` for structured concurrency over subprocesses (works on both asyncio and trio, handles Windows properly), `pytest`+`pytest-asyncio` for tests, `ruff` for lint+format, `mypy --strict` in CI (plus `pyright` in editor for speed), `mkdocs-material` for the hosted doc site. Minimum Python is 3.10.

**Key constraint decisions:**
- **Subprocess lib (both langs): native, not execa/anyio-only wrappers.** The Gemini CLI is a *long-running, streaming* subprocess, not a one-shot. Native APIs expose the exact knobs (stdin close, signal delivery, Windows `detached`/`CREATE_NO_WINDOW`) that execa abstracts away. anyio.open_process is Python's native + cross-runtime story and already what claude-agent-sdk-python uses.
- **NDJSON parsing: no dependency.** A line-buffered chunked parser is ~40 lines and fully testable with golden fixtures. Pulling in `stream-json` or `ndjson.js` adds weight for a problem we can solve trivially.
- **Schema source of truth: shared JSON Schema for the event envelope.** Generates TS types via `json-schema-to-typescript` and Python Pydantic models via `datamodel-code-generator`. Both packages run the same fixture corpus as parity tests in CI.
- **Archon integration: `GeminiClient implements IAssistantClient` living in this repo's `packages/archon-adapter/`, published as `@gemini-sdk/archon-adapter`.** Archon's `packages/core/src/clients/` contains `claude.ts`, `codex.ts`, and `factory.ts`; a Gemini PR to Archon adds `gemini.ts` that does nothing but re-export from `@gemini-sdk/archon-adapter`. This keeps the adapter evolved in-repo without requiring a fork of Archon for every iteration.

---

## Recommended Stack

### Core Technologies (shared)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Git + GitHub | n/a | Source control, CI, releases | Only realistic choice for an OSS SDK; Archon is already here. |
| GitHub Actions | n/a | CI, matrix tests (ubuntu/macos/windows × node/python), release publishing | Free for OSS, native Windows runners, already what claude-agent-sdk uses. |
| pnpm workspace + uv workspace-member | pnpm 10.x, uv 0.11.x | Monorepo layout with TS and Python siblings | pnpm is standard for TS monorepos; uv is the 2025 default for Python packaging and coexists fine because the Python tree is just a subfolder uv treats as a project root. |

### Core Technologies (TypeScript package)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Node.js | >=18.17 (LTS 20/22 targeted) | Runtime | Claude Agent SDK TypeScript targets Node 18+; matches Archon (Bun is a Node-compatible runtime). Node 18 is EOL April 2025 but still the minimum the ecosystem supports; 20/22 are primary test targets. |
| TypeScript | 5.6.x (pin minor, allow patch) | Language | Claude Agent SDK and Archon both on TS 5.x; 5.6 has `--noUncheckedSideEffectImports`, better NodeNext resolution, mature `using` disposable support (useful for subprocess lifecycle). |
| tsup | 8.5.x | Bundler (ESM + CJS + `.d.ts` in one command) | Zero-config library bundler built on esbuild. Emits dual ESM/CJS and type declarations with a 4-line config. Actively maintained (tsdown is promising but immature — defer). |
| Vitest | 4.x | Test runner | Ecosystem standard for TS libraries in 2025; better Windows behavior than bun:test; compatible mocking, coverage via v8, browser mode unneeded here. Archon's internal tests use `bun test` but Archon doesn't publish to npm — we do, so Vitest is the safer choice for contributors. |
| tsx | 4.x | On-the-fly TS execution for scripts and examples | Standard; avoids forcing a pre-build step when running examples. |
| @types/node | 22.x | Node type definitions | Matches target runtime. |
| native `node:child_process` | Node stdlib | Subprocess spawning | See decision rationale below. |
| native `node:readline` or custom line buffer | Node stdlib | NDJSON line splitting over stdout chunks | See decision rationale below. |

### Core Technologies (Python package)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Python | >=3.10 | Runtime | Matches claude-agent-sdk-python's floor; 3.9 is EOL Oct 2025; 3.10 gets us `match`, PEP 604 unions, `ParamSpec`. |
| uv | 0.11.x | Package + env manager + Python version manager | 2025 standard. 10-100x faster than pip/poetry, reproducible `uv.lock`, `uv run` for one-line test invocation, Windows-first. |
| hatchling | 1.x | PEP 517 build backend | What claude-agent-sdk-python uses. Lightweight, well-supported, plays nice with `uv build` and `uv publish`. |
| anyio | >=4.10 (latest: 4.13.0) | Async subprocess + structured concurrency abstraction | What claude-agent-sdk-python uses. Gives us `anyio.open_process()` which normalizes Windows quirks, task groups for reader/writer tasks, cancellation scopes for timeouts. Runs on asyncio *and* trio — callers aren't forced into one runtime. |
| pytest | >=8.3 | Test runner | Universal standard. |
| pytest-asyncio | >=0.24 | Async test support | Standard pairing with anyio + pytest. |
| anyio[trio] (dev only) | — | Run the test suite on both backends | Catches asyncio-specific assumptions. Same pattern as claude-agent-sdk-python. |
| ruff | 0.15.x | Linter + formatter (replaces black, isort, flake8) | 100x faster than black+flake8+isort, single config file, what every modern Python SDK uses in 2025 (FastAPI, pandas, pydantic, Airflow). |
| mypy | >=1.13, `--strict` | Type checker for CI | Required for a library's published types to be authoritative; stricter defaults than pyright, and what most library consumers expect to work against. |
| pyright (optional, editor only) | latest | Fast type checking in VS Code via Pylance | Faster feedback loop during dev; not run in CI to avoid two sources of truth. |

### Supporting Libraries (TypeScript)

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| zod | 3.23.x or 4.x | Runtime validation of parsed NDJSON events against schema; structured output validation | For every untrusted boundary: what Gemini CLI emits, what callers pass in. Chosen over valibot because the DX ecosystem (error formatting, MCP tools, Archon, Claude Agent SDK) is Zod-aligned — consistency trumps 15kB of bundle for a server-side SDK. |
| tiny-invariant | 1.3.x | Compact assertion helper for internal invariants | Replaces `throw new Error()` boilerplate; tree-shakes in prod. |
| (NOT execa) | — | — | See "What NOT to Use". |
| (NOT stream-json) | — | — | See "What NOT to Use". |

### Supporting Libraries (Python)

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| pydantic | >=2.9 | Runtime validation of parsed NDJSON events against schema; typed data models | Same rationale as Zod for TS. Pydantic v2 is the universal choice in 2025; fast (Rust core), great DX, `datamodel-code-generator` produces Pydantic models from the shared JSON Schema. |
| typing-extensions | >=4.12 | Backports newer typing features to 3.10/3.11 | Required when using `Self`, `Unpack`, etc. with 3.10 as floor. |

### Documentation Tooling

| Tool | Purpose | Notes |
|---|---|---|
| VitePress | Hosted doc site (Quickstart, Guides, How-Tos) for the TS package and the SDK at large | Vite-powered, extremely fast dev loop, markdown+Vue components, themable, GitHub Pages deploy in one action. Chosen over Docusaurus because React SSR is overkill for a docs site and the Vue embed story beats MDX for small interactive examples. |
| typedoc | Auto-generated TypeScript API reference, consumed *by* VitePress via `typedoc-plugin-markdown` | Produces markdown files that VitePress renders natively, so the API reference lives in the same site, same theme, same search index. |
| mkdocs + mkdocs-material | Hosted doc site for the Python package | `mkdocs-material` is the default for serious Python libraries (FastAPI, Pydantic, Typer, etc.). Ships with search, versioning (via `mike`), code highlighting, admonitions. |
| mkdocstrings[python] | Auto-generated Python API reference embedded in mkdocs | Parses docstrings (Google/NumPy/Sphinx styles) and renders them as material pages alongside hand-written guides. |
| Single published site with two sections | `docs.gemini-sdk.dev/ts/` and `docs.gemini-sdk.dev/python/` | Build both in CI, deploy to GitHub Pages under subdirectories, share the top-level landing page. |

### Development Tools

| Tool | Purpose | Notes |
|---|---|---|
| GitHub Actions | CI + release + doc deploy | Matrix: `{ubuntu, macos, windows} × {node 18, 20, 22} × {python 3.10, 3.11, 3.12, 3.13}`. Windows-first means Windows *cannot* be `continue-on-error: true`. |
| changesets | Version bump + changelog + npm publish for the TS package | Explicit changeset files decouple versioning from commit messages; works cleanly in a single-package subtree within a polyglot monorepo. |
| `uv publish` | PyPI publish for the Python package | Driven by a GitHub Action on tag. `tag: python-v*` fires the Python release; `tag: ts-v*` fires the TS release. |
| Husky + lint-staged (TS) / pre-commit (Python) | Pre-commit hooks for format+lint | Matches Archon's choice on the TS side (husky is in Archon's devDependencies). |
| Prettier | TS/JSON/Markdown formatter | Matches Archon. |
| ESLint 9 (flat config) + `@typescript-eslint` | TS linting | Flat config is the new default; Archon uses ESLint 9. |
| gemini-cli (version-pinned) | Binary-under-test | `GEMINI_BIN_PATH` env var points at a test fixture; CI installs a known version from npm as a dev dependency for integration tests. |

---

## Installation

### TypeScript package (consumer)

```bash
# Consumer installs
npm install @gemini-sdk/core
# or
pnpm add @gemini-sdk/core
# or
bun add @gemini-sdk/core

# Consumer must also have gemini-cli on PATH (or set GEMINI_BIN_PATH)
npm install -g @google/gemini-cli
```

### TypeScript package (development)

```bash
# One-time
corepack enable
pnpm install

# Dev loop
pnpm --filter @gemini-sdk/core dev       # tsup --watch
pnpm --filter @gemini-sdk/core test      # vitest
pnpm --filter @gemini-sdk/core typecheck # tsc --noEmit
pnpm --filter @gemini-sdk/core build     # tsup (produces dist/)
pnpm docs:ts:dev                         # vitepress dev
```

### Python package (consumer)

```bash
# Consumer installs
uv add gemini-sdk        # uv-first
# or
pip install gemini-sdk   # still works
```

### Python package (development)

```bash
# One-time
uv sync

# Dev loop
uv run pytest                      # test
uv run pytest --backend=asyncio    # + explicit
uv run pytest --backend=trio       # + trio backend
uv run ruff check .                # lint
uv run ruff format .               # format
uv run mypy src tests              # type check
uv run mkdocs serve                # docs preview
```

---

## Subprocess Strategy (the load-bearing decision)

The Gemini CLI SDK is, at its core, a *subprocess lifecycle manager over an NDJSON pipe*. This dominates every architectural choice. Rationale for the non-obvious picks:

### TypeScript: `child_process.spawn`, not execa or tinyexec

**Decision:** Use Node's built-in `child_process.spawn` directly. Wrap it in a small `GeminiProcess` class that owns:
- The `ChildProcess` handle
- A `Readable` stdout chunked through a line-splitter transform
- A `Writable` stdin for interactive sessions (if gemini-cli supports long-lived pipe mode — feasibility TBD in research)
- A typed error classifier that reads stderr on exit
- Windows-specific flags: `windowsHide: true`, `detached: false`, no `shell: true`

**Why not execa:**
- execa is *optimized* for one-shot "run this command and get the output" usage. It buffers output by default, adds a ~50kB dependency for features we don't need (templates, piping, result objects), and hides the raw stream control we actually require for NDJSON streaming.
- execa's Windows support is good but it hides `windowsHide` behind abstractions; we'd be fighting the abstraction within a week.
- Claude Agent SDK's TypeScript package uses `child_process.spawn` directly for exactly this reason.

**Why not tinyexec:**
- Smaller than execa (good), but still a wrapper that doesn't expose the granular stream control we need. Its docs explicitly state it "does not re-expose every child_process method/event."

**Why not zx:**
- zx is a scripting tool, not an SDK subprocess primitive. Wrong tool entirely.

### Python: `anyio.open_process`, not `asyncio.create_subprocess_exec` or `trio.run_process`

**Decision:** Use `anyio.open_process` inside an `anyio` task group. This mirrors claude-agent-sdk-python exactly.

**Why:**
- **Cross-runtime by default.** Callers on asyncio, trio, or (via `asyncify`) sync code all work without us writing two implementations.
- **Structured concurrency.** Task groups guarantee child tasks (stdout reader, stderr reader, heartbeat) are cancelled together if any fail — critical for avoiding orphan processes on error paths.
- **Windows handling is already baked in.** anyio normalizes the Windows event loop policy, supports `creationflags=subprocess.CREATE_NO_WINDOW`, and handles the Windows subprocess-transport race conditions that plain asyncio has suffered from for years.
- **It's what the reference SDK does.** Claude Agent SDK Python uses `anyio.open_process()` with stdin/stdout/stderr pipes + a persistent task group that lives from `connect()` to `disconnect()`. We have literally zero reason to deviate.

**Why not raw `asyncio.create_subprocess_exec`:**
- Locks callers into asyncio.
- Windows subprocess-transport history is painful; anyio papers over known bugs.
- No structured concurrency primitives → orphan-process risk on error paths.

**Why not `trio.run_process`:**
- Locks callers into trio. Too niche for a general SDK.

### NDJSON parsing: hand-rolled line splitter, no dependency

**Decision:** ~40 lines of code in each package. TS uses a `Transform` stream that buffers until `\n`, emits complete JSON objects parsed through Zod. Python uses an `async for` over `stdout` that accumulates until newline, parses through Pydantic.

**Why not `stream-json`, `ndjson.js`, `@streamparser/json`:**
- The NDJSON protocol is trivially simple: split on `\n`, JSON.parse each line, validate with schema. A dependency hides this and makes debugging protocol mismatches harder.
- Claude Agent SDK's Python client hand-rolls a JSON reassembly state machine for the same reason.
- `stream-json` is designed for multi-gigabyte JSON files, not NDJSON event streams — overkill.
- Test coverage is trivial: golden fixture files + chunk-boundary splitter tests.

**Implementation notes:**
- Buffer must survive chunks that split mid-line, mid-emoji, mid-utf8 multibyte character.
- On Windows, gemini-cli may emit CRLF (`\r\n`) — strip trailing `\r` before parsing. This is a known Windows gotcha.
- Emit a structured `ProtocolError` (subclass of `ParseError`) when a line fails to parse, including the raw line and position — critical for field-debugging version mismatches when gemini-cli ships a breaking change.

---

## Cross-Language Parity Strategy

**Problem:** Two packages in two languages will drift. Event types, error codes, and behaviors must stay identical or users will hit mysterious discrepancies.

**Solution:**

1. **Shared JSON Schema as source of truth.** `packages/gemini-sdk-shared/schemas/` contains:
    - `event-envelope.schema.json` — the NDJSON line types gemini-cli emits (assistant, tool_use, result, etc.)
    - `error-codes.schema.json` — the enum of error categories (`rate_limit`, `auth`, `invalid_prompt`, `process`, `unknown`)
    - `options.schema.json` — the caller-facing request options shape
2. **Generated types.** Build step regenerates:
    - TS: `json-schema-to-typescript` → `src/generated/types.ts` (checked in, regeneration is part of CI validation)
    - Python: `datamodel-code-generator` → `src/gemini_sdk/generated/models.py` (Pydantic v2 models)
3. **Golden fixture corpus.** `packages/gemini-sdk-shared/fixtures/` contains ~30 NDJSON files captured from real gemini-cli runs (tool use, rate limit, auth error, multimodal input, etc.). Both packages have a parity test suite that:
    - Feeds each fixture through the parser
    - Asserts the resulting typed objects match a reference JSON snapshot
    - Snapshots live in the shared directory, shared across both packages
4. **CI matrix parity job.** A single workflow runs both test suites against the same fixture set and fails if either produces different results.
5. **Error hierarchy table.** A markdown file in `packages/gemini-sdk-shared/docs/error-hierarchy.md` is the canonical enumeration of error classes; both docs sites cross-link to it.

**Why this works:** When a new gemini-cli version emits a new event shape, the failing test is the schema or the fixture — in *one* place — not two separate "I added a field in Python but forgot Python" bugs.

---

## Archon Integration Surface

Verified from actual Archon source (`dev` branch, 2026-04-11):

**Archon uses:**
- Bun 1.3+ as package manager (`bun.lock`, `bunfig.toml` in repo root)
- TypeScript 5.3+, ESLint 9.39+, Prettier 3.7+, Husky 9.1+ as devDependencies
- `@anthropic-ai/claude-agent-sdk@^0.2.74` already as a direct dependency
- Monorepo workspaces at `packages/*`; packages export *raw `.ts`* via `"main": "./src/index.ts"` — they rely on the consuming app bundling the source (Bun handles this natively)

**Archon's AI assistant client surface lives in `packages/core/src/clients/`** and contains:
- `claude.ts` (~27kB) — `ClaudeClient implements IAssistantClient`
- `codex.ts` (~22kB) — `CodexClient implements IAssistantClient`
- `factory.ts` — `getAssistantClient(type: 'claude' | 'codex')` dispatcher
- `index.ts` — re-exports

**The `IAssistantClient` interface (verified):**
```typescript
export interface IAssistantClient {
  sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: AssistantRequestOptions
  ): AsyncGenerator<MessageChunk>;
  getType(): string;
}
```

**`MessageChunk` is a discriminated union** with cases: `assistant`, `system`, `thinking`, `result`, `rate_limit`, `tool`, `tool_result`, `workflow_dispatch`.

**Implication for this SDK:**
- `@gemini-sdk/core` (raw SDK, ecosystem-facing) has its own ergonomic shape, not tied to Archon's types.
- `@gemini-sdk/archon-adapter` (separate package in our monorepo) contains `GeminiClient implements IAssistantClient` that wraps `@gemini-sdk/core` and emits `MessageChunk`-shaped values. It type-imports `IAssistantClient` from `@archon/core` via `peerDependencies`, so consumers bring their own Archon version.
- The Archon PR is tiny: a new `packages/core/src/clients/gemini.ts` that `import { GeminiClient } from '@gemini-sdk/archon-adapter'` and re-exports it, plus an update to `factory.ts` to add `'gemini'` and a README update.
- Because Archon packages export raw `.ts`, **the archon-adapter package must also export raw `.ts` in its package.json exports** (`"main": "./src/index.ts"`) to match. This means the archon-adapter does NOT go through tsup — it's source-published, Bun-consumable. The core `@gemini-sdk/core` package still ships compiled ESM+CJS through tsup for npm/Node consumers outside Archon.

**Error classification expected by Archon:** The verified Claude and Codex clients both classify errors into `rate_limit`, `auth`, `crash`, `unknown` (Codex also has `model_access`). Our typed error hierarchy (`RateLimitError`, `AuthError`, `InvalidPromptError`, `ProcessError`) maps cleanly — the archon-adapter just exposes `.category` accessor to match.

---

## Monorepo Layout

```
Gemini-SDK/
├── pnpm-workspace.yaml
├── package.json                     # root, private, workspace scripts
├── tsconfig.base.json
├── .changeset/                      # changesets config + pending changesets
├── .github/workflows/
│   ├── ci-ts.yml                    # test matrix for TS package
│   ├── ci-python.yml                # test matrix for Python package
│   ├── parity.yml                   # cross-language fixture parity tests
│   ├── release-ts.yml               # changesets → npm on tag push
│   ├── release-python.yml           # uv publish on tag push
│   └── deploy-docs.yml              # build + deploy both doc sites
├── packages/
│   ├── gemini-sdk-shared/           # schemas + fixtures + error tables
│   │   ├── schemas/*.schema.json
│   │   ├── fixtures/*.ndjson
│   │   └── docs/error-hierarchy.md
│   ├── gemini-sdk-ts/               # @gemini-sdk/core (npm)
│   │   ├── package.json             # tsup build, ESM+CJS
│   │   ├── tsup.config.ts
│   │   ├── src/
│   │   └── test/
│   ├── archon-adapter/              # @gemini-sdk/archon-adapter (npm)
│   │   ├── package.json             # source-published (main = ./src/index.ts)
│   │   └── src/GeminiClient.ts
│   └── gemini-sdk-python/           # gemini-sdk (PyPI)
│       ├── pyproject.toml           # hatchling backend, uv-driven
│       ├── src/gemini_sdk/
│       └── tests/
└── docs/
    ├── ts/                          # VitePress site for TS package
    └── python/                      # MkDocs site for Python package
```

**Why polyglot monorepo and not two repos:**
- Shared schemas + fixtures + error tables need a single source of truth that PRs can modify atomically across both language surfaces.
- Cross-language parity tests must run against both packages in the same CI run.
- Hosted docs benefit from a single landing page and unified versioning.
- The archon-adapter belongs with the TS package it wraps.
- Downside — the Python subtree isn't managed by pnpm — is handled by `uv` treating `packages/gemini-sdk-python/` as its own project root. The two tools ignore each other.

---

## CI Strategy

**Matrix:**
- TS: `{ubuntu-latest, macos-latest, windows-latest} × {node: 18.17, 20, 22}`
- Python: `{ubuntu-latest, macos-latest, windows-latest} × {python: 3.10, 3.11, 3.12, 3.13}`
- Parity: ubuntu-latest only (one job, runs both packages against shared fixtures)

**Windows is non-negotiable.** Every job runs on Windows with no `continue-on-error`. If it breaks on Windows, the PR is blocked. This is the single most important CI discipline for this project.

**Gemini CLI version pinning.** CI installs a pinned `@google/gemini-cli` version as a dev dep. A separate *nightly* job runs against `@google/gemini-cli@latest` and files an issue on breakage without blocking PRs — gives early warning on upstream changes without blocking daily work.

**Release flow:**
- TS: contributor adds a changeset file → merge → `changesets/action` opens a version PR → merging that PR triggers `npm publish` via a trusted publisher GitHub Action.
- Python: contributor bumps `pyproject.toml` version in a PR → merge → tag `python-v{version}` → `uv publish` action runs on tag. Trusted publishing via PyPI's OIDC integration, no API tokens.
- Docs: any push to `main` that touches `docs/` or the schema triggers a rebuild + deploy to GitHub Pages.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| pnpm workspaces | Bun workspaces | If we decided to match Archon's package-manager exactly. Rejected because Bun's npm publishing story is still maturing, and most SDK consumers still use npm/pnpm/yarn — consistency with *consumers* beats consistency with *one specific consumer*. The archon-adapter subpackage's source-publishing trick gets us Archon compatibility without adopting Bun for the whole monorepo. |
| pnpm workspaces | Turborepo on top | If the build graph gets complex enough that we need task caching. Right now we have 3 TS packages (core, shared, adapter) — pnpm `--filter` is enough. Revisit if we add >5 packages. |
| tsup | tsdown | tsdown is the spiritual successor from the Rolldown/Oxc team and promises better tree-shaking. Defer to v2 — too new (pre-1.0) to bet a published SDK on. |
| tsup | tsc alone | If we didn't need dual ESM/CJS output. We do, because some Archon consumers and older Node setups still need CJS. |
| Vitest | bun:test | If the whole monorepo went Bun and contributors were Bun-only. Bun tests are faster but narrower; Vitest has better Windows behavior and broader ecosystem. |
| hatchling | uv_build | uv_build is the newer, uv-native backend. It works but claude-agent-sdk-python (our reference) uses hatchling, and hatchling is battle-tested. Stick with hatchling unless we need a uv_build-only feature. |
| anyio | raw asyncio | If we wanted zero dependencies in the Python package. Not worth the Windows-handling pain and the cross-runtime limitation. |
| VitePress + mkdocs-material (separate) | One unified Docusaurus site for both languages | Docusaurus can technically host both, but mkdocstrings is the best-in-class Python API reference generator and we'd lose it. Two sites under subdirectories with a shared landing page is better than a compromised single site. |
| changesets | release-please | release-please drives versioning from conventional commits; works for single-package repos but gets awkward with the polyglot mixed monorepo. changesets' explicit "I'm changing this package at this level" files give clearer intent in a multi-package repo. |
| Zod | Valibot | If bundle size mattered. It doesn't — this is a server-side SDK running under Node or Python, not a browser bundle. Zod's ecosystem alignment with Claude Agent SDK, MCP, and Archon is more valuable than 15kB. |
| Native `child_process.spawn` | execa | Rejected. See subprocess strategy above. |
| Native `anyio.open_process` | `asyncio.create_subprocess_exec` | Rejected. See subprocess strategy above. |
| Hand-rolled NDJSON splitter | `stream-json`, `ndjson`, `@streamparser/json` | Rejected. See subprocess strategy above. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| execa | Buffers by default, hides stream control, extra dependency for a feature we don't need. Wrong tool for long-running streaming subprocesses. | `node:child_process.spawn` directly, wrapped in a small `GeminiProcess` class. |
| `child_process.exec` / `execSync` | Blocking / buffer-based; no streaming; shell injection risk. | `spawn` with `shell: false`. |
| `shell: true` on spawn | Shell injection risk; platform-dependent behavior; Node 18 also deprecated `.bat`/`.cmd` invocation via `shell: true` (DEP0190). | Pass args as an array; if `.bat`/`.cmd` is needed on Windows, invoke `cmd.exe /c <file>` explicitly. |
| `ndjson` (Node package) | Stale (last substantive update years ago), not TypeScript-first, uses old-style streams. | Hand-rolled Transform or plain line buffer. |
| `stream-json` | Solves a different problem (huge JSON documents, not NDJSON line streams). Pulls in 7 sub-packages. | Hand-rolled line splitter. |
| poetry | Still popular, but slower than uv, and the claude-agent-sdk ecosystem is uv-aligned. Fine for legacy Python projects, wrong choice for a 2025 greenfield. | uv + hatchling. |
| pip-tools / requirements.txt | Not reproducible across platforms, no lockfile semantics. | `uv.lock` via `uv sync`. |
| black + isort + flake8 | Three tools for what ruff does in one, 100x slower. Every modern Python library has migrated. | ruff (lint + format). |
| jest (TS) | Slower than vitest, worse TS integration, worse Windows ergonomics, declining ecosystem. | Vitest 4. |
| Docusaurus (if mkdocs-material covers Python) | React overhead, MDX complexity, Algolia DocSearch applications for a small project. | VitePress for TS side, mkdocs-material for Python side. |
| JSDoc-only as "the docs" | Unprofessional for an SDK pitching "serious package signal." | Full hosted site (VitePress + typedoc for TS, mkdocs-material + mkdocstrings for Python). |
| PyPI classic uploads via twine with API tokens | Token rotation burden, security exposure. | PyPI trusted publishing (OIDC) via GitHub Actions. |
| npm publish with static NPM_TOKEN | Same reasons. | npm trusted publishing / changesets/action with OIDC. |
| `subprocess.CREATE_NEW_CONSOLE` flag | Pops a visible console window on Windows when used inside an app. | `subprocess.CREATE_NO_WINDOW` on Python side; `windowsHide: true` on Node side. Verified pattern from claude-agent-sdk-python. |

---

## Windows-First Gotchas (call-outs)

- **CRLF in NDJSON output.** gemini-cli on Windows may emit `\r\n` line endings. The line splitter must trim trailing `\r` before parsing; tests must cover a fixture with Windows line endings.
- **Hidden console windows.** On Node: `spawn(bin, args, { windowsHide: true })`. On Python: `subprocess.CREATE_NO_WINDOW` flag passed via `anyio.open_process`'s `creationflags` keyword (anyio 4.x supports this directly). Without these, running the SDK from inside an Electron or packaged Python app flashes a console window.
- **PATH / `GEMINI_BIN_PATH` resolution.** On Windows, `node:child_process.spawn` does not search `PATHEXT` automatically — `gemini` without an extension won't find `gemini.cmd`. Solution: resolve the absolute binary path ourselves using a small `which`-equivalent (check `GEMINI_BIN_PATH` → check `PATH` with platform-correct extensions). This is what Archon's Codex binary-guard test file exercises.
- **Shell-quote vs. list args.** Never pass args as a single string on Windows (or anywhere) — always as an array. The `shell: false` default is correct; resist the temptation to set `shell: true` to "fix" a missing-binary error.
- **Path separators in cwd/workspace contexts.** `--include-directories` and `@`-reference paths must be passed with the separator gemini-cli expects (forward slashes usually work cross-platform, but not always inside `@`-refs). Integration tests must run on Windows.
- **Process tree cleanup on SIGINT / Ctrl-C.** Windows doesn't have POSIX signals; `process.kill('SIGTERM')` on a Windows subprocess sends a forced termination, not a graceful signal. The SDK's shutdown path should close stdin first to give gemini-cli a chance to flush, then fall back to killing the process.
- **Long paths.** Windows MAX_PATH still bites without `\\?\` prefixes in some tooling. Tests that create deep temp directories must handle this or explicitly opt into long-path mode.
- **Python asyncio event loop policy on Windows.** Historically required `WindowsProactorEventLoopPolicy` for subprocesses on older Python; anyio normalizes this automatically, which is another reason to use anyio rather than raw asyncio.
- **Antivirus interference.** Windows Defender can lock the gemini-cli binary briefly during first execution. Retries on `EPERM`/`EBUSY` spawn errors with a 100ms backoff (up to 3 attempts) prevents flaky first-run failures.

---

## Stack Patterns by Variant

**If the user is an Archon consumer:**
- Install `@gemini-sdk/archon-adapter` + `@gemini-sdk/core`
- Adds a one-line change to Archon's `factory.ts` (via the shipped PR)
- Uses the `IAssistantClient`-compatible surface; no other API surface is visible
- Auth via existing Archon patterns: `GEMINI_API_KEY` or `GEMINI_BIN_PATH` env vars

**If the user is a general TS consumer:**
- Install `@gemini-sdk/core` only
- Uses the ergonomic SDK API (shape TBD in planning — Claude-Agent-SDK-style `query()` + `client.sendQuery()`)
- Not coupled to any `MessageChunk` or Archon type

**If the user is a Python consumer:**
- `uv add gemini-sdk` (or pip)
- Uses async generator API driven by anyio; works under asyncio or trio transparently
- Same ergonomic shape as the TS package, translated idiomatically

**If the user is on Windows (all variants):**
- No extra steps. Windows is the *primary* supported platform.
- CI enforces Windows parity on every PR.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| Node.js >=18.17 | TypeScript 5.6, Vitest 4.x, tsup 8.x | Node 18 is the current floor for Claude Agent SDK TS. |
| TypeScript 5.6 | Archon (uses 5.3+), Claude Agent SDK (5.x) | 5.6 is the recent stable; users with older TS still consume published `.d.ts` fine. |
| Vitest 4 | Node 18.17+ | Vitest 4 dropped support for Node <18.17. |
| Bun 1.3+ | archon-adapter (via source publishing) | Archon requires `^1.3.0`. |
| Python >=3.10 | anyio 4.10+, pydantic 2.9+, mkdocs-material latest | anyio 4.13 dropped 3.9 support. |
| anyio 4.13 | asyncio, trio | Our `anyio[trio]` dev dep ensures both are tested. |
| pydantic 2.9+ | datamodel-code-generator latest | v2 is the universal Python data-modeling choice in 2025. |
| @anthropic-ai/claude-agent-sdk ^0.2.74 | Archon dev branch | Our archon-adapter peerDep-installs this transitively via `@archon/core`. |
| gemini-cli (pinned range, TBD) | Our SDK version range | Compat matrix lives in `packages/gemini-sdk-shared/compat.md`. Research phase must lock an initial supported range. |

---

## Open Stack Questions (defer to planning)

- **Bun compatibility of `@gemini-sdk/core`.** The tsup-built ESM/CJS package should work under Bun, but we need a Bun smoke test in CI to confirm. Claude Agent SDK TS works under Bun (Archon uses it), so precedent is good.
- **Whether `@gemini-sdk/archon-adapter` should live in this repo or in a fork of Archon.** Current recommendation: live in this repo, PR to Archon just re-exports. Alternative: fork Archon and contribute directly. Decision depends on how collaborative the Archon maintainer is with cross-repo adapters.
- **Docs hosting subdomain.** `docs.gemini-sdk.dev`, GitHub Pages on the main repo, or a Vercel-style deployment? Negligible technical differences; pick based on DNS availability in planning.
- **Whether to ship a `@gemini-sdk/types` subpackage** for people who only want the typed event envelope without the SDK runtime. Low priority; add if demanded.

---

## Sources

**Primary (HIGH confidence — direct source inspection):**
- [Archon repository root package.json (verified via GitHub)](https://github.com/coleam00/Archon/blob/dev/package.json) — Bun 1.3+, TS 5.3+, ESLint 9.39+, Prettier 3.7+, Husky 9.1+, @anthropic-ai/claude-agent-sdk ^0.2.74
- [Archon bunfig.toml](https://github.com/coleam00/Archon/blob/dev/bunfig.toml) — test config
- [Archon packages/adapters/package.json](https://github.com/coleam00/Archon/blob/dev/packages/adapters/package.json) — source-export pattern (main=./src/index.ts)
- [Archon packages/core/src/clients/](https://github.com/coleam00/Archon/tree/dev/packages/core/src/clients) — claude.ts, codex.ts, factory.ts, index.ts (verified file listing)
- [Archon packages/core/src/clients/claude.ts](https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/claude.ts) — `ClaudeClient implements IAssistantClient`, error categories, streaming pattern
- [Archon packages/core/src/clients/codex.ts](https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/codex.ts) — `CodexClient implements IAssistantClient`, CODEX_BIN_PATH handling, error categories
- [Archon packages/core/src/types/index.ts](https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts) — verified `IAssistantClient` interface and `MessageChunk` discriminated union
- [claude-agent-sdk-python pyproject.toml](https://github.com/anthropics/claude-agent-sdk-python/blob/main/pyproject.toml) — hatchling + anyio + mypy + ruff + pytest stack confirmed
- [claude-agent-sdk-typescript repository](https://github.com/anthropics/claude-agent-sdk-typescript) — Node 18+ requirement, current at v0.2.101 (2026-04-10)

**Tooling docs (HIGH confidence — official):**
- [tsup GitHub](https://github.com/egoist/tsup) — current 8.5.1, 2024-11-12
- [anyio GitHub releases](https://github.com/agronholm/anyio/releases) — current 4.13.0, 2025-03-24
- [Vitest GitHub releases](https://github.com/vitest-dev/vitest/releases) — 4.x current
- [uv GitHub releases](https://github.com/astral-sh/uv/releases) — 0.11.6 current (2026-04-09)
- [ruff GitHub releases](https://github.com/astral-sh/ruff/releases) — 0.15.10 current (2026-04-09)
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) — Windows PATHEXT / .bat/.cmd / DEP0190 behavior
- [anyio subprocess docs](https://anyio.readthedocs.io/en/stable/subprocesses.html) — creationflags, task groups

**Ecosystem analyses (MEDIUM confidence — verified against multiple sources):**
- [Python Build Backends in 2025 (Medium)](https://medium.com/@dynamicy/python-build-backends-in-2025-what-to-use-and-why-uv-build-vs-hatchling-vs-poetry-core-94dd6b92248f) — hatchling vs uv_build vs poetry-core
- [Bun vs Vitest vs Jest 2026 (PkgPulse)](https://www.pkgpulse.com/blog/bun-test-vs-vitest-vs-jest-2026) — Vitest as 2026 default for TS libraries
- [tsup vs Rollup vs esbuild 2026 (PkgPulse)](https://www.pkgpulse.com/blog/tsup-vs-rollup-vs-esbuild-2026) — tsup as standard for TS package builds
- [pyright vs mypy (pydevtools)](https://pydevtools.com/handbook/explanation/how-do-mypy-pyright-and-ty-compare/) — "pyright in editor, mypy in CI" is the standard pattern
- [Documentation generator comparison 2025 (okidoki)](https://okidoki.dev/documentation-generator-comparison) — VitePress vs Docusaurus vs MkDocs feature matrix
- [Ruff docs](https://docs.astral.sh/ruff/faq/) — replacement scope (flake8, black, isort)
- [claude-agent-sdk-python subprocess transport (DeepWiki)](https://deepwiki.com/anthropics/claude-agent-sdk-python) — confirmed `anyio.open_process()` + task group pattern

**LOW confidence / unverified:**
- Specific dependency pins inside `@anthropic-ai/claude-agent-sdk`'s package.json (WebFetch returned 404 against raw.githubusercontent.com; the README confirms Node 18+ and the CHANGELOG confirms it's tsup-compatible, but I could not directly inspect devDependencies). Recommendation: when Phase 0 research kicks off, clone the repo locally and audit package.json directly for the one or two pins this STACK.md states with authority but could not verify.
- Exact tsup version in current claude-agent-sdk-typescript releases — unverified but irrelevant (tsup is our choice on its own merits).

---
*Stack research for: Gemini CLI SDK (TypeScript + Python subprocess wrapper)*
*Researched: 2026-04-11*
