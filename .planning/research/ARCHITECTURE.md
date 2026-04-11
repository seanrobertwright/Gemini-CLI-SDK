# Architecture Research

**Domain:** Dual-language (TypeScript + Python) SDK wrapping a Node CLI binary (`gemini-cli`) as a subprocess, targeting integration with Archon (`coleam00/Archon`) as a drop-in AI assistant client alongside Claude and Codex.
**Researched:** 2026-04-11
**Confidence:** HIGH on Archon integration shape (read directly from `dev` branch source), HIGH on Claude/Codex SDK architectural patterns (read from source), HIGH on `gemini-cli` stream-json surface (verified via issue #8203, PR #10883, headless docs), MEDIUM on exact stream-json event schema (documented event types confirmed; field-level schema under-documented, validate empirically in Phase 1).

---

## System Overview

The SDK is a **thin, layered wrapper** around a foreign subprocess. There is no hosted state, no database, no HTTP server — the "system" is a library that owns a child process and streams parsed events out of it. The architecture below is identical in TypeScript and Python; only the language primitives differ.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Consumer Application                         │
│       (Archon adapter, user script, CLI tool, test harness)          │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  query() / async iteration
┌────────────────────────────────┴─────────────────────────────────────┐
│                       PUBLIC API LAYER                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
│  │  query()   │  │  Session   │  │   Types    │  │  Error Types  │  │
│  │ generator  │  │  (resume)  │  │  (enums)   │  │  (hierarchy)  │  │
│  └─────┬──────┘  └──────┬─────┘  └────────────┘  └───────┬───────┘  │
└────────┼─────────────────┼──────────────────────────────┬┘           │
         │                 │                              │            │
┌────────┼─────────────────┼──────────────────────────────┼────────────┐
│        │   INTERNAL CORE LAYER                          │            │
│  ┌─────▼──────────┐  ┌───▼─────────┐  ┌──────────┐  ┌──▼──────────┐ │
│  │  Process Mgr   │  │  Session    │  │  Options │  │ ErrorMapper │ │
│  │  (spawn/kill/  │  │  State      │  │  Builder │  │ stderr+exit │ │
│  │   lifecycle)   │  │  (per-call) │  │  (argv)  │  │  → typed    │ │
│  └────────┬───────┘  └───┬─────────┘  └────┬─────┘  └──▲──────────┘ │
│           │              │                 │            │            │
│  ┌────────▼──────────────▼─────────────────▼────────────┴──────┐    │
│  │            NDJSON Stream Parser / Event Dispatcher          │    │
│  │  (line-buffered reader → schema validate → typed events)   │    │
│  └────────┬────────────────────────────────────────────────────┘    │
│           │                                                          │
│  ┌────────┴────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Binary         │  │  Auth        │  │  MCP Passthrough       │  │
│  │  Resolver       │  │  Environment │  │  (config file / flag   │  │
│  │  (PATH /        │  │  (OAuth /    │  │   relay — no bridge    │  │
│  │   GEMINI_BIN)   │  │   key / VA)  │  │   in v1)               │  │
│  └─────────────────┘  └──────────────┘  └────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │  child_process.spawn
                                       │  stdin/stdout/stderr pipes
┌──────────────────────────────────────▼──────────────────────────────┐
│                     gemini-cli (Node subprocess)                     │
│     invoked with  -p <prompt>  --output-format stream-json  [...]   │
└──────────────────────────────────────────────────────────────────────┘
```

**Data flow direction (single source of truth):**

- **Outbound (public → CLI):** `query()` → Session → OptionsBuilder → ProcessMgr → `spawn()`
- **Inbound (CLI → public):** CLI stdout → line buffer → NDJSON Parser → Event dispatcher → `AsyncGenerator` / `AsyncIterator` yielded from `query()`
- **Errors (cross-cutting):** stderr lines + exit codes → ErrorMapper → typed exception → thrown into the generator at the next `yield`/`await`
- **State ownership:** The SDK itself is **stateless across calls** in v1. All multi-turn state is encoded in a `sessionId` string returned by one `query()` and passed to the next via `resume=...`. No singletons, no shared process, no cache — swap to a pooled model later without reshaping the public API.

---

## Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|---------------|------------------------|
| **Public `query()`** | Entry point. Returns `AsyncGenerator<MessageChunk>` (TS) / `AsyncIterator[MessageChunk]` (Python). Validates inputs, instantiates Session and ProcessMgr, yields parsed events. | `async function* query(opts)` / `async def query(...) -> AsyncIterator` |
| **Session** | Holds `sessionId` between calls. In v1 it is a value object, not a resource: caller passes it back into the next `query()` with `resume=sessionId`. No open process. | Plain record with `sessionId`, `cwd`, last-known `usage`. |
| **OptionsBuilder** | Translates typed SDK options (`model`, `systemPrompt`, `tools`, `mcpServers`, `additionalDirectories`, `outputFormat`, `abortSignal`) into a **`string[]` argv array**. Never uses shell interpolation. | Pure function: `buildArgv(options): string[]`. Unit-testable without spawning. |
| **BinaryResolver** | Locates `gemini` (or `gemini.exe` on Windows). Order: explicit `cliPath` option → `GEMINI_BIN_PATH` env → `PATH` lookup via `which`/`shutil.which` → known install locations (`~/.npm-global/bin/gemini`, `/usr/local/bin/gemini`, `~/.local/bin/gemini`, `~/node_modules/.bin/gemini`). Throws `GeminiNotFoundError` with actionable install hint. | Mirrors Claude Agent SDK Python's `_find_cli()` exactly — proven pattern. |
| **AuthEnvironment** | Produces the `env` dict for the subprocess. Three auth modes: OAuth (rely on `~/.gemini/` state), API key (`GEMINI_API_KEY`), Vertex AI (`GOOGLE_APPLICATION_CREDENTIALS` + region/project). Canonical default: **API key** (most predictable, highest quota ceiling per-project). Filters parent-process sensitive keys through an env allowlist. | Mirrors Archon's `buildCleanSubprocessEnv` → env-allowlist pattern. |
| **ProcessManager** | Spawns `gemini-cli` with argv + env + cwd. Wires stdout/stderr/stdin pipes. Owns kill/abort (SIGTERM → wait → SIGKILL on Unix; `taskkill /T /F` on Windows). Exposes an **async stream of stdout lines** and a sink of stderr lines. Has a **pluggable strategy interface** so `spawn-per-call` / `long-lived` / `pool` can swap in later. | TS: `child_process.spawn(bin, argv, { env, cwd, shell: false, stdio: ['pipe','pipe','pipe'], windowsHide: true })`. Python: `asyncio.create_subprocess_exec(bin, *argv, stdin=PIPE, stdout=PIPE, stderr=PIPE, env=..., cwd=...)`. |
| **NDJSON Parser** | Reads stdout line-by-line, buffers partial lines until `\n`, parses each as JSON, validates shape against the stream-json event schema, dispatches to a normalized `MessageChunk` union. Tolerates non-JSON junk lines (logs) by routing them to a "warning" event, never throwing. | Line reader + `JSON.parse`/`json.loads` + schema tag dispatch. |
| **ErrorMapper** | Classifies failures into typed errors. Inputs: exit code, accumulated stderr, any `{"type":"error"}` event payloads, known stderr substring patterns. Outputs: `GeminiError` subclasses (see Pattern 3 below). | Mirrors Archon's `classifySubprocessError` — pattern-match approach is battle-tested. |
| **MCPPassthrough** | Relays caller-provided MCP server configs to `gemini-cli` via its native MCP support (config file or `--mcp-server` flag, depending on what research confirms). **Does not bridge to caller-side in-process tools in v1** — that's the "tool-use bridge" whose approach is TBD. | Thin JSON-writer + argv injection. No protocol work. |
| **Tool-use Bridge** _(v1 design placeholder)_ | Phase 4 decision. Leading candidate: caller-side tool definitions are exposed to Gemini by **spinning a stub MCP server inside the SDK process** that proxies MCP tool calls back into user-supplied functions. This is exactly how Claude Agent SDK handles `@tool` — wrapping user functions "in an in-process MCP server." Fallback: v1 supports built-in `gemini-cli` tools only and defers custom tools. | TBD in planning. Architecture leaves this as a **separate module** so omitting it does not block v1. |

---

## The Dual-Language Parity Strategy (core decision)

This is the most consequential architecture decision, because the project ships two implementations in parallel and the user's success criterion is *behavioral* consistency, not API-surface consistency. Three options were evaluated:

### Option A — Single canonical impl (TS) + mechanical port (Python) **[CHOSEN]**

TypeScript is the reference implementation. Python follows, module-for-module, one commit behind at worst. A **shared spec doc** (`/spec/protocol.md`) defines the normative contract; both implementations link to it and cite section numbers in docstrings. A **shared fixture set** (`/spec/fixtures/*.ndjson` + expected event sequences in `*.json`) is consumed by **both** language test suites — this is the actual parity enforcement mechanism.

**Why:**
1. Archon is TypeScript. TS unblocks the forcing-function integration — it must be first and must stay current.
2. Claude Agent SDK also ships TS first, Python slightly behind (v0.2.71 vs v0.1.48 in 2026); proven cadence.
3. A TS-first discipline means the Python port is a mechanical translation, not an independent design, which reduces parity drift at the source.
4. Shared NDJSON fixtures are the only parity test that truly works — mocking the subprocess interface-compatibly in both languages is otherwise painful.

**Tradeoff accepted:** Python release lags TS by ~1 week during active development. This is visible and acceptable.

### Option B — Parallel implementations against a shared spec

Both languages are developed simultaneously against `/spec/protocol.md` with no canonical. **Rejected** — parity drift is inevitable when two people (or one person on two days) interpret a spec differently, and "shared spec" becomes a theatrical artifact that no one updates.

### Option C — Shared protobuf schema / codegen

Define events as `.proto`, generate TS + Python types. **Rejected as overkill.** The event set is small (~6 types), the velocity is weekly (codegen adds friction), and `gemini-cli` does not use protobuf on the wire — it emits NDJSON. A codegen pipeline for what is effectively 6 discriminated-union variants is cost without benefit.

### Concrete parity mechanisms

1. **`/spec/protocol.md`** — Normative doc. Lists every stream-json event type, every SDK error, every argv flag the SDK uses, and every public option. Both `README.md` files say "see /spec/protocol.md for normative semantics."
2. **`/spec/fixtures/`** — Golden NDJSON traces captured from real `gemini-cli` runs (scrubbed of session IDs / timestamps). Each fixture has a sibling `.expected.json` listing the event sequence the SDK should emit. Both language test suites load the same fixtures and assert the same sequence.
3. **`/spec/errors.md`** — Canonical list of typed errors + the stderr patterns that map to each. Both implementations duplicate the same patterns table; a linter script diffs them in CI.
4. **Matching file layout.** `ts/src/process/manager.ts` ↔ `python/src/gemini_sdk/_internal/process/manager.py`. A code-review checklist requires "if you added/renamed a file in one language, do it in the other in the same PR."
5. **Test name parity.** TS `manager.spec.ts` and Python `test_manager.py` share test case names (snake_case vs camelCase is fine). A script compares the two test lists and flags unique-to-one-side tests.
6. **No shared wire protocol is emitted by the SDK itself.** The SDK is the *consumer* of `gemini-cli`'s NDJSON wire format; it does not produce any cross-language wire format. Parity is purely at the *behavioral* layer (same inputs → same events), which is exactly what fixture testing verifies.

---

## Recommended Project Structure (monorepo)

```
Gemini-SDK/
├── spec/                              # The parity anchor
│   ├── protocol.md                    # Normative event schema, flag contract, error taxonomy
│   ├── errors.md                      # Stderr-pattern → typed-error mapping table
│   └── fixtures/
│       ├── simple_text.ndjson         # Captured gemini-cli output (real trace)
│       ├── simple_text.expected.json  # Asserted SDK event sequence for the above
│       ├── tool_use_builtin.ndjson
│       ├── tool_use_builtin.expected.json
│       ├── resume_session.ndjson
│       ├── resume_session.expected.json
│       ├── error_rate_limit.ndjson
│       └── error_rate_limit.expected.json
│
├── ts/                                # TypeScript package (canonical)
│   ├── src/
│   │   ├── index.ts                   # Public exports only
│   │   ├── query.ts                   # query() generator (public API)
│   │   ├── session.ts                 # Session value object
│   │   ├── types.ts                   # Discriminated-union MessageChunk, option types, enums
│   │   ├── errors.ts                  # GeminiError hierarchy
│   │   └── _internal/
│   │       ├── process/
│   │       │   ├── manager.ts         # spawn/kill/abort, strategy interface
│   │       │   ├── spawn-per-call.ts  # v1 default strategy
│   │       │   └── binary-resolver.ts # cliPath → GEMINI_BIN_PATH → PATH → known paths
│   │       ├── parse/
│   │       │   ├── ndjson-reader.ts   # Line-buffered async iterator over stdout
│   │       │   ├── event-dispatcher.ts# Validates + normalizes to MessageChunk
│   │       │   └── schema.ts          # Runtime validators for each event type
│   │       ├── options/
│   │       │   ├── argv-builder.ts    # options → string[] argv (pure, shell:false)
│   │       │   └── env-builder.ts     # auth-mode → env dict, with allowlist
│   │       ├── errors/
│   │       │   └── classifier.ts      # stderr+exit-code → typed error, pattern-table
│   │       └── mcp/
│   │           └── passthrough.ts     # Relay user mcpServers config to CLI
│   ├── test/
│   │   ├── fixtures.spec.ts           # Loads ../spec/fixtures/*, runs parser, diffs
│   │   ├── argv-builder.spec.ts       # Pure unit, no spawn
│   │   ├── binary-resolver.spec.ts    # Mocks fs + PATH
│   │   ├── errors.spec.ts             # Pattern-table coverage
│   │   └── e2e/
│   │       └── gemini-cli-real.spec.ts  # Optional, gated on GEMINI_E2E=1
│   ├── package.json
│   └── tsconfig.json
│
├── python/                            # Python package (mirror)
│   ├── src/gemini_sdk/
│   │   ├── __init__.py                # Public exports only
│   │   ├── query.py                   # async def query() -> AsyncIterator
│   │   ├── session.py
│   │   ├── types.py                   # TypedDict / dataclass MessageChunk union
│   │   ├── errors.py                  # GeminiError hierarchy
│   │   └── _internal/
│   │       ├── process/
│   │       │   ├── manager.py
│   │       │   ├── spawn_per_call.py
│   │       │   └── binary_resolver.py
│   │       ├── parse/
│   │       │   ├── ndjson_reader.py
│   │       │   ├── event_dispatcher.py
│   │       │   └── schema.py
│   │       ├── options/
│   │       │   ├── argv_builder.py
│   │       │   └── env_builder.py
│   │       ├── errors/
│   │       │   └── classifier.py
│   │       └── mcp/
│   │           └── passthrough.py
│   ├── tests/
│   │   ├── test_fixtures.py           # Same ../spec/fixtures/* as TS
│   │   ├── test_argv_builder.py
│   │   ├── test_binary_resolver.py
│   │   ├── test_errors.py
│   │   └── e2e/
│   │       └── test_gemini_cli_real.py
│   └── pyproject.toml
│
├── adapter-archon/                    # Thin Archon integration (PR'd into coleam00/Archon)
│   └── gemini.ts                      # Implements IAssistantClient, imports @gsd/gemini-sdk
│
└── .planning/                         # (GSD project meta, already present)
```

### Structure rationale

- **`spec/` at the root of the monorepo, not inside either language.** Signals that the spec is the source of truth and neither language "owns" it. Fixtures are symlinked/path-referenced from both test suites.
- **`_internal/` prefix is mandatory.** Mirrors `claude-agent-sdk-python`'s `_internal/` convention. Anything inside is explicitly private; only `index.ts` / `__init__.py` define the public surface. This prevents downstream breakage when internals change, which they will, weekly, as `gemini-cli` evolves.
- **Flat module layout inside `_internal/`**, grouped by *responsibility* (`process/`, `parse/`, `options/`, `errors/`, `mcp/`), not by lifecycle or layer. Matches how Claude Agent SDK Python is organized (`_internal/transport/`, `_internal/message_parser.py`, `_internal/query.py`) and makes the TS↔Python 1:1 file mapping obvious at review time.
- **`adapter-archon/` lives in this repo during development** and gets copied/PR'd into Archon's `packages/core/src/clients/gemini.ts` when ready. Keeping it in-tree lets the SDK author evolve the SDK and the consumer in lock-step, catching interface mismatches early.
- **No `src/shared/` or `common/`.** There is no runtime code shared between TS and Python. The only shared artifacts are in `spec/`, and they are static files, not code.

---

## Architectural Patterns

### Pattern 1: Async Generator as Public API

**What:** `query()` returns an async generator that yields `MessageChunk` events until the CLI exits. The generator owns the process lifecycle: process spawns on first `await`/iteration, is killed if the generator is closed early (caller breaks out of `for await`), and emits a terminal `result` chunk before returning.

**When to use:** Whenever a streaming CLI wrapper needs to expose partial output without forcing the caller to manage a process object. This is exactly the pattern Claude Agent SDK and Codex SDK both use, and what Archon consumes via `for await (const chunk of client.sendQuery(...))`.

**Trade-offs:**
- ✅ Caller cancellation via `break` / early return is natural; generator cleanup kills the subprocess automatically.
- ✅ No process handle leaks into user code.
- ✅ Aligns byte-for-byte with the interface Archon's `IAssistantClient.sendQuery` already expects (see Integration Points below).
- ⚠️ Error handling inside a generator is subtle. Errors thrown mid-stream surface at the caller's next `await` on the iterator — they can't be caught with a `try` around `query()` alone; the `try` must wrap the `for await` loop.
- ⚠️ On retry, chunks already yielded by a failed attempt are gone; the caller may see partial output from attempt 1 followed by full output from attempt 2. Archon's Claude client documents this exact limitation and lives with it; the Gemini SDK should match.

**TypeScript example:**
```typescript
export async function* query(
  input: { prompt: string; options?: QueryOptions }
): AsyncGenerator<MessageChunk> {
  const process = await processMgr.spawn(input.options);
  try {
    for await (const line of process.stdoutLines()) {
      const event = parseAndValidate(line);
      if (event) yield event;
    }
    const exit = await process.exitCode();
    if (exit !== 0) {
      throw errorMapper.classify(exit, process.stderrBuffer);
    }
  } finally {
    await process.killIfAlive();
  }
}
```

### Pattern 2: Argv Builder as Pure Function

**What:** All translation from SDK options to CLI arguments lives in a single pure function `buildArgv(options): string[]`. It touches no filesystem, no environment, no process. It is unit-testable without spawning a thing.

**When to use:** Any CLI wrapper. This is the single highest-leverage testability lever in the whole codebase, because 80% of subprocess-wrapper bugs are in flag construction.

**Trade-offs:**
- ✅ Exhaustive coverage of flag combinations in fast unit tests.
- ✅ Impossible to accidentally inject shell metacharacters, because the output is a `string[]` and spawning uses `shell: false`.
- ✅ When `gemini-cli` adds or renames a flag, exactly one file changes.
- ⚠️ Requires discipline — no one-off `args.push('--foo')` sprinkled in the process manager.

**TypeScript example:**
```typescript
export function buildArgv(opts: QueryOptions): string[] {
  const argv: string[] = ['-p', opts.prompt, '--output-format', 'stream-json'];
  if (opts.model) argv.push('--model', opts.model);
  if (opts.resumeSessionId) argv.push('--resume', opts.resumeSessionId);
  if (opts.additionalDirectories) {
    for (const dir of opts.additionalDirectories) argv.push('--include-directories', dir);
  }
  if (opts.outputSchema) argv.push('--output-schema-file', writeTempSchema(opts.outputSchema));
  return argv;
}
```

### Pattern 3: Typed Error Hierarchy from stderr + exit code

**What:** A single `classify(exitCode, stderr, lastEvents)` function pattern-matches known failure modes into a typed `GeminiError` subclass. Unknown failures fall through to `ProcessError`. This is the **same pattern** Archon's Claude client uses in production, so it is battle-tested against a very similar problem (wrapping a weekly-breaking Anthropic Node CLI).

**When to use:** Any time the underlying tool does not provide machine-readable error codes and instead communicates via stderr text. Which is: every CLI, ever.

**Taxonomy (v1):**
```
GeminiError                     // abstract base
├── GeminiNotFoundError         // binary missing → install hint
├── AuthError                   // 401/403, "unauthorized", "credit balance"
├── RateLimitError              // 429, "rate limit", "too many requests", "quota"
├── InvalidPromptError          // CLI refused the prompt (schema, length, safety)
├── ProcessError                // non-zero exit, no known pattern match
├── ProcessCrashError           // killed, signal, "exited with code", retryable
├── ParseError                  // NDJSON line failed to parse or validate
├── AbortError                  // caller cancelled via AbortSignal
└── UnsupportedFeatureError     // feature flagged unsupported by cli version
```

**Trade-offs:**
- ✅ Callers (especially Archon) can retry rate-limit and crash errors while hard-failing auth errors — exactly what Archon's workflow executor needs.
- ✅ Pattern tables are greppable, code-reviewable, and cheap to extend.
- ⚠️ Patterns drift as `gemini-cli` changes stderr wording. Mitigation: `spec/errors.md` has a version column; `.gemini-cli-compat` file pins a tested version range; CI has a "stderr taxonomy" smoke test that runs real commands against the pinned version and verifies known patterns still classify.

### Pattern 4: Pluggable Process Strategy (ship one, design for three)

**What:** `ProcessManager` consumes an abstract `ProcessStrategy` interface. v1 ships `SpawnPerCallStrategy`. The architecture admits `LongLivedStrategy` and `PoolStrategy` later *without* a breaking change to the public API, because `query()` only sees "an async stream of stdout lines and a way to end it."

**Strategy interface (TS):**
```typescript
export interface ProcessStrategy {
  run(argv: string[], env: NodeJS.ProcessEnv, cwd: string, signal?: AbortSignal): ProcessHandle;
}
export interface ProcessHandle {
  stdoutLines(): AsyncIterable<string>;
  stderrText(): string;              // buffered, final, for error classification
  exitCode(): Promise<number>;
  kill(): Promise<void>;
}
```

**Why this matters *now* even if we only ship `SpawnPerCallStrategy`:** It prevents the public API from accidentally leaking process-lifecycle assumptions. If `query()` ever returns a `Process` object instead of an async iterator, or exposes `startSession()` / `endSession()` methods, swapping in a long-lived strategy later becomes a breaking change. The async-iterator contract gives us freedom.

**Swap points:**
- **Spawn-per-call → long-lived:** No public API change. The `run()` impl returns a handle whose `stdoutLines()` reads from a persistent process, and `kill()` becomes a no-op (or decrement of a ref count). Only `ProcessManager` and the new strategy file change.
- **Long-lived → pool:** Change the strategy's internal acquisition (checkout from pool, return on `kill()`). Still no public API change.
- **Lock-in risks to avoid now:** Do **not** expose `sessionId` as "the thing you hold a reference to" — expose it as a *value* the caller passes back. Do **not** cache the BinaryResolver result in a module-level variable without a reset hook (tests need reset; long-lived strategies may need re-resolution). Do **not** make `query()` itself stateful.

### Pattern 5: Line-Buffered NDJSON Reader with Lenient Fallback

**What:** The parser reads stdout one line at a time (`readline()` in Python, a byte-stream line-splitter in TS), attempts `JSON.parse`/`json.loads` on each, and **emits but does not throw** on parse failure — non-JSON lines are forwarded as a `{type: 'cli_log', content: raw}` event (or silently dropped, configurable). Only an explicit `--strict-parse` test mode throws on junk.

**Why lenient:** `gemini-cli` is a weekly-breaking tool that has historically leaked log lines into stdout (see "Stability risk" in `PROJECT.md`). A parser that crashes on the first unexpected line is a parser that breaks the SDK every release. A lenient parser degrades gracefully and lets the SDK ship a one-line fix to the pattern table.

**Buffer limit:** 1 MiB per line (matches Claude Agent SDK's `_DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024`). Beyond that, throw `ParseError("line too long")` — this is a real attack vector if a malicious MCP server can drive CLI output.

---

## Data Flow

### Request flow

```
User code
  │
  │  query({prompt, options})
  ▼
query() generator
  │
  ├─► BinaryResolver.resolve()     → path to gemini executable
  ├─► EnvBuilder.build(authMode)   → subprocess env dict
  ├─► ArgvBuilder.build(options)   → string[] argv
  ├─► OptionsBuilder validates enums & flag compatibility
  │
  ▼
ProcessManager.run(path, argv, env, cwd, abortSignal)
  │
  ▼
strategy.spawn()  ── child_process.spawn (TS) / asyncio.create_subprocess_exec (Py)
  │                  { shell: false, windowsHide: true, stdio: [pipe, pipe, pipe] }
  ▼
gemini-cli subprocess starts, inherits env + cwd
```

### Response flow

```
gemini-cli stdout (NDJSON, \n-delimited)
  │
  ▼
LineReader  ── reads bytes, splits on \n, decodes UTF-8, emits lines
  │
  ▼
EventDispatcher  ── JSON.parse each line, validate against schema
  │                  Known types: init | message | tool_use | tool_result | error | result
  │                  Unknown/junk → {type:'cli_log'} (lenient mode) or ParseError (strict)
  ▼
Normalize to MessageChunk union
  │  { type: 'assistant', content: string }
  │  { type: 'tool',      toolName, toolInput, toolCallId }
  │  { type: 'tool_result', toolName, toolOutput, toolCallId }
  │  { type: 'result',   sessionId, tokens, cost, stopReason }
  │  { type: 'system',   content }
  │  { type: 'rate_limit', rateLimitInfo }
  │
  ▼
yield from query() generator
  │
  ▼
Consumer's `for await (const chunk of query(...))` loop
```

Meanwhile, stderr flows into a **ring buffer** (bounded, e.g. 256 KiB). The buffer is read only on error — it is not streamed to the caller. On non-zero exit or thrown mid-stream error, the final stderr buffer contents are passed to `ErrorMapper.classify()` and included in the enriched error message (same pattern Archon's Claude client uses).

### State management

```
        ┌────────────────────────┐
        │ Consumer's code owns   │
        │ the sessionId string   │
        └───────────┬────────────┘
                    │
                    ▼
        query({..., resumeSessionId})
                    │
                    ▼
        ArgvBuilder appends --resume <id>
                    │
                    ▼
        gemini-cli loads the prior session
        (loaded from gemini-cli's own storage,
         not SDK-managed)
                    │
                    ▼
        Result event yields new sessionId
                    │
                    ▼
        Consumer stores it for the next call
```

**The SDK holds no session state.** Multi-turn is achieved entirely by (a) passing `resumeSessionId` forward on each call and (b) `gemini-cli`'s own checkpoint store. This is identical to how Archon's Codex client works (`codex.resumeThread(resumeSessionId, threadOptions)`) and it is the only design that lets the SDK be stateless, thread-safe, and trivially pool-able later.

**Known risk:** `gemini-cli` issue #14180 notes that "stdin and positional arguments don't work with `--resume` flag" — this needs empirical verification in Phase 1 Research. If `--resume` is broken in headless mode, the fallback is to implement session state as a **prompt-prepended transcript** (the SDK stores previous turns and prepends them to the next `-p` invocation). That fallback stays inside the current architecture — only `Session` and `ArgvBuilder` change.

---

## Suggested Build Order / Phase Dependencies

The dependency graph is strict: each layer depends only on those above it. Build bottom-up, in both languages, **one layer at a time across both languages** (not TS-entire then Python-entire). This prevents TS from accumulating features Python cannot yet port.

```
  Phase 1: Feasibility + spec  (research, fixtures captured from real gemini-cli)
      │
      ▼
  Phase 2: BinaryResolver + ProcessManager (spawn-per-call) + EnvBuilder
      │   TS and Python in parallel; trivial "hello world" spawn test per language
      ▼
  Phase 3: NDJSON Parser + EventDispatcher + MessageChunk types
      │   Driven by spec/fixtures/ — both languages consume same fixtures
      ▼
  Phase 4: ArgvBuilder + public query() + streaming end-to-end
      │   First real gemini-cli call; basic text echo works
      ▼
  Phase 5: ErrorMapper + typed error hierarchy + retry classification
      │   (Retry loop itself is a consumer concern; SDK only classifies.)
      ▼
  Phase 6: Session (resume) + multi-turn smoke test
      │   Validates gemini-cli issue #14180 worry. Fallback: transcript prepend.
      ▼
  Phase 7: Structured output + additionalDirectories + model selection
      │
      ▼
  Phase 8: MCP passthrough  (config file / flag relay, no bridge)
      │
      ▼
  Phase 9: Tool-use bridge decision  (in-process MCP stub server OR defer)
      │   This is where the TS and Python paths may diverge if Python MCP
      │   server libs are less mature — flag in advance.
      ▼
  Phase 10: Archon adapter (TS only) — gemini.ts in packages/core/src/clients/
      │
      ▼
  Phase 11: Docs site, hardening, compat matrix, release
```

**Build order rationale:**

- **Process + parse before anything else.** Nothing works without a subprocess spawning cleanly and emitting parseable NDJSON. These are the two load-bearing unknowns; everything else is configuration on top.
- **Fixtures before parser.** Capture real `gemini-cli` NDJSON output *first*, in Phase 1, then write the parser against those fixtures. Do not invent event shapes from documentation alone — documentation is incomplete (headless docs don't show full schema; PR #10883 merged but event field-level schema under-documented) and will be wrong.
- **Errors after basic streaming works.** You need observed stderr samples before you can build a classifier. Write the classifier empirically, not speculatively.
- **Sessions before tools.** Sessions unblock multi-turn smoke tests that then validate tool calls across turns. Tools on a single-shot query give a false sense of coverage.
- **MCP passthrough before tool bridge.** Passthrough is "write flags + config"; the bridge is a protocol implementation. Shipping the passthrough unblocks users who already have MCP servers installed, even if the SDK itself exposes no custom tools in v1.
- **Archon adapter last (Phase 10).** The adapter is ~100 lines of glue around the already-shipped SDK. It depends on the SDK being feature-complete for the assistant interface surface. It is also the test — if it is hard to write, the SDK's shape is wrong, which means looping back. Budget for one iteration.

### TS/Python fork points

- **Phases 2–8 stay in lock-step.** Every PR touches both languages in the same commit.
- **Phase 9 (tool-use bridge) may fork.** TS has mature MCP libraries (`@modelcontextprotocol/sdk`). Python has `mcp` (official). If the tool-use strategy becomes "spin a stub MCP server," both languages need to wire a local MCP server into the argv path. If one language's MCP library is less mature, ship TS first with the bridge and Python with passthrough-only, document the gap, close it post-v1.
- **Phase 10 (Archon adapter) is TS-only by definition.** Archon is a TS monorepo. Python never grows an Archon adapter.

---

## Windows Subprocess Specifics (project is Windows-first)

Every decision below is non-negotiable for Windows correctness and should be unit-tested with explicit "Windows path" branches.

### 1. Binary resolution & path handling

- **Always resolve the full path** via `shutil.which('gemini')` / a cross-platform `which` library (TS: `@npmcli/which` or hand-rolled, since Claude Agent SDK Python just uses `shutil.which`). Never rely on `spawn('gemini', ...)` with an unresolved name — Windows will hit the legacy command-lookup code path and mis-handle spaces.
- **Append `.cmd` / `.exe` consideration:** `gemini-cli` is a Node binary installed via `npm install -g`, which on Windows creates a `gemini.cmd` shim. `shutil.which` finds `.cmd` files correctly when `PATHEXT` includes `.CMD` (default). The resolver should treat `.cmd`, `.exe`, `.bat`, and extensionless all as valid hits. **Do not strip extensions** — pass the resolved path verbatim to `spawn`.
- **`.cmd` + `shell: false` quirk:** Node's `child_process.spawn` on Windows, since the CVE-2024-27980 fix, **refuses to spawn `.cmd`/`.bat` files with `shell: false`** unless you explicitly opt-in. Options: (a) set `shell: true` *only when the resolved binary ends in `.cmd` or `.bat`*, and use array-form argv so Node escapes correctly, OR (b) locate the underlying `gemini.js` script that the `.cmd` shim launches and spawn Node on it directly. **Recommendation: option (a)**, guarded by an extension check, because it does not couple the SDK to `gemini-cli`'s internal npm layout (which may change).
- **Never hand-construct a command string.** Always pass argv as `string[]`. Never use `shell: true` with a built command string.

### 2. `shell: false` as the default

- **TS default:** `{ shell: false }`. Only flip to `true` in the narrow `.cmd` exception above. Document the exception inline.
- **Python default:** `asyncio.create_subprocess_exec` (*not* `create_subprocess_shell`). `exec` bypasses the shell entirely.
- **Why:** Prevents injection, prevents argument-mangling, prevents the legacy Windows spaces-in-command bug (`nodejs/node#7367`), and makes argv exactly what you passed in.

### 3. Signal handling

- **Unix:** `SIGTERM` → wait up to 5s → `SIGKILL`. Standard.
- **Windows has no `SIGTERM`.** Sending it via `process.kill('SIGTERM')` is equivalent to `SIGKILL` (unconditional process termination). `gemini-cli` gets no graceful-shutdown window.
- **Child-process tree:** On Windows, killing the parent **does not kill child processes** by default. Since `gemini-cli` is a Node process that itself spawns tool subprocesses (shell commands, git, etc.), the SDK must kill the *tree*. Two options:
    - **TS:** `spawn(bin, argv, { detached: false, ... })` + on kill, use the `tree-kill` npm package or call `taskkill /PID <pid> /T /F`.
    - **Python:** On Windows, use `subprocess.CREATE_NEW_PROCESS_GROUP` creation flag + `proc.send_signal(signal.CTRL_BREAK_EVENT)` for graceful, or `taskkill` for hard kill. In practice: use `psutil` to enumerate children and kill them with `TerminateProcess`.
- **`windowsHide: true`** on spawn — prevents a console window from flashing briefly when the SDK is used from a non-console process (e.g. a GUI app wrapping Archon). Always set it.

### 4. stdout buffering

- **`gemini-cli` is a Node process** and will use the `stdout.isTTY` check to decide whether to line-buffer or block-buffer. When its stdout is a pipe (our case), Node uses block-buffering by default, which can delay stream-json events until a 64 KiB block fills. **For NDJSON streaming, this is unacceptable** — the whole point is real-time events.
- **Verify empirically in Phase 1:** does `--output-format stream-json` force flush-per-event inside `gemini-cli`? Check the source of `gemini-cli` to confirm it calls `process.stdout.write(line + '\n')` with explicit flushing or uses a `writeSync` wrapper. If not, consider the workaround below.
- **If buffering is a problem:** The `node-pty` package provides a pseudo-terminal that tricks the child into line-buffering. Do not use it as the default — it adds a native dependency and Windows PTY support is fragile. Use only as a documented escape hatch (`options.forcePty: true`).
- **Line-reading on the SDK side must not wait for EOF.** Use streaming line-splitting, not `.read()` then `.split('\n')`. On TS: iterate `process.stdout` as an async iterable, accumulate a `Buffer` tail, split on `\n` lazily. On Python: `await proc.stdout.readline()` in a loop; do **not** call `.readlines()` or `communicate()` (both buffer to EOF).

### 5. Encoding

- **Force UTF-8 on both ends.** Set `PYTHONIOENCODING=utf-8` in the subprocess env for Python consumers. On Windows, also set `chcp 65001` via an initial probe is overkill — instead, pass UTF-8 explicitly: TS `process.stdout.setEncoding('utf8')`, Python `TextReceiveStream(proc.stdout, encoding='utf-8', errors='strict')`.
- **Handle `errors='replace'` carefully.** NDJSON must round-trip exactly. Use `errors='strict'` and surface decoding failures as `ParseError` — do not silently drop bytes.

### 6. Event loop policy (Python)

- **On Windows, asyncio defaults to `ProactorEventLoop` since Python 3.8.** That is the loop that supports subprocesses. **Do not** set `WindowsSelectorEventLoopPolicy` — it has no subprocess support and will crash on `create_subprocess_exec`.
- **Do not force a policy in library code.** Read the current loop; if it doesn't support subprocesses, raise a clear error at `query()` entry.

### 7. Environment variable `PATH` case sensitivity

- On Windows, environment variables are case-insensitive but Node's `child_process` is case-sensitive when the caller passes a pre-built `env` dict. If the SDK builds an `env` that has both `Path` (inherited) and `PATH` (SDK-added), Node may pick the wrong one. **Fix:** canonicalize to upper-case `PATH` by deleting any case-variant keys before setting the final value. The env builder should have a helper `normalizeEnvKey('PATH')` that removes duplicates.

### 8. Working directory

- Pass `cwd` explicitly to every spawn. Relative paths in `--include-directories` should be resolved against the caller's `cwd`, not the SDK process's cwd, before being passed to the subprocess.
- Normalize path separators: `path.normalize()` (TS) / `os.path.normpath()` (Python). `gemini-cli` on Windows generally tolerates forward slashes but not always — back-slash is the safe default.

---

## Scaling Considerations

This SDK is a **library**, not a service. "Scale" is measured in concurrent `query()` calls per host, not users.

| Scale | Architecture adjustment |
|-------|-------------------------|
| 1–10 concurrent queries | v1 spawn-per-call is fine. Each query owns its own subprocess (~150–300 MiB RSS each for `gemini-cli`). No locking, no coordination. |
| 10–100 concurrent queries | Swap `SpawnPerCallStrategy` for `PoolStrategy` with a max-concurrency gate (default: CPU count). Memory is the first ceiling — 100 concurrent `gemini-cli` processes ≈ 20–30 GiB. The gate is about preventing thrash, not enforcing correctness. Public API unchanged. |
| 100+ concurrent queries | The SDK is the wrong tool. At this scale, shell out to `gemini-cli`'s `--long-lived` piped mode (if/when it exists) or use the Gemini API directly via its REST/SDK. Document this in the README so users self-select. |

### Scaling priorities (what breaks first)

1. **Process-start latency.** `gemini-cli` is Node + extensive initialization (~0.5–2s cold start). At 10+ qps this dominates. Mitigation: pooled long-lived processes (Phase 11+ swap, not v1).
2. **Memory ceiling.** 100+ concurrent `gemini-cli` instances exhaust RAM on a laptop. Mitigation: concurrency gate inside `PoolStrategy`.
3. **Rate-limit ceiling from the upstream API.** `gemini-cli` OAuth is 60 req/min; API key is 1K/day. The SDK's `RateLimitError` classification gives consumers a retry/backoff signal but cannot raise the ceiling.
4. **Parser CPU is never the bottleneck.** NDJSON parsing at gemini-cli throughput is ~nothing on a modern CPU. Do not optimize it.

---

## Anti-Patterns

### Anti-Pattern 1: Exposing the child-process handle in the public API

**What people do:** `const p = query(...); p.on('message', ...); p.send(...); p.kill();`

**Why it's wrong:** It leaks the process lifecycle into user code, couples the SDK permanently to `spawn-per-call` semantics (long-lived and pooled strategies suddenly can't swap in without breaking callers), and creates "forgot to .kill()" leaks. Archon's adapter interface cannot consume it.

**Do this instead:** Return an async iterator. Lifecycle is bounded by iteration. Cancellation is `AbortSignal` in options. This is exactly how Claude Agent SDK, Codex SDK, and Archon's `IAssistantClient` all work.

### Anti-Pattern 2: `shell: true` with a built command string

**What people do:** `spawn(\`gemini -p "${prompt}" --model ${model}\`, { shell: true })`.

**Why it's wrong:** Shell injection via prompt, argument-mangling on spaces/quotes, different parsing on Windows cmd vs PowerShell vs bash, and flags with `$` or backticks silently reinterpreted. Every one of these is a real bug we don't want to debug at 2am.

**Do this instead:** `spawn(bin, argv, { shell: false })` with `argv` a `string[]`. Flag values with spaces, Unicode, shell metacharacters — all pass through verbatim. Unit-testable without spawning.

### Anti-Pattern 3: Buffering stdout to EOF before parsing

**What people do:** `const { stdout } = await execFile(bin, argv); for (const line of stdout.split('\n')) { ... }`.

**Why it's wrong:** Defeats the entire purpose of `--output-format stream-json`. Caller gets a single blob after the CLI finishes; no streaming; `AbortSignal` cannot cancel partway through; user experience is indistinguishable from "hung for 30 seconds then dumped a wall of text."

**Do this instead:** Stream stdout as an async iterable of lines. Yield each parsed event immediately. Integrate `AbortSignal` at the loop boundary so `break`/cancel works.

### Anti-Pattern 4: One global, module-level subprocess shared across calls

**What people do:** Spawn `gemini-cli` once at import, pipe prompts in on stdin, read events from stdout. "Pool of one."

**Why it's wrong in v1:** Introduces shared state, race conditions on concurrent calls, complex session-id juggling (which turn belongs to which caller), and makes test isolation impossible. `gemini-cli`'s non-interactive mode is also almost certainly not designed for multiple prompt-streams multiplexed over one process — needs empirical verification before even considering this.

**Do this instead:** v1 is spawn-per-call. The pluggable strategy interface means this can be revisited post-v1 without breaking the public API, once there is evidence of both (a) a real throughput problem and (b) `gemini-cli` supporting the mode.

### Anti-Pattern 5: Speccing the NDJSON schema from docs alone

**What people do:** Read the headless-mode docs, write TypeScript interfaces for every event type, commit without running the CLI.

**Why it's wrong:** The docs list six event `type` values (`init`, `message`, `tool_use`, `tool_result`, `error`, `result`) but do not document field-level schemas exhaustively. `gemini-cli` ships weekly and has ~2.4k open issues — documentation lag is a given. Your types will be wrong on release day.

**Do this instead:** Capture real output into `spec/fixtures/*.ndjson` in Phase 1 *before* writing any parser code. Derive the schema from observation, pin it to a specific `gemini-cli` version, and update fixtures whenever the pinned version moves.

### Anti-Pattern 6: One retry loop per public API call

**What people do:** Build retry logic into the SDK's `query()` function, with exponential backoff, configurable attempts, etc.

**Why it's wrong:** Retries collide with the async-generator contract (chunks already yielded by attempt 1 are visible to the caller before attempt 2 retries with a clean stream — user sees duplicated output). Retries inside the SDK also conflict with retries in the consumer (Archon has its own retry logic in the workflow executor; stacking them causes 16x retry storms).

**Do this instead:** The SDK *classifies* errors (retryable-crash vs retryable-rate-limit vs terminal-auth vs terminal-unknown) but does *not* retry. Consumers retry by calling `query()` again with the same `resumeSessionId`. Document this explicitly in the README. This matches Codex SDK's design (which is simpler than Claude Agent SDK in this regard) and is easier to compose.

> Note: Archon's Claude client *does* retry internally up to 3x. That's because Archon's Claude client wraps a higher-level SDK that doesn't expose enough classification for Archon to retry confidently. Our SDK is the lower layer — we should *not* double-wrap.

---

## Integration Points

### Archon adapter: the exact shape

The single most important finding from source inspection: **Archon's AI assistant clients do not live in `packages/adapters/`.** That directory is for chat / forge platform adapters (Slack, Telegram, GitHub, Discord). AI assistants live in:

> `packages/core/src/clients/` on the `dev` branch of `coleam00/Archon`.

The relevant files as of April 2026 are:

| File | Role |
|------|------|
| `packages/core/src/clients/claude.ts` | Wraps `@anthropic-ai/claude-agent-sdk`, implements `IAssistantClient` |
| `packages/core/src/clients/codex.ts` | Wraps `@openai/codex-sdk`, implements `IAssistantClient` |
| `packages/core/src/clients/factory.ts` | `getAssistantClient(type: string): IAssistantClient` switch — `'claude'` / `'codex'`, default throws `"Unknown assistant type: ${type}. Supported types: 'claude', 'codex'"` |
| `packages/core/src/clients/index.ts` | Public exports |
| `packages/core/src/types/index.ts` | Defines `IAssistantClient`, `MessageChunk`, `AssistantRequestOptions`, `TokenUsage` |

**The `IAssistantClient` contract (quoted from `types/index.ts`):**

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

**The `MessageChunk` discriminated union (every variant the Gemini adapter must emit):**

```typescript
export type MessageChunk =
  | { type: 'assistant'; content: string }
  | { type: 'system'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'result';
      sessionId?: string;
      tokens?: TokenUsage;
      structuredOutput?: unknown;
      isError?: boolean;
      errorSubtype?: string;
      cost?: number;
      stopReason?: string;
      numTurns?: number;
      modelUsage?: Record<string, unknown>;
    }
  | { type: 'rate_limit'; rateLimitInfo: Record<string, unknown> }
  | { type: 'tool'; toolName: string; toolInput?: Record<string, unknown>; toolCallId?: string }
  | { type: 'tool_result'; toolName: string; toolOutput: string; toolCallId?: string }
  | { type: 'workflow_dispatch'; workerConversationId: string; workflowName: string };
```

**Critical alignment points:**

- **The Gemini SDK's `MessageChunk` should be a superset (or strict subset) of the above.** Anything the adapter emits that isn't in Archon's union gets silently dropped by the server; anything Archon expects and never receives leaves the UI "spinning forever until lock release" (a phrase lifted from Archon's own comments in `codex.ts`).
- **`tool_result` must be emitted even on failure.** Archon's Claude client has explicit commentary: *"Without this, errored / interrupted / permission-denied tools never produce a paired `tool_result` chunk and the corresponding UI card spins forever."* The Gemini SDK's NDJSON dispatcher must emit a `tool_result` for every `tool_use` it observes, even synthesizing one from an error event if `gemini-cli` drops the pairing.
- **`toolCallId` should be populated when available.** Archon uses it to pair concurrent tool calls when names collide. `gemini-cli`'s stream-json schema must be checked for a stable per-tool-use ID; if none, the adapter can synthesize one with UUID and it still works, but pairing only holds within a single stream.
- **`result` must carry `sessionId`.** Archon persists this; without it, multi-turn is broken.

### The shape of the Gemini adapter file

The adapter is a thin shim from `IAssistantClient` → `@gsd/gemini-sdk`. Estimated ~150 lines. Skeleton:

```typescript
// packages/core/src/clients/gemini.ts
import { query, GeminiError, RateLimitError, AuthError, ProcessCrashError } from '@gsd/gemini-sdk';
import {
  type AssistantRequestOptions,
  type IAssistantClient,
  type MessageChunk,
} from '../types';
import { createLogger } from '@archon/paths';
import { buildCleanSubprocessEnv } from '../utils/env-allowlist';
import { resolveGeminiBinaryPath } from '../utils/gemini-binary-resolver';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog() { return cachedLog ??= createLogger('client.gemini'); }

export class GeminiClient implements IAssistantClient {
  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: AssistantRequestOptions
  ): AsyncGenerator<MessageChunk> {
    const cliPath = await resolveGeminiBinaryPath();
    const env = buildCleanSubprocessEnv();  // reuse Archon's allowlist

    try {
      for await (const chunk of query({
        prompt,
        cwd,
        cliPath,
        env,
        resumeSessionId,
        model: options?.model,
        additionalDirectories: options?.additionalDirectories,
        mcpServers: options?.mcpServers,        // v1: passthrough only
        outputFormat: options?.outputFormat,    // when gemini-cli supports it
        abortSignal: options?.abortSignal,
      })) {
        yield chunk;  // already in IAssistantClient MessageChunk shape
      }
    } catch (err) {
      // Classify + re-throw with Archon-shaped enrichment
      if (err instanceof RateLimitError) { /* ... */ throw err; }
      if (err instanceof AuthError) { /* ... */ throw err; }
      if (err instanceof ProcessCrashError) { /* ... */ throw err; }
      throw err;
    }
  }

  getType(): string { return 'gemini'; }
}
```

The file is dropped into `packages/core/src/clients/gemini.ts` in an Archon PR. The one-line change to `factory.ts`:

```typescript
case 'gemini':
  return new GeminiClient();
```

And `.env.example` gains `GEMINI_API_KEY` / `GEMINI_BIN_PATH` with comments matching the existing `CODEX_BIN_PATH` pattern.

### External boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| SDK ↔ gemini-cli | OS process, stdin (optional) / stdout (NDJSON) / stderr (text) / exit code / signals | Pipe-based; no shared memory; fully serialized per strategy |
| SDK ↔ user code | Async generator `query()` + typed options + typed errors | Zero mutable shared state; cancellation via `AbortSignal` |
| SDK ↔ Google APIs | None directly | SDK never calls Google APIs; `gemini-cli` owns all API interaction |
| SDK ↔ filesystem | Binary resolution + optional tempfile write for `outputSchema` + `cwd` passthrough | All I/O is bounded and on-demand, never async-polled |
| SDK ↔ MCP servers | Passthrough only in v1 (config file / argv relay) | `gemini-cli` handles the MCP protocol; SDK just wires the config |
| TS SDK ↔ Python SDK | None at runtime | Parity enforced via shared `spec/fixtures/` consumed by both test suites; no runtime coupling |
| Archon ↔ SDK (TS only) | `new GeminiClient().sendQuery(...)` as per `IAssistantClient` | Drop-in replacement for `ClaudeClient` / `CodexClient` |

---

## Sources

### Primary (HIGH confidence — read directly from source)

- [`coleam00/Archon` — `packages/core/src/clients/claude.ts` (dev branch)](https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/claude.ts) — the `ClaudeClient` implementation of `IAssistantClient`, retry/classify patterns, env allowlist usage, hook draining, `tool_result` pairing commentary
- [`coleam00/Archon` — `packages/core/src/clients/codex.ts` (dev branch)](https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/codex.ts) — `CodexClient` implementation, singleton binary-path resolver pattern, thread lifecycle
- [`coleam00/Archon` — `packages/core/src/clients/factory.ts`](https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/factory.ts) — `getAssistantClient(type)` dispatch; confirms string-keyed switch with 'gemini' as the addition
- [`coleam00/Archon` — `packages/core/src/clients/index.ts`](https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/index.ts) — public export surface to mirror
- [`coleam00/Archon` — `packages/core/src/types/index.ts`](https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts) — normative `IAssistantClient`, `MessageChunk`, `AssistantRequestOptions`, `TokenUsage` definitions
- [`coleam00/Archon` — `packages/adapters/src/index.ts`](https://github.com/coleam00/Archon/blob/dev/packages/adapters/src/index.ts) — confirms `packages/adapters/` is for platform adapters (Telegram/Slack/GitHub/Discord), NOT AI assistants
- [`coleam00/Archon` — `.claude/docs/adapter-implementation-guide.md`](https://github.com/coleam00/Archon/blob/dev/.claude/docs/adapter-implementation-guide.md) — explicitly covers `IPlatformAdapter` (chat/forge), disambiguating from `IAssistantClient`
- [`anthropics/claude-agent-sdk-python` — `_internal/transport/subprocess_cli.py`](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py) — `_find_cli()` search order, `_DEFAULT_MAX_BUFFER_SIZE = 1 MiB`, bundled-CLI fallback, Windows `.exe` branch, `_internal/` layout convention

### Secondary (HIGH confidence — official and current)

- [gemini-cli issue #8203 — "Add stream-json output format"](https://github.com/google-gemini/gemini-cli/issues/8203) — confirmed merged via PR #10883 (September 2025); feature is shipped, schema under-documented
- [Gemini CLI — Headless Mode reference](https://geminicli.com/docs/cli/headless/) — lists `-p`, `--output-format`, `-r/--resume`; enumerates six stream-json event types (`init`, `message`, `tool_use`, `tool_result`, `error`, `result`)
- [gemini-cli issue #14180 — "stdin and positional arguments don't work with --resume flag"](https://github.com/google-gemini/gemini-cli/issues/14180) — open bug that materially affects the session architecture; transcript-prepend fallback is required contingency
- [Gemini CLI — Checkpointing](https://geminicli.com/docs/cli/checkpointing/) — confirms `--checkpointing` CLI flag was removed in v0.11.0; checkpointing now settings.json-only
- [Node.js docs — Child process](https://nodejs.org/api/child_process.html) — authoritative on `shell: false`, Windows `.cmd`/`.bat` CVE behavior, stdio pipe buffering
- [Python docs — asyncio subprocesses](https://docs.python.org/3/library/asyncio-subprocess.html) — confirms `ProactorEventLoop` is the only subprocess-capable event loop on Windows (default since 3.8); confirms `readline()` returns `b''` on EOF

### Tertiary (MEDIUM confidence — community + historical context)

- [Claude Agent SDK architecture blog post (Medium)](https://medium.com/@shivanshmay2019/claude-agent-sdk-deep-dive-what-it-means-to-use-claude-code-as-a-library-773aea121787) — confirms the `@tool`/in-process-MCP pattern Anthropic uses for custom tools; informs the Phase 9 "spin a stub MCP server" candidate
- [2ality — Executing shell commands from Node.js](https://2ality.com/2022/07/nodejs-child-process.html) — practical `spawn` vs `exec` guidance
- [Streaming subprocess stdin and stdout with asyncio in Python (Kevin McCarthy)](https://kevinmccarthy.org/2016/07/25/streaming-subprocess-stdin-and-stdout-with-asyncio-in-python/) — canonical `readline()` streaming loop pattern
- [nodejs/node issue #7367 — spawn fails on Windows given spaces](https://github.com/nodejs/node/issues/7367) — historical but informs "always resolve full path, never pass bare name" rule

---

*Architecture research for: dual-language TS+Python subprocess-wrapper SDK with Archon integration*
*Researched: 2026-04-11*
