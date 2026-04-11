# Gemini CLI SDK

## What This Is

A TypeScript and Python SDK that wraps Google's `gemini-cli` as a subprocess, giving developers a programmatic, Claude-Agent-SDK-shaped interface to Gemini's agent capabilities. Fills the ecosystem gap where Anthropic ships the Claude Agent SDK and OpenAI ships the Codex SDK, but Google has not yet shipped an equivalent library for `gemini-cli`.

## Core Value

A developer can drop this SDK into a TypeScript or Python project and drive `gemini-cli` programmatically with an API that feels like the Claude Agent SDK — and specifically, can use it to add Gemini as a third AI assistant inside [Archon](https://github.com/coleam00/Archon) alongside Claude and Codex. Done = `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in Archon.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

**SDK surface (TS + Python, parallel in v1):**

- [ ] TypeScript package wrapping `gemini-cli` via subprocess
- [ ] Python package wrapping `gemini-cli` via subprocess
- [ ] API shape mirrors Claude Agent SDK (async streaming query, sessions, tools)
- [ ] Streaming responses via `--output-format stream-json` (NDJSON) parsing
- [ ] Multi-turn sessions (built on gemini-cli checkpointing)
- [ ] MCP server passthrough
- [ ] File / workspace context (`--include-directories`, `@`-references)
- [ ] System prompt override (via workaround — approach TBD in planning)
- [ ] Structured output (JSON schema / response format)
- [ ] Hooks / lifecycle events (feasibility TBD in research)
- [ ] Tool use / function calling (approach TBD — see Open Questions)
- [ ] Typed error hierarchy: `GeminiError` base + `RateLimitError`, `AuthError`, `InvalidPromptError`, `ProcessError`, etc.
- [ ] Typed model enum + string escape-hatch for model selection
- [ ] Windows, macOS, Linux all first-class at v1 launch
- [ ] Pre-installed `gemini-cli` required; `GEMINI_BIN_PATH` env var override
- [ ] Full hosted documentation site (quickstart, API reference, guides)
- [ ] MIT license

**Archon integration (in v1 scope):**

- [ ] Thin Archon adapter published in `coleam00/Archon` (fork or PR) that adds a `gemini` entry alongside `claude` / `codex` in `packages/adapters/`
- [ ] `DEFAULT_AI_ASSISTANT=gemini` works in Archon with real workflows
- [ ] Env-var auth shape consistent with Archon's existing patterns (e.g. `GEMINI_API_KEY`, `GEMINI_BIN_PATH`)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Rust SDK** — deferred to v2. Neither Claude Agent SDK nor Codex SDK ship Rust; tripling surface area for v1 is unjustified.
- **Auto-installing gemini-cli** — rejected in favor of "require pre-installed." Auto-install is magic, fragile, and inconsistent with how Archon handles Codex binaries.
- **Bundling gemini-cli as a package dependency** — same reasoning. Users own their `gemini-cli` install and version.
- **Separate reference "code automation" demo app** — Archon integration *is* the dogfood; a separate demo would duplicate effort and dilute the "done" criterion.
- **Native Node.js library integration with gemini-cli** — gemini-cli has no programmatic entry point; subprocess is the only realistic path.
- **Custom tool definitions in v1 if `gemini-cli` doesn't natively support them** — approach deferred to planning (see Open Questions), but v1 will not invent a parallel tool-execution runtime.

## Context

**The ecosystem gap.** Anthropic ships the Claude Agent SDK (TS + Python) wrapping Claude Code. OpenAI ships the Codex SDK (TS) wrapping the Codex CLI. Google ships `gemini-cli` but no equivalent SDK. Developers building multi-LLM agent systems who want Gemini as a backend have to hand-roll subprocess plumbing.

**Archon as the forcing function.** [Archon](https://github.com/coleam00/Archon) (coleam00/Archon, `dev` branch) is a TypeScript monorepo — "the first open-source harness builder for AI coding" — that currently supports Claude and Codex as interchangeable AI assistants via its `packages/adapters/` pattern. Its `.env.example` exposes `DEFAULT_AI_ASSISTANT=claude|codex`, with auth per-assistant (global `claude /login` or explicit tokens; `~/.codex/auth.json` for Codex), plus `CODEX_BIN_PATH` for native-binary overrides. A comment in `.env.example` references "the SDK's default model," confirming Archon wraps the Claude Agent SDK and Codex SDK directly rather than calling REST APIs — so to plug in, the Gemini SDK must present a comparable shape.

**`gemini-cli` surface (Apache 2.0, Google, rapid release cadence).** Non-interactive mode via `-p "prompt"`. Structured output via `--output-format json` and `--output-format stream-json` (NDJSON). Three auth modes: OAuth, API key, Vertex AI (different rate-limit profiles: 60 req/min OAuth vs. 1K/day API key). Native support: file/dir context, built-in tools (shell, file ops, web fetch, Google Search), MCP server extensibility, `GEMINI.md` project-context files, session checkpointing, multimodal input. **Not exposed via CLI flags:** system prompt override, caller-defined tool definitions, JSON-schema enforcement on output, per-prompt multi-turn conversation control. These gaps will need workarounds.

**Stability risk.** `gemini-cli` has ~2.4k open issues and weekly releases; recent breakages include OAuth 403 errors, tool-calling bugs, and Windows shell output failures. SDK must pin and maintain a compat matrix.

## Constraints

- **Tech stack**: TypeScript/Node + Python for v1. Rust v2. — Matches reference SDKs' primary surfaces; Archon is TS so TS unblocks the integration path.
- **Dependency**: `gemini-cli` must be installed on the user's system; SDK locates it via PATH or `GEMINI_BIN_PATH` override. — Simple, honest, matches Archon's Codex pattern.
- **Platform**: Windows, macOS, and Linux must all be first-class at v1 launch. — User primarily develops on Windows; dogfood-driven.
- **License**: MIT. — Permissive, short, standard for TS packages, lowest contribution barrier.
- **API shape**: Mirror Claude Agent SDK in spirit (streaming, sessions, typed errors), not necessarily identically. — Keeps the SDK general-purpose; a thin Archon adapter handles the last-mile fit.
- **Compatibility**: Track `gemini-cli` releases, pin a supported version range, document breakage response process. — Fast-moving upstream makes this non-optional.
- **Tool execution security**: gemini-cli exposes shell/file-write/web-fetch. SDK must surface these with some safety story. — Deferred to planning (see Open Questions).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TS + Python in v1; Rust deferred to v2 | Match Claude Agent SDK / Codex SDK reference shapes; don't triple surface area | — Pending |
| SDK-shaped (Claude Agent SDK spirit) + separate thin Archon adapter, both in v1 | Keeps SDK general-purpose while meeting the "works in Archon" bar | — Pending |
| Require pre-installed `gemini-cli`, configurable via `GEMINI_BIN_PATH` | Simple, honest, matches Archon's Codex pattern | — Pending |
| Typed error hierarchy | Archon's workflow executor needs retry classification; opaque strings are a no-go | — Pending |
| Windows first-class at v1 | Primary developer is on Windows; dogfood discipline | — Pending |
| MIT license | Permissive, short, TS-ecosystem default | — Pending |
| Full hosted doc site for v1 | Signals a serious package despite "me-first" audience | — Pending |
| Typed model enum + string escape hatch | Type safety plus forward compatibility with new Gemini releases | — Pending |
| Archon integration *is* the dogfood | Avoids scope creep on a separate demo app | — Pending |
| Tool-use strategy, concurrency model, system-prompt workaround, and tool-execution security deferred to planning | Each depends on what `gemini-cli` actually exposes; research phase will close these | — Pending |

## Open Questions

<!-- Surfaced during questioning; to be resolved in research/planning. -->

- **Tool-use mechanism**: MCP-server bridge (SDK spins a stub MCP server to expose caller tools), built-ins only (v1 supports no custom tools), or a `GEMINI.md` / output-parsing trick?
- **Concurrency model**: spawn-per-call, long-lived piped process, or process pool? Research must first verify what gemini-cli's non-interactive mode actually supports.
- **System prompt override**: prepend to user prompt vs. transient per-session `GEMINI.md` file — which survives multi-turn context cleanly?
- **Feature feasibility audit**: for each listed Active requirement (hooks, structured output, multi-turn sessions, MCP passthrough), does `gemini-cli` expose a clean flag/config, or does it need a workaround?
- **Tool execution security model**: passthrough, opt-in allowlist, or confirmation-callback pattern?
- **Auth canonicalization**: which of `gemini-cli`'s three auth modes (OAuth / API key / Vertex AI) is the canonical SDK default, and how do the others surface?

## Audience

- **v1 primary**: the project author, using the SDK via Archon for code-automation workflows on their own codebases
- **v1 secondary**: developers who already use Claude Agent SDK / Codex SDK and want Gemini as a third interchangeable backend
- **Future**: multi-LLM agent-system builders; the broader Gemini developer community once Google doesn't ship an official one

---
*Last updated: 2026-04-11 after initialization*
