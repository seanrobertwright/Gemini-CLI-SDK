# Project Research Summary

**Project:** Gemini CLI SDK (TypeScript + Python, wrapping `gemini-cli` as a subprocess; forcing function = Archon integration)
**Domain:** Dual-language SDK wrapping a fast-moving Node CLI via NDJSON subprocess streaming, targeting drop-in compatibility with Archon's `IAssistantClient` interface
**Researched:** 2026-04-11
**Confidence:** HIGH overall — every load-bearing claim was verified directly against upstream source (Archon `dev` branch, `gemini-cli` `main` branch, Claude Agent SDK + Codex SDK source), with MEDIUM confidence on a few empirical items (exact `stream-json` field-level schema, `--resume` + `-p` interop, `GEMINI_CONFIG_DIR` behavior) that Phase 1 smoke-tests must close.

---

## Executive Summary

This is a **thin, layered subprocess wrapper** in the exact mold of Claude Agent SDK and Codex SDK — not a new agent framework, not an API client, not a reimplementation of anything. The SDK spawns `gemini-cli` with `--output-format stream-json`, parses NDJSON events into a discriminated-union `MessageChunk` stream, classifies errors into typed exceptions, and yields everything through an async generator. There is **no hosted state, no database, no shared singletons**; multi-turn is stateless, achieved by passing a `sessionId` string (captured from the CLI's `init` event) back into the next call via `--resume`. Archon integration is ~150 lines of adapter glue that maps SDK types to Archon's `IAssistantClient` contract.

The research surfaced a **much more capable `gemini-cli` than PROJECT.md assumed**: system-prompt override is first-class (`GEMINI_SYSTEM_MD` env var, not a workaround), hooks are a full lifecycle system (11 events, decision semantics, but file-configured so the SDK needs a hook-bridge subprocess layer), multi-turn resume is mechanically supported via `--resume` + the stream-json `init` event, and MCP passthrough is first-class. The **real blockers** are narrower than expected: (a) caller-defined custom tools have no direct path — the only viable mechanism is an in-process stub MCP server (LARGE; defer to v1.x), and (b) guaranteed JSON-schema output enforcement is tracked in gemini-cli issue #13388 with no ETA (use best-effort prompt injection + runtime validation, document as limitation). Everything else Archon needs is reachable in v1.

The **risk profile is dominated by upstream volatility, not design difficulty**. `gemini-cli` ships weekly, has ~2.4k open issues, and has active live bugs the SDK must defend against: silent model downgrades (Pro → Flash, multiple open issues), Windows encoding mojibake (issues #4945 / #20186 / #15389), post-March-2026 Google routing changes that broke OAuth for many paid users (discussion #22970, making API key the only sane production default), `--resume` + `-p` interop concerns (issue #14180), and Gemini 2.5 Flash/Pro **deprecating on 2026-06-17** — nine weeks out. Mitigation: defensive NDJSON parsing (never throw on unknown events), empirical fixture-driven development (capture real CLI output before writing parsers), a published compat matrix with runtime version probe, typed errors that map **exactly** to Archon's 5-bucket retry classifier (`rate_limit` / `auth` / `model_access` / `crash` / `unknown`), and shared fixture tests enforcing TS ↔ Python parity.

---

## Critical Corrections to PROJECT.md Assumptions

These are the factual corrections research discovered against PROJECT.md. They **must** be preserved through roadmap and requirements phases — re-making these mistakes would cost weeks.

1. **Archon AI clients live in `packages/core/src/clients/`, NOT `packages/adapters/`.** PROJECT.md line 45 says `packages/adapters/` — wrong. `packages/adapters/` is for platform adapters (Slack, Telegram, GitHub, Discord). AI assistants live in `packages/core/src/clients/{claude,codex,factory,index}.ts`. The `IAssistantClient` interface (from `packages/core/src/types/index.ts`) is:
   ```ts
   sendQuery(prompt: string, cwd: string, resumeSessionId?: string, options?: AssistantRequestOptions): AsyncGenerator<MessageChunk>
   getType(): string
   ```
   The Archon integration is a new `packages/core/src/clients/gemini.ts` file + a 3-line edit to `factory.ts` (`case 'gemini': return new GeminiClient()`) + `.env.example` entries for `GEMINI_API_KEY` / `GEMINI_BIN_PATH` matching the existing `CODEX_BIN_PATH` pattern.

2. **System prompt override is first-class, not a workaround.** PROJECT.md line 34 marks this "via workaround — approach TBD." It isn't. `GEMINI_SYSTEM_MD` is a real environment variable with three modes (`true` → `./.gemini/system.md`, file path, `false` → built-in). It's a **full replacement** (not merge), supports variable substitution, and works per-invocation. SDK strategy: write a temp `.md` file per query, point `GEMINI_SYSTEM_MD` at it via spawn env, clean up in `finally`. This is SMALL-complexity, not a research item. Source: geminicli.com/docs/cli/system-prompt/ + issue #3866.

3. **Hooks are a full lifecycle system — but file-configured, not programmatic.** PROJECT.md line 34 marks hooks "feasibility TBD." Feasibility is: **yes, but non-trivially.** `gemini-cli` supports 11 hook events (`BeforeTool`, `AfterTool`, `BeforeModel`, `BeforeToolSelection`, `AfterModel`, `BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `Notification`, `PreCompress`) with `allow`/`deny` decision semantics — comparable in power to Claude Agent SDK. **But hooks are exclusively configured in `settings.json` and execute as subprocesses that communicate via JSON on stdin/stdout.** There is no CLI flag to register hooks at invocation time. To expose programmatic `options.hooks` like Claude SDK, the SDK must ship a **hook-bridge subprocess layer**: write a temp `settings.json` fragment, register a tiny SDK-owned hook script that relays stdin JSON over a local socket/named pipe to the parent SDK process which runs the user callback, then writes the response JSON back. Feasible but LARGE; start with a subset (`BeforeTool`, `AfterTool`, `SessionStart`, `SessionEnd`). **Defer to v1.x unless Archon explicitly needs it in v1.** Source: docs/hooks/reference.md.

4. **Multi-turn resume works via `--resume <id>` — with a known live bug to defend against.** Session ID is captured from the `init` event in `stream-json` (not the legacy `--output-format json`, which has a gap tracked in issue #14435). **But gemini-cli issue #14180 says `--resume` may not interop with `-p` / positional prompts in headless mode.** The SDK must smoke-test this against a pinned version in Phase 1. **Fallback strategy, designed-in from day 1: transcript-prepend inside the `Session` value object** — store previous turns locally and prepend to the next `-p` invocation. Fallback fits the existing architecture — only `Session` and `ArgvBuilder` change.

5. **API key is the canonical default — NOT OAuth.** `gemini-cli`'s OAuth mode is actively broken post-March 2026 Google routing change. See discussion #22970 ("Service update: mitigating abuse and prioritizing traffic", March 25 2026) and a wall of 403 issues affecting even paid Google One / AI Premium / AI Ultra users (#16435, #24517, #24962, #14934, #10110, #22241). Google's own FAQ warns that third-party software piggybacking on gemini-cli's OAuth violates ToS. **Env var precedence:** `GEMINI_API_KEY` > `GOOGLE_APPLICATION_CREDENTIALS` (Vertex) > OAuth fallback, with a runtime warning if multiple are set. Never automate OAuth login. Typed `AuthError` subtypes distinguish `NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation`.

6. **Silent model downgrade is a live bug the SDK must catch.** Multiple open issues (#3485, #3425, #2470, #8269, #11650) show `gemini-cli` silently downgrading Pro → Flash mid-session. SDK must **inspect the `init` event's `model` field, compare to the requested model, and surface a non-fatal `ModelDowngradeWarning` in the `result` chunk** if they differ. **Gemini 2.5 Flash and 2.5 Pro deprecate on 2026-06-17 (nine weeks from research date).** Default model must be `latest` / `auto`, not a pinned 2.5 string. Typed model enum marks 2.5-series `@deprecated`.

7. **Two real blockers, both larger than PROJECT.md assumed.**
   - **Caller-defined tools (W1):** no direct path. Earlier `tools.discoveryCommand` / `tools.callCommand` settings keys do **not** appear in current `docs/cli/settings.md`. Only realistic v1 mechanism is an in-process stub MCP server the SDK spins up, registers caller's tool definitions with, and hands to gemini-cli via `settings.json` + `--allowed-mcp-server-names`. This is LARGE and collides with known MCP fragility (#2654, #3406, #20694, #17787, #23296, #13604). **Recommend deferring to v1.x.** v1 documents MCP passthrough only.
   - **Guaranteed JSON-schema output enforcement (W2/B1):** no CLI flag; tracked in open issue #13388 (`priority/p2`, `help wanted`, no ETA). Fallback is best-effort prompt injection into `GEMINI_SYSTEM_MD` + runtime Ajv/pydantic validation with optional single-retry. **Cannot guarantee schema adherence** — document as best-effort.

8. **Archon uses Bun + source-published `.ts` exports** (`"main": "./src/index.ts"`, no compile step for internal packages). The **Archon-adapter subpackage must source-publish `.ts`** to match Archon's monorepo convention; the **core SDK still ships compiled** (tsup dual ESM+CJS+`.d.ts`) to npm for third-party consumers. **Two different publish strategies in the same monorepo** — capture early in the build layer.

9. **Archon's retry classifier has exactly 5 buckets — the SDK error hierarchy must map to them 1:1.** Buckets are `rate_limit` / `auth` / `model_access` / `crash` / `unknown` (from Archon's `claude.ts`). SDK typed error hierarchy:
   - `RateLimitError` → `rate_limit`
   - `AuthError` (+ subtypes) → `auth`
   - `ModelAccessError` (403 for this model, not quota) → `model_access`
   - `ProcessError` / `ProcessCrashError` → `crash`
   - `InvalidPromptError`, `ParseError`, `UnsupportedFeatureError`, generic `GeminiError` → `unknown`

   Each error carries `.retryable: boolean` and optional `.retryAfterMs?: number` so Archon doesn't reverse-engineer it from the class name. Stream-json `error` events AND exit code + stderr pattern matching must both produce the same typed error — two code paths, one taxonomy.

---

## Key Findings

### Recommended Stack

**Polyglot monorepo** (`pnpm` workspace for TS, `uv` workspace-member for Python) with parallel `ts/` and `python/` trees, a root-level `spec/` directory holding normative protocol docs + golden NDJSON fixtures consumed by **both** language test suites (the parity-enforcement mechanism), and an `adapter-archon/` subpackage that source-publishes `.ts` for Archon's Bun-based import. GitHub Actions runs `{ubuntu, macos, windows} × {node 18/20/22} × {python 3.10–3.13}` with Windows as a **hard-required job, not `continue-on-error`**.

**Core technologies:**
- **Git + GitHub Actions + pnpm + uv** — polyglot workspace, matrix CI, changesets (npm) + `uv publish` (PyPI)
- **TypeScript 5.6.x + tsup 8.5 + Vitest 4 + tsx** — matches Claude Agent SDK; native `using` for subprocess lifecycle
- **Python 3.10+ + hatchling + anyio 4.10+ + pytest + ruff + mypy --strict** — matches `claude-agent-sdk-python` exactly; anyio gives cross-runtime (asyncio + trio) structured-concurrency subprocess handling
- **Native `child_process.spawn` (TS) / `anyio.open_process` (Python) — NOT execa, NOT tinyexec, NOT `asyncio.create_subprocess_exec` direct** — we need fine-grained control over stdin/stdout NDJSON pipes, Windows `CREATE_NO_WINDOW` / `windowsHide: true`, signal delivery, and structured-concurrency cancellation. The load-bearing decision.
- **Hand-rolled line-buffered NDJSON parser (~40 lines each)** — no `stream-json` / `ndjson` dependency; Claude Agent SDK hand-rolls its own for the same reasons.
- **Shared JSON Schema** for the event envelope → generates TS types (`json-schema-to-typescript`) + Pydantic models (`datamodel-code-generator`); both packages run the same fixture corpus in CI.
- **Zod (TS) + Pydantic (Python)** for runtime validation at every untrusted boundary.
- **VitePress (TS docs) + mkdocs-material (Python docs)** — single published site with two sections; typedoc + mkdocstrings for auto API reference.

See `.planning/research/STACK.md` for full rationale including the "what NOT to use" list.

### Expected Features

21-row feature matrix built from Claude Agent SDK + Codex SDK reference surfaces, mapped to `gemini-cli`'s real capabilities.

**Must have / table stakes (v1):**
- T1 Async streaming query (`stream-json` NDJSON parse → `MessageChunk`)
- T2 Non-streaming query (wrapper over T1)
- T3 Model selection (typed enum + string escape hatch, 2.5-series `@deprecated`)
- T4 Multi-turn session resume (`init` event → `--resume <id>`; transcript-prepend fallback for #14180)
- T5 System prompt override (temp file + `GEMINI_SYSTEM_MD`)
- T6 File / workspace context (`cwd` + `--include-directories`)
- T7 Built-in tool allow/deny (`--allowed-tools` / Policy Engine)
- T8 MCP passthrough via isolated `GEMINI_CONFIG_DIR` + `--allowed-mcp-server-names`
- T9 Approval mode (`--approval-mode default|auto_edit|yolo|plan`)
- T10 Auth modes (API key canonical, OAuth + Vertex supported, conflict warning)
- T11 Abort / cancellation (SIGTERM→SIGKILL, `taskkill /T /F` Windows process tree)
- T12 Typed error hierarchy mapping to Archon's 5-bucket classifier
- T13 Binary discovery (`GEMINI_BIN_PATH` → PATH → known install locations)
- T14 Windows + macOS + Linux first-class
- T15 Full `MessageChunk` mapping (Archon contract)

**Should have / differentiators (v1):**
- D3 TS + Python parity from day 1 (shared fixtures, shared error taxonomy YAML)
- D4 Hosted doc site
- D5 Per-invocation env injection
- D6 Raw-event API alongside the high-level mapped generator
- D7 `settings.json` merge helper with isolated config dir (never mutate user's real `~/.gemini/settings.json`)
- D8 Compat matrix + `gemini --version` runtime probe
- W2 Structured-output best-effort (prompt injection + validation + single retry), **clearly documented as best-effort**

**Defer (v1.x):**
- D1/W3 Programmatic hooks bridge (subprocess layer, local socket/named pipe IPC) — LARGE
- W1 Stub in-process MCP server for caller-defined tools — LARGEST risk item
- W4 Fork session (depends on checkpoint file format stability)
- W5 Cost budgeting helper (not enforcement)
- W6 Subagents via skills-file bridging

**Blocked (v1 documents as unsupported):**
- B1 Guaranteed JSON-schema output enforcement (wait for upstream #13388)
- B2 In-process tool execution (Claude-style JS callbacks) — requires W1
- B3/B4 `thinking`, `effort`, `fallbackModel`, `maxBudgetUsd`, `betas`, `persistSession`, `forkSession` — silently ignored (Archon's `AssistantRequestOptions` already marks these Claude-only)
- B5 Interactive user-confirmation round-trip

**Anti-features (explicitly NOT in v1):** wrapping the interactive REPL, auto-installing `gemini-cli`, bundling as dependency, reinventing tool execution parallel to MCP, byte-for-byte Claude-SDK format mimicry, emulating Claude's `permissionMode` names exactly, extension install/management, writing to user's real `~/.gemini/settings.json`, real-time hard budget enforcement, SDK-internal subprocess-crash retry loops.

See `.planning/research/FEATURES.md` for the full matrix, per-feature feasibility (Direct / Workaround / Blocked), and dependency graph.

### Architecture Approach

The SDK is a **stateless, layered wrapper** with a single public surface (`query()` async generator) and a strict one-file-responsibility internal structure. Data flows outbound as `query → Session → OptionsBuilder → BinaryResolver → ProcessManager → spawn()` and inbound as `stdout → LineReader → EventDispatcher → MessageChunk → yield`. Stderr flows separately into a bounded ring buffer, read only on failure by the `ErrorMapper`. The SDK holds **zero session state between calls**: multi-turn is a sessionId string the caller passes forward; `gemini-cli` owns the actual checkpoint store.

**Dual-language strategy:** TypeScript is the canonical implementation (Archon is TS; TS must be first and stay current). Python is a **mechanical port, module-for-module, one commit behind at worst** (matches Claude Agent SDK's cadence). Parity is enforced by a **shared fixture corpus at `/spec/fixtures/*.ndjson`** consumed by both language test suites — not by shared spec documents alone, which inevitably drift. Matching file layout (`ts/src/_internal/process/manager.ts` ↔ `python/src/gemini_sdk/_internal/process/manager.py`), matching test names, a CI job diffs the two test lists.

**Major components:**
1. **Public `query()` async generator** — only public surface; owns process lifecycle; yields parsed `MessageChunk` events; kills subprocess on early break / cancel.
2. **OptionsBuilder / ArgvBuilder (pure function)** — translates typed SDK options to `string[]` argv. No filesystem, no env, no spawn; 100% unit-testable. Isolates the 80% of subprocess-wrapper bugs that live in flag construction.
3. **BinaryResolver** — locates `gemini` / `gemini.exe` / `gemini.cmd` via `cliPath` → `GEMINI_BIN_PATH` → `PATH` → known install locations. Handles Windows `.cmd` + CVE-2024-27980 `shell: false` quirk (opt into `shell: true` only for resolved `.cmd`/`.bat` targets, with array argv).
4. **AuthEnvironment** — subprocess env dict with allowlist (mirrors Archon's `buildCleanSubprocessEnv`). API key canonical, OAuth/Vertex supported, conflict warnings.
5. **ProcessManager + pluggable ProcessStrategy interface** — ships `SpawnPerCallStrategy` in v1; strategy interface makes future `LongLivedStrategy` / `PoolStrategy` a non-breaking swap. Owns SIGTERM→5s grace→SIGKILL on Unix; `taskkill /T /F` or `psutil` on Windows for process tree.
6. **NDJSON Parser + EventDispatcher** — line-buffered reader with stateful UTF-8 decoder, 1 MiB line limit, **lenient fallback** (non-JSON lines become `{type:'cli_log'}` events, never throw), schema validation via Zod/Pydantic, dispatches to normalized `MessageChunk` union.
7. **ErrorMapper / classifier** — pattern-matches `(exit code, stderr, last events)` into typed `GeminiError` subclasses. Pattern table versioned in `spec/errors.md`, cross-checked by a CI linter.
8. **MCPPassthrough** — writes caller's `mcpServers` config to a temp `GEMINI_CONFIG_DIR`, gates via `--allowed-mcp-server-names`. Does NOT bridge to in-process callbacks in v1.
9. **Tool-Use Bridge (v1.x placeholder)** — stub in-process MCP server. Kept as a separate module so omitting it in v1 does not block anything else.
10. **Archon adapter** (`adapter-archon/gemini.ts`) — ~150 lines of translation glue. Lives in this repo during development; dropped into Archon's `packages/core/src/clients/gemini.ts` via PR when ready, with a 3-line `factory.ts` edit.

**Patterns used:** (1) Async-generator-as-public-API, (2) Argv-builder-as-pure-function, (3) Typed error hierarchy from stderr + exit code + event payloads, (4) Pluggable process strategy (ship one, design for three), (5) Line-buffered NDJSON reader with lenient fallback.

**Anti-patterns rejected:** exposing child-process handles in public API; `shell: true` with built command strings; buffering stdout to EOF (`exec` / `communicate()`); a single global shared subprocess in v1; speccing NDJSON schemas from docs alone; retry loops inside the SDK (SDK classifies, consumer retries).

See `.planning/research/ARCHITECTURE.md` for data-flow diagrams, component responsibility tables, 8 Windows subprocess rules, and the exact Archon adapter skeleton.

### Critical Pitfalls

Prioritized from 18 researched pitfalls, most backed by live `gemini-cli` issues:

1. **Stream-json is not a stable versioned wire protocol** (#8203, #22647). Parse defensively — never throw on unknown event types; yield `{type: 'unknown', raw}` instead. Golden-file tests against captured real-CLI output. **Phase:** Parsing (foundational).
2. **Subprocess buffering deadlocks / truncation** (Node `exec` 1 MB `maxBuffer`, Python `run(capture_output=True)`, ~64 KB OS pipe kernel buffer). Never use `exec`/`run`; always `spawn` + streaming line reader; always drain stderr in parallel. **Phase:** Foundation.
3. **Partial-line NDJSON parsing across chunk boundaries.** Use `readline` / `async for line in proc.stdout` or roll a proper line splitter with stateful UTF-8 decoder; trim `\r` for CRLF tolerance. **Phase:** Parsing.
4. **Orphan / zombie subprocesses on parent crash** (`gemini-cli` spawns MCP server children — see #13604). POSIX: `detached:true` / `start_new_session=True` + `killpg`. Windows: `CREATE_NEW_PROCESS_GROUP` + `taskkill /T /F` or `psutil` child enumeration. Integration test: kill parent mid-stream, verify no orphans. **Phase:** Foundation.
5. **Silent subprocess death** — stream ends cleanly on non-zero exit, SDK thinks query succeeded. Always `await proc.wait()`; raise `ProcessError{exitCode, stderr, partialEvents}` on non-zero; treat "stream ended without a terminal `result` event" as error even if exit code is 0. **Phase:** Foundation.
6. **Windows `.cmd` + CVE-2024-27980 `shell: false`** — Node's `spawn` refuses `.cmd`/`.bat` with `shell: false` since the CVE fix. Resolver must detect extension and selectively opt into `shell: true` with array argv. **Phase:** Foundation.
7. **Windows encoding mojibake** (live: #4945, #20186, #15389, #12468, #20661, #3015). Force UTF-8 at spawn; decode with `errors='replace'`; CI matrix must include a non-en-US Windows runner. **Phase:** Foundation + CI matrix.
8. **OAuth 403 blast radius + ToS risk** (#16435, #24517, #24962, #14934, #10110, #22241, discussion #22970). API key canonical default; typed `AuthError` subtypes; never automate OAuth login. **Phase:** Auth layer.
9. **Rate-limit mis-classification breaks Archon retry** (#22631). Error hierarchy must map 1:1 to Archon's 5 buckets with `.retryable` + `.retryAfterMs`. Contract test against Archon's adapter. **Phase:** Error taxonomy.
10. **Silent model downgrade** (#3485, #3425, #2470, #8269, #11650). Inspect `init` event, compare to requested model, surface `ModelDowngradeWarning`. Alias `latest` / `auto` as default. 2.5 series `@deprecated` (2026-06-17 EOL). **Phase:** Parsing + Model selection.
11. **Hooks/structured-output/system-prompt APIs that silently degrade** — leaky abstractions faking what the CLI doesn't natively support. Feasibility-audit *every* promise before declaring API types. Mark workaround-backed features `@experimental`. No silent degradation. **Phase:** Feasibility audit (done by this research).
12. **TS / Python parity drift.** Shared test corpus (YAML + NDJSON fixtures), parity CI job diffing outputs, single version number for both SDKs, error taxonomy generated from one YAML source. **Phase:** Foundation + every feature phase.
13. **Archon adapter breakage from upstream refactors** (#965 "Pi as third AI assistant provider" shows Archon is actively refactoring the adapter surface). Adapter is a thin shim (<200 LOC); business logic lives in the SDK. Contract tests live in Archon's repo. Env-var namespace discipline: `GEMINI_*` and `GEMINI_SDK_*` only. **Phase:** Adapter phase.

See `.planning/research/PITFALLS.md` for all 18 pitfalls with warning signs, phases to address, and direct issue references.

---

## Implications for Roadmap

Recommended phase structure: **11 phases**, strict bottom-up dependency graph, **TS and Python in lock-step** phases 2–8 (the only exception is Phase 10, Archon adapter, which is TS-only by definition).

### Phase 1: Feasibility spike + fixture capture
**Rationale:** Before writing any SDK code, capture real `gemini-cli` NDJSON into `spec/fixtures/*.ndjson` and smoke-test three load-bearing unknowns: (a) `--resume <id> -p "follow-up"` preserves context (#14180), (b) `GEMINI_CONFIG_DIR` / equivalent redirects settings lookup for isolated MCP/hooks config, (c) `stream-json` flushes per-event (not block-buffered to 64 KB). Pin the first working `gemini-cli` version. Documentation is known incomplete — derive schemas from observation.
**Delivers:** `spec/protocol.md` draft, `spec/errors.md` draft, `spec/fixtures/*.ndjson` + sibling `.expected.json`, pinned `gemini-cli` version, documented fallback decisions.
**Avoids:** Pitfall 1, Pitfall 17, Anti-pattern 5.

### Phase 2: Foundation — BinaryResolver + ProcessManager (spawn-per-call) + EnvBuilder
**Rationale:** Hardest thing to retrofit — Windows `.cmd` CVE handling, UTF-8 forcing, process-tree killing, Proactor event loop. Ship spawn-per-call behind a `ProcessStrategy` interface so pool/long-lived can swap in later without public-API break.
**Delivers:** Working "hello world" spawn test per language; `BinaryResolver` with Windows `.cmd` detection; `EnvBuilder` with API-key-canonical auth + env allowlist; `ProcessManager` + `SpawnPerCallStrategy` with SIGTERM→SIGKILL escalation and Windows `taskkill /T /F` tree-kill; `windowsHide: true` / `CREATE_NO_WINDOW`.
**Avoids:** Pitfalls 2, 4, 6, 7; Anti-patterns 1–4.

### Phase 3: NDJSON Parser + EventDispatcher + MessageChunk types
**Rationale:** Fixtures from Phase 1 drive the parser, not docs. Parity enforcement begins here — both language suites consume identical `spec/fixtures/`. Lenient parsing is non-negotiable.
**Delivers:** Line-buffered NDJSON reader with stateful UTF-8 decoder + 1 MiB limit; schema validators (Zod/Pydantic) from shared JSON Schema; `EventDispatcher` → `MessageChunk`; lenient unknown-event fallback; CRLF tolerance; **both language suites passing against identical fixtures**.
**Avoids:** Pitfalls 1, 3.

### Phase 4: ArgvBuilder + public `query()` + streaming end-to-end
**Rationale:** First real `gemini-cli` round-trip. `query()` async generator is the entire public API — everything else is internal. Pure-function `buildArgv` is the highest-leverage testability lever.
**Delivers:** Pure `buildArgv(options): string[]` with exhaustive unit coverage; `query()` generator gluing Phases 2+3; first real `-p "echo hello"` test; `options.abortSignal` → SIGTERM wiring; temp-file `GEMINI_SYSTEM_MD` for `options.systemPrompt`.
**Addresses:** T1, T2, T3, T5, T6, T11.
**Avoids:** Anti-pattern 1, Pitfall 18.

### Phase 5: ErrorMapper + typed error hierarchy + Archon 5-bucket mapping
**Rationale:** Retry classification is the load-bearing contract with Archon. Build the classifier **empirically** from observed stderr samples, not speculatively. Pattern table in `spec/errors.md` with a CI linter diffing it against both language implementations.
**Delivers:** `GeminiError` hierarchy (`RateLimitError` / `AuthError` + subtypes / `ModelAccessError` / `InvalidPromptError` / `ProcessError` / `ProcessCrashError` / `ParseError` / `AbortError` / `UnsupportedFeatureError` / `GeminiNotFoundError`); exit-code taxonomy (0/1/42/53); stderr pattern table; `.retryable` + `.retryAfterMs` fields; stream-json `error` event → same typed errors as exit-code path; `ModelDowngradeWarning` on `init` inspection.
**Addresses:** T12, Correction #9, Pitfall 10.
**Avoids:** Pitfalls 5, 9, 10; Anti-pattern 6.

### Phase 6: Session resume + multi-turn smoke test (with transcript-prepend fallback)
**Rationale:** Must validate #14180 empirically. If `--resume <id> -p "follow-up"` works, `Session` is trivial. If not, the fallback lands.
**Delivers:** `Session` value object; session capture from `init` event; `--resume` wiring; transcript-prepend fallback (gated by Phase-1 decision); kill-mid-session integration test.
**Addresses:** T4, Pitfall 11.

### Phase 7: Structured output (best-effort) + additionalDirectories + tool allow/deny + approval mode
**Rationale:** The "easy" features on top of the foundation. W2 is a workaround, documented as best-effort; callers get a validation error + single retry, never silent mismatch.
**Delivers:** T7, T9, W2; `--include-directories` wiring; model enum + string escape hatch.
**Avoids:** Pitfall 17.

### Phase 8: MCP passthrough + `settings.json` merge helper (isolated config dir)
**Rationale:** MCP passthrough and settings-merge helper are the same piece of code. Must **never mutate user's real `~/.gemini/settings.json`** — always use a temp config dir per query, lifecycle tied to `query()`'s `finally`.
**Delivers:** T8, D7; `GEMINI_CONFIG_DIR` redirect; `--allowed-mcp-server-names` gating; documented MCP fragility risks.

### Phase 9: [v1.x] Tool-use bridge — in-process stub MCP server
**Rationale:** Largest and riskiest feature. **Spike on `@modelcontextprotocol/sdk` (TS) + `mcp` (Python)** to confirm a minimal stdio MCP server is achievable in <2 weeks per language. If larger, escalate to v2. TS and Python paths **may fork** here if Python MCP maturity lags.
**Delivers:** W1; round-trip integration test; golden-file fixture of entire event stream.
**Recommendation:** **Defer to v1.x** unless Archon's phase-1 workflows require it.

### Phase 10: Archon adapter (TS only)
**Rationale:** ~150 lines of glue depending on everything above. Also the integration test — if the adapter is hard to write, the SDK's shape is wrong and we loop back. Budget one iteration.
**Delivers:** `GeminiClient implements IAssistantClient` in Archon; `DEFAULT_AI_ASSISTANT=gemini` working end-to-end; contract tests running Archon's retry classifier against recorded SDK error payloads; Bun-compatible source-published `.ts` build strategy for this subpackage.
**Addresses:** Corrections #1, #8, #9.

### Phase 11: Docs site, hardening, compat matrix, release
**Rationale:** VitePress + mkdocs-material doc site; compat matrix; runtime `gemini --version` probe (warn-not-error); `.gemini-cli-compat` pin file; CI parity job diffing TS vs Python fixture outputs; dual publish via changesets + `uv publish`; 1.0.0 release.
**Delivers:** D4, D8; v1.0.0 on npm + PyPI; Archon adapter PR merged.

### Phase Ordering Rationale

- **Process + parse before anything else** — nothing works without clean subprocess + NDJSON. Every other phase is configuration on top.
- **Fixtures before parsers** — documentation is incomplete and will be wrong. Capture real output first.
- **Errors after basic streaming works** — observed stderr samples required to build the classifier empirically.
- **Sessions before tools** — multi-turn smoke tests validate tool calls across turns; tools on a single-shot query give false coverage.
- **MCP passthrough before tool bridge** — passthrough is "write flags + config"; bridge is a protocol implementation. Shipping passthrough unblocks users with existing MCP servers.
- **Archon adapter last** — depends on everything and also tests whether the SDK's shape is right. One loopback iteration budgeted.
- **TS and Python lock-step phases 2–8** — every PR touches both languages. Lock-step is the only way parity holds.
- **Phase 9 may fork** if Python MCP library maturity lags behind TS.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 1 (Feasibility spike):** This phase IS research — three specific unknowns.
- **Phase 8 (MCP passthrough):** Short research spike at phase start to pin the smallest reliable MCP-integration configuration window (#2654, #3406, #20694, #13604).
- **Phase 9 (Tool-use bridge, v1.x):** MCP SDK capability spike in both TS and Python before committing to stub MCP server. If >2 weeks per language, escalate to v2.
- **Phase 6 (Session resume):** Conditional — only if Phase 1 finds `--resume` fully broken and transcript-prepend fallback needs more durable serialization.

**Phases with standard patterns (skip research-phase):**
- **Phase 2 (Foundation):** Subprocess wrapping patterns proven by Claude Agent SDK; Windows gotchas enumerated in PITFALLS.md.
- **Phase 3 (NDJSON parser):** ~40 lines; universal pattern.
- **Phase 4 (query / ArgvBuilder):** Pure-function argv + async-generator-over-subprocess are both standard.
- **Phase 5 (Error taxonomy):** Pattern-table classifier battle-tested in Archon's `claude.ts`.
- **Phase 7 (structured output best-effort):** Well-known pattern; prompt-inject + validate + retry-once.
- **Phase 10 (Archon adapter):** Source already inspected; shape known; ~150 lines.
- **Phase 11 (docs + release):** Standard release engineering.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against Archon `dev` branch, Claude Agent SDK TS + Python source, Codex SDK README, `gemini-cli` `main` branch docs. Two "pick A vs B" calls (zod 3 vs 4, tsup vs tsdown) marked MEDIUM inline — both defensible. |
| Features | HIGH | Every claim cites `gemini-cli` repo `main` branch docs or an open issue with URL. Secondary-doc claims marked MEDIUM inline; Phase 1 closes them empirically. |
| Architecture | HIGH | Archon integration shape file-by-file confirmed from `packages/core/src/{clients,types}/`. Claude/Codex SDK patterns read from source. Stream-json event field schema MEDIUM — types confirmed but field-level schema under-documented and must come from Phase 1 fixture capture. |
| Pitfalls | HIGH | 18 pitfalls, most with live `gemini-cli` issue numbers. Subprocess-level pitfalls (4, 7) have Claude Agent SDK production code as proof. |

**Overall confidence:** **HIGH** — the SDK shape is tightly bounded (Archon contract inspected; Claude/Codex SDK reference patterns read; `gemini-cli` feature surface enumerated), and risk is upstream volatility, not design uncertainty.

### Gaps to Address During Planning

1. **Stream-json event field-level schema.** Event types confirmed; field shapes need empirical capture. **Resolution:** Phase 1 fixtures drive the JSON Schema.
2. **`--resume` + `-p` interop** (#14180). **Resolution:** Phase 1 smoke-test; transcript-prepend fallback designed-in from day 1.
3. **Isolated `settings.json` directory mechanism.** Confirm whether `GEMINI_CONFIG_DIR` / `HOME` override works. **Resolution:** Phase 1; fallback is `gemini mcp add --scope project` into a temp CWD.
4. **Policy Engine stabilization timing.** `--allowed-tools` deprecated. **Resolution:** runtime compat matrix + quick upstream-status check at Phase 7 start.
5. **`gemini-cli` stdout block-buffering behavior.** Per-event flush or 64 KB block? **Resolution:** Phase 1 timing test; `options.forcePty: true` via `node-pty` as documented escape hatch.
6. **MCP sidecar (W1) depth.** **Resolution:** Phase 9 capability spike; escalate to v2 if >2 weeks per language.
7. **Hook-bridge subprocess (D1) IPC on Windows.** Named pipes are the wildcard. **Resolution:** Phase 9-equivalent spike; ship without hooks first if infeasible.
8. **Archon's precise retry-classifier buckets** — confirmed `rate_limit` / `auth` / `model_access` / `crash` / `unknown` from `claude.ts` inspection. **Lock into `spec/errors.md` and contract-test.**
9. **Schema workaround (W2) retry semantics** — retry once with validation feedback, then raise. Planning decision; default to that.

---

## Sources

### Primary (HIGH confidence — read directly from source)

**Archon (`coleam00/Archon` dev branch):**
- `packages/core/src/clients/claude.ts` — reference adapter (retry/classify, env allowlist, `tool_result` pairing)
- `packages/core/src/clients/codex.ts` — reference adapter (singleton binary-path resolver, thread lifecycle)
- `packages/core/src/clients/factory.ts` — `getAssistantClient(type)` dispatch
- `packages/core/src/clients/index.ts` — public export surface
- `packages/core/src/types/index.ts` — `IAssistantClient`, `MessageChunk`, `AssistantRequestOptions`, `TokenUsage`
- `packages/adapters/src/index.ts` — platform adapters (disambiguates from AI clients)
- `.claude/docs/adapter-implementation-guide.md` — `IPlatformAdapter` vs `IAssistantClient`
- `.env.example` — `DEFAULT_AI_ASSISTANT`, `CODEX_BIN_PATH` conventions

**Gemini CLI (`google-gemini/gemini-cli` main branch):**
- `docs/cli/cli-reference.md` — full flag reference
- `docs/cli/headless.md` — `stream-json` event schema + exit codes (0/1/42/53)
- `docs/cli/settings.md` — `settings.json` keys
- `docs/hooks/reference.md` — 11 hook events + execution model
- Issue #8203 / PR #10883 — stream-json feature shipped (Sep 2025)
- Issue #14180 — `--resume` + stdin/positional interop bug (affects session architecture)
- Issue #13388 — custom output schema feature request (`priority/p2`, no ETA)
- Issue #14435 — session ID in headless JSON output
- Issue #3866 — `GEMINI_SYSTEM_MD` history
- Issues #4945, #20186, #15389, #12468, #20661, #3015 — Windows encoding mojibake
- Issues #16435, #24517, #24962, #14934, #10110, #22241 — OAuth 403 blast radius
- Discussion #22970 — March 2026 Google routing change
- Issues #3485, #3425, #2470, #8269, #11650 — silent model downgrade
- Issues #2654, #3406, #20694, #17787, #23296, #13604 — MCP fragility
- Issues #22647, #22631, #18112 — stream pollution, rate-limit loops, shell-quoting
- `geminicli.com/docs/cli/system-prompt/` — `GEMINI_SYSTEM_MD` canonical behavior
- `geminicli.com/docs/cli/headless/` — headless mode
- `geminicli.com/docs/hooks/reference/` — hooks (cross-verified)
- `geminicli.com/docs/cli/checkpointing/` — `--checkpointing` removed in v0.11.0
- `geminicli.com/docs/resources/faq/` — ToS / OAuth piggyback warning

**Reference SDKs:**
- `code.claude.com/docs/en/agent-sdk/overview` — Claude Agent SDK full feature tour
- `anthropics/claude-agent-sdk-python` `_internal/transport/subprocess_cli.py` — `_find_cli()`, buffer size, Windows `.exe` branch, `_internal/` layout
- `developers.openai.com/codex/sdk` + `openai/codex` TypeScript SDK README — method signatures, `outputSchema` v0.116.0+

**Node.js / Python subprocess primitives:**
- Node.js docs Child process — `shell: false`, Windows `.cmd`/`.bat` CVE-2024-27980, pipe buffering
- Python docs asyncio subprocesses — Proactor event loop requirement on Windows
- Node.js issue #7367 — spawn fails with spaces on Windows
- Node.js issue #4236 — `exec` maxBuffer truncation

### Secondary (MEDIUM confidence)
- Claude Agent SDK architecture blog — `@tool` / in-process-MCP pattern
- 2ality — `spawn` vs `exec` guidance
- Phabricator T13209 — Windows shell-escape impossibility
- litellm#12496 — Gemini CLI JSON parse error on markdown-wrapped JSON (W2 retry semantics)
- Geektrovert/fraction#1 — parity-benchmark harness for dual-language SDKs
- Letta SDK — OpenAPI → Fern generates both TS + Python SDKs
- npm/cli#9179 — semver for package wrapping semver-compliant executable
- zed-industries/claude-agent-acp#338 — CLI subprocess death leaves session stuck

---
*Research completed: 2026-04-11*
*Ready for roadmap: yes*
