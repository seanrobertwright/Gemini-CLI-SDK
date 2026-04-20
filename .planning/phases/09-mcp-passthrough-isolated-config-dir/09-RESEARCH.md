# Phase 9: MCP Passthrough + Isolated Config Dir - Research

**Researched:** 2026-04-20
**Domain:** gemini-cli MCP configuration, isolated GEMINI_CONFIG_DIR, temp lifecycle, MCP SDK stubs
**Confidence:** HIGH (all critical decisions empirically verified in Phase 1)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `options.mcpServers?: Record<string, Record<string, unknown>>` — raw pass-through, no compile-time union
- `options.allowedMcpServerNames?: string[]` — separate field, CSV-joined as `--allowed-mcp-server-names`
- Empty `mcpServers: {}` or `undefined` → no temp dir created, no flag emitted
- `mcpServers` set but `allowedMcpServerNames` empty/undefined → pre-spawn `InvalidPromptError` (not silent)
- `env.GEMINI_CONFIG_DIR` + `mcpServers` together → pre-spawn `InvalidPromptError` (collision guard)
- Temp dir content: `settings.json` at dir root ONLY. The exact scaffolding beyond `settings.json` is DEFERRED to research spike (this document resolves it — see § Scaffolding Shape below)
- `settings.json` fragment: only `{ "mcpServers": <verbatim input> }` — no other keys
- `GEMINI_CONFIG_DIR` already in `EnvBuilder.ts` allowlist — no changes to `EnvBuilder.ts`
- Success-path cleanup: blocking `await fs.rm(tempDir, { recursive: true, force: true })` in `finally`
- Abort/error cleanup: `killTree` → `proc.wait()` → `fs.rm(..., maxRetries: 3, retryDelay: 200)`
- Cleanup failure after retries: `console.warn` with stranded path, do NOT re-throw
- No new error classes — reuse `InvalidPromptError` for both pre-spawn guards
- `@experimental` JSDoc on both `mcpServers` and `allowedMcpServerNames`
- No runtime warning on first use; no env-var gating
- Stub MCP servers use official `@modelcontextprotocol/sdk` (TS) and `mcp` PyPI (Python)
- Stubs live in `spec/fixtures/mcp/stub.mjs` and `spec/fixtures/mcp/stub.py`
- Tests: `ts/src/mcp/` module files, `ts/test/mcp-passthrough.test.ts`, `python/tests/test_mcp_passthrough.py`
- PAR-01 lock-step: TS + Python both implement Phase 9 (last lock-step phase)
- `docs/mcp.md` authored in Phase 9, published in Phase 11
- No fixture capture for MCP round-trip in `spec/fixtures.manifest.json` (spike decides; see § Fixture Strategy)

### Claude's Discretion

- Exact module layout under `ts/src/mcp/` and `python/src/gemini_sdk/mcp/`
- Temp dir naming prefix (consistent with existing `gemini-sdk-system-` prefix)
- Whether TS `fs.rm` retry wrapper is inlined in `cleanupConfigDir.ts` or extracted to `retryingRm.ts`
- Whether to golden-file the stub MCP server tool-call round-trip events or assert shape at runtime
- Whether `docs/mcp.md` includes a "porting from gemini-cli CLI MCP config" section
- Exact prose of `InvalidPromptError` messages for the two new pre-spawn guards
- Whether Phase 9 adds `--scenario mcp-stdio` to `scripts/capture-fixtures.*`

### Deferred Ideas (OUT OF SCOPE)

- Caller-defined custom tools via stub MCP sidecar (CTL-01..03)
- HTTP MCP OAuth token refresh workaround (#23296 / #23776)
- Archon-adapter wiring of `mcpServers` (Phase 10)
- `docs/mcp.md` publication (Phase 11)
- MCP lifecycle hooks (HOK-01..04)
- Runtime `gemini --version` probe for MCP flag renames (Phase 8 TOL-03 decision applies)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | SDK accepts `options.mcpServers` (map of server name → config) and writes a temp `settings.json` fragment | settings.json format verified; GEMINI_CONFIG_DIR path confirmed; exact fragment is `{ "mcpServers": <verbatim> }` |
| MCP-02 | SDK uses an isolated temp `GEMINI_CONFIG_DIR` per query — NEVER mutates user's real `~/.gemini/settings.json` | Phase 1 feasibility verdict: PASS. `GEMINI_CONFIG_DIR` respected on Windows 0.37.1, real mtime unchanged. |
| MCP-03 | SDK gates which MCP servers gemini-cli can use via `--allowed-mcp-server-names` | Flag confirmed in CLI reference. Format: CSV-joined string. Mirrors `--allowed-tools` pattern exactly. |
| MCP-04 | Temp config dir is cleaned up in `finally` (even on error/cancel) | `fs.rm({recursive,force,maxRetries:3,retryDelay:200})` verified for Windows EBUSY; Python shutil.rmtree + retry loop pattern established. |
</phase_requirements>

---

## Summary

Phase 9 is well-bounded by prior work. The three load-bearing unknowns that would have blocked planning — whether `GEMINI_CONFIG_DIR` works on Windows, what exact `settings.json` shape gemini-cli expects, and whether the minimum fragment suffices or scaffolding is needed — are all now resolved.

**GEMINI_CONFIG_DIR semantics (confirmed):** The env var redirects gemini-cli's user config base to the specified directory. `settings.json` lives directly at `GEMINI_CONFIG_DIR/settings.json` (not inside a `.gemini/` subdir). This was empirically verified in the Phase 1 smoke test with gemini-cli 0.37.1 on Windows 11 Pro: `config_dir_verdict: pass`, real `~/.gemini/settings.json` mtime unchanged after all tests.

**Minimum scaffolding verdict (RESOLVED by spike):** The minimum viable temp dir is a single `settings.json` at the root containing only `{ "mcpServers": <verbatim> }`. No `.gemini/` subdirectory scaffolding is required when `GEMINI_CONFIG_DIR` is set — gemini-cli reads `$GEMINI_CONFIG_DIR/settings.json` directly. The `settings.json + .gemini/ subdir` tentative from CONTEXT.md is **overturned** by this spike finding. Simple is enough.

**Known-fragile upstream map (all seven issues):** Issues #2654 and #3406 are the highest-impact for the SDK's behavior. The others are documented in `docs/mcp.md` Known Limitations as pass-through concerns the SDK does not work around. Issue #8248 (GEMINI_CONFIG_DIR broken on Windows) is the one that most threatened Phase 9's design — but Phase 1 proved it works on 0.37.1, overriding the issue's "closed as not planned" label.

**Primary recommendation:** Use `{ mcpServers: verbatimInput }` as the sole content of the temp `settings.json`. Write it to `GEMINI_CONFIG_DIR/settings.json`. Emit `--allowed-mcp-server-names` as CSV. Guard with two pre-spawn `InvalidPromptError` checks. Clean up with `fs.rm({ recursive, force, maxRetries: 3, retryDelay: 200 })` in `finally`. Stub servers use the official MCP SDK packages.

---

## Spike Deliverable 1: Golden Working settings.json Fragment

**Confidence: HIGH** — Verified against gemini-cli 0.37.1 documentation and official source schema.

The minimum `settings.json` fragment that causes gemini-cli to recognize an MCP server:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/stub.mjs"]
    }
  }
}
```

For an HTTP server:

```json
{
  "mcpServers": {
    "remote-server": {
      "httpUrl": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

For an SSE server:

```json
{
  "mcpServers": {
    "sse-server": {
      "url": "https://example.com/sse"
    }
  }
}
```

**SDK behavior:** The SDK JSON-stringifies `options.mcpServers` verbatim into `{ "mcpServers": <value> }`. No transport discrimination — whatever shape the caller passes is forwarded to gemini-cli without inspection. gemini-cli is the source of truth on field validity.

**Optional server fields (all pass through verbatim):**

| Field | Applies To | Purpose |
|-------|-----------|---------|
| `command` | stdio | executable to spawn |
| `args` | stdio | argv array |
| `cwd` | stdio | working directory for server process |
| `env` | stdio | additional env vars for server process |
| `httpUrl` | http | streamable HTTP endpoint |
| `url` | sse | SSE endpoint |
| `headers` | http, sse | request headers (auth, custom) |
| `timeout` | all | ms; gemini-cli has a hardcoded 60 s discovery timeout regardless (#17787) |
| `trust` | all | whether to trust server-provided tool descriptions |
| `includeTools` | all | allowlist tools from this server |
| `excludeTools` | all | blocklist tools from this server |

---

## Spike Deliverable 2: Scaffolding Shape

**Confidence: HIGH** — Derived from Phase 1 smoke test result + gemini-cli source inspection.

**Verdict: minimum fragment is sufficient. The `.gemini/` subdirectory scaffolding tentative from CONTEXT.md is NOT needed.**

When `GEMINI_CONFIG_DIR` is set, gemini-cli looks for `settings.json` directly at:
```
$GEMINI_CONFIG_DIR/settings.json
```

**NOT** at `$GEMINI_CONFIG_DIR/.gemini/settings.json`.

**Temp dir structure for Phase 9:**
```
/tmp/gemini-sdk-mcp-<hex>/
└── settings.json          ← only file; content: {"mcpServers": <verbatim input>}
```

**Evidence:**
- Phase 1 smoke test `smokeConfigDir()` in `scripts/capture-fixtures.mjs` wrote `settings.json` directly to `tempDirA` (not into a `.gemini/` subdir) and got `gemini_config_dir_respected: true` on Windows 0.37.1.
- The `DeepWiki` config documentation shows the two standard locations are `.gemini/settings.json` (workspace) and `~/.gemini/settings.json` (user). When `GEMINI_CONFIG_DIR` overrides the base, it replaces `~/.gemini/` — so `settings.json` sits directly in the override dir.

**#3406 implications:** Issue #3406 ("MCP servers not detected despite valid config") was `closed as not planned` and affects version 0.1.9 (very old). The root cause was not a scaffolding issue — it was a config parsing bug that appeared to be user-environment-specific. The minimum fragment is sufficient for 0.37.1 where the Phase 1 verdict confirmed `GEMINI_CONFIG_DIR` works. No extra scaffolding needed.

---

## Spike Deliverable 3: Known-Fragile Upstream Map

**Confidence: MEDIUM** — Issue statuses sourced from live GitHub pages; current as of 2026-04-20.

| Issue | Title | Status | Impact on SDK | SDK Action |
|-------|-------|--------|---------------|------------|
| #2654 | `toUpperCase()` crash on multi-type JSON schema in MCP tool params | Closed (duplicate of #1481, priority/p1) | MCP servers with `"type": ["string", "number"]` params crash gemini-cli | Document; SDK passes schemas verbatim — if caller's MCP server uses multi-type params, gemini-cli will crash with a non-zero exit code that ErrorMapper handles normally |
| #3406 | MCP servers not detected despite valid config (macOS) | Closed as not planned | Affected 0.1.9; Phase 1 confirms 0.37.1 is fine | Document; confirmed not reproducible on pinned version |
| #20694 | `gemini mcp enable` "Server not found" config parsing bug | Closed (PR #21184 merged) | Internal `getMcpServersFromConfig()` returned wrapper not server names | Irrelevant to SDK (SDK doesn't use `gemini mcp enable`); document for completeness |
| #13604 | CLI hangs spawning npx subprocess for MCP stdio transport | Closed as duplicate of #11459 | MCP grandchild processes (npx-spawned servers) can hold file handles on cleanup | SDK mitigates: `killTree` → `proc.wait(5s)` → `fs.rm({maxRetries:3,retryDelay:200})` |
| #17787 | gemini-cli ignores MCP `timeout` configuration | Closed as not planned | Hardcoded 60 s discovery timeout ignores per-server `timeout` field | Document; SDK does not work around; callers warned in `docs/mcp.md` |
| #23296 | MCP HTTP OAuth token refresh fails during tool calls | Open (filed 2026-03-20) | HTTP MCP servers with expiring OAuth tokens fail mid-session | Document; SDK passes HTTP configs verbatim; callers use long-lived tokens or non-expiring bearer tokens |
| #23776 | (companion to #23296) MCP HTTP auth: static bearer token injection | Open | Same root cause as #23296 | Document alongside #23296 |
| #8248 | GEMINI_CONFIG_DIR not respected on Windows | Closed as not planned | Issue affects some Windows builds | **OVERRIDDEN BY PHASE 1 EVIDENCE**: 0.37.1 on Windows 11 Pro: `config_dir_verdict: pass` |

**SDK workarounds applied:**
- **#13604 mitigation** (highest-risk, applied in code): `killTree` before rm, `fs.rm` with `maxRetries: 3, retryDelay: 200`, Python shutil retry loop. If cleanup still fails → `console.warn`/`warnings.warn`, do not re-throw.
- **All others:** Document in `docs/mcp.md` Known Limitations. No code workaround.

---

## Spike Deliverable 4: Pinned gemini-cli Version

**Conclusion: current pin `0.37.1` is sufficient for stdio MCP. No bump required.**

Phase 1 feasibility verdict (`config_dir_verdict: pass`) was captured against `0.37.1`. `GEMINI_CONFIG_DIR` works, real settings mtime is untouched. `.gemini-cli-compat` content remains `0.37.1`.

---

## Standard Stack

### Core (no new runtime deps)

| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| `node:fs/promises` | Node built-in | `mkdtemp`, `writeFile`, `rm` with retry options | `fs.rm({ maxRetries, retryDelay })` requires Node 16.9+ |
| `node:os` | Node built-in | `tmpdir()` | |
| `node:crypto` | Node built-in | `randomBytes` for unique dir suffix | |
| `anyio` | existing dep | `anyio.Path.mkdir`, `anyio.Path.write_text` (Python) | |
| `shutil` | Python stdlib | `shutil.rmtree` (Python cleanup) | |

### Test-Only Deps (NEW)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | `^1.29.0` | TS stub MCP server | Official reference impl; protocol compliance guaranteed |
| `mcp` | `^1.27.0` | Python stub MCP server | Official PyPI package; FastMCP for minimal code |

**Installation (test-only):**
```bash
# TypeScript (add to ts/package.json devDependencies)
npm install --save-dev @modelcontextprotocol/sdk

# Python (add to python/pyproject.toml [dependency-groups.dev])
uv add --dev "mcp[cli]"
```

Both packages are MIT-licensed.

---

## Architecture Patterns

### Recommended Module Layout

```
ts/src/mcp/
├── writeConfigDir.ts      # mkdtemp + write settings.json; returns temp dir path
├── cleanupConfigDir.ts    # fs.rm with maxRetries/retryDelay + warn-on-failure
└── index.ts               # barrel (internal-only; no public re-export needed)

python/src/gemini_sdk/mcp/
├── write_config_dir.py    # anyio.Path.mkdir + write settings.json
├── cleanup_config_dir.py  # shutil.rmtree with retry loop
└── __init__.py            # barrel

spec/fixtures/mcp/
├── stub.mjs               # TS MCP server stub (stdio, one echo tool)
└── stub.py                # Python MCP server stub (stdio, one echo tool)
```

### Pattern 1: writeConfigDir helper

**What:** Creates a uniquely-named temp dir and writes `settings.json` containing only `{ "mcpServers": verbatimInput }`.

**When to use:** Called from `query()`, `queryRaw()`, `queryFull()` when `mcpServers` is non-empty, before spawn. Mirrors `writeTempSystemPrompt` structure exactly.

```typescript
// ts/src/mcp/writeConfigDir.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Create an isolated GEMINI_CONFIG_DIR for one query invocation.
 * Writes settings.json containing only { mcpServers: verbatimInput }.
 * Returns the absolute path to the temp dir (caller sets GEMINI_CONFIG_DIR to this).
 */
export async function writeConfigDir(
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<string> {
  const suffix = randomBytes(8).toString('hex');
  const tempDir = join(tmpdir(), 'gemini-sdk-mcp-' + suffix);
  await mkdir(tempDir, { recursive: true });
  const content = JSON.stringify({ mcpServers }, null, 2);
  await writeFile(join(tempDir, 'settings.json'), content, 'utf-8');
  return tempDir;
}
```

Python mirror:
```python
# python/src/gemini_sdk/mcp/write_config_dir.py
import json
import secrets
import tempfile

import anyio


async def write_config_dir(mcp_servers: dict) -> str:
    """Create isolated GEMINI_CONFIG_DIR for one query; write settings.json.

    Returns the absolute path to the temp dir.
    """
    suffix = secrets.token_hex(8)
    temp_dir = anyio.Path(tempfile.gettempdir()) / f"gemini-sdk-mcp-{suffix}"
    await temp_dir.mkdir(parents=True, exist_ok=True)
    content = json.dumps({"mcpServers": mcp_servers}, indent=2)
    await (temp_dir / "settings.json").write_text(content, encoding="utf-8")
    return str(temp_dir)
```

### Pattern 2: cleanupConfigDir with retry (MCP-04, #13604 mitigation)

**What:** Removes the temp dir with Windows EBUSY-resilient retry semantics.

```typescript
// ts/src/mcp/cleanupConfigDir.ts
import { rm } from 'node:fs/promises';

/**
 * Remove the temp GEMINI_CONFIG_DIR created by writeConfigDir.
 * Uses fs.rm maxRetries/retryDelay to handle Windows EBUSY from MCP grandchildren.
 * On persistent failure: emits console.warn with the stranded path, does NOT re-throw.
 */
export async function cleanupConfigDir(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    // Warn but never re-throw — a leaked temp dir is recoverable; masking the
    // original error the caller is handling is not. (#13604 Windows holdout path)
    console.warn(`[gemini-sdk] MCP config dir cleanup failed, stranded path: ${tempDir}`, err);
  }
}
```

Python mirror uses a sync `shutil.rmtree` with a manual retry loop (3 attempts × 200 ms), run via `anyio.to_thread.run_sync`. `shutil.rmtree` has no built-in retry options in Python stdlib.

### Pattern 3: Pre-spawn guards in query()

Two new guards added adjacent to the existing Phase 7/8 guards, BEFORE auth resolution and spawn:

```typescript
// Guard 1 (MCP-02 collision): env.GEMINI_CONFIG_DIR + mcpServers
if (options.mcpServers && options.env?.['GEMINI_CONFIG_DIR'] !== undefined) {
  throw new InvalidPromptError(
    'Cannot set env.GEMINI_CONFIG_DIR when mcpServers is provided; ' +
    'SDK manages this variable for isolation (MCP-02). See docs/mcp.md.'
  );
}

// Guard 2 (MCP-03 required): mcpServers without allowedMcpServerNames
if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
  if (!options.allowedMcpServerNames?.length) {
    throw new InvalidPromptError(
      'allowedMcpServerNames is required when mcpServers is set. ' +
      'gemini-cli silently ignores servers not in this whitelist. See docs/mcp.md.'
    );
  }
}
```

### Pattern 4: buildArgv extension for --allowed-mcp-server-names

Verbatim copy of the Phase 8 `--allowed-tools` branch:

```typescript
// MCP-03: --allowed-mcp-server-names (skip when undefined or empty)
if (options.allowedMcpServerNames?.length) {
  argv.push('--allowed-mcp-server-names', options.allowedMcpServerNames.join(','));
}
```

### Pattern 5: query() compose chain with MCP config dir

```typescript
// After pre-spawn guards, after writeTempSystemPrompt:
let mcpConfigDir: string | undefined;
if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
  mcpConfigDir = await writeConfigDir(options.mcpServers);
  envOverrides['GEMINI_CONFIG_DIR'] = mcpConfigDir;
}

// In finally block (after systemPrompt unlink):
if (mcpConfigDir) {
  await cleanupConfigDir(mcpConfigDir);
}
```

### Pattern 6: Stub MCP server (TS)

```javascript
// spec/fixtures/mcp/stub.mjs
// Minimal stdio MCP server — one 'echo' tool returning a canned response.
// Uses @modelcontextprotocol/sdk (official). Run: node stub.mjs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'gemini-sdk-test-stub', version: '0.0.1' });

server.tool('echo', { message: z.string() }, async ({ message }) => ({
  content: [{ type: 'text', text: `echo: ${message}` }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
// Note: use console.error() for diagnostics — console.log() corrupts JSON-RPC on stdout
```

Python mirror (stub.py) using FastMCP:
```python
# spec/fixtures/mcp/stub.py
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("gemini-sdk-test-stub")

@mcp.tool()
def echo(message: str) -> str:
    """Echo the input message back with a prefix."""
    return f"echo: {message}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

### Anti-Patterns to Avoid

- **Writing anything other than `mcpServers` to the temp settings.json** — adding `selectedAuthType`, `memoryImportFormat`, model keys, etc. will fight Phase 6 auth resolution and existing argv-driven config channels. The fragment MUST be `{ "mcpServers": <verbatim> }` and nothing else.
- **Auto-deriving `allowedMcpServerNames` from `mcpServers` keys** — contradicts transparent-wrapper ethos and hides magic. Caller explicitly lists what they want allowed.
- **Snapshotting the real `~/.gemini/` into the temp dir** — violates MCP-02 (reads user files) and adds complexity for zero benefit.
- **A per-process cached config dir** — violates MCP-02 isolation guarantee; per-query ephemeral is the correct pattern (matches SpawnPerCallStrategy).
- **Using `console.log` in the stub server** — corrupts JSON-RPC stdout framing; always use `console.error` for diagnostics.
- **Re-throwing cleanup errors** — masks the original error the caller is already handling. Always warn-and-continue.
- **Calling `mkdtemp` without `randomBytes`/`secrets.token_hex`** — the OS-provided mkdtemp suffix is random, but an explicit suffix makes the prefix recognizable in diagnostics (`gemini-sdk-mcp-<hex>`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stub MCP server protocol | Custom JSON-RPC framing | `@modelcontextprotocol/sdk` (TS), `mcp` FastMCP (Python) | Hand-rolled framing accumulates technical debt the moment upstream bumps MCP protocol version. Official SDK guarantees protocol compliance |
| JSON Schema validation of `mcpServers` input | Custom type-checking | Don't validate at all (v1) | SDK is a transparent wrapper; gemini-cli is source of truth on field validity |
| Windows EBUSY retry loop | Custom exponential backoff | `fs.rm({ maxRetries, retryDelay })` (Node built-in since 16.9) | Node's built-in handles EBUSY/EPERM/EMFILE natively with "move then remove" fallback |
| Temp dir naming | Random UUID library | `randomBytes(8).toString('hex')` (built-in) | No extra deps; 64-bit entropy is sufficient for isolation |

**Key insight:** The official MCP SDK packages exist precisely to handle protocol compliance; reinventing any part of JSON-RPC framing for a test harness buys nothing and risks subtle incompatibilities.

---

## Common Pitfalls

### Pitfall 1: GEMINI_CONFIG_DIR Windows Issue #8248 — False Alarm
**What goes wrong:** Issue #8248 is "closed as not planned" suggesting the env var is broken on Windows.
**Why it's a false alarm:** Phase 1 empirically confirmed `config_dir_verdict: pass` on Windows 11 Pro with 0.37.1. The issue was closed without resolution but may have been a version-specific or environment-specific bug in older versions. The SDK is built against 0.37.1 where it works.
**How to avoid:** Trust Phase 1 evidence over issue tracker labels. Add an SC-4 CI test on all three OSes that asserts the behavior works.
**Warning signs:** If the SC-4 CI test fails on Windows, bump `.gemini-cli-compat` and re-investigate.

### Pitfall 2: MCP Grandchild File Handle Retention (#13604)
**What goes wrong:** When the SDK kills the gemini-cli process after an abort/error, MCP servers spawned as grandchild processes (especially `npx`-based ones) can linger and hold file handles on the temp config dir. `fs.rm` on Windows throws `EBUSY`.
**Why it happens:** Windows does not allow deleting files that are open by any process. `npx` starts a child node process that may keep the config dir open.
**How to avoid:** Call `killTree(pid)` FIRST, then wait for `proc.wait()` with the 5-second grace window, THEN call `fs.rm({ maxRetries: 3, retryDelay: 200 })`. If still failing after 3 retries, `console.warn` and move on.
**Warning signs:** Test infrastructure should have a "held-handle" stub test that injects a file-handle-holding process and asserts the warning path is taken without re-throwing.

### Pitfall 3: Empty mcpServers Map Must Be a No-Op
**What goes wrong:** If `mcpServers: {}` creates a temp dir and sets `GEMINI_CONFIG_DIR`, gemini-cli runs with an empty `mcpServers` config. This is wasteful and could trigger edge cases in gemini-cli.
**Why it happens:** Careless truthy check (`if (options.mcpServers)`) passes for `{}`.
**How to avoid:** Check `Object.keys(options.mcpServers).length > 0`. Empty map is treated identically to `undefined` — no temp dir, no flag.

### Pitfall 4: Temp settings.json Key Pollution
**What goes wrong:** Adding any key besides `mcpServers` to the temp `settings.json` (e.g., `selectedAuthType`, `model`) creates a settings file that fights existing Phase 6 auth resolution and argv-driven config channels.
**Why it happens:** Developers may want to "ensure" a clean state by setting explicit values.
**How to avoid:** The fragment is `{ "mcpServers": <verbatim> }` and nothing else. The test suite SC-2 (mtime invariant) checks the real `~/.gemini/settings.json` is untouched but does NOT check what's in the temp file — add an explicit assertion that the temp file contains only the `mcpServers` key.

### Pitfall 5: stdout vs stderr in Stub Server
**What goes wrong:** Any `console.log()` call in the stub server process corrupts the JSON-RPC framing on stdout that gemini-cli reads.
**Why it happens:** MCP stdio transport uses stdout exclusively for JSON-RPC; any non-JSON-RPC bytes break the framing.
**How to avoid:** All diagnostic output in stub servers uses `console.error()` (TS) or `sys.stderr` (Python). The test scaffold verifies the stub is reachable by checking gemini-cli's event stream, not the stub's stdout.

### Pitfall 6: #2654 Multi-Type JSON Schema Crash
**What goes wrong:** An MCP server whose tools use `"type": ["string", "number"]` (JSON Schema multi-type) causes gemini-cli to crash with `TypeError: Cannot read properties of undefined (reading 'toUpperCase')`.
**Why it happens:** gemini-cli assumes `type` is always a string, not an array.
**How to avoid:** SDK cannot prevent this (transparent pass-through). Document in `docs/mcp.md` Known Limitations. When this happens, ErrorMapper catches the non-zero exit code and classifies it as `ProcessCrashError` via existing pipeline.
**Warning signs:** `ProcessCrashError` from callers using MCP servers with multi-type params.

### Pitfall 7: Cleanup in Finally with Two Resources
**What goes wrong:** If cleanup of the systemPrompt temp file is done before or separately from cleanup of the mcpConfigDir, an error in one cleanup can skip the other.
**Why it happens:** Sequential cleanup with early-return on error.
**How to avoid:** Both cleanups run in the SAME `finally` block. `unlink(tempPath)` (best-effort, `.catch(() => {})`) runs first, then `cleanupConfigDir(mcpConfigDir)` runs second. Neither re-throws. Order within `finally` is deterministic.

---

## Code Examples

### QueryOptions Extension (additive, zero breaking changes)

```typescript
// Add to ts/src/query/types.ts QueryOptions interface
/**
 * @experimental MCP server map (MCP-01). Written verbatim into a temp
 * settings.json inside an isolated GEMINI_CONFIG_DIR per query.
 * Empty/undefined → no temp dir created.
 * See docs/mcp.md Known Limitations (#2654, #3406, #20694, #13604, #17787).
 */
mcpServers?: Record<string, Record<string, unknown>>;

/**
 * @experimental Whitelist of MCP server names passed via
 * --allowed-mcp-server-names (MCP-03). CSV-joined at argv boundary.
 * Empty/undefined → flag omitted. REQUIRED when mcpServers is set
 * (else pre-spawn InvalidPromptError). See docs/mcp.md.
 */
allowedMcpServerNames?: string[];
```

Python mirror (add to `QueryOptions` TypedDict):

```python
mcp_servers: Dict[str, Dict[str, Any]]
"""**Experimental:** MCP server map (MCP-01). Written verbatim into temp
settings.json in isolated GEMINI_CONFIG_DIR. Empty/absent → no temp dir.
See docs/mcp.md Known Limitations (#2654, #3406, #20694, #13604, #17787).
"""

allowed_mcp_server_names: List[str]
"""**Experimental:** MCP server name whitelist (MCP-03). CSV-joined at
argv boundary as --allowed-mcp-server-names. Required when mcp_servers set.
"""
```

### Full Integration Test Scaffold (SC-1)

```typescript
// ts/src/mcp/mcp-passthrough.spec.ts (or ts/test/mcp-passthrough.test.ts)
it('SC-1 mcp-passthrough tool call round-trips through event stream', async () => {
  // Start stub MCP server as a subprocess
  const stubPath = resolve(__dirname, '../../../spec/fixtures/mcp/stub.mjs');
  
  const result = await queryFull({
    prompt: 'Call the echo tool with the message "hello from test"',
    mcpServers: {
      'test-stub': { command: 'node', args: [stubPath] },
    },
    allowedMcpServerNames: ['test-stub'],
    approvalMode: ApprovalMode.YOLO,
  });

  // Assert at least one tool chunk appears in the event stream
  const toolChunks = result.chunks.filter(c => c.type === 'tool');
  expect(toolChunks.length).toBeGreaterThan(0);
  // Assert the response contains the echo prefix
  expect(result.text).toContain('echo:');
});
```

---

## Fixture Strategy

**Verdict: assert shape at runtime, no golden NDJSON fixture.**

The MCP tool-call round-trip event ordering (tool → tool_result → assistant) matches the existing tool-use-builtin fixture shape. The specific content (tool name, parameters, response) is stub-server-specific and varies. Golden-filing the NDJSON would create a fragile fixture tied to a specific stub invocation.

**Approach:** Integration tests (`sc-1`) spawn the stub server, run a live query, and assert:
1. At least one `tool` chunk appears in the event stream
2. At least one `tool_result` chunk appears paired to it
3. The final `text` output contains the expected canned response prefix (`"echo:"`)
4. No `ProcessCrashError` or `ProcessError` is thrown

`spec/fixtures.manifest.json` is NOT modified. `scripts/capture-fixtures.*` does NOT gain a `--scenario mcp-stdio` branch.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `gemini mcp add --scope project` to configure servers | Direct `GEMINI_CONFIG_DIR` + `settings.json` write | Phase 1 feasibility (2026-04-11) | Per-query isolation is possible without mutation of user config |
| McpServer class in `@modelcontextprotocol/sdk` v0.x | `McpServer` in v1.x with Zod tool registration | 2024-2025 | API is stable; `import { McpServer } from '.../server/mcp.js'` |
| Low-level `Server` class in old SDK | `McpServer` high-level wrapper | 2024 | High-level McpServer preferred for stubs; less boilerplate |

**Deprecated/outdated:**
- Old `Server` class from `@modelcontextprotocol/sdk` pre-1.x: use `McpServer` from `sdk/server/mcp.js` instead.
- `mcp.tool()` decorator in older FastMCP: current API is `@mcp.tool()` returning the value directly.

---

## Open Questions

1. **Is `--allowed-mcp-server-names` positional or strictly named in the real gemini-cli 0.37.1 binary?**
   - What we know: The CLI reference confirms the flag exists with array format (CSV or repeated).
   - What's unclear: Whether 0.37.1 uses the flag name exactly as documented or whether it differs from newer versions.
   - Recommendation: The SC-4 CI test on all three OSes verifies this empirically. If it fails with an unrecognized flag error, capture the actual flag name from `gemini --help` output.

2. **Does the stub server need `--approval-mode yolo` to auto-approve tool calls?**
   - What we know: Phase 8 SC-1 used `approvalMode: ApprovalMode.YOLO` for live tool testing.
   - What's unclear: Whether MCP tool invocation also requires `yolo` mode or whether it's auto-approved differently.
   - Recommendation: Include `approvalMode: ApprovalMode.YOLO` in the SC-1 test to match Phase 8 precedent. If yolo isn't needed, it's harmless.

3. **Python `shutil.rmtree` retry: should it use `anyio.to_thread.run_sync` or `anyio.Path` async wrapper?**
   - What we know: `shutil.rmtree` is synchronous; the async runtime is anyio.
   - What's unclear: Whether wrapping in `anyio.to_thread.run_sync` is needed or whether a sync call in the `finally` is acceptable.
   - Recommendation: Use `anyio.to_thread.run_sync(shutil.rmtree, path, ...)` for consistency with the anyio async pattern. If retry logic is needed, wrap the retry loop in the sync callable passed to `run_sync`.

---

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | Vitest ^3.2 |
| Framework (Python) | pytest |
| Config file (TS) | `ts/vitest.config.ts` |
| Config file (Python) | `python/pyproject.toml` |
| Quick run (TS) | `pnpm --filter ts test run -- ts/src/mcp/` |
| Quick run (Python) | `uv run pytest python/tests/test_mcp_passthrough.py -x` |
| Full suite (TS) | `pnpm --filter ts test run` |
| Full suite (Python) | `uv run pytest python/tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | `mcpServers` option writes temp `settings.json` with correct content | unit | `pnpm --filter ts test run -- ts/src/mcp/writeConfigDir.spec.ts` | ❌ Wave 0 |
| MCP-01 | `--allowed-mcp-server-names` flag emitted as CSV in argv | unit | `pnpm --filter ts test run -- ts/src/query/buildArgv.spec.ts` | ✅ (extend existing) |
| MCP-01 | Tool call round-trips through stub MCP server (SC-1, live) | integration | `RUN_LIVE_E2E=1 pnpm --filter ts test run -- ts/tests-live/` | ❌ Wave 0 (gate: RUN_LIVE_E2E) |
| MCP-02 | Real `~/.gemini/settings.json` mtime unchanged after query with `mcpServers` (SC-2) | integration | `pnpm --filter ts test run -- ts/src/mcp/mcp-passthrough.spec.ts` | ❌ Wave 0 |
| MCP-02 | `env.GEMINI_CONFIG_DIR` + `mcpServers` pre-spawn guard throws `InvalidPromptError` | unit | `pnpm --filter ts test run -- ts/src/query/query.spec.ts` | ✅ (extend existing) |
| MCP-03 | Empty `allowedMcpServerNames` + non-empty `mcpServers` throws `InvalidPromptError` | unit | `pnpm --filter ts test run -- ts/src/query/query.spec.ts` | ✅ (extend existing) |
| MCP-03 | `allowedMcpServerNames: undefined` → no flag in argv | unit | `pnpm --filter ts test run -- ts/src/query/buildArgv.spec.ts` | ✅ (extend existing) |
| MCP-04 | Temp dir removed after success (SC-3 success path) | unit | `pnpm --filter ts test run -- ts/src/mcp/cleanupConfigDir.spec.ts` | ❌ Wave 0 |
| MCP-04 | Temp dir removed after abort (SC-3 abort path) | unit | `pnpm --filter ts test run -- ts/src/mcp/cleanupConfigDir.spec.ts` | ❌ Wave 0 |
| MCP-04 | Temp dir removed after error (SC-3 error path) | unit | `pnpm --filter ts test run -- ts/src/mcp/cleanupConfigDir.spec.ts` | ❌ Wave 0 |
| MCP-04 | Windows EBUSY → warn-and-continue, no re-throw (SC-4) | unit | `pnpm --filter ts test run -- ts/src/mcp/cleanupConfigDir.spec.ts` | ❌ Wave 0 |

Python mirrors must match all test names above per PAR-01 (`diff-test-names.sh`).

### Sampling Rate

- **Per task commit:** `pnpm --filter ts test run -- ts/src/mcp/` + `uv run pytest python/tests/test_mcp_passthrough.py -x`
- **Per wave merge:** `pnpm --filter ts test run` + `uv run pytest python/tests/`
- **Phase gate:** Full suite green on all three OSes before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `ts/src/mcp/writeConfigDir.spec.ts` — covers MCP-01 temp dir creation and settings.json content
- [ ] `ts/src/mcp/cleanupConfigDir.spec.ts` — covers MCP-04 success/abort/error/EBUSY paths
- [ ] `ts/src/mcp/mcp-passthrough.spec.ts` — covers MCP-02 mtime invariant (mock-spawn safe, no live CLI needed)
- [ ] `ts/tests-live/mcp-passthrough.live.spec.ts` — covers SC-1 round-trip (gated: `RUN_LIVE_E2E=1`)
- [ ] `ts/src/mcp/writeConfigDir.ts` — new file
- [ ] `ts/src/mcp/cleanupConfigDir.ts` — new file
- [ ] `ts/src/mcp/index.ts` — barrel
- [ ] `python/src/gemini_sdk/mcp/write_config_dir.py` — new file
- [ ] `python/src/gemini_sdk/mcp/cleanup_config_dir.py` — new file
- [ ] `python/src/gemini_sdk/mcp/__init__.py` — barrel
- [ ] `python/tests/test_mcp_passthrough.py` — covers all MCP-01..04 (Python mirrors)
- [ ] `spec/fixtures/mcp/stub.mjs` — TS stub server
- [ ] `spec/fixtures/mcp/stub.py` — Python stub server
- [ ] `docs/mcp.md` — authored here, published Phase 11
- [ ] Framework installs: `npm install --save-dev @modelcontextprotocol/sdk` + `uv add --dev "mcp[cli]"`

---

## Sources

### Primary (HIGH confidence)

- Phase 1 feasibility verdict `spec/feasibility.md` — `config_dir_verdict: pass` on Windows 0.37.1 — direct empirical evidence
- Phase 1 smoke test `scripts/capture-fixtures.mjs` lines 757–860 — exact `GEMINI_CONFIG_DIR/settings.json` path structure used and confirmed
- `ts/src/process/EnvBuilder.ts` — `GEMINI_CONFIG_DIR` already in ALLOWED_KEYS (line 16)
- `ts/src/query/query.ts` — `writeTempSystemPrompt` pattern (template for `writeConfigDir`)
- `ts/src/query/buildArgv.ts` — `--allowed-tools` CSV branch (template for `--allowed-mcp-server-names`)
- gemini-cli docs `docs/tools/mcp-server.md` (raw GitHub) — `settings.json` mcpServers schema for all three transports
- Node.js docs `fs.html` — `fs.rm` `maxRetries` and `retryDelay` options for EBUSY handling

### Secondary (MEDIUM confidence)

- `@modelcontextprotocol/sdk` npm — version 1.29.0, `McpServer` + `StdioServerTransport` API pattern confirmed
- `mcp` PyPI — version 1.27.0, `FastMCP` + `mcp.run(transport="stdio")` pattern confirmed
- gemini-cli `docs/cli/cli-reference.md` (WebFetch) — `--allowed-mcp-server-names` flag confirmed with CSV format
- GitHub issues #2654, #3406, #13604, #17787, #20694, #23296 — status and impact confirmed via WebFetch

### Tertiary (LOW confidence — document only)

- `deepwiki.com/google-gemini/gemini-cli/2.3-configuration` — config hierarchy corroborates `settings.json` path structure
- `audrey.feldroy.com/articles/2025-07-27-Gemini-CLI-Settings-With-MCP` — real-world settings.json example corroborates format

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new runtime deps; existing Node/Python builtins; test-only deps are official packages
- Architecture: HIGH — Phase 1 spike resolved all three key unknowns; patterns are direct copies of Phase 4/8 precedents
- Pitfalls: HIGH — most pitfalls derived from Phase 1 empirical evidence or existing Phase 5/8 patterns
- Scaffolding shape: HIGH — minimum fragment confirmed sufficient; `.gemini/` subdir tentative overturned
- Upstream fragility map: MEDIUM — issue statuses current as of 2026-04-20; may change if upstream ships fixes

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable; upstream issues are unlikely to change SDK behavior before Phase 9 ships)
