# Requirements: Gemini CLI SDK

**Defined:** 2026-04-11
**Core Value:** A developer can drop this SDK into a TypeScript or Python project and drive `gemini-cli` programmatically with an API that feels like the Claude Agent SDK — and specifically, can use it to add Gemini as a third AI assistant inside Archon (coleam00/Archon) alongside Claude and Codex. Done = `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in Archon.

## v1 Requirements

Requirements for initial release. Each maps to a roadmap phase.

### Foundation

- [x] **FDN-01**: SDK locates the `gemini` binary via `cliPath` option → `GEMINI_BIN_PATH` env var → `PATH` → known install locations
- [x] **FDN-02**: SDK spawns `gemini-cli` using `child_process.spawn` (TS) / `anyio.open_process` (Python), never `exec`/`run`
- [x] **FDN-03**: SDK handles Windows `.cmd`/`.bat` shims safely (CVE-2024-27980) with array argv and selective `shell: true`
- [x] **FDN-04**: SDK forces UTF-8 at subprocess spawn and decodes stderr/stdout with replacement on error
- [x] **FDN-05**: SDK hides subprocess windows on Windows (`windowsHide: true` / `CREATE_NO_WINDOW`)
- [x] **FDN-06**: SDK escalates SIGTERM → 5s grace → SIGKILL on Unix; uses `taskkill /T /F` or `psutil` tree-kill on Windows
- [x] **FDN-07**: SDK builds a clean subprocess env dict via allowlist (mirrors Archon's `buildCleanSubprocessEnv` pattern)
- [x] **FDN-08**: SDK ships `SpawnPerCallStrategy` behind a pluggable `ProcessStrategy` interface so pool/long-lived variants are non-breaking swaps
- [x] **FDN-09**: `ProcessManager` detects orphan MCP grandchildren and cleans them up on parent exit

### Parsing

- [x] **PRS-01**: SDK parses `--output-format stream-json` NDJSON with a stateful UTF-8 decoder and 1 MiB line limit
- [x] **PRS-02**: NDJSON parser tolerates CRLF line endings
- [x] **PRS-03**: NDJSON parser is lenient — unknown event types yield `{type: 'unknown', raw}` and never throw
- [x] **PRS-04**: Non-JSON stdout lines yield `{type: 'cli_log'}` events and never throw
- [x] **PRS-05**: `EventDispatcher` maps parsed events into a normalized `MessageChunk` discriminated union
- [x] **PRS-06**: SDK emits shapes compatible with Archon's `MessageChunk` type (8 variants: `assistant | system | thinking | result | rate_limit | tool | tool_result | workflow_dispatch`)
- [x] **PRS-07**: SDK guarantees `tool_use` and `tool_result` chunks are always paired (per Archon's `claude.ts` correctness bar)
- [x] **PRS-08**: Shared JSON Schema at `spec/events.schema.json` generates TS types (via `json-schema-to-typescript`) and Pydantic models (via `datamodel-code-generator`)
- [x] **PRS-09**: Shared fixture corpus at `spec/fixtures/*.ndjson` with sibling `.expected.json` files; TS and Python suites both run it in CI

### Query API

- [x] **API-01**: Public `query(options): AsyncIterable<MessageChunk>` is the only public entry point
- [x] **API-02**: Pure-function `buildArgv(options): string[]` translates typed options to argv with no filesystem/env/spawn side effects
- [x] **API-03**: `query()` owns subprocess lifecycle — spawns on first iteration, kills on early break or cancel
- [x] **API-04**: `query()` accepts `options.abortSignal` (TS) / `cancel_scope` (Python) for cancellation
- [x] **API-05**: SDK provides a non-streaming helper (accumulates into a single result) as a wrapper over `query()`
- [x] **API-06**: Raw-event API is available alongside the high-level mapped generator

### Model Selection

- [x] **MDL-01**: SDK exposes a typed model enum with known Gemini models (e.g. `latest`, `auto`, `2.5-flash` `@deprecated`, `2.5-pro` `@deprecated`)
- [x] **MDL-02**: SDK accepts a raw string for model selection as an escape hatch for unknown/future models
- [x] **MDL-03**: Default model is `latest` / `auto`, NOT a pinned 2.5 string (2.5 series EOL 2026-06-17)
- [x] **MDL-04**: SDK inspects the `init` event's `model` field, compares to requested, surfaces a non-fatal `ModelDowngradeWarning` in the `result` chunk on mismatch

### System Prompt

- [x] **SYS-01**: `options.systemPrompt` writes a temp `.md` file and points `GEMINI_SYSTEM_MD` at it via spawn env
- [x] **SYS-02**: Temp system-prompt file is cleaned up in `finally` (even on error/cancel)

### Workspace Context

- [x] **CWD-01**: `options.cwd` sets subprocess working directory
- [x] **CWD-02**: `options.additionalDirectories` maps to `--include-directories` flag

### Sessions / Multi-Turn

- [x] **SES-01**: SDK captures session ID from the `stream-json` `init` event
- [x] **SES-02**: SDK resumes a session by passing `--resume <id>` when `resumeSessionId` is provided
- [x] **SES-03**: SDK provides a `Session` value object (immutable, identifier-based; NOT process-bound)
- [x] **SES-04**: SDK includes a transcript-prepend fallback inside `Session` in case gemini-cli issue #14180 (`--resume` + `-p` interop) proves unresolvable — fallback lives inside `Session` + `ArgvBuilder` only

### Tools

- [x] **TOL-01**: SDK passes `options.allowedTools` to `--allowed-tools` / Policy Engine (whichever is current)
- [x] **TOL-02**: SDK passes `options.approvalMode` to `--approval-mode` (`default` | `auto_edit` | `yolo` | `plan`)
- [x] **TOL-03**: `--allowed-tools` → Policy Engine migration is handled gracefully (runtime compat matrix check)
- [x] **TOL-04**: SDK documents that caller-defined custom tool definitions are NOT supported in v1.0 — only built-in gemini-cli tools + MCP passthrough

### MCP Passthrough

- [ ] **MCP-01**: SDK accepts `options.mcpServers` (map of server name → config) and writes a temp `settings.json` fragment
- [ ] **MCP-02**: SDK uses an isolated temp `GEMINI_CONFIG_DIR` per query — NEVER mutates user's real `~/.gemini/settings.json`
- [ ] **MCP-03**: SDK gates which MCP servers gemini-cli can use via `--allowed-mcp-server-names`
- [ ] **MCP-04**: Temp config dir is cleaned up in `finally` (even on error/cancel)

### Authentication

- [x] **AUT-01**: Gemini API key auth (`GEMINI_API_KEY`) is the canonical default
- [x] **AUT-02**: SDK supports Vertex AI auth via service account JSON (`GOOGLE_APPLICATION_CREDENTIALS`) when explicitly selected
- [x] **AUT-03**: SDK supports Vertex AI auth via Google Cloud API key (`GOOGLE_API_KEY`) as an alternative Vertex path
- [x] **AUT-04**: SDK passes through `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT_ID` / `GOOGLE_CLOUD_LOCATION` for Vertex project+region scoping
- [x] **AUT-05**: SDK supports Sign-in-with-Google / ADC fallback (picked up transparently if already configured) but NEVER automates interactive OAuth login
- [x] **AUT-06**: SDK warns at runtime if multiple auth modes are configured, documenting precedence: `GEMINI_API_KEY` > `GOOGLE_APPLICATION_CREDENTIALS` > `GOOGLE_API_KEY` > ADC/OAuth fallback
- [x] **AUT-07**: Typed `AuthError` subtypes distinguish `NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation`
- [x] **AUT-08**: SDK documentation links gemini-cli discussion #22970 and Google's FAQ ToS warning so users understand why API key is the default
- [x] **AUT-09**: SDK documentation explicitly notes that **there is no `GOOGLE_AUTH_TOKEN` passthrough** and no env-var path for supplying a pre-obtained short-lived OAuth access token — users with bearer tokens must substitute service account JSON or `GOOGLE_API_KEY`

### Structured Output (best-effort)

- [x] **OUT-01**: `options.outputSchema` / `responseFormat` enables best-effort JSON schema mode
- [x] **OUT-02**: Best-effort mode injects schema guidance into the system prompt + runtime-validates output with Zod/Pydantic
- [x] **OUT-03**: Best-effort mode retries ONCE with validation feedback on failure, then raises `SchemaValidationError`
- [x] **OUT-04**: Structured output is marked `@experimental` in types and docs; limitations are clearly documented (wait for upstream #13388)

### Error Taxonomy

- [x] **ERR-01**: SDK defines a typed error hierarchy: `GeminiError` base + `RateLimitError`, `AuthError` (with subtypes), `ModelAccessError`, `InvalidPromptError`, `ProcessError`, `ProcessCrashError`, `ParseError`, `AbortError`, `UnsupportedFeatureError`, `GeminiNotFoundError`
- [x] **ERR-02**: Every error carries `.retryable: boolean` and optional `.retryAfterMs?: number`
- [x] **ERR-03**: Error classes map 1:1 to Archon's 5 retry buckets: `rate_limit` / `auth` / `model_access` / `crash` / `unknown`
- [x] **ERR-04**: `ErrorMapper` pattern-matches `(exit code, stderr tail, last events)` into typed errors; pattern table versioned in `spec/errors.md`
- [x] **ERR-05**: Stream-json `error` events and exit-code + stderr matching both produce the same typed errors (two code paths, one taxonomy)
- [x] **ERR-06**: SDK raises `ProcessError` if the stream ends without a terminal `result` event, even on exit code 0
- [x] **ERR-07**: A CI linter cross-checks `spec/errors.md` against both TS and Python implementations

### Cross-Platform

- [ ] **PLT-01**: TS package works on Windows, macOS, and Linux at v1 launch
- [ ] **PLT-02**: Python package works on Windows, macOS, and Linux at v1 launch
- [x] **PLT-03**: CI matrix runs `{ubuntu, macos, windows} × {node 18/20/22} × {python 3.10–3.13}` — Windows is a required job, NOT `continue-on-error`
- [x] **PLT-04**: Python uses `anyio` on top of asyncio/trio; Windows subprocess handling uses ProactorEventLoop correctly
- [x] **PLT-05**: CI includes at least one non-en-US Windows runner to catch encoding mojibake

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

- [x] **PAR-01**: TypeScript is the canonical implementation; Python is a mechanical port with matching file layout
- [x] **PAR-02**: Both language suites consume the same `spec/fixtures/*.ndjson` in CI
- [x] **PAR-03**: Parity CI job diffs test names across TS and Python and blocks merge on divergence
- [x] **PAR-04**: Both SDKs ship with a single shared version number
- [x] **PAR-05**: Error taxonomy is generated from one YAML source consumed by both SDKs

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

All v1 requirements map to exactly one phase. Coverage: 102/102.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FDN-01 | Phase 2 | Complete |
| FDN-02 | Phase 2 | Complete |
| FDN-03 | Phase 2 | Complete |
| FDN-04 | Phase 2 | Complete |
| FDN-05 | Phase 2 | Complete |
| FDN-06 | Phase 2 | Complete |
| FDN-07 | Phase 2 | Complete |
| FDN-08 | Phase 2 | Complete |
| FDN-09 | Phase 2 | Complete |
| PRS-01 | Phase 3 | Complete |
| PRS-02 | Phase 3 | Complete |
| PRS-03 | Phase 3 | Complete |
| PRS-04 | Phase 3 | Complete |
| PRS-05 | Phase 3 | Complete |
| PRS-06 | Phase 3 | Complete |
| PRS-07 | Phase 3 | Complete |
| PRS-08 | Phase 1 | Complete |
| PRS-09 | Phase 1 | Complete |
| API-01 | Phase 4 | Complete |
| API-02 | Phase 4 | Complete |
| API-03 | Phase 4 | Complete |
| API-04 | Phase 4 | Complete |
| API-05 | Phase 4 | Complete |
| API-06 | Phase 4 | Complete |
| MDL-01 | Phase 4 | Complete |
| MDL-02 | Phase 4 | Complete |
| MDL-03 | Phase 4 | Complete |
| MDL-04 | Phase 4 | Complete |
| SYS-01 | Phase 4 | Complete |
| SYS-02 | Phase 4 | Complete |
| CWD-01 | Phase 4 | Complete |
| CWD-02 | Phase 4 | Complete |
| SES-01 | Phase 7 | Complete |
| SES-02 | Phase 7 | Complete |
| SES-03 | Phase 7 | Complete |
| SES-04 | Phase 7 | Complete |
| TOL-01 | Phase 8 | Complete |
| TOL-02 | Phase 8 | Complete |
| TOL-03 | Phase 8 | Complete |
| TOL-04 | Phase 8 | Complete |
| MCP-01 | Phase 9 | Pending |
| MCP-02 | Phase 9 | Pending |
| MCP-03 | Phase 9 | Pending |
| MCP-04 | Phase 9 | Pending |
| AUT-01 | Phase 6 | Complete |
| AUT-02 | Phase 6 | Complete |
| AUT-03 | Phase 6 | Complete |
| AUT-04 | Phase 6 | Complete |
| AUT-05 | Phase 6 | Complete |
| AUT-06 | Phase 6 | Complete |
| AUT-07 | Phase 6 | Complete |
| AUT-08 | Phase 6 | Complete |
| AUT-09 | Phase 6 | Complete |
| OUT-01 | Phase 8 | Complete |
| OUT-02 | Phase 8 | Complete |
| OUT-03 | Phase 8 | Complete |
| OUT-04 | Phase 8 | Complete |
| ERR-01 | Phase 5 | Complete |
| ERR-02 | Phase 5 | Complete |
| ERR-03 | Phase 5 | Complete |
| ERR-04 | Phase 5 | Complete |
| ERR-05 | Phase 5 | Complete |
| ERR-06 | Phase 5 | Complete |
| ERR-07 | Phase 5 | Complete |
| PLT-01 | Phase 11 | Pending |
| PLT-02 | Phase 11 | Pending |
| PLT-03 | Phase 2 | Complete |
| PLT-04 | Phase 2 | Complete |
| PLT-05 | Phase 2 | Complete |
| ARC-01 | Phase 10 | Pending |
| ARC-02 | Phase 10 | Pending |
| ARC-03 | Phase 10 | Pending |
| ARC-04 | Phase 10 | Pending |
| ARC-05 | Phase 10 | Pending |
| ARC-06 | Phase 10 | Pending |
| ARC-07 | Phase 10 | Pending |
| ARC-08 | Phase 10 | Pending |
| ARC-09 | Phase 10 | Pending |
| PAR-01 | Phase 2 | Complete |
| PAR-02 | Phase 3 | Complete |
| PAR-03 | Phase 2 | Complete |
| PAR-04 | Phase 2 | Complete |
| PAR-05 | Phase 5 | Complete |
| DOC-01 | Phase 11 | Pending |
| DOC-02 | Phase 11 | Pending |
| DOC-03 | Phase 11 | Pending |
| DOC-04 | Phase 11 | Pending |
| DOC-05 | Phase 11 | Pending |
| DOC-06 | Phase 11 | Pending |
| DOC-07 | Phase 11 | Pending |
| REL-01 | Phase 11 | Pending |
| REL-02 | Phase 11 | Pending |
| REL-03 | Phase 11 | Pending |
| REL-04 | Phase 11 | Pending |
| REL-05 | Phase 11 | Pending |
| REL-06 | Phase 11 | Pending |
| REL-07 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: 102 total
- Mapped to phases: 102
- Unmapped: 0

**Per-phase requirement count:**

| Phase | Requirements | IDs |
|-------|--------------|-----|
| 1. Feasibility Spike + Fixture Capture | 2 | PRS-08, PRS-09 |
| 2. Process Foundation + Workspace + CI Matrix | 15 | FDN-01..09, PLT-03, PLT-04, PLT-05, PAR-01, PAR-03, PAR-04 |
| 3. NDJSON Parser + EventDispatcher + MessageChunk Types | 8 | PRS-01..07, PAR-02 |
| 4. Public query() + ArgvBuilder + systemPrompt + Workspace + Model | 14 | API-01..06, SYS-01, SYS-02, CWD-01, CWD-02, MDL-01..04 |
| 5. Error Taxonomy + Archon 5-Bucket Mapping | 8 | ERR-01..07, PAR-05 |
| 6. Auth Environment | 9 | AUT-01..09 |
| 7. Session Resume + Multi-Turn | 4 | SES-01..04 |
| 8. Tools + Approval Mode + Structured Output | 8 | TOL-01..04, OUT-01..04 |
| 9. MCP Passthrough + Isolated Config Dir | 4 | MCP-01..04 |
| 10. Archon Adapter (TS only) | 9 | ARC-01..09 |
| 11. Docs Site + Compat Matrix + Release | 16 | DOC-01..07, REL-01..07, PLT-01, PLT-02 |

---
*Requirements defined: 2026-04-11*
*Last updated: 2026-04-11 — traceability populated by gsd-roadmapper (11 phases, 102/102 mapped)*
