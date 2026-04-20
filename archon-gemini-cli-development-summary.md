# Archon Development Summary: Gemini CLI Provider + SDK

A single reference covering the two-part project: building `@lril/gemini-cli-sdk` (a TypeScript wrapper around Google's `gemini-cli` binary) and contributing a Gemini CLI provider to the Archon workflow engine that consumes it.

Replace `@lril/` with the npm scope you actually publish under.

---

## At a glance

You're shipping two related artifacts:

1. **`@lril/gemini-cli-sdk`** — a standalone npm package that wraps Google's `gemini-cli` tool, exposes it as a TypeScript API, and parallels the shape of `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk`. This is the upstream dependency.
2. **Gemini CLI provider for Archon** — a new `GeminiCliClient` in `packages/core/src/clients/gemini-cli.ts` that implements Archon's `IAssistantClient` interface and delegates to your SDK. This is the downstream PR against `coleam00/Archon`.

The work order is: SDK first, then Archon PR. The SDK's public API is explicitly designed to make the Archon adapter trivial — if the SDK emits events that line up with Archon's `MessageChunk` variants, `gemini-cli.ts` is effectively a switch statement.

---

## Table of contents

- [Part I — Orientation & strategy](#part-i--orientation--strategy)
- [Part II — The integration target (drives both workstreams)](#part-ii--the-integration-target)
- [Part III — Prerequisites](#part-iii--prerequisites)
- [Part IV — Phase 1: Build the SDK](#part-iv--phase-1-build-the-sdk)
- [Part V — Phase 2: Contribute the provider to Archon](#part-v--phase-2-contribute-the-provider-to-archon)
- [Part VI — Pitfalls and testing](#part-vi--pitfalls-and-testing)
- [Part VII — References](#part-vii--references)

---

## Part I — Orientation & strategy

### I.1 What Archon is, briefly

Archon is a workflow engine for AI coding agents. Users define development processes as YAML workflows — plan, implement, validate, review, PR — and Archon runs them across projects from CLI, Web UI, Telegram, Slack, Discord, or GitHub. Today it supports two AI providers: Claude Code (via Anthropic's Claude Agent SDK) and Codex (via OpenAI's Codex SDK). You're adding a third.

### I.2 Three non-obvious facts the docs bury

**1. The repo is mid-rewrite.** `github.com/coleam00/Archon` holds two different codebases under one name. The old Python/FastAPI/Supabase "Archon OS" lived on `main`; the new TypeScript/Bun workflow engine (the one `archon.diy` describes) lives on the **`dev` branch**. Contributors branch from `dev`, not `main`. If you clone and see `python/`, `docker-compose.yml`, and `archon-ui-main/`, you grabbed the archived codebase. The migration tracker is [Issue #952](https://github.com/coleam00/Archon/issues/952); it may be further along by the time you read this, so verify which branch contains `packages/core/` and `bun.lockb` before branching off.

**2. Someone already did the provider-addition blueprint.** [Issue #965](https://github.com/coleam00/Archon/issues/965) — "feat: Pi coding-agent as third AI assistant provider" — enumerates every file that needs changing, provides code snippets for every pattern to mirror, and orders the work into 14 tasks. [Issue #1106](https://github.com/coleam00/Archon/issues/1106) (Hermes provider) is the second example. These are your reference architecture. Your Gemini CLI provider touches the same set of files with the same patterns and naming.

**3. Google has not shipped an official Gemini CLI SDK.** [Google's gemini-cli Issue #2023](https://github.com/google-gemini/gemini-cli/issues/2023) is the still-open feature request for one. An unofficial third-party SDK (`@ketd/gemini-cli-sdk`) exists but is eight days old with zero other consumers — reviewers will reasonably push back on that dep. Hence: you're building your own SDK.

### I.3 Why build your own SDK

Three reasons, stacked:

1. **No official alternative.** Until Issue #2023 resolves, there is no first-party package.
2. **An SDK-based contribution reviews better than a subprocess-management-blob-in-the-provider contribution.** The existing Claude and Codex providers both delegate to SDKs. An SDK means cleaner review diffs, tested boundaries, and future-compatibility with Google's eventual first-party SDK (you swap the import in one PR).
3. **You own the design.** The SDK's public API can be shaped specifically to make the Archon adapter trivial. That's the single most important design lever you have across both workstreams.

### I.4 The dependency relationship

```
┌──────────────────────────────────────────────────┐
│                   Your work                       │
│                                                   │
│   @lril/gemini-cli-sdk  ◀── npm package          │
│          │                                        │
│          │ consumed by                           │
│          ▼                                        │
│   packages/core/src/clients/gemini-cli.ts        │
│          │                                        │
│          │ implements                            │
│          ▼                                        │
│   IAssistantClient (Archon's interface)          │
└──────────────────────────────────────────────────┘
```

Ship the SDK first (at least 0.2.x with commit history and passing tests), then open the Archon PR citing it as a stable dep. Don't reverse this order — publishing a v0.0.1 the day you open the Archon PR is a red flag for reviewers.

---

## Part II — The integration target

Both the SDK and the Archon adapter exist to satisfy one interface. Understand this before you touch either codebase.

### II.1 `IAssistantClient` interface

Location in Archon: `packages/core/src/types/index.ts`.

Per the [Archon architecture docs](https://archon.diy/reference/architecture/#iassistantclient-interface), the advertised signature is:

```ts
export interface IAssistantClient {
  sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string
  ): AsyncGenerator<MessageChunk>;

  getType(): string;
}
```

The docs show the simplified form. The real signature — per Issue #965's discussion of `AssistantRequestOptions` — also carries model, system prompt, and abort signal:

```ts
sendQuery(
  prompt: string,
  cwd: string,
  options: {
    resumeSessionId?: string;
    model?: string;
    systemPrompt?: string;
    abortSignal?: AbortSignal;
  }
): AsyncGenerator<MessageChunk>;
```

Your `GeminiCliClient` in `packages/core/src/clients/gemini-cli.ts` will call into your SDK and `yield` `MessageChunk`s as SDK events arrive. Everything downstream of that yield is Archon's problem.

### II.2 `MessageChunk` — the shape your SDK must project onto

```ts
interface MessageChunk {
  type: 'assistant' | 'thinking' | 'tool' | 'tool_result' | 'result' | 'system';
  content?: string;                              // for assistant | thinking | system
  sessionId?: string;                            // for result
  toolName?: string;                             // for tool | tool_result
  toolInput?: Record<string, unknown>;           // for tool
  toolOutput?: string;                           // for tool_result (implied by #965)
  tokens?: { input: number; output: number };   // for result (implied)
}
```

Semantics:

| `type`        | Emitted when                                  | Typical fields           |
| ------------- | --------------------------------------------- | ------------------------ |
| `assistant`   | Model produces natural-language output        | `content` (delta)        |
| `thinking`    | Model is reasoning (if Gemini CLI exposes it) | `content`                |
| `tool`        | Model invokes a tool                          | `toolName`, `toolInput`  |
| `tool_result` | Tool execution finishes                       | `toolName`, `toolOutput` |
| `result`      | Turn complete — emit **exactly once** at end  | `sessionId`, `tokens`    |
| `system`      | Non-fatal warnings surfaced to the user       | `content`                |

Archon's orchestrator streams these to the user in stream mode or batches them in batch mode. You don't need to know which — just emit in order and finish with one `result`.

---

## Part III — Prerequisites

Install all of these before starting either workstream.

- **Bun** — runtime / package manager / test runner. Archon uses Bun, not Node.js. macOS/Linux/WSL: `curl -fsSL https://bun.sh/install | bash`. Windows PowerShell: `irm bun.sh/install.ps1 | iex`.
- **Git** and a **GitHub account** with a personal access token (repo scope).
- **GitHub CLI (`gh`)** — required by some Archon workflows, useful for PR creation.
- **Claude Code** — needed to run Archon during development (default provider). Install it and authenticate via `claude /login`.
- **`gemini-cli` itself** — install globally with `npm install -g @google/gemini-cli` and authenticate separately (API key, OAuth, or Vertex AI). You'll test your SDK and the Archon provider against it.
- **An npm namespace you own** — the SDK needs a home. `@<your-username>/gemini-cli-sdk` or similar.
- **A code editor** — maintainers use VS Code.

Windows note: Archon runs natively on Windows. You only need Git for Windows (Git Bash for bash nodes) and Bun for Windows — no WSL required.

Decision points that should be settled before you write code:

| Decision                                                    | Your answer                          | Why it matters                                                                           |
| ----------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Wrap `gemini-cli` or call Gemini API direct?                | Wrap the CLI.                        | Matches Claude Code / Codex precedent in Archon.                                         |
| Use third-party `@ketd/gemini-cli-sdk` or build your own?   | Build your own.                      | Reviewers won't accept an 8-day-old unofficial dep.                                      |
| Provider naming in Archon?                                  | `gemini-cli`                         | Namespace avoids collision with a future "gemini" direct-API provider.                   |
| Model string convention?                                    | `gemini-cli:gemini-2.5-pro` (prefix) | Same prefix pattern Pi uses (`pi:google/gemini-2.5-pro`).                                |
| SDK shape — Claude-style `query()` or Codex-style `Thread`? | Codex-style (see IV.3).              | Cleaner session-resume mapping, closer to the architecture you're actually implementing. |

---

## Part IV — Phase 1: Build the SDK

Deliverable: a published npm package, minimum v0.2.x, with passing tests, clean TypeScript types, and a README that demonstrates three flows — fresh turn, streamed turn, resumed thread.

### IV.1 Reference: Claude Agent SDK shape

Package: `@anthropic-ai/claude-agent-sdk`. Pattern: one function, one generator.

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

const result: Query = query({
  prompt: 'Review this code for bugs',
  options: {
    model: 'claude-sonnet-4-5',
    cwd: '/path/to/project',
    systemPrompt: 'You are a security-focused code reviewer.',
    allowedTools: ['Read', 'Grep', 'Glob'],
    disallowedTools: ['Write', 'Edit', 'Bash'],
    permissionMode: 'default',
    abortController: new AbortController(),
    maxTurns: 10,
  },
});

for await (const msg of result) {
  // msg.type: 'system' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'result'
}
```

`Query` extends `AsyncGenerator<SDKMessage, void>` and also exposes control methods (`interrupt()`, `rewindFiles()`, `setPermissionMode()`, `setModel()`). The `system` message with subtype `init` carries the session ID; the `result` message signals turn completion.

Characteristics:

- Stateless entry: `query()` is a function; each call returns an independent generator.
- Single options bag with 15+ fields.
- Generator with extension methods.
- Spawns the `claude` binary under the hood.

### IV.2 Reference: Codex SDK shape

Package: `@openai/codex-sdk`. Pattern: factory → thread → run (two layers).

```ts
import { Codex } from '@openai/codex-sdk';

const codex = new Codex({
  apiKey: process.env.OPENAI_API_KEY,
  env: { PATH: '/usr/local/bin' },
  baseUrl: 'https://api.openai.com',
});

const thread = codex.startThread({
  model: 'gpt-5-codex',
  workingDirectory: '/path/to/project',
  sandboxMode: 'workspace-write',
  approvalMode: 'on-request',
  skipGitRepoCheck: true,
});
// or: const thread = codex.resumeThread(savedThreadId);

// Buffered
const turn = await thread.run('Diagnose the test failure');

// Streamed
const { events } = await thread.runStreamed('Diagnose the test failure');
for await (const event of events) {
  switch (event.type) {
    case 'thread.started':   break;
    case 'turn.started':     break;
    case 'item.started':     break;
    case 'item.updated':     break;
    case 'item.completed':   break;
    case 'turn.completed':   break;
    case 'turn.failed':      break;
    case 'error':            break;
  }
}
```

Event items produced within a turn include `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `plan_update`. Threads persist on disk (`~/.codex/sessions`); resume via `codex.resumeThread(threadId)`.

Characteristics:

- Stateful thread object across `run()` calls.
- Two output modes (buffered `run`, streamed `runStreamed`).
- Granular event model separating turn lifecycle from item events.
- Spawns `codex` binary and exchanges JSONL over stdin/stdout.

### IV.3 Recommended public API

Follow Codex's two-layer pattern, not Claude's. Three reasons:

1. Gemini CLI's `--output-format stream-json` mode is architecturally identical to what Codex does under the hood — JSONL over stdout. You're building the same thing with different paint.
2. The `Thread.id` + `resumeThread(id)` model maps cleanly onto Archon's `resumeSessionId` parameter. Claude's "pass `continue: true` on every call" is awkward in that context.
3. Mirroring the newer and more structured of the two Archon-supported SDKs produces the more defensible design review.

#### IV.3.1 Client factory

```ts
export interface GeminiClientOptions {
  /** Path to the `gemini` binary. Default: discovered via PATH. */
  pathToGeminiCli?: string;
  /** API key. Default: GOOGLE_API_KEY env var. */
  apiKey?: string;
  /** Override base URL (Vertex, proxy). */
  baseUrl?: string;
  /** Replaces the full env passed to the spawned CLI. Otherwise inherits. */
  env?: Record<string, string>;
  /** Skip 'must be in a git repo' check if the CLI enforces one. */
  skipGitRepoCheck?: boolean;
}

export class GeminiClient {
  constructor(options?: GeminiClientOptions);
  startThread(options?: ThreadOptions): GeminiThread;
  resumeThread(threadId: string, options?: ThreadOptions): GeminiThread;
}
```

#### IV.3.2 Thread

```ts
export interface ThreadOptions {
  model?: string;                    // e.g. 'gemini-2.5-pro'
  workingDirectory?: string;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  skipGitRepoCheck?: boolean;
  allowedTools?: string[];
  timeoutMs?: number;
}

export class GeminiThread {
  readonly id: string;

  run(prompt: string, overrides?: Partial<ThreadOptions>): Promise<Turn>;

  runStreamed(
    prompt: string,
    overrides?: Partial<ThreadOptions>
  ): Promise<{ events: AsyncIterable<GeminiEvent> }>;

  abort(): Promise<void>;
  dispose(): Promise<void>;
}

export interface Turn {
  finalResponse: string;
  items: TurnItem[];
  usage?: { inputTokens: number; outputTokens: number };
}
```

#### IV.3.3 Event types

These are the most important type definitions in the whole SDK. Make them match Archon's `MessageChunk` variants as closely as possible.

```ts
export type GeminiEvent =
  | { type: 'thread.started'; threadId: string }
  | { type: 'turn.started' }
  | { type: 'item.started'; item: TurnItem }
  | { type: 'item.updated'; item: TurnItem }
  | { type: 'item.completed'; item: TurnItem }
  | { type: 'turn.completed'; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'turn.failed'; error: GeminiError }
  | { type: 'error'; error: GeminiError };

export type TurnItem =
  | { id: string; type: 'agent_message'; text: string; status?: 'in_progress' | 'complete' }
  | { id: string; type: 'reasoning'; text: string }
  | { id: string; type: 'tool_call'; toolName: string; input: Record<string, unknown>; status: 'in_progress' | 'complete' | 'failed' }
  | { id: string; type: 'tool_result'; toolName: string; output: string; isError: boolean }
  | { id: string; type: 'system_notice'; text: string; severity: 'info' | 'warning' };
```

The item-ID + `status` progression (`in_progress → complete`) lets Archon's `tool_formatter.ts` render tool UI states cleanly.

### IV.4 Event-to-`MessageChunk` mapping table

This is the table the Archon adapter will implement. If your SDK events line up, `gemini-cli.ts` is a switch statement.

| Your SDK event                                   | Archon `MessageChunk`                                     | Notes                                      |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------ |
| `thread.started`                                 | — (no emission)                                           | Stash `threadId` for the final `result`.   |
| `turn.started`                                   | —                                                         | No emission.                               |
| `item.started` + `type: 'tool_call'`             | `{ type: 'tool', toolName, toolInput }`                   | Once per tool call start.                  |
| `item.updated` + `type: 'agent_message'` (delta) | `{ type: 'assistant', content: delta }`                   | Every delta text chunk.                    |
| `item.updated` + `type: 'reasoning'` (delta)     | `{ type: 'thinking', content: delta }`                    | If Gemini exposes reasoning.               |
| `item.completed` + `type: 'tool_result'`         | `{ type: 'tool_result', toolName, toolOutput: output }`   | Adapter decides what to do with `isError`. |
| `item.completed` + `type: 'system_notice'`       | `{ type: 'system', content: text }`                       | Only surface `warning` severity.           |
| `turn.completed`                                 | `{ type: 'result', sessionId: thread.id, tokens: usage }` | Exactly one. Loop must break after.        |
| `turn.failed`                                    | Throw `GeminiError` (or subtype)                          | Adapter catches, retries if transient.     |
| `error` (non-fatal)                              | `{ type: 'system', content: error.message }`              | Log, don't throw.                          |

Extra event types (e.g., `file_change`) that don't map here get skipped by the adapter — that's fine; your SDK is broader than the adapter's needs.

### IV.5 Subprocess-management checklist

The twelve things that go wrong in CLI-wrapping SDKs. Archon reviewers will grep your code for these.

- **Binary resolution order:** `options.pathToGeminiCli` → `GEMINI_CLI_PATH` env var → `which gemini` on PATH. Throw `BinaryNotFoundError` listing attempted paths if nothing works.
- **Windows support:** use `cross-spawn` or Bun's equivalent, not raw `child_process.spawn`. The `.cmd` / `.exe` / shim handling differs on Windows.
- **Stdin lifecycle:** close stdin cleanly after writing the prompt. Don't leave it dangling.
- **Stdout line buffering:** the stream-json output is newline-delimited JSON. Use a line-based reader. Handle partial lines at chunk boundaries.
- **Stderr handling:** capture separately. Keep the last N KB in a ring buffer so crash errors can include it. Don't interleave into the event stream.
- **Exit code handling:** wait for the `exit` event. If the process exits non-zero and you haven't seen `turn.completed`, throw `SubprocessCrashError` with stderr tail.
- **Abort semantics:** `abortSignal.aborted === true` → SIGTERM, wait ~2s, then SIGKILL. On Windows, SIGTERM is a no-op — use `taskkill /T /F /PID <pid>`. Wait for the `close` event to confirm, not just `exit`.
- **Timeout:** if `timeoutMs` is set, arm a timer that aborts and throws `TimeoutError`.
- **EPIPE on stdin writes:** catch and convert to `AbortError` (if aborted) or `SubprocessCrashError`.
- **Zombie-process prevention:** implement the async iterator's `return()` method to tear down the child. **This is the single easiest thing to miss** — when Archon's consumer breaks out of the loop after seeing `result`, your SDK must still kill the subprocess.
- **Disposal idempotency:** `dispose()` must be safe to call any number of times, including while a turn is running and after it's done.
- **Environment leakage:** if `options.env` is set, use it verbatim as the child's environment. Don't merge with `process.env`. Matters for Archon's env-leak gate (Issue #1036).

### IV.6 Error-taxonomy checklist

Throw typed errors so the Archon adapter's `classifyGeminiCliError()` is an `instanceof` chain instead of regex-on-stderr.

```ts
export class GeminiError extends Error {
  constructor(message: string, public readonly cause?: unknown) { super(message); }
}
export class AuthError extends GeminiError {}
export class RateLimitError extends GeminiError {}
export class ModelAccessError extends GeminiError {}
export class SubprocessCrashError extends GeminiError {}
export class BinaryNotFoundError extends GeminiError {}
export class AbortError extends GeminiError {}
export class TimeoutError extends GeminiError {}
```

Classification rules:

| Condition                              | SDK behavior                                                              |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Binary not found, no override          | `BinaryNotFoundError`, thrown early                                       |
| Missing API key where CLI requires it  | `AuthError`, thrown consistently (either at `startThread` or first `run`) |
| 401/403 / known auth-fail stderr       | `AuthError`, no retry                                                     |
| 429 / known rate-limit stderr          | `RateLimitError`, Archon may retry with backoff                           |
| "Model not available" stderr           | `ModelAccessError`, no retry                                              |
| Non-zero exit without `turn.completed` | `SubprocessCrashError`, Archon may retry once                             |
| Caller aborts via `AbortSignal`        | `AbortError`, no retry                                                    |
| `timeoutMs` elapses                    | `TimeoutError`, Archon may retry once                                     |
| `turn.failed` with specific reason     | Corresponding subclass based on reason                                    |

Attach captured stderr tail as a `.stderr` property on relevant errors.

### IV.7 What to ship in v0.1

- `GeminiClient` with `constructor`, `startThread`, `resumeThread`.
- `GeminiThread` with `run`, `runStreamed`, `abort`, `dispose`, and an exposed `id`.
- Full event-type hierarchy with runtime discriminated unions.
- Full error taxonomy (eight typed errors above).
- Shipped TypeScript declarations (`.d.ts`).
- Binary discovery + Windows-friendly subprocess spawning.
- JSONL parser for `gemini-cli --output-format stream-json`.
- Thread persistence: a stable `id` that `resumeThread(id)` can use. Reuse `gemini-cli`'s own session store if it has one; otherwise store a JSONL transcript on disk.
- Abort + timeout + disposal working for early-break consumers.
- Unit tests for event-mapping and error classification.
- README demonstrating fresh turn, streamed turn, resumed thread.

### IV.8 What NOT to ship in v0.1

State these in your README and in your Archon PR description. Scope discipline is half the battle in review.

- No built-in retries (Archon retries at its client layer; don't double-retry).
- No automatic model selection or routing.
- No structured output / `outputSchema` support.
- No custom tools or MCP server bundling (Gemini CLI has its own extension system).
- No auth flows (OAuth, Vertex setup). Delegate to users having `gemini-cli` pre-authenticated.
- No sandbox/permission modes (revisit after seeing what Gemini CLI exposes).
- No progress/background events beyond the turn-lifecycle and item events.
- No Python port.

### IV.9 Publishing checklist

Each of these should be true before you link the SDK in the Archon PR.

- Package scope is one you own on npm (not `@google/*`, not `@anthropic-ai/*`).
- Version is ≥ 0.2.0 with at least one prior release in git history.
- Public API stable across the pinned range. Break BC only with a minor bump.
- TypeScript types exported and verified in a throwaway consumer project.
- Peer dependency on `@google/gemini-cli` declared, or user-side install documented.
- README covers quickstart (~20 lines), full options, event reference, error reference, and an "for integrators" subsection pointing at this spec.
- LICENSE file present (MIT or Apache-2.0).
- `package.json` has `files`, `main`, `types`, `exports`, `repository`, `bugs`, `keywords`, `engines`. Don't ship tests or source maps.
- GitHub repo public, issues enabled.
- CI running tests on push (GitHub Actions is fine).
- `CHANGELOG.md` maintained.

---

## Part V — Phase 2: Contribute the provider to Archon

Deliverable: a merged PR against `coleam00/Archon` that adds `gemini-cli` as a third AI provider.

### V.1 Open the issue first

Before coding, file a GitHub issue at `https://github.com/coleam00/Archon/issues/new`:

- **What:** "Add Gemini CLI as a third AI provider alongside Claude and Codex, backed by `@lril/gemini-cli-sdk`."
- **Why:** users who prefer Gemini (1M context, multimodal, Google ecosystem) currently have no first-class path.
- **How:** reference Issues #965 (Pi) and #1106 (Hermes) as the architectural template. Declare Path A (wrap the CLI) and the SDK you'll consume.
- **Scope limits:** no session resume in v1, API-key auth only, no structured output. Be explicit so review doesn't argue about scope.
- **Model convention:** propose `gemini-cli:gemini-2.5-pro` to namespace Gemini model strings.
- **Transparency:** state that you authored the SDK, link its repo and npm page, link Issue #2023 showing no official SDK exists, and commit to SDK maintenance.

Wait for maintainer feedback before opening the PR. You may get useful pushback on naming, scope, or dependency trust — better to handle in the issue than in PR review.

### V.2 Fork and clone

```bash
# Fork on GitHub, then:
git clone https://github.com/<your-username>/Archon.git
cd Archon

git remote add upstream https://github.com/coleam00/Archon.git
git fetch upstream
git checkout dev
git pull upstream dev
```

If `git checkout dev` shows Python files, check whichever branch contains `packages/core/` and `bun.lockb` — that's the TypeScript codebase. The migration may have landed on `main` by the time you read this.

### V.3 Dev environment setup

```bash
bun install
cp .env.example .env
```

Edit `.env`:

- `CLAUDE_USE_GLOBAL_AUTH=true` (uses your existing `claude /login` credentials) or a Claude OAuth token.
- `GH_TOKEN` and `GITHUB_TOKEN` both set to the same GitHub PAT with repo scope.

Verify the baseline passes before touching anything:

```bash
bun run type-check
bun run lint
bun run test
```

All three must exit 0. If any fail on a clean clone, fix that before building on top of it.

**Always use `bun run test`, never `bun test`.** The former runs each package in isolation; the latter pollutes mocks across packages and produces false failures.

### V.4 Create your feature branch

```bash
git checkout dev
git pull upstream dev
git checkout -b feat/gemini-cli-provider
```

Branch naming in this repo is `feat/` | `fix/` | `docs/` + kebab-case description.

### V.5 Read the code before writing any

Priority order, roughly.

| Priority | File                                                                   | Why                                                                          |
| -------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P0       | `packages/core/src/clients/codex.ts`                                   | The simpler existing provider. Mirror this structure.                        |
| P0       | `packages/core/src/clients/claude.ts`                                  | Shows retry loop and error classification.                                   |
| P0       | `packages/core/src/types/index.ts`                                     | `MessageChunk`, `TokenUsage`, `IAssistantClient`, `AssistantRequestOptions`. |
| P0       | `packages/core/src/clients/factory.ts`                                 | The registration point where you'll add `case 'gemini-cli'`.                 |
| P1       | `packages/workflows/src/deps.ts`                                       | Defines `AssistantClientFactory` and `WorkflowConfig.assistants`.            |
| P1       | `packages/workflows/src/model-validation.ts`                           | Where you'll add `isGeminiCliModel()`.                                       |
| P1       | `packages/workflows/src/dag-executor.ts`                               | `resolveNodeProviderAndModel` — per-node provider resolution.                |
| P1       | `packages/workflows/src/executor.ts`                                   | Workflow-level provider resolution.                                          |
| P1       | `packages/core/src/config/config-types.ts`                             | Config type definitions.                                                     |
| P2       | `packages/core/src/clients/codex.test.ts`                              | Test pattern to follow.                                                      |
| P2       | `packages/workflows/src/schemas/workflow.ts` and `schemas/dag-node.ts` | Zod enums to widen.                                                          |

Re-read Issue #965 with these files open. Its "Patterns to Mirror" section shows exact code snippets keyed to the file names above.

### V.6 Plan your file changes

Based on #965, adapted to Gemini CLI naming.

**Files to CREATE:**

| File                                           | Purpose                                            |
| ---------------------------------------------- | -------------------------------------------------- |
| `packages/core/src/clients/gemini-cli.ts`      | `GeminiCliClient` implementing `IAssistantClient`. |
| `packages/core/src/clients/gemini-cli.test.ts` | Unit tests.                                        |

**Files to UPDATE:**

| File                                                       | Change                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/clients/factory.ts`                     | Add `case 'gemini-cli'` to the switch.                                                                                                                      |
| `packages/core/src/clients/index.ts`                       | Export `GeminiCliClient`.                                                                                                                                   |
| `packages/core/src/clients/factory.test.ts`                | Add test case; update error-message assertion.                                                                                                              |
| `packages/core/src/config/config-types.ts`                 | Add `'gemini-cli'` to every provider union. Add `GeminiCliAssistantDefaults` interface. Touches `GlobalConfig`, `RepoConfig`, `MergedConfig`, `SafeConfig`. |
| `packages/core/src/config/config-loader.ts`                | Add `'gemini-cli'` to env-var validation; default `assistants` entry.                                                                                       |
| `packages/core/src/types/index.ts`                         | Consider a shared `ProviderType = 'claude' \| 'codex' \| 'gemini-cli'` union.                                                                               |
| `packages/workflows/src/model-validation.ts`               | Add `isGeminiCliModel()`. Widen `isModelCompatible()`.                                                                                                      |
| `packages/workflows/src/schemas/workflow.ts`               | Widen provider Zod enum.                                                                                                                                    |
| `packages/workflows/src/schemas/dag-node.ts`               | Same widening on the DAG node schema.                                                                                                                       |
| `packages/workflows/src/deps.ts`                           | Widen `AssistantClientFactory`; add `gemini-cli` to `WorkflowConfig.assistants`.                                                                            |
| `packages/workflows/src/executor.ts`                       | Widen `resolvedProvider` type; infer `gemini-cli` from `gemini-cli:...` model strings.                                                                      |
| `packages/workflows/src/dag-executor.ts`                   | Widen ~15 `'claude' \| 'codex'` annotations. Add Gemini CLI branches in `resolveNodeProviderAndModel` and `buildLoopNodeOptions`.                           |
| `packages/workflows/src/loader.ts`                         | Add `\|\| raw.provider === 'gemini-cli'` to the literal check.                                                                                              |
| `packages/server/src/routes/schemas/config.schemas.ts`     | Widen Zod enums; add `gemini-cli` entry to `safeConfigSchema.assistants` and `updateAssistantConfigBodySchema`.                                             |
| `packages/web/src/components/workflows/BuilderToolbar.tsx` | Add `'gemini-cli'` to provider-select options; widen type union.                                                                                            |
| `packages/web/src/components/workflows/NodeInspector.tsx`  | Same addition.                                                                                                                                              |
| `packages/core/package.json`                               | Add `@lril/gemini-cli-sdk` as a dep.                                                                                                                        |

**Compile-time assertion trap:** `packages/workflows/src/store-adapter.ts` (around line 19) has something like `const assertConfigCompat: WorkflowConfig = {} as MergedConfig`. This deliberately breaks type-check when `MergedConfig` and `WorkflowConfig` drift. You must update **both** before type-check will pass — plan to finish the config-types change and `deps.ts` in one sitting.

### V.7 Implement in dependency order

Work the list in this order, running `bun run type-check` after each step.

1. **Install the dep.** `bun add @lril/gemini-cli-sdk@^0.2 --cwd packages/core`. Verify no peer-dep warnings.
2. **Define the shared provider union.** In `packages/core/src/types/index.ts`: `export type ProviderType = 'claude' | 'codex' | 'gemini-cli'`. Refactor the hardcoded unions. (`@archon/workflows` can't import from `@archon/core` at the type level in some spots — `deps.ts` may need its own parallel union.)
3. **Create `gemini-cli.ts`.** Mirror `codex.ts` structure: lazy logger, class implementing `IAssistantClient`, retry loop with exponential backoff (3 retries, 2s base delay), error classification returning one of `'rate_limit' | 'auth' | 'model_access' | 'crash' | 'unknown'`, abort signal wiring, async generator that maps your SDK's events to `MessageChunk`. Because your SDK already emits events shaped like Archon's `MessageChunk`, this class is primarily a switch statement per the table in IV.4.
4. **Register in the factory.** Add `case 'gemini-cli'` in `factory.ts`. Update the error-message string.
5. **Update config types.** Add `GeminiCliAssistantDefaults` with at minimum `{ model?: string; binaryPath?: string }`. Propagate through `GlobalConfig`, `RepoConfig`, `MergedConfig`, `SafeConfig`. `SafeConfig` is what the web UI sees — no secrets.
6. **Update config loader.** Add `'gemini-cli'` to env-var validation and include a default `gemini-cli: {}` entry.
7. **Update workflow schemas and deps.** Widen the Zod enums in both `workflow.ts` and `dag-node.ts`. Widen `AssistantClientFactory` in `deps.ts`. Add `gemini-cli` to `WorkflowConfig.assistants`.
8. **Update model validation.** Add `isGeminiCliModel(model: string): boolean` returning `model.startsWith('gemini-cli:')`. Widen `isModelCompatible()`.
9. **Update executors.** In `executor.ts`, infer `provider = 'gemini-cli'` when workflow model starts with `gemini-cli:`. In `dag-executor.ts`, do the same in `resolveNodeProviderAndModel`. Add Gemini CLI branches for options in `buildLoopNodeOptions`. Add warnings for Claude-only fields set on Gemini CLI nodes, mirroring the Codex warning pattern.
10. **Update server schemas.** Widen Zod enums in `packages/server/src/routes/schemas/config.schemas.ts`. Add `gemini-cli` to `safeConfigSchema` and `updateAssistantConfigBodySchema`.
11. **Regenerate frontend types.** `bun run dev:server` in one terminal, `bun --filter @archon/web generate:types` in another.
12. **Update the web UI.** Add `<option value="gemini-cli">Gemini CLI</option>` to the provider selects in both `BuilderToolbar.tsx` and `NodeInspector.tsx`. Widen type unions and casts.
13. **Write the tests.** In `gemini-cli.test.ts`, use `mock.module(...)` to mock `@lril/gemini-cli-sdk`. Cover: yields assistant chunks, yields tool/`tool_result` chunks, yields `result` with tokens, handles abort, retries on transient errors, throws on auth without retry, cleans up in `finally`. In `factory.test.ts`, add a creation case and update the error-message assertion.

### V.8 Validate before you push

```bash
bun run type-check
bun run lint
bun run format
bun run test
# or, in one shot:
bun run validate
```

All four must pass. Again: `bun run test`, not `bun test`.

### V.9 Manual smoke test

Unit tests aren't enough for a provider.

1. `bun run dev:server` in one terminal.

2. Open the web UI (default `http://localhost:5173`). Confirm "Gemini CLI" appears in provider dropdowns in both the builder toolbar and the node inspector.

3. Create a minimal workflow at `.archon/workflows/test-gemini.yaml`:
   
   ```yaml
   name: test-gemini
   description: Smoke test for the Gemini CLI provider
   provider: gemini-cli
   model: gemini-cli:gemini-2.5-pro
   nodes:
     - id: ask
       prompt: "Say hello and tell me what model you are."
   ```

4. `bun run cli workflow list` should show it without errors.

5. `bun run cli workflow run test-gemini "hello"` should stream output. If `gemini-cli` isn't authenticated, expect a clean `AuthError` from your SDK propagated as a clear user-facing error — not a raw stack trace. A raw stack trace means your error classification needs tightening.

6. `curl http://localhost:3090/api/config | jq .assistants` should include `gemini-cli`.

### V.10 Commit

Commit style:

- Present tense: "Add Gemini CLI provider" not "Added".
- First line under 72 characters.
- Reference your issue number.

```bash
git add .
git commit -m "Add Gemini CLI as third AI provider (#<your-issue-number>)"
```

Split commits if the work spans clearly separable changes (e.g., one commit for the client, one for schema widening, one for UI).

### V.11 Push and open the PR

```bash
git push -u origin feat/gemini-cli-provider
```

PR form:

- **Base branch:** `coleam00/Archon:dev` — **not `main`**. If GitHub defaults to `main`, change it.
- **Compare branch:** your fork's `feat/gemini-cli-provider`.
- **Title:** `feat: Add Gemini CLI provider`.
- **Description:** link your issue with `Closes #<number>`. Briefly explain additions, scope limits, and any deviations from #965's pattern. State explicitly that `bun run validate` passes. Declare authorship of the SDK dep and link its repo/npm/CI.

Checklist to paste in the PR body:

- [ ] Issue filed and approach agreed with maintainers
- [ ] SDK published and authored by me (`@lril/gemini-cli-sdk` at v0.2.x)
- [ ] Mirrors the Codex client pattern
- [ ] Unit tests for new client and factory
- [ ] Manual smoke test: end-to-end workflow run with Gemini CLI
- [ ] `bun run type-check` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes
- [ ] `bun run validate` passes
- [ ] Web UI shows the new provider in both dropdowns

### V.12 Handle review

Expect feedback on naming (`gemini-cli` vs `gemini` vs `google`), scope, shared code with other providers, error messages, and edge-case tests — especially around the subprocess boundary.

Respond promptly. Push fixes as additional commits to the same branch. Don't force-push during review unless asked — it makes reviewers lose their place.

---

## Part VI — Pitfalls and testing

### VI.1 Pitfalls: SDK side

Things that will go wrong while building `@lril/gemini-cli-sdk`. Detailed in IV.5 and IV.6; flagged here as the short list to keep at eye-level during dev:

- **The `return()` trap:** async-iterator consumers that break out early must not leave zombie `gemini` processes. Implement `return()` on your iterator.
- **Windows subprocess behavior:** `cross-spawn`, `taskkill`, wait for `close` not `exit`.
- **Env leakage:** if `env` is provided, use it verbatim. Don't merge with `process.env`.
- **Partial JSON lines at chunk boundaries:** buffer incomplete lines; don't `JSON.parse` a fragment.
- **Stderr capture as ring buffer:** don't accumulate unbounded stderr in memory; keep the last N KB for error attachment.
- **Typed errors throughout:** every thrown `Error` should be one of the eight classes in IV.6.

### VI.2 Pitfalls: Archon side

Things that will bite you while implementing the provider:

- **The `store-adapter.ts` compile-time assertion.** `MergedConfig` and `WorkflowConfig` must stay in structural sync. Update both in one sitting.
- **Fifteen-ish annotations in `dag-executor.ts`.** Find-in-files for every `'claude' | 'codex'` literal before declaring victory.
- **Mock pollution.** `bun test` (no `run`) pollutes mocks across packages. Always `bun run test`.
- **Regenerating frontend types.** Server-schema changes require the two-terminal sequence (`bun run dev:server` + `bun --filter @archon/web generate:types`) or the web UI will show stale TS errors.
- **CLI vs server file reads.** The CLI reads workflows from disk and picks up uncommitted changes. The server reads from `~/.archon/workspaces/owner/repo/`, which only syncs on worktree creation. Edits that "don't take effect" are usually this.
- **Branch selection in the PR form.** Default is `main`. Change to `dev`.
- **Binary distribution for compiled installs.** The compiled `bun build --compile` archon binary may not find `gemini-cli` the same way the dev build does. Read [Issue #995](https://github.com/coleam00/Archon/issues/995) before finishing. At minimum, fail fast with a clear error if your provider is invoked from a compiled binary that can't locate `gemini`.

### VI.3 Testing strategy

| Layer                       | Tool                                       | What it proves                                                                            |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| SDK unit tests              | Bun test with `mock.module()`              | Event mapping correct, error classification correct, subprocess lifecycle correct.        |
| SDK integration (manual)    | Run against a real `gemini-cli` install    | Real streaming works, auth failures classify correctly, abort actually kills the process. |
| Archon provider unit tests  | Bun test with mocked SDK                   | `GeminiCliClient` yields correct `MessageChunk` variants from mocked SDK events.          |
| Archon factory tests        | Existing patterns in `factory.test.ts`     | Registration works; error messages updated.                                               |
| Archon type-check           | `bun run type-check`                       | All 15ish `'claude' \| 'codex'` widenings complete.                                       |
| Archon lint                 | `bun run lint`                             | Style consistent with rest of repo.                                                       |
| Archon integration (manual) | End-to-end workflow run via CLI and Web UI | Provider is visible, runs, fails cleanly on auth errors.                                  |

For the SDK unit tests, test at minimum these nine cases (lifted from #965's Pi test list, adapted):

1. Yields assistant text from `agent_message` deltas.
2. Yields thinking from `reasoning` deltas.
3. Yields tool from `tool_call` item start.
4. Yields tool_result from `tool_call` item completion.
5. Yields result with token usage from `turn.completed`.
6. Handles abort signal (calls `thread.abort()`, subprocess dies).
7. Retries on transient errors (SubprocessCrashError, not AuthError).
8. Throws on auth errors without retry.
9. Calls `dispose()` in finally, even on early break.

---

## Part VII — References

**Archon (the project):**

- Main docs: <https://archon.diy/>
- Architecture (`IAssistantClient`, `MessageChunk`, extension guide): <https://archon.diy/reference/architecture/>
- AI Assistants setup: <https://archon.diy/getting-started/ai-assistants/>
- New Developer Guide: <https://archon.diy/contributing/new-developer-guide/>
- CLI Internals: <https://archon.diy/contributing/cli-internals/>
- Repo: <https://github.com/coleam00/Archon>
- Repo `CONTRIBUTING.md` (PR rules, terse but authoritative): <https://github.com/coleam00/Archon/blob/main/CONTRIBUTING.md>

**Archon issues to know:**

- #965 — Pi provider (your blueprint): <https://github.com/coleam00/Archon/issues/965>
- #1106 — Hermes provider (secondary reference): <https://github.com/coleam00/Archon/issues/1106>
- #995 — Binary-distribution caveats for provider SDKs: <https://github.com/coleam00/Archon/issues/995>
- #952 — Migration plan explaining the main/dev split: <https://github.com/coleam00/Archon/issues/952>

**Existing provider SDKs:**

- Claude Agent SDK (npm): <https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk>
- Claude Agent SDK TypeScript reference: <https://platform.claude.com/docs/en/agent-sdk/typescript>
- Codex SDK (npm): <https://www.npmjs.com/package/@openai/codex-sdk>
- Codex SDK source + README: <https://github.com/openai/codex/tree/main/sdk/typescript>
- Codex non-interactive JSONL event schema: <https://developers.openai.com/codex/noninteractive>

**Gemini CLI:**

- Gemini CLI (npm): <https://www.npmjs.com/package/@google/gemini-cli>
- Gemini CLI feature request for an official SDK (open): <https://github.com/google-gemini/gemini-cli/issues/2023>
- Gemini CLI GitHub repo: <https://github.com/google-gemini/gemini-cli>
