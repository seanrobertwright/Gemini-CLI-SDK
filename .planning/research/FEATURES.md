# Feature Research — Gemini CLI SDK

**Domain:** Agent CLI SDK wrapping `gemini-cli` as a subprocess
**Researched:** 2026-04-11
**Overall confidence:** HIGH (most feature-level claims cite `gemini-cli` docs on the `main` branch; a few secondary-doc claims marked MEDIUM inline)

This file answers: **what does an agent-CLI SDK expose, and which of those features can actually be built on top of `gemini-cli`'s real non-interactive surface?** It is scoped deliberately narrowly to match `.planning/PROJECT.md` Active requirements and the Archon `IAssistantClient` / `AssistantRequestOptions` interface the SDK must conform to.

---

## TL;DR

1. **`gemini-cli` is much more capable than PROJECT.md assumed.** Several items listed as "not exposed" or "unclear" in PROJECT.md are in fact exposed cleanly:
   - **System prompt override:** cleanly supported via the `GEMINI_SYSTEM_MD` environment variable (full replacement, per-invocation, variable substitution). **Not a workaround — a real feature.**
   - **Hooks / lifecycle events:** a full hook system exists (`BeforeTool`, `AfterTool`, `BeforeModel`, `BeforeToolSelection`, `AfterModel`, `BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `Notification`, `PreCompress`) configured in `settings.json`, with subprocess-over-stdin/stdout execution and decision/allow/deny semantics. Comparable in power to Claude Agent SDK hooks.
   - **Multi-turn session resume:** the `--resume` / `-r` flag accepts `"latest"` or a session ID. Combined with `--output-format stream-json`'s `init` event (which carries `session_id`), full multi-turn is mechanically feasible.
   - **MCP passthrough:** first-class via `gemini mcp add`, `~/.gemini/settings.json` `mcpServers`, and `--allowed-mcp-server-names`.
2. **Two real blockers remain.**
   - **Custom output JSON schema** is not supported (tracked in google-gemini/gemini-cli#13388, open, `priority/p2`, no ETA). Archon's `outputFormat: { type: 'json_schema', schema }` contract cannot be honored by `gemini-cli` today. We must fall back to prompt-level schema injection with runtime validation, and surface this as a documented limitation.
   - **Caller-defined custom tools (function calling)** no longer have a direct path in current `gemini-cli` — earlier `tools.discoveryCommand` / `tools.callCommand` settings do not appear in the current `docs/cli/settings.md` reference. The only realistic mechanism for v1 is an **in-process stub MCP server** the SDK spins up and hands to `gemini-cli` via `mcpServers` config.
3. **Archon compatibility is the hard constraint.** The Archon `AssistantRequestOptions` type (`packages/core/src/types/index.ts`) is already liberal about per-field "Claude only — Codex ignores this" semantics. That gives the Gemini client the same permission to silently ignore Claude-specific fields (`thinking`, `effort`, `fallbackModel`, `betas`, `maxBudgetUsd`) and still conform to `IAssistantClient`. The truly load-bearing surface is narrower than PROJECT.md implied: `sendQuery(prompt, cwd, resumeSessionId?, options?)` yielding `AsyncGenerator<MessageChunk>` plus a typed error hierarchy.

---

## What a peer SDK exposes (Claude Agent SDK + Codex SDK)

Consolidated feature matrix across the two reference SDKs, so feasibility against `gemini-cli` can be evaluated one row at a time.

| # | Feature | Claude Agent SDK | Codex SDK |
|---|---|---|---|
| 1 | Async streaming query | `query({prompt, options})` async iterator of typed messages | `thread.runStreamed(prompt)` async generator of events |
| 2 | Single-shot (non-streaming) query | Same iterator, consume to end | `thread.run(prompt)` buffered |
| 3 | Multi-turn sessions / resume | `options.resume = sessionId`; `SystemMessage.subtype === 'init'` carries session_id | `Codex.resumeThread(threadId)`; sessions persist in `~/.codex/sessions` |
| 4 | Fork session | `options.forkSession: true` (copies prior history to new file) | Not documented |
| 5 | System prompt override | `options.systemPrompt`; presets via `claude_code` | Via `config` TOML override |
| 6 | Built-in tools (Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch) | First-class; gated via `allowedTools` / `disallowedTools` | Built-in via Codex CLI |
| 7 | Caller-defined tools (function calling) | `tools` array in `options`; execution callbacks | Via `config` |
| 8 | MCP server passthrough | `options.mcpServers: Record<string, McpServerConfig>` | Via `config` |
| 9 | Structured output / JSON schema | `options.outputFormat: { type: 'json_schema', schema }` | `outputSchema` on `TurnOptions` (v0.116.0+), Zod-compatible |
| 10 | Hooks / lifecycle events | `options.hooks: { PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, UserPromptSubmit, ... }` as JS callbacks | Not documented |
| 11 | Subagents | `options.agents: Record<string, AgentDefinition>` + `options.agent: 'name'` | Not documented |
| 12 | Permissions / approval modes | `options.permissionMode: 'acceptEdits' \| ...`; `allowedTools` pre-approval | Via `config` |
| 13 | File / workspace context | Driven by `cwd` + `allowedTools` for FS access; `settingSources: ['project']` loads `CLAUDE.md` | `workingDirectory`; `skipGitRepoCheck` |
| 14 | Abort / cancellation | `options.abortSignal: AbortSignal` | Not documented |
| 15 | Typed error hierarchy | SDK errors + subprocess retry classification (see Archon claude.ts `RATE_LIMIT_PATTERNS`) | Partial |
| 16 | Auth modes | API key, OAuth, Bedrock/Vertex/Foundry via env flags | API key via env |
| 17 | Streaming event schema | `SDKMessage` variants: system/init, assistant, user, tool_use, tool_result, result, thinking | `item.completed`, `turn.completed` |
| 18 | Per-call env injection | `options.env: Record<string,string>` (Claude 0.2.74+) | `env` on constructor |
| 19 | Cost budgeting | `options.maxBudgetUsd` | Not documented |
| 20 | Model selection | `options.model: string` + fallbackModel | Via constructor/config |
| 21 | Reasoning/thinking knobs | `options.effort` / `options.thinking` | Not documented |

**Sources for this matrix:**
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview (HIGH — official)
- Codex SDK: https://developers.openai.com/codex/sdk + github.com/openai/codex `sdk/typescript/README.md` (HIGH — official)
- Archon integration signal: `packages/core/src/types/index.ts` on `dev` branch at coleam00/Archon (HIGH — source inspection; every `AssistantRequestOptions` field above maps to a real Claude or Codex SDK option).

---

## What `gemini-cli` actually exposes

Evidence gathered from the `main` branch of `google-gemini/gemini-cli` (`docs/cli/cli-reference.md`, `docs/cli/headless.md`, `docs/cli/settings.md`, `docs/hooks/reference.md`) and the canonical hosted docs at geminicli.com.

### Non-interactive CLI flags (authoritative — `docs/cli/cli-reference.md`)

| Flag | Alias | Type | Purpose (for SDK) |
|---|---|---|---|
| `--prompt <text>` | `-p` | string | **Forces non-interactive mode.** Primary entry point. |
| `--prompt-interactive <text>` | `-i` | string | Ignore — interactive only. |
| `--model <name>` | `-m` | string | Model selection (`auto`, `pro`, `flash`, `flash-lite`, or concrete). |
| `--output-format <fmt>` | `-o` | enum `text \| json \| stream-json` | Streaming surface. Use `stream-json`. |
| `--resume <id \| "latest">` | `-r` | string | **Multi-turn session resume.** |
| `--list-sessions` | — | bool | Enumerate sessions for current project. |
| `--delete-session <idx>` | — | string | Session management. |
| `--include-directories <dirs>` | — | array (comma or repeated) | Workspace context. |
| `--allowed-mcp-server-names <names>` | — | array | MCP passthrough gating. |
| `--allowed-tools <tools>` | — | array | **Deprecated in favor of Policy Engine**; still works. |
| `--extensions <names>` | `-e` | array | Extension scoping. |
| `--approval-mode <mode>` | — | enum `default \| auto_edit \| yolo \| plan` | Tool approval control. |
| `--yolo` | `-y` | bool | Deprecated alias for `--approval-mode=yolo`. |
| `--sandbox` | `-s` | bool | Sandbox toggle (uses `tools.sandbox` profile). |
| `--debug` | `-d` | bool | Verbose logging. |
| `--worktree [name]` | `-w` | string | Requires `experimental.worktrees: true`. |
| `--experimental-acp` | — | bool | ACP mode (ignore for v1). |

**Source:** https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md (HIGH — verified directly from the repo `main` branch).

**Notable absences from the CLI flag set** (must use env vars or `settings.json`):
- No `--system-prompt` flag (use `GEMINI_SYSTEM_MD` env var).
- No `--mcp-server` inline config flag (edit `settings.json` or use `gemini mcp add` pre-run).
- No `--output-schema` / `--response-schema` flag (feature request #13388 open).
- No `--hook` flag (configure in `settings.json`).
- No `--tool` / `--function` flag for caller-defined tools.

### `--output-format stream-json` event schema (`docs/cli/headless.md`)

NDJSON events emitted to stdout:

| Event | Contains |
|---|---|
| `init` | Session metadata — session ID, model. **This is how we capture `session_id` for resume.** |
| `message` | User and assistant message chunks. |
| `tool_use` | Tool call requests with arguments. |
| `tool_result` | Output from executed tools. |
| `error` | Non-fatal warnings and system errors. |
| `result` | Final outcome with aggregated stats and per-model token usage breakdown. |

**Exit codes:**
- `0` success
- `1` general error / API failure
- `42` input error (invalid prompt/args)
- `53` turn limit exceeded

**Source:** https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md (HIGH).

### Hooks (`docs/hooks/reference.md`)

| Event | Can block? | Use for SDK |
|---|---|---|
| `BeforeTool` | Yes — `decision: allow/deny`, can rewrite `tool_input` | Policy enforcement, sensitive-file guard |
| `AfterTool` | Yes — can redact or replace `tool_result` | Audit log, output scrubbing |
| `BeforeModel` | Yes — can override LLM request | Rare; not exposed via SDK in v1 |
| `BeforeToolSelection` | Yes — filter available tools | Rare; not exposed via SDK in v1 |
| `AfterModel` | Advisory for streaming chunks | Chunk transformation |
| `BeforeAgent` | Yes — inject context before planning | Per-turn prompt injection |
| `AfterAgent` | Yes — validate/retry final response | Output validation |
| `SessionStart` | Advisory | Telemetry |
| `SessionEnd` | Advisory | Cleanup |
| `Notification` | Advisory | Surface alerts |
| `PreCompress` | Advisory | History compression hook |

**Mechanics (critical for SDK design):** Hooks run as **subprocesses** that communicate via JSON on stdin/stdout. Exit code `0` = success (parse JSON), `2` = block (stderr as reason), other = warning. **Hooks are exclusively configured in `settings.json`.** There is no CLI flag to register hooks at invocation time.

**Source:** https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md + https://geminicli.com/docs/hooks/reference/ (HIGH — cross-verified).

### System prompt override — `GEMINI_SYSTEM_MD`

Environment variable, three modes:
1. `GEMINI_SYSTEM_MD=true` or `=1` — reads `./.gemini/system.md`
2. `GEMINI_SYSTEM_MD=/abs/path.md` — treat as file path (tilde expansion supported)
3. `GEMINI_SYSTEM_MD=false` or unset — use built-in prompt

**Full replacement, not merge.** Variable substitution is supported in the file contents (`${AgentSkills}`, `${SubAgents}`, `${AvailableTools}`). A companion `GEMINI_WRITE_SYSTEM_MD=1` exports the built-in prompt for modification.

**Per-invocation works** — `GEMINI_SYSTEM_MD=/tmp/x.md gemini -p "…"` is valid, which means the SDK can write a temp file per query. This is cleaner than the `GEMINI.md`-prepend workaround PROJECT.md Open Questions contemplated.

**Source:** https://geminicli.com/docs/cli/system-prompt/ (HIGH — hosted canonical docs; cross-checked against issue google-gemini/gemini-cli#3866 which tracks the feature's original design).

### Sessions & checkpointing

- `--resume latest` or `--resume <id>` → loads saved session (conversation + tool history + token counts) from `~/.gemini/tmp/<project_hash>/checkpoints/*.json`.
- `stream-json` `init` event exposes the session ID, making the SDK capable of the Claude-SDK capture-then-resume pattern.
- `--list-sessions` and `--delete-session` for lifecycle management.
- `general.checkpointing.enabled` (boolean) in `settings.json` enables automatic state snapshots before file modifications (for revert).
- `general.sessionRetention.maxAge` / `.maxCount` auto-cleans old sessions.
- **Open gap (MEDIUM):** an existing issue (google-gemini/gemini-cli#14435) complains that headless JSON output didn't originally include session ID for resume. It's marked fixed or fixable — the `init` event in `stream-json` is the resolution — but we should **smoke-test on a pinned version** before committing to it.

### MCP passthrough

- `~/.gemini/settings.json` → `mcpServers.<name>` object with: `command`, `args`, `env`, `cwd`, `url` (SSE), `httpUrl` (streamable HTTP), `includeTools`, `excludeTools`, `trust`.
- Precedence: `httpUrl` > `url` > `command`.
- `gemini mcp add <name> <command>` subcommand for programmatic registration.
- `gemini mcp add <name> <command> --scope user` to write to user settings.
- `--allowed-mcp-server-names <list>` flag gates which servers are active per-invocation.
- **Source:** https://geminicli.com/docs/reference/configuration/ + docs/cli/cli-reference.md MCP section (HIGH).

### Built-in tools (analogous to Claude Agent SDK's Read/Bash/Glob/etc.)

`gemini-cli` ships: shell, file read/write/edit, Google Search, web fetch, memory, and MCP-discovered tools. Gated via `tools.core` allowlist (`settings.json`), `tools.exclude`, `--allowed-tools` (deprecated), and the Policy Engine. Approval controlled via `--approval-mode` or `general.defaultApprovalMode`. **YOLO mode is CLI-flag-only** and can be hard-disabled via `security.disableYoloMode`.

### Auth modes

- **Env vars:** `GEMINI_API_KEY` (Gemini API), `GOOGLE_API_KEY` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_APPLICATION_CREDENTIALS` (Vertex AI), OAuth flow via `--login` / `--auth`.
- **Settings:** `security.auth.selectedType`, `security.auth.enforcedType`, `security.auth.useExternal`.
- **Three distinct auth modes** match PROJECT.md's Open Questions list exactly. API key is the canonical default for programmatic use — OAuth has 60 req/min limit vs. 1K/day API-key limit (per PROJECT.md context).

### NOT exposed / confirmed missing

| Feature | Status | Source |
|---|---|---|
| Custom output JSON schema (Claude `outputFormat`, Codex `outputSchema`) | **Open issue, no ETA.** `priority/p2`, `help wanted`. | google-gemini/gemini-cli#13388 (HIGH) |
| Caller-defined tools via CLI setting | **Not documented in current `docs/cli/settings.md`.** Earlier third-party summaries (DeepWiki) describe `tools.discoveryCommand` / `tools.callCommand`, but these keys are absent from the current settings reference. Assume deprecated or never shipped as stable. | settings.md grep (MEDIUM — absence of evidence, but MCP is the documented replacement) |
| Programmatic hook registration (pass callbacks at invocation) | Not supported — hooks are file-based only. | docs/hooks/reference.md (HIGH) |
| Abort signal / graceful cancellation | Not exposed as a feature; must SIGTERM the subprocess. | Absence in cli-reference.md + headless.md (MEDIUM) |
| Cost budgeting (like Claude `maxBudgetUsd`) | Not exposed. | Absence (MEDIUM) |
| Inline per-call env vars on CLI (beyond shell env) | Must be set in the spawn call. | No flag exists (HIGH) |
| Fork session (copy history to new file before appending) | Not documented; `--resume` mutates target session. | Absence in session-management docs (MEDIUM) |

---

## Feature-by-feature feasibility for the SDK

Legend:
- **Direct** = supported by a `gemini-cli` flag, env var, or `settings.json` key; SDK just wires it.
- **Workaround** = achievable with wrapper glue (temp files, stub MCP server, prompt injection, post-parsing).
- **Blocked** = no feasible v1 path; must document as unsupported.

Complexity: SMALL (≤1 day), MEDIUM (≤1 week), LARGE (multi-week), BLOCKED.

### Table Stakes (v1 must ship these)

These match the minimum surface Archon and a generic Claude-Agent-SDK consumer assume. Missing any of these makes the SDK feel incomplete.

| # | Feature | Status | How | Complexity | Notes |
|---|---|---|---|---|---|
| T1 | Async streaming query (`sendQuery` async generator) | **Direct** | Spawn `gemini -p "…" --output-format stream-json`, parse NDJSON line-by-line, map events to Archon `MessageChunk` union | MEDIUM | Core loop. NDJSON parser must be streaming-safe (partial lines, backpressure). |
| T2 | Non-streaming query (`run`-style) | **Direct** | Collect from T1 until `result` event | SMALL | Thin wrapper over T1. |
| T3 | Model selection (`options.model`) | **Direct** | `--model <name>` or `-m`; pass through enum + string escape-hatch | SMALL | Map typed model enum to concrete names; preserve aliases (`auto`, `pro`, `flash`, `flash-lite`). |
| T4 | Multi-turn session resume | **Direct** | Capture `session_id` from `init` event; on next call, `--resume <id>` | MEDIUM | Requires smoke-test on pinned version (issue #14435 fix confirmation). See risks below. |
| T5 | System prompt override (`options.systemPrompt`) | **Direct** | Write prompt to a temp `.md` file, set `GEMINI_SYSTEM_MD=<path>` in spawn env; clean up in `finally` | SMALL | Per-invocation temp file. **Full replacement** — document that user's prompt fully replaces built-in (not a merge). |
| T6 | File / workspace context (`cwd`, `additionalDirectories`) | **Direct** | Pass `cwd` to `spawn()`; map `additionalDirectories` to `--include-directories a,b,c` | SMALL | Matches Archon `AssistantRequestOptions.additionalDirectories` 1:1. |
| T7 | Built-in tool allow/deny | **Direct** | Map Archon `tools?: string[]` → `--allowed-tools a,b`; map `disallowedTools` → `--excluded-tools` (or Policy Engine if deprecated goes away) | SMALL | `--allowed-tools` is deprecated but functional; plan migration path to Policy Engine when it stabilizes. |
| T8 | MCP server passthrough | **Direct (with caveat)** | Two strategies: (a) accept MCP config, write to a temp `settings.json` via `GEMINI_CONFIG_DIR` or merge into user config; (b) pre-register via `gemini mcp add --scope user`. Scope to `--allowed-mcp-server-names` per call. | MEDIUM | Caveat: `gemini-cli` doesn't have an inline `--mcp-server` flag; temp-settings approach is cleaner but path lookup needs verification. |
| T9 | Approval mode (permissions) | **Direct** | `--approval-mode default\|auto_edit\|yolo\|plan` | SMALL | Default to `default`; expose yolo only explicitly (matches Claude SDK's explicit-opt-in stance). |
| T10 | Auth modes (API key / OAuth / Vertex) | **Direct** | Pass env vars (`GEMINI_API_KEY`, `GOOGLE_API_KEY` + project, OAuth via `~/.gemini` state); document canonical default = `GEMINI_API_KEY` | SMALL | Matches PROJECT.md auth mode question. |
| T11 | Abort / cancellation (`AbortSignal`) | **Workaround** | Wire `options.abortSignal` to `child_process.kill('SIGTERM')` with a grace period then `SIGKILL`. Windows: use `taskkill /T /F` for process tree. | MEDIUM | No in-protocol cancel; subprocess kill is the only option. Clean-up temp files in `finally`. |
| T12 | Typed error hierarchy | **Workaround** | Parse `stream-json` `error` events + exit codes (0/1/42/53) + stderr patterns (`rate limit`, `429`, `overloaded`, `403`). Expose `GeminiError` base + `RateLimitError`, `AuthError`, `InvalidPromptError` (exit 42), `TurnLimitExceededError` (exit 53), `ProcessError`, `GeminiCliNotFoundError` | MEDIUM | Mirror Archon's `RATE_LIMIT_PATTERNS` approach from `claude.ts`. Retry logic lives outside the error class (decision for planning). |
| T13 | `GEMINI_BIN_PATH` override + PATH discovery | **Direct** | `which`/`where.exe` lookup + env-var override; fail fast with `GeminiCliNotFoundError` if missing. Version-probe via `gemini --version` at startup. | SMALL | Matches Archon's `codex-binary-resolver.ts` pattern. |
| T14 | Windows + macOS + Linux first-class | **Direct (with care)** | Use `spawn` with `shell: false`, forward-slash paths internally, handle Windows process-tree kill, avoid CRLF bugs in NDJSON parser | MEDIUM | `gemini-cli` has known Windows shell-output bugs (PROJECT.md context); pin a Windows-stable version in compat matrix. |
| T15 | `stream-json` event → `MessageChunk` mapping (Archon-compatible) | **Direct** | `init` → capture session ID (emit as part of `result` chunk); `message` (assistant) → `{type:'assistant',content}`; `tool_use` → `{type:'tool',toolName,toolInput,toolCallId}`; `tool_result` → `{type:'tool_result',...}`; `result` → `{type:'result', sessionId, tokens, ...}`; `error` → surface as thrown typed error or non-fatal `{type:'system'}` | MEDIUM | Load-bearing for Archon integration. Discriminated-union fidelity is the acceptance test. |

### Differentiators (competitive edge for this SDK)

| # | Feature | Status | Value | Complexity | Notes |
|---|---|---|---|---|---|
| D1 | Hooks / lifecycle events (`options.hooks`) | **Workaround** | Match Claude SDK's hook surface despite `gemini-cli` requiring file-based hooks | MEDIUM | SDK writes a temp `settings.json` fragment (via `--settings` if it exists, or `GEMINI_DIR`/`GEMINI_CONFIG_DIR`). Hook script is a tiny SDK-owned binary that reads stdin JSON, forwards to user callback over a local socket/named pipe, and writes response JSON back. **Feasible but non-trivial.** Start with a subset: `BeforeTool`, `AfterTool`, `SessionStart`, `SessionEnd`. |
| D2 | System prompt override | **Direct** | PROJECT.md listed this as a workaround; it isn't — `GEMINI_SYSTEM_MD` is first-class | SMALL | Already covered in T5. Called out as a differentiator vs. Codex which only exposes via TOML config. |
| D3 | Typed TS + Python parity from day 1 | **Direct** | Claude Agent SDK has both; Codex SDK is TS-only. Shipping Python in v1 closes a gap. | MEDIUM | Share NDJSON parser spec across languages via a shared JSON schema (generate TS types and Python dataclasses from one source). |
| D4 | Hosted doc site (quickstart, API ref, guides) | **Direct** | Signals seriousness; matches PROJECT.md constraint | MEDIUM | Outside feature scope but called out in requirements. |
| D5 | Per-invocation env injection (`options.env`) | **Direct** | Archon uses this for Claude 0.2.74+; we get it trivially via `spawn({env})` | SMALL | Merge on top of discovered base env. |
| D6 | Structured NDJSON parser + typed events | **Direct** | Expose raw events as an opt-in low-level API alongside the high-level `MessageChunk` generator | SMALL | Power users can build on the raw stream; Archon uses the mapped form. |
| D7 | `settings.json` merge helper | **Direct** | Provide an ergonomic "write-through" helper so SDK consumers can set MCP servers, hooks, and tool allowlists from code without hand-editing JSON files | MEDIUM | Temp-dir isolation per query avoids polluting the user's real `~/.gemini/settings.json`. |
| D8 | Compat matrix + runtime version probe | **Direct** | `gemini --version` at construction; fail loudly on unsupported ranges; document supported `gemini-cli` version window | SMALL | Matches PROJECT.md "Stability risk" constraint. |

### Features that require workarounds (capability present but not clean)

| # | Feature | Status | Workaround | Complexity |
|---|---|---|---|---|
| W1 | Custom tools / caller-defined function calling | **Workaround via stub MCP server** | SDK spins up an in-process MCP server (stdio transport), registers caller's tool definitions, injects it into `settings.json` as an MCP entry, scopes it via `--allowed-mcp-server-names`. User tool callbacks run in the SDK process. | LARGE | Non-trivial — must implement enough of MCP spec to be usable. Strongly recommend **deferring to v1.x** unless Archon needs it. See Open Questions. |
| W2 | Structured output / JSON schema (`outputFormat`) | **Workaround via prompt injection + validation** | Inject `"Respond only with JSON matching this schema: <schema>"` into the user prompt (or system prompt via `GEMINI_SYSTEM_MD`), parse `result.response`, validate against schema with Ajv (TS) / jsonschema (Py), raise `SchemaValidationError` on mismatch. Optionally do one retry with the error as feedback. | MEDIUM | **Cannot guarantee** schema adherence — it's best-effort. Must document as such so Archon can fall back gracefully. Track google-gemini/gemini-cli#13388 and replace with `--output-schema` when it lands. |
| W3 | Programmatic hooks (`options.hooks`) | See D1 | SDK-owned hook-bridge subprocess | MEDIUM-LARGE | Same as D1. |
| W4 | Fork session | **Workaround** | Read checkpoint JSON from `~/.gemini/tmp/<project_hash>/checkpoints/<id>.json`, copy to new file with fresh ID, resume the copy | MEDIUM | Fragile — depends on checkpoint file format stability. Skip for v1. |
| W5 | Cost budgeting (`maxBudgetUsd`) | **Workaround** | Track per-`result` event token counts, estimate cost from model pricing table, abort session when budget exceeded | MEDIUM | Pricing table maintenance is the cost; v1 can simply expose `tokens` in `result` chunks and let the caller implement budgets. |
| W6 | Subagents (`options.agents` / `options.agent`) | **Workaround via skills/extensions** | `gemini-cli` has its own skills + subagents system (`.gemini/skills/`, `docs/core/subagents.md`) but it's file-based, not programmatic. Map Claude `AgentDefinition` → temp skill files. | LARGE | **Defer to v1.x.** Not load-bearing for Archon's core path. |

### Blocked (cannot deliver in v1; document as unsupported)

| # | Feature | Status | Why blocked | Mitigation |
|---|---|---|---|---|
| B1 | Guaranteed JSON-schema output enforcement | **Blocked** | No CLI flag; prompt-level injection is best-effort only | See W2; document limitation; surface schema validation errors explicitly |
| B2 | In-process tool execution (Claude SDK style: pass JS functions as tools) | **Blocked (v1)** | Requires the stub-MCP-server route (W1), which is LARGE. V1 surfaces tool use **only via real MCP servers and gemini-cli's built-in tools.** | Accept `mcpServers` from Archon; route caller tools through MCP servers they manage themselves. Revisit for v1.x. |
| B3 | Rich thinking/effort/reasoning knobs (`options.effort`, `options.thinking`) | **Blocked** | `gemini-cli` has `model.name` and model-routing settings but no programmatic effort knob analogous to Claude's | Silently ignore these `AssistantRequestOptions` fields (Archon interface already allows "Claude only — ignored for Codex" semantics) |
| B4 | `fallbackModel`, `betas`, `maxBudgetUsd`, `persistSession`, `forkSession` | **Blocked (silently ignored)** | No gemini-cli analog | Archon's type definition already makes these Claude-specific; we get a free pass |
| B5 | True `Notification`/interactive approval callbacks | **Blocked** | Hooks can emit notifications but the CLI is non-interactive; no way to round-trip a user confirmation into the agent loop without a UI | Document: non-interactive approval is "pre-approve via `--approval-mode`" only; interactive loops are out of scope |

### Anti-features (deliberately NOT in v1 — prevent scope creep)

| # | Anti-feature | Why people will ask | Why we won't | Alternative |
|---|---|---|---|---|
| A1 | Wrapping the interactive REPL | "Let me drive the TUI from code" | `gemini-cli`'s TUI is not a stable API; PROJECT.md already rules out native library integration; subprocess is the only honest path | Use `--prompt-interactive` explicitly if you need a hybrid; we don't wrap it |
| A2 | Auto-installing `gemini-cli` | "One-line SDK install" | Already rejected in PROJECT.md Out of Scope | `GEMINI_BIN_PATH` override + fail-fast discovery (T13) |
| A3 | Bundling `gemini-cli` as a dependency | "Versioning simplicity" | Already rejected in PROJECT.md | Compat matrix + runtime version probe (D8) |
| A4 | Reinventing tool execution (parallel to MCP) | "I want Claude-SDK-style custom tools without running an MCP server" | Creates a second tool-execution runtime that competes with gemini-cli's built-in one. High complexity, brittle. | Defer to v1.x as W1; v1 documents MCP as the only path for caller tools |
| A5 | Syncing Gemini's JSON response format to match Claude's exactly | "Drop-in compatibility with Claude SDK consumers" | Archon's `AssistantRequestOptions` already tolerates per-assistant divergence; chasing byte-for-byte compatibility is a rabbit hole | Map to Archon's `MessageChunk` discriminated union (T15) and stop there |
| A6 | Emulating Claude's `permissionMode` semantics perfectly | "Works the same as Claude" | Gemini has four modes (`default`/`auto_edit`/`yolo`/`plan`); Claude has different mode names. Forced equivalence creates confusion. | Expose Gemini's native mode names; provide a non-normative mapping in docs |
| A7 | Extension install/management via SDK | "I want to install `gemini extensions` from code" | Extensions are a CLI-level concept that belongs to the user's `gemini-cli` install; SDK shouldn't mutate global state | Document `gemini extensions install …` as a user prerequisite if they need it |
| A8 | Writing to user's real `~/.gemini/settings.json` | "Easier config" | Mutating user global state is a footgun (test runs leave stale MCP servers, tool allowlists, hooks) | Always use an isolated config directory per query (temp dir + `GEMINI_CONFIG_DIR` or equivalent), merge from user defaults read-only |
| A9 | Real-time cost enforcement / hard budgets | "Don't let the agent burn $50" | Requires pricing table maintenance + reliable per-event token counts, and still can't prevent the final call from overshooting | Expose per-call token counts; leave enforcement to the caller (v1.x can add if demand is real) |
| A10 | Automatic retry of subprocess crashes | "Claude SDK retries on exit 1, we should too" | Retry policy is orchestrator concern; SDK should surface typed errors clearly and let Archon decide | Archon already has `MAX_SUBPROCESS_RETRIES` logic in `claude.ts`; mirror in Archon's gemini adapter, not in the SDK |

---

## Feature dependencies (for roadmap phase ordering)

```
T1 stream-json parser
 ├── T2 non-streaming query
 ├── T4 multi-turn resume (needs session_id from init event)
 ├── T12 typed errors (needs to classify error events + exit codes)
 └── T15 MessageChunk mapping (Archon contract)
            └── T8 MCP passthrough (MessageChunk tool/tool_result events carry MCP tool results)

T13 binary discovery
 └── T14 cross-platform spawn
      └── everything else

T5 system prompt (GEMINI_SYSTEM_MD temp-file)
 └── W2 JSON schema workaround (may use GEMINI_SYSTEM_MD to inject schema)

T8 MCP passthrough
 └── W1 stub MCP server for custom tools (same infra)
 └── D7 settings.json merge helper (both need isolated config dir)

D1 hooks bridge
 └── D7 settings.json merge helper

T4 multi-turn resume
 └── W4 fork session (depends on checkpoint file layout, which depends on multi-turn being wired)
```

**Phase-ordering implications:**
1. **Foundation phase must land before anything else:** T13 binary discovery → T14 cross-platform spawn → T1 stream-json parser → T15 MessageChunk mapping → T12 typed errors. This is the critical path.
2. **MCP (T8) and settings.json helper (D7) are the same piece of code.** Build them together.
3. **Hooks (D1) should land after MCP (T8).** They share the settings-merge infrastructure, and hooks without MCP is a weird shape.
4. **W2 (schema workaround) depends on T5 (system prompt override)** because one of the injection sites is the system prompt.
5. **W1 (stub MCP server) is the riskiest and most valuable differentiator.** Recommend treating it as a v1.x stretch unless Archon's concrete workflows require it for phase-1 integration.

---

## MVP definition (what ships in v1)

### v1.0 launch (table stakes + must-have differentiators)

| Must-have | Item |
|---|---|
| ✅ | T1–T4: streaming query + non-streaming + model selection + multi-turn resume |
| ✅ | T5: system prompt override via `GEMINI_SYSTEM_MD` temp file |
| ✅ | T6: cwd + `--include-directories` |
| ✅ | T7: `tools` / `disallowedTools` allow/deny (via `--allowed-tools` + Policy Engine) |
| ✅ | T8: MCP passthrough with isolated config dir |
| ✅ | T9: approval mode (`default`/`auto_edit`/`plan`; yolo opt-in) |
| ✅ | T10: auth modes (API key canonical, OAuth + Vertex supported) |
| ✅ | T11: abort signal → SIGTERM/SIGKILL |
| ✅ | T12: typed error hierarchy (`GeminiError`, `RateLimitError`, `AuthError`, `InvalidPromptError`, `TurnLimitExceededError`, `ProcessError`, `GeminiCliNotFoundError`) |
| ✅ | T13–T14: binary discovery + Windows/macOS/Linux support |
| ✅ | T15: full `MessageChunk` mapping (Archon contract) |
| ✅ | D3: TS + Python parity |
| ✅ | D4: hosted doc site |
| ✅ | D5: per-invocation env injection |
| ✅ | D6: low-level raw-event API alongside the high-level generator |
| ✅ | D7: `settings.json` merge helper (temp/isolated) |
| ✅ | D8: compat matrix + `gemini --version` probe |
| ✅ | W2: structured-output workaround (prompt injection + Ajv/jsonschema validation), **clearly documented as best-effort** |

### v1.x (after v1 ships and Archon integration validates)

- D1 / W3: programmatic hooks bridge (subset: `BeforeTool`, `AfterTool`, `SessionStart`, `SessionEnd`)
- W1: stub MCP server for caller-defined tools
- W4: fork session
- W5: cost budgeting helper (not enforcement)
- W6: subagents via skills-file bridging

### v2+ (deferred indefinitely)

- Rust SDK (already in PROJECT.md Out of Scope)
- True `outputSchema` enforcement — wait for google-gemini/gemini-cli#13388 to land
- Interactive approval loop with user-in-the-loop callbacks
- Real-time cost enforcement with hard budgets

---

## Prioritization matrix

| # | Feature | User value | Implementation cost | Priority |
|---|---|---|---|---|
| T1 | Streaming query (stream-json parser) | HIGH | MEDIUM | **P0** |
| T4 | Multi-turn resume | HIGH | MEDIUM | **P0** |
| T5 | System prompt override | HIGH | SMALL | **P0** |
| T8 | MCP passthrough | HIGH | MEDIUM | **P0** |
| T12 | Typed error hierarchy | HIGH | MEDIUM | **P0** |
| T13 | Binary discovery | HIGH | SMALL | **P0** |
| T15 | MessageChunk mapping | HIGH | MEDIUM | **P0** |
| T14 | Windows/macOS/Linux support | HIGH | MEDIUM | **P0** |
| T7 | Tool allow/deny | HIGH | SMALL | **P0** |
| T9 | Approval mode | MEDIUM | SMALL | **P0** |
| T10 | Auth modes | HIGH | SMALL | **P0** |
| T11 | Abort signal | MEDIUM | MEDIUM | **P0** |
| T6 | cwd / include-directories | HIGH | SMALL | **P0** |
| D3 | TS + Python parity | HIGH | MEDIUM | **P0** |
| D7 | settings.json merge helper | MEDIUM | MEDIUM | **P1** (enables T8, D1) |
| D8 | Compat matrix + version probe | MEDIUM | SMALL | **P1** |
| D6 | Raw-event API | MEDIUM | SMALL | **P1** |
| D5 | Per-call env injection | MEDIUM | SMALL | **P1** |
| D4 | Hosted doc site | HIGH | MEDIUM | **P1** |
| W2 | Structured output workaround | HIGH | MEDIUM | **P1** |
| D1 / W3 | Programmatic hooks bridge | MEDIUM | LARGE | **P2** (v1.x) |
| W1 | Stub MCP server (custom tools) | MEDIUM | LARGE | **P2** (v1.x) |
| W4 | Fork session | LOW | MEDIUM | **P3** |
| W5 | Cost budgeting helper | LOW | MEDIUM | **P3** |
| W6 | Subagents via skills | LOW | LARGE | **P3** |

---

## Archon `IAssistantClient` conformance map

**The absolute minimum the SDK must deliver for the Archon adapter to work** (source: `packages/core/src/types/index.ts` on `dev` branch, inspected directly):

```ts
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

**`MessageChunk` discriminated union the SDK must emit:**

| Variant | Gemini source | Status |
|---|---|---|
| `{type:'assistant', content}` | `message` events with assistant role | T1 + T15 |
| `{type:'system', content}` | `init` event (formatted), non-fatal `error` events | T1 + T15 |
| `{type:'thinking', content}` | Not emitted by `gemini-cli` today (no thinking events in stream-json schema) | Skip — Archon treats as optional |
| `{type:'result', sessionId, tokens, structuredOutput?, isError?, errorSubtype?, cost?, stopReason?, numTurns?, modelUsage?}` | Terminal `result` event + aggregated stats | T15 |
| `{type:'tool', toolName, toolInput?, toolCallId?}` | `tool_use` events | T15 |
| `{type:'tool_result', toolName, toolOutput, toolCallId?}` | `tool_result` events | T15 |
| `{type:'rate_limit', rateLimitInfo}` | Derived from stderr pattern match / exit-code-1 with rate-limit classification | T12 |
| `{type:'workflow_dispatch', ...}` | Archon-internal; SDK never emits this | N/A |

**`AssistantRequestOptions` field-by-field honor status:**

| Field | Honor | Mechanism |
|---|---|---|
| `model` | **Yes** | `--model` |
| `modelReasoningEffort` | No (silently ignore) | No gemini analog |
| `webSearchMode` | **Partial** | gemini-cli ships `google_web_search` built-in; map `on/off` to tool allow/deny |
| `additionalDirectories` | **Yes** | `--include-directories` |
| `tools` (whitelist) | **Yes** | Policy Engine / `--allowed-tools` (with deprecation watch) |
| `disallowedTools` | **Yes** | Policy Engine / `--excluded-tools` (verify flag name) |
| `outputFormat` (JSON schema) | **Best-effort** | W2: prompt injection + Ajv validation; document limitation |
| `hooks` | **v1.x** | D1 hook bridge; v1 accepts-and-warns or accepts-and-ignores |
| `mcpServers` | **Yes** | T8 isolated config dir |
| `allowedTools` (MCP auto-allow) | **Yes** | `--allowed-mcp-server-names` + Policy Engine |
| `agents` | No (silently ignore in v1) | W6 deferred |
| `agent` | No (silently ignore in v1) | W6 deferred |
| `abortSignal` | **Yes** | T11 subprocess kill |
| `persistSession` | N/A | gemini checkpointing is always-on when enabled in settings |
| `forkSession` | No (silently ignore in v1) | W4 deferred |
| `settingSources` | **Partial** | Maps to which `GEMINI.md` files get loaded; honor `'project'` by default |
| `env` | **Yes** | D5 `spawn({env})` merge |
| `effort` | No (silently ignore) | No gemini analog |
| `thinking` | No (silently ignore) | No gemini analog |
| `maxBudgetUsd` | No (silently ignore in v1) | W5 deferred |
| `systemPrompt` | **Yes** | T5 `GEMINI_SYSTEM_MD` temp file |
| `fallbackModel` | No (silently ignore) | No gemini analog |
| `betas` | No (silently ignore) | No gemini analog |
| `sandbox` | **Partial** | `--sandbox` + `tools.sandbox` profile; may not match Claude's `SandboxSettings` shape exactly — document field-by-field |

**Net:** Of 24 `AssistantRequestOptions` fields, the SDK fully honors 11, partially honors 4, defers 4 (W4/W5/W6/hooks), silently ignores 5 (Claude-specific knobs Archon already marks "Claude only"). This is acceptable — Archon's type definition was explicitly designed for this kind of per-assistant divergence.

---

## Risks & open questions carried forward to planning

1. **Smoke-test multi-turn resume on a pinned version.** Issue google-gemini/gemini-cli#14435 says the `session_id` in headless JSON was originally missing. The `init` event in `stream-json` is the documented fix, but we need to **actually spawn `gemini -p "hi" --output-format stream-json`, parse the init event, confirm `session_id` is present and non-empty**, then confirm `gemini -r "<id>" -p "follow-up" --output-format stream-json` preserves context. Pin the first gemini-cli version where this works end-to-end.
2. **Isolated config dir mechanism.** PROJECT.md constraint: never mutate the user's real `~/.gemini/settings.json`. Need to confirm whether `gemini-cli` honors `GEMINI_CONFIG_DIR` / `HOME` override to redirect settings lookup. If not, the temp-settings strategy for MCP/hooks/tools needs a different approach (e.g., `gemini mcp add --scope project` into a temp CWD). **Planning must resolve this before T8 lands.**
3. **Policy Engine stabilization.** `--allowed-tools` is explicitly marked deprecated in favor of the Policy Engine. If Policy Engine breaks the flag during our support window, T7 will need rework. Track `docs/reference/policy-engine.md` once it exists.
4. **Stub MCP server (W1) depth.** The deepest blocker on "real" custom tools. Before starting v1.x, **spike on `@modelcontextprotocol/sdk`** (TS) and whatever Python MCP SDK exists, to confirm that a minimal in-process stdio MCP server that exposes caller-defined JS/Python functions as tools is genuinely achievable in <2 weeks of work. If it's larger, W1 moves to v2.
5. **Hook-bridge subprocess (D1).** Same architectural spike: can a tiny SDK-owned hook script reliably communicate via stdin/stdout JSON and round-trip to the parent SDK process via a local socket / named pipe? Named pipes on Windows are the wildcard.
6. **Python parity cost.** Every feature in this doc must be implementable in both TS and Python. The NDJSON parser, subprocess management, typed errors, and async generators all have different idioms. Budget ~1.5x the TS cost for Python.
7. **Schema workaround (W2) failure semantics.** When the model produces non-conforming JSON, do we (a) retry once with the validation error appended to the conversation, (b) raise immediately, or (c) return the raw response with a warning? Archon probably wants option (a) with a cap. Planning decision.

---

## Sources

### Gemini CLI (authoritative)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md — CLI flag reference (HIGH)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md — stream-json event schema, exit codes (HIGH)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/settings.md — `settings.json` keys (HIGH)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md — hooks event list and execution model (HIGH)
- https://geminicli.com/docs/cli/system-prompt/ — `GEMINI_SYSTEM_MD` canonical behavior (HIGH)
- https://geminicli.com/docs/reference/configuration/ — consolidated config reference (MEDIUM — secondary hosted docs, cross-checked)
- https://geminicli.com/docs/cli/headless/ — headless mode overview (HIGH)
- https://geminicli.com/docs/hooks/reference/ — hooks reference, cross-checked with GitHub (HIGH)
- https://github.com/google-gemini/gemini-cli/issues/13388 — custom output schema feature request, open, `priority/p2` (HIGH)
- https://github.com/google-gemini/gemini-cli/issues/14435 — session ID in headless JSON output (MEDIUM — confirms the gap existed and was addressed)
- https://github.com/google-gemini/gemini-cli/issues/3866 — system prompt override history (MEDIUM — confirms feature is real)
- https://github.com/google-gemini/gemini-cli/issues/8203 — stream-json format request (MEDIUM — confirms format is real and recently added)

### Reference SDKs
- https://code.claude.com/docs/en/agent-sdk/overview — Claude Agent SDK full feature tour (HIGH)
- https://developers.openai.com/codex/sdk — Codex SDK overview (HIGH)
- https://github.com/openai/codex TypeScript SDK README — method signatures, event types, `outputSchema` v0.116.0+ (HIGH)

### Archon integration
- `github.com/coleam00/Archon` `dev` branch, `packages/core/src/types/index.ts` — full `IAssistantClient`, `AssistantRequestOptions`, `MessageChunk` definitions (HIGH — inspected directly)
- `github.com/coleam00/Archon` `dev` branch, `packages/core/src/clients/claude.ts` — reference adapter implementation patterns (env scrubbing, retry, rate-limit classification) (HIGH — inspected directly)

---
*Feature research for: TypeScript + Python SDK wrapping `gemini-cli`*
*Researched: 2026-04-11*
