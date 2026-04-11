# Requirements: Gemini CLI SDK

**Defined:** 2026-04-11
**Core Value:** A developer can drop this SDK into a TypeScript or Python project and drive `gemini-cli` programmatically with an API that feels like the Claude Agent SDK — and specifically, can use it to add Gemini as a third AI assistant inside Archon (coleam00/Archon) alongside Claude and Codex. Done = `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in Archon.

## v1 Requirements

Requirements for initial release. Each maps to a roadmap phase.

### Foundation

- [ ] **FDN-01**: SDK locates the `gemini` binary via `cliPath` option → `GEMINI_BIN_PATH` env var → `PATH` → known install locations
- [ ] **FDN-02**: SDK spawns `gemini-cli` using `child_process.spawn` (TS) / `anyio.open_process` (Python), never `exec`/`run`
- [ ] **FDN-03**: SDK handles Windows `.cmd`/`.bat` shims safely (CVE-2024-27980) with array argv and selective `shell: true`
- [ ] **FDN-04**: SDK forces UTF-8 at subprocess spawn and decodes stderr/stdout with replacement on error
- [ ] **FDN-05**: SDK hides subprocess windows on Windows (`windowsHide: true` / `CREATE_NO_WINDOW`)
- [ ] **FDN-06**: SDK escalates SIGTERM → 5s grace → SIGKILL on Unix; uses `taskkill /T /F` or `psutil` tree-kill on Windows
- [ ] **FDN-07**: SDK builds a clean subprocess env dict via allowlist (mirrors Archon's `buildCleanSubprocessEnv` pattern)
- [ ] **FDN-08**: SDK ships `SpawnPerCallStrategy` behind a pluggable `ProcessStrategy` interface so pool/long-lived variants are non-breaking swaps
- [ ] **FDN-09**: `ProcessManager` detects orphan MCP grandchildren and cleans them up on parent exit

### Parsing

- [ ] **PRS-01**: SDK parses `--output-format stream-json` NDJSON with a stateful UTF-8 decoder and 1 MiB line limit
- [ ] **PRS-02**: NDJSON parser tolerates CRLF line endings
- [ ] **PRS-03**: NDJSON parser is lenient — unknown event types yield `{type: 'unknown', raw}` and never throw
- [ ] **PRS-04**: Non-JSON stdout lines yield `{type: 'cli_log'}` events and never throw
- [ ] **PRS-05**: `EventDispatcher` maps parsed events into a normalized `MessageChunk` discriminated union
- [ ] **PRS-06**: SDK emits shapes compatible with Archon's `MessageChunk` type (8 variants: `assistant | system | thinking | result | rate_limit | tool | tool_result | workflow_dispatch`)
- [ ] **PRS-07**: SDK guarantees `tool_use` and `tool_result` chunks are always paired (per Archon's `claude.ts` correctness bar)
- [ ] **PRS-08**: Shared JSON Schema at `spec/events.schema.json` generates TS types (via `json-schema-to-typescript`) and Pydantic models (via `datamodel-code-generator`)
- [ ] **PRS-09**: Shared fixture corpus at `spec/fixtures/*.ndjson` with sibling `.expected.json` files; TS and Python suites both run it in CI

### Query API

- [ ] **API-01**: Public `query(options): AsyncIterable<MessageChunk>` is the only public entry point
- [ ] **API-02**: Pure-function `buildArgv(options): string[]` translates typed options to argv with no filesystem/env/spawn side effects
- [ ] **API-03**: `query()` owns subprocess lifecycle — spawns on first iteration, kills on early break or cancel
- [ ] **API-04**: `query()` accepts `options.abortSignal` (TS) / `cancel_scope` (Python) for cancellation
- [ ] **API-05**: SDK provides a non-streaming helper (accumulates into a single result) as a wrapper over `query()`
- [ ] **API-06**: Raw-event API is available alongside the high-level mapped generator

### Model Selection

- [ ] **MDL-01**: SDK exposes a typed model enum with known Gemini models (e.g. `latest`, `auto`, `2.5-flash` `@deprecated`, `2.5-pro` `@deprecated`)
- [ ] **MDL-02**: SDK accepts a raw string for model selection as an escape hatch for unknown/future models
- [ ] **MDL-03**: Default model is `latest` / `auto`, NOT a pinned 2.5 string (2.5 series EOL 2026-06-17)
- [ ] **MDL-04**: SDK inspects the `init` event's `model` field, compares to requested, surfaces a non-fatal `ModelDowngradeWarning` in the `result` chunk on mismatch

### System Prompt

- [ ] **SYS-01**: `options.systemPrompt` writes a temp `.md` file and points `GEMINI_SYSTEM_MD` at it via spawn env
- [ ] **SYS-02**: Temp system-prompt file is cleaned up in `finally` (even on error/cancel)

### Workspace Context

- [ ] **CWD-01**: `options.cwd` sets subprocess working directory
- [ ] **CWD-02**: `options.additionalDirectories` maps to `--include-directories` flag

### Sessions / Multi-Turn

- [ ] **SES-01**: SDK captures session ID from the `stream-json` `init` event
- [ ] **SES-02**: SDK resumes a session by passing `--resume <id>` when `resumeSessionId` is provided
- [ ] **SES-03**: SDK provides a `Session` value object (immutable, identifier-based; NOT process-bound)
- [ ] **SES-04**: SDK includes a transcript-prepend fallback inside `Session` in case gemini-cli issue #14180 (`--resume` + `-p` interop) proves unresolvable — fallback lives inside `Session` + `ArgvBuilder` only

### Tools

- [ ] **TOL-01**: SDK passes `options.allowedTools` to `--allowed-tools` / Policy Engine (whichever is current)
- [ ] **TOL-02**: SDK passes `options.approvalMode` to `--approval-mode` (`default` | `auto_edit` | `yolo` | `plan`)
- [ ] **TOL-03**: `--allowed-tools` → Policy Engine migration is handled gracefully (runtime compat matrix check)
- [ ] **TOL-04**: SDK documents that caller-defined custom tool definitions are NOT supported in v1.0 — only built-in gemini-cli tools + MCP passthrough

### MCP Passthrough

- [ ] **MCP-01**: SDK accepts `options.mcpServers` (map of server name → config) and writes a temp `settings.json` fragment
- [ ] **MCP-02**: SDK uses an isolated temp `GEMINI_CONFIG_DIR` per query — NEVER mutates user's real `~/.gemini/settings.json`
- [ ] **MCP-03**: SDK gates which MCP servers gemini-cli can use via `--allowed-mcp-server-names`
- [ ] **MCP-04**: Temp config dir is cleaned up in `finally` (even on error/cancel)

### Authentication

- [ ] **AUT-01**: Gemini API key auth (`GEMINI_API_KEY`) is the canonical default
- [ ] **AUT-02**: SDK supports Vertex AI auth via service account JSON (`GOOGLE_APPLICATION_CREDENTIALS`) when explicitly selected
- [ ] **AUT-03**: SDK supports Vertex AI auth via Google Cloud API key (`GOOGLE_API_KEY`) as an alternative Vertex path
- [ ] **AUT-04**: SDK passes through `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT_ID` / `GOOGLE_CLOUD_LOCATION` for Vertex project+region scoping
- [ ] **AUT-05**: SDK supports Sign-in-with-Google / ADC fallback (picked up transparently if already configured) but NEVER automates interactive OAuth login
- [ ] **AUT-06**: SDK warns at runtime if multiple auth modes are configured, documenting precedence: `GEMINI_API_KEY` > `GOOGLE_APPLICATION_CREDENTIALS` > `GOOGLE_API_KEY` > ADC/OAuth fallback
- [ ] **AUT-07**: Typed `AuthError` subtypes distinguish `NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation`
- [ ] **AUT-08**: SDK documentation links gemini-cli discussion #22970 and Google's FAQ ToS warning so users understand why API key is the default
- [ ] **AUT-09**: SDK documentation explicitly notes that **there is no `GOOGLE_AUTH_TOKEN` passthrough** and no env-var path for supplying a pre-obtained short-lived OAuth access token — users with bearer tokens must substitute service account JSON or `GOOGLE_API_KEY`

### Structured Output (best-effort)

- [ ] **OUT-01**: `options.outputSchema` / `responseFormat` enables best-effort JSON schema mode
- [ ] **OUT-02**: Best-effort mode injects schema guidance into the system prompt + runtime-validates output with Zod/Pydantic
- [ ] **OUT-03**: Best-effort mode retries ONCE with validation feedback on failure, then raises `SchemaValidationError`
- [ ] **OUT-04**: Structured output is marked `@experimental` in types and docs; limitations are clearly documented (wait for upstream #13388)

### Error Taxonomy

- [ ] **ERR-01**: SDK defines a typed error hierarchy: `GeminiError` base + `RateLimitError`, `AuthError` (with subtypes), `ModelAccessError`, `InvalidPromptError`, `ProcessError`, `ProcessCrashError`, `ParseError`, `AbortError`, `UnsupportedFeatureError`, `GeminiNotFoundError`
- [ ] **ERR-02**: Every error carries `.retryable: boolean` and optional `.retryAfterMs?: number`
- [ ] **ERR-03**: Error classes map 1:1 to Archon's 5 retry buckets: `rate_limit` / `auth` / `model_access` / `crash` / `unknown`
- [ ] **ERR-04**: `ErrorMapper` pattern-matches `(exit code, stderr tail, last events)` into typed errors; pattern table versioned in `spec/errors.md`
- [ ] **ERR-05**: Stream-json `error` events and exit-code + stderr matching both produce the same typed errors (two code paths, one taxonomy)
- [ ] **ERR-06**: SDK raises `ProcessError` if the stream ends without a terminal `result` event, even on exit code 0
- [ ] **ERR-07**: A CI linter cross-checks `spec/errors.md` against both TS and Python implementations

### Cross-Platform

- [ ] **PLT-01**: TS package works on Windows, macOS, and Linux at v1 launch
- [ ] **PLT-02**: Python package works on Windows, macOS, and Linux at v1 launch
- [ ] **PLT-03**: CI matrix runs `{ubuntu, macos, windows} × {node 18/20/22} × {python 3.10–3.13}` — Windows is a required job, NOT `continue-on-error`
- [ ] **PLT-04**: Python uses `anyio` on top of asyncio/trio; Windows subprocess handling uses ProactorEventLoop correctly
- [ ] **PLT-05**: CI includes at least one non-en-US Windows runner to catch encoding mojibake

### Archon Integration

- [ ] **ARC-01**: This repo contains an `adapter-archon/` subpackage that implements Archon's `IAssistantClient` interface
- [ ] **ARC-02**: `GeminiClient.sendQuery(prompt, cwd, resumeSessionId?, options?): AsyncGenerator<MessageChunk>` matches Archon's signature exactly
- [ ] **ARC-03**: `GeminiClient.getType()` returns `'gemini'`
- [ ] **ARC-04**: Adapter subpackage source-publishes `.ts` (matches Archon's Bun-based monorepo convention)
- [ ] **ARC-05**: Adapter translates `AssistantRequestOptions` fields to SDK options (11 fully honored, 4 partially, 4 deferred, 5 silently ignored per Claude/Codex precedent)
- [ ] **ARC-06**: Adapter is thin (~200 LOC target) with business logic in the SDK
- [ ] **ARC-07**: Contract tests prove `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in a real Archon checkout
- [ ] **ARC-08**: PR opened against `coleam00/Archon` adding `packages/core/src/clients/gemini.ts` + 3-line `factory.ts` edit + `.env.example` entries
- [ ] **ARC-09**: Env-var namespace discipline: only `GEMINI_*` and `GEMINI_SDK_*` names used (no collisions with Archon's Claude/Codex vars)

### Parity (TS ↔ Python)

- [ ] **PAR-01**: TypeScript is the canonical implementation; Python is a mechanical port with matching file layout
- [ ] **PAR-02**: Both language suites consume the same `spec/fixtures/*.ndjson` in CI
- [ ] **PAR-03**: Parity CI job diffs test names across TS and Python and blocks merge on divergence
- [ ] **PAR-04**: Both SDKs ship with a single shared version number
- [ ] **PAR-05**: Error taxonomy is generated from one YAML source consumed by both SDKs

### Documentation

- [ ] **DOC-01**: Hosted doc site is published (VitePress + mkdocs-material, single site with two sections)
- [ ] **DOC-02**: Quickstart guide covers installing `gemini-cli` (required prerequisite), obtaining an API key, first `query()` call, first multi-turn session, first MCP server
- [ ] **DOC-03**: API reference is auto-generated from types (typedoc for TS, mkdocstrings for Python)
- [ ] **DOC-04**: Compat matrix documents supported `gemini-cli` version range with runtime `gemini --version` warning
- [ ] **DOC-05**: Known-issues appendix links the live gemini-cli bugs the SDK defends against (#14180, #13388, #3485 et al., encoding issues, OAuth 403)
- [ ] **DOC-06**: Migration guide for users coming from Claude Agent SDK / Codex SDK
- [ ] **DOC-07**: Archon integration guide shows how to configure `DEFAULT_AI_ASSISTANT=gemini`

### Release & Publishing

- [ ] **REL-01**: TS package published to npm via changesets
- [ ] **REL-02**: Python package published to PyPI via `uv publish` + trusted publishing
- [ ] **REL-03**: MIT license in root LICENSE file
- [ ] **REL-04**: CHANGELOG.md maintained via changesets (TS) and mirrored in Python release notes
- [ ] **REL-05**: `gemini-cli` is declared a runtime prerequisite (NOT bundled, NOT auto-installed)
- [ ] **REL-06**: Runtime version probe warns if detected `gemini-cli` version is outside tested range (warn-not-error)
- [ ] **REL-07**: v1.0.0 tagged only when Archon adapter PR merges and `DEFAULT_AI_ASSISTANT=gemini` is confirmed working

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Programmatic Hooks

- **HOK-01**: SDK accepts `options.hooks = { beforeTool, afterTool, beforeModel, ... }` callbacks
- **HOK-02**: SDK ships a hook-bridge subprocess layer — a tiny SDK-owned hook script registered via temp `settings.json` fragment, relaying JSON over local socket/named pipe IPC
- **HOK-03**: Initial subset covers `BeforeTool`, `AfterTool`, `SessionStart`, `SessionEnd`
- **HOK-04**: Hook bridge handles Windows named-pipes IPC reliably

### Caller-Defined Tools

- **CTL-01**: SDK ships an in-process stub MCP server that exposes caller-provided JavaScript/Python tool functions to gemini-cli
- **CTL-02**: Stub MCP server is registered via temp `settings.json` fragment + `--allowed-mcp-server-names`
- **CTL-03**: Round-trip integration tested against golden-file fixtures

### Long-Lived / Pool Concurrency

- **CON-01**: `LongLivedStrategy` keeps a `gemini-cli` process piped in non-interactive mode for lower per-call overhead
- **CON-02**: `PoolStrategy` manages a pool of `N` reusable processes with checkout/return semantics
- **CON-03**: Strategy choice is a non-breaking runtime option (public `query()` API unchanged)

### Rust SDK

- **RST-01**: Rust crate wrapping `gemini-cli` with the same SDK shape
- **RST-02**: Behaviorally consistent with TS and Python (fixture corpus parity)
- **RST-03**: Dual MIT/Apache-2.0 license for Rust-ecosystem convention

### Additional Session Features

- **SES-V2-01**: `forkSession(id)` — create a branch from a checkpoint (depends on checkpoint-file format stability)
- **SES-V2-02**: Durable session serialization if `--resume` + `-p` remains unreliable upstream

### Cost Tracking

- **COS-01**: Token usage and cost estimation helpers (not hard enforcement)
- **COS-02**: Per-session cumulative tracking

### Subagents

- **SUB-01**: Subagent support via gemini-cli skills-file bridging (pattern TBD — may require upstream feature)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Guaranteed JSON-schema output enforcement | Blocked on upstream gemini-cli issue #13388 — no ETA. v1 ships best-effort only (OUT-01 et al.) and documents the limitation. |
| In-process tool execution (Claude-style JS callbacks) without MCP | Requires caller-defined tools (v2), which itself requires the stub MCP server. Not v1. |
| `thinking` / `effort` options | Not exposed by gemini-cli (Archon's type already marks these Claude-only; silently ignored by the adapter). |
| `fallbackModel` / `maxBudgetUsd` / `betas` / `persistSession` / `forkSession` in v1 | Not exposed by gemini-cli; Archon already marks these Claude-only or Codex-only. Silently ignored per precedent. |
| Interactive user-confirmation round-trip | Headless mode doesn't surface an approval prompt to SDK callers. Use `--approval-mode yolo` or `auto_edit` in non-interactive contexts. |
| Wrapping gemini-cli's interactive REPL | SDK is headless-only. Interactive use = run gemini-cli directly. |
| Auto-installing `gemini-cli` | Rejected. Users install and manage their own binary (matches Archon's Codex pattern). |
| Bundling `gemini-cli` as a package dependency | Same reasoning — users own version choice and auth. |
| Native Node.js library integration with gemini-cli | No library entry point exists in gemini-cli; subprocess is the only realistic path. |
| Separate reference "code automation" demo app | Archon integration IS the dogfood; a separate demo would duplicate effort. |
| Writing to user's real `~/.gemini/settings.json` | Never. Always temp `GEMINI_CONFIG_DIR` per query. |
| Real-time hard budget enforcement | Gemini CLI doesn't expose streaming cost hooks. Best-effort tracking in v2 only. |
| SDK-internal subprocess-crash retry loops | SDK classifies errors; the consumer (e.g. Archon's workflow executor) decides retry policy. |
| Byte-for-byte Claude Agent SDK format mimicry | Spirit, not letter — SDK is Gemini-idiomatic where it diverges. |
| Emulating Claude's `permissionMode` names exactly | Use gemini-cli's `--approval-mode` vocabulary (`default`/`auto_edit`/`yolo`/`plan`). |
| Extension install / management | Out of scope — use gemini-cli's `--extensions` flag passthrough only. |

## Traceability

Populated during roadmap creation. All v1 requirements will map to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (to be filled by gsd-roadmapper) | — | Pending |

**Coverage:**
- v1 requirements: 87 total (to be confirmed by traceability pass)
- Mapped to phases: 0
- Unmapped: 87 ⚠️

---
*Requirements defined: 2026-04-11*
*Last updated: 2026-04-11 after initial definition*
