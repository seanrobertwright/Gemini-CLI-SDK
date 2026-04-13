# Phase 4: Public query() + ArgvBuilder + systemPrompt + Workspace + Model Selection - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the SDK's only public entry point — `query(options): AsyncIterable<MessageChunk>` async generator — wired to the pure-function `buildArgv(options): string[]`, cancellation via `abortSignal` (TS) / `cancel_scope` (Python), temp-file `GEMINI_SYSTEM_MD` for system prompts (cleaned up in `finally`), `cwd` + `--include-directories` for workspace context, and the typed model enum with `@deprecated` 2.5-series markings + string escape hatch + silent-downgrade detection via the `init` event. Non-streaming helper (`queryFull`) and raw-event API (`queryRaw`) are thin wrappers. First real `gemini-cli` round-trip happens here.

Requirements: API-01, API-02, API-03, API-04, API-05, API-06, SYS-01, SYS-02, CWD-01, CWD-02, MDL-01, MDL-02, MDL-03, MDL-04.

</domain>

<decisions>
## Implementation Decisions

### API signature & public surface

- **Single options object pattern:** `query(options: QueryOptions)` — prompt is a required field inside the options object. Matches Claude Agent SDK style.
- **Three public functions:**
  - `query(options)` — async generator yielding `MessageChunk` (high-level mapped stream)
  - `queryFull(options)` — accumulates all chunks into a `QueryResult` with `.text`, `.sessionId`, `.stopReason`, `.chunks[]`
  - `queryRaw(options)` — async generator yielding `RawEvent` (wire-level parser output, no dispatch mapping)
- **Idiomatic field naming per language:** TS uses camelCase (`systemPrompt`, `abortSignal`, `additionalDirectories`). Python uses snake_case (`system_prompt`, `cancel_scope`, `additional_directories`). Same fields, language-native casing.

### QueryOptions fields (TS names)

- `prompt: string` — required
- `model?: Model | string` — optional, omit `--model` flag when absent (see Model Selection below)
- `systemPrompt?: string` — optional temp file (see System Prompt below)
- `cwd?: string` — subprocess working directory (CWD-01)
- `additionalDirectories?: string[]` — maps to `--include-directories` (CWD-02)
- `abortSignal?: AbortSignal` — cancellation (API-04); Python equivalent is `cancel_scope`
- `cliPath?: string` — override binary location (passed to BinaryResolver)
- `env?: Record<string, string>` — additional env vars merged via EnvBuilder

### Model selection

- **Exhaustive typed enum:** Include all known model strings gemini-cli accepts (auto, 2.5-flash, 2.5-pro, 2.0-flash, etc.). Mark 2.5 series `@deprecated` with EOL 2026-06-17 note.
- **String escape hatch:** `model` field accepts `Model | string` so unknown/future models work without SDK updates.
- **Default behavior:** When `model` is undefined or `'auto'`, omit `--model` flag entirely from argv. Let gemini-cli use its own default. The `init` event still reports which model was actually used.
- **Downgrade detection:** `query()` captures `model` from the `init` event, compares to requested model. Mismatch surfaces as `requestedModel` and `actualModel` fields on the terminal `ResultChunk`. Non-fatal, no throw.

### System prompt lifecycle

- **Temp file in OS temp dir:** Write `systemPrompt` content to `{os.tmpdir()}/gemini-sdk-system-{random}.md`. Set `GEMINI_SYSTEM_MD=<path>` in subprocess env via EnvBuilder overrides.
- **Cleanup in finally:** `fs.unlink(tempPath)` in the generator's `finally` block — runs even on error or abort.
- **Empty/undefined = no-op:** Both `undefined` and empty string `''` skip temp file creation entirely. No `GEMINI_SYSTEM_MD` set, gemini-cli falls back to its built-in behavior (reads `GEMINI.md` from cwd if present).

### Abort & cleanup

- **AbortError on cancellation:** Throw a dedicated `AbortError` (standalone class for now; Phase 5 will reparent under `GeminiError` base). `.retryable = false`, `.message = 'Query aborted by caller'`.
- **Cleanup order:** Sequential, each step try/caught independently:
  1. `killTree(child.pid)` — stop subprocess tree (5s SIGTERM grace → SIGKILL)
  2. `fs.unlink(tempSystemFile)` — delete temp system prompt file
  3. Flush unpaired tool chunks with `incomplete: true` — caller sees partial tool state before error
  4. Throw `AbortError`
- **Post-abort flush:** Buffered `tool_use` chunks are yielded with `incomplete: true` before throwing, matching Phase 3's unpaired-tool flush contract. No silent data loss.

### Claude's Discretion

- `buildArgv` internal flag ordering and flag-to-string mapping details
- `QueryResult` exact field set beyond `.text`, `.sessionId`, `.stopReason`, `.chunks[]`
- Random suffix generation for temp system prompt filenames
- How `queryFull` and `queryRaw` compose with the internal plumbing (thin wrappers over shared core)
- Whether `AbortError` extends `Error` directly now or uses a lightweight `GeminiError` stub ahead of Phase 5
- Exact model enum member names and whether to include model aliases

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 4 requirements
- `.planning/REQUIREMENTS.md` — API-01..06, SYS-01..02, CWD-01..02, MDL-01..04
- `.planning/ROADMAP.md` SS"Phase 4" — Goal, success criteria, dependencies

### Wire protocol and parser (Phase 3 outputs consumed by Phase 4)
- `spec/protocol.md` — Event-by-event field reference; `init` event carries `session_id` and `model` (used for downgrade detection)
- `spec/events.schema.json` — Frozen JSON Schema; `additionalProperties: true` (schema is a FLOOR)
- `ts/src/parser/types.ts` — `RawEvent` and `MessageChunk` type definitions; `ResultChunk` needs `requestedModel`/`actualModel` fields added
- `ts/src/parser/dispatch.ts` — Stage 2 dispatcher; `query()` composes `parseNdjson` | `dispatch`
- `ts/src/parser/parseNdjson.ts` — Stage 1 NDJSON parser; `queryRaw()` uses this directly

### Process infrastructure (Phase 2 outputs consumed by Phase 4)
- `ts/src/process/ProcessManager.ts` — `ProcessManager.spawn()` + `killTree()` — `query()` wraps these
- `ts/src/process/EnvBuilder.ts` — `buildEnv()` with `GEMINI_SYSTEM_MD` already in allowlist
- `ts/src/process/BinaryResolver.ts` — `resolveBinary()` for CLI path discovery
- `ts/src/process/ProcessStrategy.ts` — Pluggable spawn interface

### Feasibility verdicts (Phase 1)
- `spec/feasibility.md` — `resume_verdict=pass`, `config_dir_verdict=pass`, `flush_verdict=partial`; flush=partial means default `forcePty: false` with user opt-in (not in Phase 4 scope but informs no-PTY default)

### Prior phase context
- `.planning/phases/02-process-foundation-workspace-scaffolding-ci-matrix/02-CONTEXT.md` — Monorepo layout, test frameworks, CI matrix
- `.planning/phases/03-ndjson-parser-eventdispatcher-messagechunk-types/03-CONTEXT.md` — Two-stage pipeline, tool pairing, thinking variant

### Gemini CLI reference
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md — Full CLI flag reference (`-p`, `--model`, `--output-format`, `--include-directories`)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md — `stream-json` event schema

### Reference SDK patterns
- https://code.claude.com/docs/en/agent-sdk/overview — Claude Agent SDK `claude()` signature pattern (single options object)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProcessManager.spawn(options)` — accepts argv, cliPath, env overrides; `query()` wraps this with `buildArgv` output
- `killTree(pid, gracePeriodMs)` — cross-platform subprocess tree kill; used in abort/cleanup
- `buildEnv(overrides)` — allowlist-filtered env builder; `GEMINI_SYSTEM_MD` already allowlisted
- `resolveBinary(cliPath?)` — PATH + `GEMINI_BIN_PATH` lookup
- `parseNdjson(stream)` — async generator yielding `RawEvent`; input to `queryRaw()` and `query()`
- `dispatch(events)` — async generator mapping `RawEvent` → `MessageChunk`; input to `query()`
- All `MessageChunk` and `RawEvent` types defined in `ts/src/parser/types.ts`

### Established Patterns
- ESM throughout (`"type": "module"`)
- Standalone async generator functions (not classes) for pipeline stages
- Vitest for TS tests, pytest for Python
- `scripts/diff-test-names.sh` enforces test name parity
- Relative paths to `spec/fixtures/` from tests (no symlinks)

### Integration Points
- `query()` composes: `ProcessManager.spawn()` → `child.stdout` → `parseNdjson()` → `dispatch()` → yield to caller
- `queryRaw()` skips dispatch: `ProcessManager.spawn()` → `child.stdout` → `parseNdjson()` → yield to caller
- `queryFull()` wraps `query()`: accumulates chunks, returns `QueryResult`
- `ResultChunk` type in `types.ts` needs new optional `requestedModel`/`actualModel` fields
- Python mirror follows same architecture with snake_case naming

</code_context>

<specifics>
## Specific Ideas

- Three clean exports (`query`, `queryFull`, `queryRaw`) — each has a clear purpose, no overloaded return types, no boolean flags that change behavior
- Model downgrade detection is non-intrusive: fields on ResultChunk, not a separate event or thrown error
- Omitting `--model` flag when no model specified is the safest default — lets gemini-cli evolve its own default without SDK interference
- System prompt cleanup is belt-and-braces: `finally` block with individual try/catch per cleanup step

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-public-query-argvbuilder-systemprompt-workspace-model-selection*
*Context gathered: 2026-04-13*
