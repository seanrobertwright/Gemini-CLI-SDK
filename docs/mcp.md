# MCP Passthrough (Experimental)

Phase 9 adds two `QueryOptions` fields that let callers pass Model Context
Protocol (MCP) server configuration through to `gemini-cli` without
ever touching the user's real `~/.gemini/settings.json`:

- `mcpServers` / `mcp_servers` -- map of server name to server config (MCP-01)
- `allowedMcpServerNames` / `allowed_mcp_server_names` -- whitelist (MCP-03)

The SDK writes a temp `settings.json` containing only `{ "mcpServers": ... }`
into a per-query isolated `GEMINI_CONFIG_DIR` (MCP-02), gates which servers
are active via `--allowed-mcp-server-names` (MCP-03), and cleans up the
temp dir in `finally` -- even on abort, error, or Windows MCP grandchild
holding a file handle (MCP-04).

> **@experimental** -- MCP behavior depends on upstream `gemini-cli`
> which has several known-fragile paths (see **Known Limitations** below).
> API shape is stable but subprocess-level behavior may change with CLI
> updates.

## Known Limitations

The SDK passes MCP server configs through verbatim. When upstream has a
bug, the SDK documents it here rather than hiding it with a workaround.

| Issue | Impact | SDK action |
|-------|--------|-----------|
| [#2654](https://github.com/google-gemini/gemini-cli/issues/2654) | MCP tool with `"type": ["string", "number"]` params crashes gemini-cli | Pass-through; crash surfaces as `ProcessCrashError` via ErrorMapper |
| [#3406](https://github.com/google-gemini/gemini-cli/issues/3406) | Historical "server not detected" on macOS (old version) | Confirmed resolved on the pinned version via Phase 1 feasibility spike |
| [#20694](https://github.com/google-gemini/gemini-cli/issues/20694) | `gemini mcp enable` config parsing (fixed in #21184) | Irrelevant -- SDK does not use `gemini mcp enable` |
| [#13604](https://github.com/google-gemini/gemini-cli/issues/13604) | Windows MCP grandchild (npx) retains file handles on cleanup | **SDK mitigates:** `fs.rm({maxRetries:3, retryDelay:200})` + Python manual retry; warns on persistent failure, never re-throws |
| [#17787](https://github.com/google-gemini/gemini-cli/issues/17787) | gemini-cli ignores per-server MCP `timeout` field (hardcoded 60s) | Pass-through; document only |
| [#23296](https://github.com/google-gemini/gemini-cli/issues/23296) | HTTP MCP OAuth token refresh fails mid-session | Pass-through; use long-lived bearer tokens |
| [#23776](https://github.com/google-gemini/gemini-cli/issues/23776) | HTTP MCP static bearer-token injection (companion to #23296) | Pass-through; document only |

## Quick Start

**TypeScript (stdio server):**

```typescript
import { queryFull, ApprovalMode } from '@gemini-sdk/core';

const result = await queryFull({
  prompt: 'Call the echo tool with "hi".',
  mcpServers: {
    'my-server': { command: 'node', args: ['./mcp-servers/my-server.mjs'] },
  },
  allowedMcpServerNames: ['my-server'],
  approvalMode: ApprovalMode.YOLO,
});
```

**Python (stdio server):**

```python
from gemini_sdk import query_full, ApprovalMode

result = await query_full({
    "prompt": 'Call the echo tool with "hi".',
    "mcp_servers": {
        "my-server": {"command": "python", "args": ["./mcp-servers/my-server.py"]},
    },
    "allowed_mcp_server_names": ["my-server"],
    "approval_mode": ApprovalMode.YOLO,
})
```

## `mcpServers` / `mcp_servers`

A map of server name to raw server config. The SDK JSON-stringifies the value
verbatim into a temp `settings.json` -- no shape validation, no transport
discrimination. Forward-compatible with any upstream transport change.

Supported transports (from upstream):

| Transport | Required fields | Example |
|-----------|-----------------|---------|
| stdio     | `command`, `args`? | `{command: 'node', args: ['stub.mjs']}` |
| http      | `httpUrl`       | `{httpUrl: 'http://localhost:3000/mcp', headers: {...}}` |
| sse       | `url`           | `{url: 'https://example.com/sse'}` |

| Input | Behavior |
|-------|----------|
| `undefined` / absent | No temp dir created; flag omitted |
| `{}` (empty map)     | Same as absent -- no temp dir, no flag |
| Non-empty            | Temp dir created; `--allowed-mcp-server-names` REQUIRED |

## `allowedMcpServerNames` / `allowed_mcp_server_names`

A whitelist of server names gemini-cli may use. CSV-joined at the argv
boundary as `--allowed-mcp-server-names <csv>`.

| Input | Emitted argv |
|-------|--------------|
| `['a', 'b']` | `--allowed-mcp-server-names a,b` |
| `['only']`   | `--allowed-mcp-server-names only` |
| `[]`         | (flag omitted) |
| absent       | (flag omitted) |

**Required when `mcpServers` is non-empty.** Setting `mcpServers` without
`allowedMcpServerNames` throws `InvalidPromptError` pre-spawn (MCP-03),
because gemini-cli silently ignores servers not in this whitelist and the
resulting "my server did nothing" silence is a common footgun.

## Isolation Guarantee (MCP-02)

**The SDK never mutates `~/.gemini/settings.json`.** For every call with a
non-empty `mcpServers`, the SDK:

1. Creates a fresh temp dir named `gemini-sdk-mcp-<hex>` inside `os.tmpdir()`
2. Writes `settings.json` containing only `{ "mcpServers": <your verbatim input> }`
3. Sets `GEMINI_CONFIG_DIR` on the subprocess env to the temp dir path
4. Removes the temp dir in `finally` (success, abort, or error paths)

Attempting to combine `mcpServers` with `env.GEMINI_CONFIG_DIR` throws
`InvalidPromptError` pre-spawn -- the SDK owns that env var whenever
`mcpServers` is set.

## Cleanup Semantics (MCP-04)

- **Success path:** `await fs.rm(tempDir, { recursive, force })` -- blocks
  until disk is clean before `query()` resolves.
- **Abort / error path:** same `fs.rm` with `maxRetries: 3, retryDelay: 200`
  (Node's native Windows EBUSY tolerance). Python uses a manual retry loop
  around `shutil.rmtree` with identical timing.
- **If cleanup still fails after retries:** the SDK emits a
  `console.warn` / `warnings.warn` with the stranded path and returns
  normally. **Cleanup never re-throws** -- masking the original error the
  caller is handling in a finally block is worse than leaking a temp dir.

## See Also

- [docs/tools.md](./tools.md) -- built-in tools + `--allowed-tools` (prerequisite for letting MCP servers actually execute tool calls)
- [docs/structured-output.md](./structured-output.md) -- another `@experimental` feature with an upstream-fragility story
- [gemini-cli configuration docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md) -- upstream `mcpServers` schema
- [gemini-cli CLI reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md) -- `--allowed-mcp-server-names` flag
- [Model Context Protocol spec](https://modelcontextprotocol.io/specification) -- protocol details

## Contributors: Live E2E Suite

Phase 9 ships an opt-in live integration test suite at
`ts/tests-live/mcp-passthrough.live.spec.ts`. Gated by `RUN_LIVE_E2E=1`
and `GEMINI_API_KEY`. See [`ts/tests-live/README.md`](../ts/tests-live/README.md)
for run instructions and cost estimates.
