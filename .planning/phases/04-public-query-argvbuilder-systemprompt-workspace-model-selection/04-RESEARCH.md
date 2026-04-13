# Phase 4: Public query() + ArgvBuilder + systemPrompt + Workspace + Model Selection - Research

**Researched:** 2026-04-13
**Domain:** TypeScript/Python async generator API layer over gemini-cli subprocess
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**API signature & public surface:**
- Single options object pattern: `query(options: QueryOptions)` — prompt is a required field inside the options object. Matches Claude Agent SDK style.
- Three public functions:
  - `query(options)` — async generator yielding `MessageChunk` (high-level mapped stream)
  - `queryFull(options)` — accumulates all chunks into a `QueryResult` with `.text`, `.sessionId`, `.stopReason`, `.chunks[]`
  - `queryRaw(options)` — async generator yielding `RawEvent` (wire-level parser output, no dispatch mapping)
- Idiomatic field naming per language: TS uses camelCase (`systemPrompt`, `abortSignal`, `additionalDirectories`). Python uses snake_case (`system_prompt`, `cancel_scope`, `additional_directories`). Same fields, language-native casing.

**QueryOptions fields (TS names):**
- `prompt: string` — required
- `model?: Model | string` — optional, omit `--model` flag when absent (see Model Selection below)
- `systemPrompt?: string` — optional temp file (see System Prompt below)
- `cwd?: string` — subprocess working directory (CWD-01)
- `additionalDirectories?: string[]` — maps to `--include-directories` (CWD-02)
- `abortSignal?: AbortSignal` — cancellation (API-04); Python equivalent is `cancel_scope`
- `cliPath?: string` — override binary location (passed to BinaryResolver)
- `env?: Record<string, string>` — additional env vars merged via EnvBuilder

**Model selection:**
- Exhaustive typed enum: Include all known model strings gemini-cli accepts (auto, 2.5-flash, 2.5-pro, 2.0-flash, etc.). Mark 2.5 series `@deprecated` with EOL 2026-06-17 note.
- String escape hatch: `model` field accepts `Model | string` so unknown/future models work without SDK updates.
- Default behavior: When `model` is undefined or `'auto'`, omit `--model` flag entirely from argv. Let gemini-cli use its own default. The `init` event still reports which model was actually used.
- Downgrade detection: `query()` captures `model` from the `init` event, compares to requested model. Mismatch surfaces as `requestedModel` and `actualModel` fields on the terminal `ResultChunk`. Non-fatal, no throw.

**System prompt lifecycle:**
- Temp file in OS temp dir: Write `systemPrompt` content to `{os.tmpdir()}/gemini-sdk-system-{random}.md`. Set `GEMINI_SYSTEM_MD=<path>` in subprocess env via EnvBuilder overrides.
- Cleanup in finally: `fs.unlink(tempPath)` in the generator's `finally` block — runs even on error or abort.
- Empty/undefined = no-op: Both `undefined` and empty string `''` skip temp file creation entirely. No `GEMINI_SYSTEM_MD` set, gemini-cli falls back to its built-in behavior (reads `GEMINI.md` from cwd if present).

**Abort & cleanup:**
- AbortError on cancellation: Throw a dedicated `AbortError` (standalone class for now; Phase 5 will reparent under `GeminiError` base). `.retryable = false`, `.message = 'Query aborted by caller'`.
- Cleanup order: Sequential, each step try/caught independently:
  1. `killTree(child.pid)` — stop subprocess tree (5s SIGTERM grace → SIGKILL)
  2. `fs.unlink(tempSystemFile)` — delete temp system prompt file
  3. Flush unpaired tool chunks with `incomplete: true` — caller sees partial tool state before error
  4. Throw `AbortError`
- Post-abort flush: Buffered `tool_use` chunks are yielded with `incomplete: true` before throwing, matching Phase 3's unpaired-tool flush contract. No silent data loss.

### Claude's Discretion

- `buildArgv` internal flag ordering and flag-to-string mapping details
- `QueryResult` exact field set beyond `.text`, `.sessionId`, `.stopReason`, `.chunks[]`
- Random suffix generation for temp system prompt filenames
- How `queryFull` and `queryRaw` compose with the internal plumbing (thin wrappers over shared core)
- Whether `AbortError` extends `Error` directly now or uses a lightweight `GeminiError` stub ahead of Phase 5
- Exact model enum member names and whether to include model aliases

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | Public `query(options): AsyncIterable<MessageChunk>` is the only public entry point | Async generator composition pattern: `spawn → stdout → parseNdjson → dispatch → yield` |
| API-02 | Pure-function `buildArgv(options): string[]` translates typed options to argv with no side effects | Verified gemini-cli flag set: `-p`, `--output-format stream-json`, `--model`, `--include-directories`; pure mapping with no FS/env calls |
| API-03 | `query()` owns subprocess lifecycle — spawns on first iteration, kills on early break or cancel | Generator `try/finally` owns `killTree(child.pid)` on any exit path |
| API-04 | `query()` accepts `options.abortSignal` (TS) / `cancel_scope` (Python) for cancellation | AbortSignal `addEventListener('abort', handler, {once:true})` + `removeEventListener` in finally; Python: `anyio.move_on_after`/cancel_scope wrapping |
| API-05 | Non-streaming helper accumulates into a single result as wrapper over `query()` | `queryFull` iterates `query()`, concatenates `assistant` content, captures `result` chunk fields |
| API-06 | Raw-event API available alongside high-level generator | `queryRaw` skips `dispatch()` — composes `spawn → stdout → parseNdjson` only |
| SYS-01 | `options.systemPrompt` writes temp `.md` file and sets `GEMINI_SYSTEM_MD` in spawn env | `GEMINI_SYSTEM_MD` verified to accept absolute path value; file must exist or CLI errors |
| SYS-02 | Temp system-prompt file cleaned up in `finally` (even on error/cancel) | `fs.unlink` in `finally` block; Python: `anyio.Path.unlink(missing_ok=True)` |
| CWD-01 | `options.cwd` sets subprocess working directory | Pass as `spawnOptions.cwd` to `ProcessManager.spawn()` via `SpawnOptions.cwd` |
| CWD-02 | `options.additionalDirectories` maps to `--include-directories` flag | Verified: `--include-directories` is array type; can repeat flag or comma-separate |
| MDL-01 | SDK exposes typed model enum with known Gemini models; 2.5 series `@deprecated` | Current model names: `auto`, `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-3-flash`, `gemini-3-pro`; 2.5 EOL 2026-06-17 |
| MDL-02 | SDK accepts raw string escape hatch for unknown/future models | `Model | string` union type; no runtime validation beyond what CLI rejects |
| MDL-03 | Default model is `latest`/`auto`, NOT a pinned 2.5 string | Omit `--model` flag entirely when model is undefined or 'auto' |
| MDL-04 | SDK inspects `init` event's `model` field, surfaces non-fatal `ModelDowngradeWarning` | `init` event carries `model` field verified from `spec/fixtures/simple-text.ndjson`; compare to requested; add to `ResultChunk` |
</phase_requirements>

---

## Summary

Phase 4 is the integration layer that wires together all prior-phase infrastructure (ProcessManager, killTree, buildEnv, resolveBinary, parseNdjson, dispatch) into three public-facing functions. The architecture is a pipeline of async generators: `ProcessManager.spawn()` produces a ChildProcess whose `stdout` feeds `parseNdjson()` which feeds `dispatch()`, with `query()` adding the abort, system-prompt temp file, and model-downgrade logic as cross-cutting concerns in a try/finally block.

The two critical correctness invariants are: (1) subprocess lifecycle is bound to generator lifetime — spawned on first `next()`, killed on any generator exit path including early consumer break; (2) temp system-prompt file cleanup is unconditional via `finally`, even if the subprocess crashes before emitting a single event. These two invariants are enforced by placing `killTree(child.pid)` and `fs.unlink(tempPath)` inside the generator's `finally` block with each step individually try/caught.

The `buildArgv` pure function is the most unit-testable piece — it translates `QueryOptions` to a `string[]` with zero side effects, enabling 100% branch coverage with combinatoric inputs without spawning any process. The fuzz test (via `@fast-check/vitest`) verifies that no input combination causes `buildArgv` to throw or produce an empty array.

**Primary recommendation:** Implement `buildArgv` first (pure, fully testable), then implement the shared `_queryCore` internal that owns spawn/stream/cleanup, then expose `query`, `queryRaw`, and `queryFull` as thin wrappers over that core.

---

## Standard Stack

### Core (all from prior phases — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs/promises` | built-in | Temp file write/unlink | No dependency needed; `writeFile`, `unlink`, `mkdtemp` are all we need |
| `node:os` | built-in | `os.tmpdir()` for temp dir base | Standard cross-platform temp dir discovery |
| `node:crypto` | built-in | Random suffix for temp filename | `crypto.randomBytes(8).toString('hex')` gives 16-char hex suffix |
| `anyio` | >=4.0 (already in pyproject.toml) | Python async process + cancel | Already a declared dependency |

### Supporting (for fuzz/property-based testing)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fast-check/vitest` | ^0.2 | Property-based/fuzz testing of `buildArgv` | API-02 requires fuzz test; `fc.assert(fc.property(...))` with arbitrary option combos |

**Installation (TS dev dependency only):**
```bash
cd ts && pnpm add -D @fast-check/vitest fast-check
```

Python has `hypothesis` for property-based testing if parity requires it, but the success criterion specifies a fuzz test — check if Python mirror needs it. The parity script (`diff-test-names.sh`) requires matching test names. Include a Python `test_build_argv_fuzz` using `hypothesis` strategies if the TS test name is `buildArgv: fuzz test`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.randomBytes` for temp suffix | `Math.random()` | crypto is collision-resistant; Math.random() has ~53 bits of entropy — adequate but not idiomatic for temp filenames |
| `@fast-check/vitest` for fuzz | Jest-style manual combinatoric test | fast-check generates exhaustive arbitrary inputs; manual combinatoric misses edge cases |
| `anyio.Path.unlink(missing_ok=True)` | `os.unlink` with try/except | anyio is already the I/O backend; keep Python async I/O uniform |

---

## Architecture Patterns

### Recommended Project Structure
```
ts/src/
├── query/               # Phase 4 additions
│   ├── index.ts         # barrel: exports query, queryFull, queryRaw, buildArgv, QueryOptions, QueryResult, Model, AbortError
│   ├── types.ts         # QueryOptions, QueryResult, Model enum, AbortError class
│   ├── buildArgv.ts     # pure function: QueryOptions → string[]
│   ├── query.ts         # query(), queryRaw(), queryFull() — all wired to _queryCore
│   ├── buildArgv.spec.ts
│   └── query.spec.ts
├── parser/              # Phase 3 (unchanged)
├── process/             # Phase 2 (unchanged)
└── errors/              # Phase 2 seed (GeminiNotFoundError); AbortError added here

python/src/gemini_sdk/
├── query/
│   ├── __init__.py
│   ├── types.py         # QueryOptions TypedDict, QueryResult TypedDict, Model Enum, AbortError
│   ├── build_argv.py    # pure function: build_argv(options) → list[str]
│   └── query.py         # query(), query_raw(), query_full()
tests/
│   ├── test_build_argv.py
│   └── test_query.py
```

### Pattern 1: Async Generator Pipeline with try/finally lifecycle
**What:** `query()` is an async generator that owns the full subprocess lifecycle inside a try/finally. The generator is composed from existing pipeline stages.
**When to use:** Any time a streaming resource (subprocess stdout) must be cleaned up regardless of consumer behavior.
**Example:**
```typescript
// ts/src/query/query.ts
export async function* query(options: QueryOptions): AsyncGenerator<MessageChunk> {
  const tempPath = await writeTempSystemPrompt(options.systemPrompt);
  const envOverrides: Record<string, string> = {};
  if (tempPath) envOverrides['GEMINI_SYSTEM_MD'] = tempPath;

  const argv = buildArgv(options);
  const manager = new ProcessManager();
  const child = manager.spawn({
    argv,
    cliPath: options.cliPath,
    env: { ...options.env, ...envOverrides },
    spawnOptions: { cwd: options.cwd },
  });

  const abortSignal = options.abortSignal;
  let aborted = false;
  let abortHandler: (() => void) | undefined;

  try {
    if (abortSignal) {
      if (abortSignal.aborted) {
        aborted = true;
      } else {
        abortHandler = () => { aborted = true; };
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    let requestedModel: string | undefined = options.model as string | undefined;
    let actualModel: string | undefined;

    const rawEvents = parseNdjson(child.stdout!);
    const chunks = dispatch(rawEvents);

    for await (const chunk of chunks) {
      if (aborted) break;
      if (chunk.type === 'system' && chunk.subtype === 'init') {
        actualModel = chunk.model;
      }
      if (chunk.type === 'result') {
        const enriched: ResultChunk = {
          ...chunk,
          ...(requestedModel && actualModel && requestedModel !== actualModel
            ? { requestedModel, actualModel }
            : {}),
        };
        yield enriched;
        continue;
      }
      yield chunk;
    }

    if (aborted) {
      // flush unpaired tool chunks with incomplete: true
      // (dispatch already flushed on stream end — abort path needs explicit flush)
      throw new AbortError();
    }
  } finally {
    if (abortHandler) abortSignal!.removeEventListener('abort', abortHandler);
    if (child.pid) {
      try { await killTree(child.pid); } catch { /* ignore */ }
    }
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch { /* ignore */ }
    }
  }
}
```

### Pattern 2: Pure buildArgv with no side effects
**What:** `buildArgv` maps `QueryOptions` to a `string[]` argv with purely functional logic.
**When to use:** Constructing gemini-cli argv. Never spawn from within this function.
**Example:**
```typescript
// ts/src/query/buildArgv.ts
export function buildArgv(options: QueryOptions): string[] {
  const argv: string[] = [
    '--output-format', 'stream-json',
    '-p', options.prompt,
  ];
  if (options.model && options.model !== 'auto') {
    argv.push('--model', options.model as string);
  }
  if (options.additionalDirectories?.length) {
    for (const dir of options.additionalDirectories) {
      argv.push('--include-directories', dir);
    }
  }
  return argv;
}
```

### Pattern 3: queryFull as thin accumulator wrapper
**What:** Iterates `query()`, concatenates assistant content, returns `QueryResult`.
**When to use:** When caller wants a single resolved value, not a stream.
**Example:**
```typescript
export async function queryFull(options: QueryOptions): Promise<QueryResult> {
  const chunks: MessageChunk[] = [];
  let text = '';
  let sessionId = '';
  let stopReason = '';

  for await (const chunk of query(options)) {
    chunks.push(chunk);
    if (chunk.type === 'assistant') text += chunk.content;
    if (chunk.type === 'result') {
      sessionId = chunk.sessionId;
      stopReason = chunk.stopReason;
    }
  }
  return { text, sessionId, stopReason, chunks };
}
```

### Pattern 4: queryRaw skips dispatch
**What:** `queryRaw()` is identical to `query()` but yields `RawEvent` instead of `MessageChunk`, skipping the `dispatch()` stage.
**When to use:** Consumers who need wire-level events (e.g., for debugging or future tooling).
**Example:**
```typescript
export async function* queryRaw(options: QueryOptions): AsyncGenerator<RawEvent> {
  // Same lifecycle as query() — temp file, spawn, try/finally
  // Pipeline: parseNdjson(child.stdout) — no dispatch()
  const rawEvents = parseNdjson(child.stdout!);
  for await (const event of rawEvents) {
    if (aborted) break;
    yield event;
  }
}
```

### Pattern 5: Python cancel_scope cancellation
**What:** Python uses anyio's cancel scope as the cancellation primitive. The pattern wraps the iteration in a `CancelScope` that the caller can cancel from outside.
**When to use:** Python `query()` to honor `cancel_scope` option.
**Example:**
```python
# python/src/gemini_sdk/query/query.py
import anyio
from anyio import get_cancelled_exc_class

async def query(options: QueryOptions) -> AsyncIterator[MessageChunk]:
    temp_path = await _write_temp_system_prompt(options.get('system_prompt'))
    env_overrides: dict[str, str] = {}
    if temp_path:
        env_overrides['GEMINI_SYSTEM_MD'] = temp_path

    argv = build_argv(options)
    manager = ProcessManager()
    proc = await manager.spawn(
        argv=argv,
        cli_path=options.get('cli_path'),
        env={**(options.get('env') or {}), **env_overrides},
        cwd=options.get('cwd'),
    )

    cancel_scope = options.get('cancel_scope')
    try:
        async for chunk in dispatch(parse_ndjson(proc.stdout)):
            if cancel_scope and cancel_scope.cancel_called:
                break
            # model downgrade detection on result chunk
            yield chunk
    except BaseException as exc:
        if isinstance(exc, get_cancelled_exc_class()):
            raise  # always reraise cancellation
        raise
    finally:
        if proc.pid:
            try:
                await kill_tree(proc.pid)
            except Exception:
                pass
        if temp_path:
            try:
                await anyio.Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
```

### Pattern 6: Model enum with @deprecated JSDoc
**What:** TypeScript const enum (or string-literal union) with JSDoc `@deprecated` tags.
**When to use:** Typed model selection that editors surface as deprecated without runtime cost.
**Example:**
```typescript
// ts/src/query/types.ts
export const Model = {
  AUTO: 'auto',
  /** @deprecated EOL 2026-06-17 */
  FLASH_25: 'gemini-2.5-flash',
  /** @deprecated EOL 2026-06-17 */
  PRO_25: 'gemini-2.5-pro',
  FLASH_20: 'gemini-2.0-flash',
  FLASH_3: 'gemini-3-flash',
  PRO_3: 'gemini-3-pro',
} as const;
export type Model = (typeof Model)[keyof typeof Model];
```
Use `as const` object pattern rather than TypeScript `enum` — avoids enum-specific emit and allows `Model | string` union without cast.

### Anti-Patterns to Avoid
- **Spawning inside buildArgv:** `buildArgv` MUST remain a pure function. Any OS calls break the "no side effects" contract and make 100% branch coverage under unit tests trivially impossible.
- **Global AbortSignal listener without cleanup:** Always call `removeEventListener` in `finally`, or use `{ once: true }` to prevent memory leaks when the same signal is long-lived.
- **Combining `detached: true` with `windowsHide: true`:** Known Node.js issue #21825 — already avoided in `SpawnPerCallStrategy`; `query()` must not pass these together via `spawnOptions`.
- **Calling `await killTree()` after `fs.unlink()` of the temp file:** Kill the process first, then delete the temp file. If you delete first and the process tries to read the file after deletion, it errors before you can kill it cleanly.
- **Python: Swallowing cancellation exception:** Always `raise` after `get_cancelled_exc_class()` check. AnyIO relies on the exception propagating to cancel the scope stack.
- **Using TypeScript `enum` keyword for Model:** TS enums have complicated emit behavior with `isolatedModules`; use `as const` object + type alias instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subprocess spawning | Custom spawn logic | `ProcessManager.spawn()` (Phase 2) | Windows .cmd CVE mitigation, windowsHide, UTF-8 env already handled |
| Process tree kill | Custom SIGTERM loop | `killTree(pid, gracePeriodMs)` (Phase 2) | Unix grace + taskkill on Windows; cross-platform coverage already tested |
| Clean env building | Manual `process.env` copy | `buildEnv(overrides)` (Phase 2) | Allowlist filtering already vetted; `GEMINI_SYSTEM_MD` already in allowlist |
| Binary resolution | `which gemini` shell call | `resolveBinary(cliPath?)` (Phase 2) | PATH + `GEMINI_BIN_PATH` + known locations; Windows .cmd extension already handled |
| NDJSON parsing | Custom line-splitter | `parseNdjson(stream)` (Phase 3) | 1 MiB limit, CRLF tolerance, UTF-8 decode with replacement already handled |
| Event dispatch/mapping | Manual switch on raw events | `dispatch(events)` (Phase 3) | Tool pairing by `tool_id`, thinking detection, rate-limit vs error already handled |
| Property-based test harness | Manual combinatoric arrays | `@fast-check/vitest` | Arbitrary input generation with shrinking; API-02 fuzz requirement calls for this |
| Temp file collision prevention | `Date.now()` suffix | `crypto.randomBytes(8).toString('hex')` | Cryptographic randomness; prevents collisions under concurrent queries |

**Key insight:** Phase 4 is pure composition. Every hard infrastructure problem was already solved in Phases 2 and 3. The only new logic is the options-to-argv mapping (`buildArgv`), the generator lifecycle glue (`query`), and the model-downgrade comparison.

---

## Common Pitfalls

### Pitfall 1: AbortSignal race condition — signal fires before listener registered
**What goes wrong:** If `abortSignal.aborted` is already `true` when `query()` starts, the `addEventListener` call never fires and the generator loops indefinitely.
**Why it happens:** `AbortController.abort()` may be called synchronously before the async generator's first `next()`.
**How to avoid:** Check `if (abortSignal.aborted) { throw new AbortError(); }` immediately on entry, before spawning any process.
**Warning signs:** Test where `abort()` is called before `query()` loop — generator does not terminate.

### Pitfall 2: Temp file not cleaned up when consumer breaks early
**What goes wrong:** Caller does `for await (const chunk of query(...)) { break; }` — without a `finally` block on the generator, `fs.unlink` never runs.
**Why it happens:** `break` inside `for await` calls `generator.return()`, which triggers the generator's `finally` block — BUT only if the generator has one.
**How to avoid:** Place `fs.unlink(tempPath)` inside the generator's `finally` block unconditionally. This is exactly the architecture decided in CONTEXT.md.
**Warning signs:** Temp files accumulate in OS temp dir under concurrent or integration testing.

### Pitfall 3: GEMINI_SYSTEM_MD must be an absolute path — relative paths may resolve from wrong cwd
**What goes wrong:** `GEMINI_SYSTEM_MD=./system.md` is resolved from gemini-cli's cwd, not the SDK's process cwd.
**Why it happens:** The CLI resolves relative paths from its own working directory, which is `options.cwd` (subprocess cwd), not the SDK process's cwd.
**How to avoid:** Always write the temp file to `os.tmpdir()` and set `GEMINI_SYSTEM_MD` to the absolute path returned by `fs.writeFile`. Never use relative paths.
**Warning signs:** CLI errors with "missing system prompt file" on integration tests using `options.cwd`.

### Pitfall 4: Model downgrade detection against aliased model names
**What goes wrong:** User passes `model: 'auto'` and the `init` event returns `model: 'auto-gemini-3'` — naive string equality fires a false downgrade warning.
**Why it happens:** gemini-cli internally routes 'auto' to e.g. `auto-gemini-3` and reports the routing alias in the init event's model field (verified from `spec/fixtures/simple-text.ndjson` line 1: `"model":"auto-gemini-3"`).
**How to avoid:** Only compare requested model to actual model when `requestedModel` is not `'auto'` and not `undefined`. Treat 'auto' / undefined as "no preference declared — no comparison".
**Warning signs:** `ModelDowngradeWarning` on simple text queries without any explicit model set.

### Pitfall 5: --include-directories flag repeating vs comma separation
**What goes wrong:** Passing `--include-directories dir1,dir2` as a single comma-separated value may be parsed differently across gemini-cli versions.
**Why it happens:** CLI reference says the flag "accepts comma-separated or multiple flags" — but the gemini-cli version pinned in `.gemini-cli-compat` is 0.37.1, and behavior may differ.
**How to avoid:** In `buildArgv`, repeat the flag once per directory: `['--include-directories', dir1, '--include-directories', dir2]`. This is always safe and unambiguous.
**Warning signs:** Only the first directory is included when passing multiple directories.

### Pitfall 6: Python async generator and cancel_scope must stay in same task
**What goes wrong:** Trying to cancel from a different task (e.g., spawning a cancel in `anyio.to_thread`) raises `RuntimeError: Attempted to exit cancel scope in a different task`.
**Why it happens:** AnyIO cancel scopes are task-local; they cannot be entered in one task and exited in another.
**How to avoid:** Cancel scope must be entered in the same task that runs `async for chunk in query(...)`. The `cancel_scope` passed via options is entered by the caller's task; the generator inherits it.
**Warning signs:** `RuntimeError` about cancel scope in wrong task during Python cancellation tests.

### Pitfall 7: Windows path in GEMINI_SYSTEM_MD with spaces or backslashes
**What goes wrong:** On Windows, `os.tmpdir()` returns a path like `C:\Users\seanr\AppData\Local\Temp`. If this path contains spaces, gemini-cli may fail to read it if it doesn't quote env var paths.
**Why it happens:** Some CLI internals pass env var values through shell expansion.
**How to avoid:** The subprocess is spawned with `shell: true` on Windows (CVE mitigation in SpawnPerCallStrategy) — env vars are not shell-expanded when passed directly to the env dict, so this is safe. However, validate with an integration test on a Windows path with spaces in temp dir.
**Warning signs:** `missing system prompt file` on Windows in paths with spaces.

---

## Code Examples

Verified patterns from project source and official sources:

### buildArgv — Complete flag mapping
```typescript
// ts/src/query/buildArgv.ts
// Source: verified from geminicli.com/docs/cli/cli-reference/ and headless.md
export function buildArgv(options: QueryOptions): string[] {
  const argv: string[] = [
    '--output-format', 'stream-json',  // always required for SDK use
    '-p', options.prompt,               // required
  ];

  // Model: omit flag entirely when undefined or 'auto' (MDL-03)
  if (options.model !== undefined && options.model !== 'auto') {
    argv.push('--model', options.model as string);
  }

  // Additional directories: one flag per directory (CWD-02)
  if (options.additionalDirectories?.length) {
    for (const dir of options.additionalDirectories) {
      argv.push('--include-directories', dir);
    }
  }

  return argv;
}
```

### Temp file creation — cryptographically safe
```typescript
// ts/src/query/query.ts
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

async function writeTempSystemPrompt(
  systemPrompt: string | undefined
): Promise<string | undefined> {
  if (!systemPrompt) return undefined;  // empty string = no-op (SYS-01)
  const suffix = randomBytes(8).toString('hex');
  const tempPath = join(tmpdir(), `gemini-sdk-system-${suffix}.md`);
  await writeFile(tempPath, systemPrompt, 'utf-8');
  return tempPath;  // absolute path — safe across cwd changes
}
```

### Python temp file with anyio
```python
# python/src/gemini_sdk/query/query.py
import os, secrets
import anyio

async def _write_temp_system_prompt(system_prompt: str | None) -> str | None:
    if not system_prompt:
        return None
    suffix = secrets.token_hex(8)
    temp_path = os.path.join(
        os.environ.get('TMPDIR') or os.environ.get('TMP') or os.environ.get('TEMP') or '/tmp',
        f'gemini-sdk-system-{suffix}.md'
    )
    await anyio.Path(temp_path).write_text(system_prompt, encoding='utf-8')
    return temp_path
```

### AbortSignal integration in TypeScript async generator
```typescript
// Source: MDN AbortSignal + Node.js AbortController patterns
// Checked: abortSignal.aborted guard BEFORE addEventListener
async function* query(options: QueryOptions): AsyncGenerator<MessageChunk> {
  // Check already-aborted state before anything
  if (options.abortSignal?.aborted) throw new AbortError();

  let aborted = false;
  const onAbort = () => { aborted = true; };
  options.abortSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    for await (const chunk of chunks) {
      if (aborted) break;  // check after each yield point
      yield chunk;
    }
    if (aborted) throw new AbortError();
  } finally {
    options.abortSignal?.removeEventListener('abort', onAbort);
    // ... killTree, fs.unlink
  }
}
```

### Model enum (as const pattern — avoids TS enum pitfalls)
```typescript
// ts/src/query/types.ts
export const Model = {
  AUTO: 'auto',
  /** @deprecated gemini-cli will phase out 2.5 series 2026-06-17 */
  FLASH_25: 'gemini-2.5-flash',
  /** @deprecated gemini-cli will phase out 2.5 series 2026-06-17 */
  PRO_25: 'gemini-2.5-pro',
  FLASH_20: 'gemini-2.0-flash',
  FLASH_3: 'gemini-3-flash',
  PRO_3: 'gemini-3-pro',
} as const;
export type Model = (typeof Model)[keyof typeof Model];

// Usage: model field is Model | string
export interface QueryOptions {
  prompt: string;
  model?: Model | string;
  // ...
}
```

### ResultChunk extension for model downgrade (MDL-04)
```typescript
// ts/src/parser/types.ts — extend existing ResultChunk
export interface ResultChunk {
  type: 'result';
  sessionId: string;
  stopReason: string;
  requestedModel?: string;  // ADD: populated only when mismatch detected
  actualModel?: string;     // ADD: populated only when mismatch detected
}
```

### @fast-check/vitest fuzz test for buildArgv (API-02)
```typescript
// ts/src/query/buildArgv.spec.ts
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { buildArgv } from './buildArgv.js';

describe('buildArgv: fuzz test', () => {
  it('produces non-empty argv for any combinatoric input without throwing', () => {
    fc.assert(
      fc.property(
        fc.record({
          prompt: fc.string({ minLength: 1 }),
          model: fc.option(fc.oneof(fc.constantFrom('auto', 'gemini-2.5-flash', 'gemini-3-pro'), fc.string())),
          additionalDirectories: fc.option(fc.array(fc.string())),
        }),
        (options) => {
          const argv = buildArgv(options as any);
          return Array.isArray(argv) && argv.length > 0;
        }
      )
    );
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| gemini 2.5 Flash/Pro as default | `auto` routing (gemini-3 series) | Late 2025 | Default omits `--model` flag; 2.5 series is deprecated |
| `--output-format json` (single blob) | `--output-format stream-json` (NDJSON) | v0.11.0 | Streaming event-by-event delivery; required for SDK |
| gemini 2.0 Flash as current | gemini 3 Flash + gemini 3 Pro as current | Early 2026 | Enum must include gemini-3-flash, gemini-3-pro |
| Single `--include-directories` value | Array flag (repeat or comma-separate) | v0.x | Use repeat-flag pattern, not comma-separate, for safety |

**Deprecated/outdated:**
- `gemini-2.5-flash`, `gemini-2.5-pro`: EOL 2026-06-17; mark `@deprecated` in enum
- `--output-format json` (non-streaming): Not used by SDK; always use `stream-json`

---

## Open Questions

1. **`--include-directories` flag: repeat vs comma-separated behavior in 0.37.1**
   - What we know: CLI reference says both "comma-separated or multiple flags" work
   - What's unclear: Whether 0.37.1 (pinned version) handles both identically in headless mode
   - Recommendation: Use repeat-flag pattern (`--include-directories dir1 --include-directories dir2`) as the conservative default; add a regression test to fixture corpus if a multi-directory integration test is feasible

2. **Model downgrade detection: is the `init` event `model` field stable across CLI versions?**
   - What we know: Captured `"model":"auto-gemini-3"` from `spec/fixtures/simple-text.ndjson` against 0.37.1; the field exists and carries the routing result
   - What's unclear: Whether future CLI versions continue to populate this field, or change the format (e.g., from `"auto-gemini-3"` to `"gemini-3-flash"`)
   - Recommendation: Downgrade detection is non-fatal (fields on ResultChunk, not throw); design the comparison so that if `actualModel` is missing/null, no warning is emitted — graceful degradation

3. **Python: `pytest-anyio` vs `anyio.pytest_plugin`**
   - What we know: `pyproject.toml` has `pytest-anyio>=0.0.0` as dev dep; anyio tests in Phase 2/3 use it
   - What's unclear: The exact async fixture pattern for testing `query()` cancel_scope path in pytest
   - Recommendation: Follow Phase 3 Python test patterns (already established in `test_dispatch.py`); use `@pytest.mark.anyio` decorator; for cancel_scope tests use `anyio.move_on_after(0.01)` to force immediate cancellation in unit tests with a mock subprocess

4. **Windows: `queryRaw()` stdout reading — anyio ByteReceiveStream vs Node.js Readable**
   - What we know: `SpawnPerCallStrategy` spawns with `stdio: 'pipe'`; `child.stdout` is a Node.js `Readable` stream; `parseNdjson` accepts `AsyncIterable<Uint8Array>`
   - What's unclear: Whether `child.stdout` needs to be wrapped as `AsyncIterable<Uint8Array>` or is already async-iterable in Node 18+
   - Recommendation: Node.js `Readable` streams support `for await...of` since Node 10; `child.stdout` is directly consumable as `AsyncIterable<Buffer>` which satisfies `AsyncIterable<Uint8Array>`; add a type cast if TypeScript complains

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.2 (TS) / pytest ^8.0 + pytest-anyio (Python) |
| Config file | `ts/vitest.config.ts` / `python/pyproject.toml` [tool.pytest.ini_options] |
| Quick run command (TS) | `cd ts && pnpm test -- --reporter=verbose src/query/` |
| Quick run command (Python) | `cd python && uv run pytest tests/test_build_argv.py tests/test_query.py -x` |
| Full suite command (TS) | `cd ts && pnpm test` |
| Full suite command (Python) | `cd python && uv run pytest` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | `query()` yields `MessageChunk` stream backed by subprocess | integration (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| API-02 | `buildArgv()` pure, 100% branch coverage, fuzz test | unit + property | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ Wave 0 |
| API-03 | Subprocess killed on early break / generator return | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| API-04 | `abortSignal` / `cancel_scope` kills subprocess, throws AbortError | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| API-05 | `queryFull()` accumulates chunks into QueryResult | unit (mock query) | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| API-06 | `queryRaw()` yields `RawEvent` not `MessageChunk` | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| SYS-01 | `systemPrompt` writes temp file, sets `GEMINI_SYSTEM_MD` in env | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| SYS-02 | Temp file deleted in finally (abort path verified by post-abort fs.stat) | unit | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| CWD-01 | `cwd` option propagates to subprocess spawnOptions.cwd | unit | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |
| CWD-02 | `additionalDirectories` maps to repeated `--include-directories` flags in argv | unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ Wave 0 |
| MDL-01 | Model enum contains expected model strings including deprecated 2.5 series | type/unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ Wave 0 |
| MDL-02 | Raw string accepted as model without SDK error | unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ Wave 0 |
| MDL-03 | `model: undefined` and `model: 'auto'` both omit `--model` flag from argv | unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ Wave 0 |
| MDL-04 | `init` model mismatch adds `requestedModel`/`actualModel` to ResultChunk, no throw | unit | `pnpm test -- src/query/query.spec.ts` | ❌ Wave 0 |

Python parity test files: `tests/test_build_argv.py` and `tests/test_query.py` — both Wave 0 gaps.

### Sampling Rate
- **Per task commit:** `cd ts && pnpm test -- src/query/` + `cd python && uv run pytest tests/test_build_argv.py tests/test_query.py -x`
- **Per wave merge:** `cd ts && pnpm test` + `cd python && uv run pytest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `ts/src/query/types.ts` — QueryOptions, QueryResult, Model, AbortError definitions
- [ ] `ts/src/query/buildArgv.ts` — pure buildArgv function
- [ ] `ts/src/query/query.ts` — query, queryRaw, queryFull generators
- [ ] `ts/src/query/index.ts` — barrel export
- [ ] `ts/src/query/buildArgv.spec.ts` — unit + fuzz tests (API-02, MDL-01..04, CWD-02)
- [ ] `ts/src/query/query.spec.ts` — integration/mock tests (API-01..06, SYS-01..02, CWD-01)
- [ ] `python/src/gemini_sdk/query/__init__.py`
- [ ] `python/src/gemini_sdk/query/types.py`
- [ ] `python/src/gemini_sdk/query/build_argv.py`
- [ ] `python/src/gemini_sdk/query/query.py`
- [ ] `python/tests/test_build_argv.py`
- [ ] `python/tests/test_query.py`
- [ ] Update `ts/src/index.ts` to `export * from './query/index.js'`
- [ ] Update `python/src/gemini_sdk/__init__.py` to export `query`, `query_full`, `query_raw`, `build_argv`
- [ ] `ts/src/parser/types.ts` — add `requestedModel?` and `actualModel?` to `ResultChunk` (MDL-04)
- [ ] Dev dep: `cd ts && pnpm add -D @fast-check/vitest fast-check` for fuzz test (API-02)

---

## Sources

### Primary (HIGH confidence)
- `spec/protocol.md` — Event-by-event field reference; `init` event carries `session_id` and `model`; confirmed from `spec/fixtures/simple-text.ndjson`
- `spec/feasibility.md` — `flush_verdict=partial`; Phase 4 defaults `forcePty: false` (user opt-in)
- `ts/src/process/ProcessManager.ts` — `spawn()` signature, `SpawnOptions2`, `killTree()` implementation
- `ts/src/process/EnvBuilder.ts` — `GEMINI_SYSTEM_MD` already in allowlist (verified directly)
- `ts/src/parser/types.ts` — `ResultChunk` needs `requestedModel`/`actualModel` extension
- `ts/src/parser/dispatch.ts` — unpaired tool flush contract; `query()` abort path must mirror this
- Node.js built-in APIs: `fs/promises.writeFile`, `fs/promises.unlink`, `os.tmpdir`, `crypto.randomBytes` — stable Node 18+ APIs

### Secondary (MEDIUM confidence)
- [geminicli.com/docs/cli/system-prompt](https://geminicli.com/docs/cli/system-prompt/) — `GEMINI_SYSTEM_MD` accepts absolute path; file-must-exist behavior; `GEMINI_SYSTEM_MD=false` disables
- [geminicli.com/docs/cli/cli-reference](https://geminicli.com/docs/cli/cli-reference/) — `--include-directories` array flag; `-p`/`--prompt`; `--model`/`-m`; `--output-format`
- [fast-check.dev/blog/2025/03/28/...](https://fast-check.dev/blog/2025/03/28/beyond-flaky-tests-bringing-controlled-randomness-to-vitest/) — `@fast-check/vitest` integration for property-based testing
- [anyio cancel scope docs](https://anyio.readthedocs.io/en/stable/cancellation.html) — cancel_scope task-locality constraint (cancel scope must stay in same task)

### Tertiary (LOW confidence — flag for validation)
- Model names `gemini-3-flash`, `gemini-3-pro` from geminicli.com/docs/get-started/gemini-3/ — current as of 2026-04-13 but model names change frequently; validate against `gemini --version` output on CI host
- `--include-directories` comma-separate vs repeat behavior against pinned 0.37.1 — not integration-tested; repeat-flag pattern is conservative default

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all core dependencies are from prior phases; only `@fast-check/vitest` is new (well-documented, stable)
- Architecture: HIGH — pipeline composition pattern is confirmed by Phase 2/3 code; `try/finally` generator lifecycle is standard Node.js
- GEMINI_SYSTEM_MD behavior: MEDIUM — confirmed from community docs + discussions; behavior validated in prior capture (Phase 1); absolute path requirement verified
- Model names/aliases: MEDIUM — current as of April 2026 from official geminicli.com; model names evolve; enum is runtime-flexible via `Model | string` escape hatch
- Pitfalls: HIGH — AbortSignal race (aborted-before-listen) and cancel_scope task-locality are documented platform constraints

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (model names section may need refresh sooner if gemini-cli releases major update)
