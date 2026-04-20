# Tools + Approval Mode

Phase 8 adds two `QueryOptions` fields that flow directly to `gemini-cli` flags:

- `allowedTools` / `allowed_tools` → `--allowed-tools <csv>` (TOL-01)
- `approvalMode` / `approval_mode` → `--approval-mode <mode>` (TOL-02)

The SDK is a transparent wrapper: unknown tool names pass through, and `gemini-cli` is the source of truth on which tools exist and how approval modes behave.

## Quick Start

**TypeScript:**

```typescript
import { query, ApprovalMode } from '@gemini-sdk/core';

for await (const chunk of query({
  prompt: 'read the README and summarize',
  allowedTools: ['read_file'],
  approvalMode: ApprovalMode.YOLO,
})) {
  console.log(chunk);
}
```

**Python:**

```python
from gemini_sdk import query, ApprovalMode

async for chunk in query({
    "prompt": "read the README and summarize",
    "allowed_tools": ["read_file"],
    "approval_mode": ApprovalMode.YOLO,
}):
    print(chunk)
```

## `allowedTools` / `allowed_tools`

A list of tool names to whitelist via `--allowed-tools`. The SDK CSV-joins the list at the argv boundary.

| Input                          | Emitted argv                            |
| ------------------------------ | --------------------------------------- |
| `['read_file', 'write_file']`  | `--allowed-tools read_file,write_file`  |
| `['read_file']`                | `--allowed-tools read_file`             |
| `[]` (empty array)             | (flag omitted)                          |
| `undefined` / absent           | (flag omitted)                          |

Empty array and absence behave identically — this avoids the footgun where a caller filters a list down to empty and accidentally disables everything.

The SDK does **not** validate names against any internal enum. Unknown tool names pass through; the subprocess is the source of truth. This mirrors the `model` raw-string escape hatch (MDL-02) and keeps the SDK forward-compatible with new tools added upstream.

## `approvalMode` / `approval_mode`

Controls the `--approval-mode` flag. Four known values map to the upstream CLI modes:

| Value         | Behavior                                                    |
| ------------- | ----------------------------------------------------------- |
| `'default'`   | gemini-cli's own default. May prompt in non-TTY contexts.   |
| `'auto_edit'` | Edits auto-approve; other actions prompt.                   |
| `'yolo'`      | All actions auto-approve. Use for headless automation.      |
| `'plan'`      | Produces a plan; NO filesystem mutations occur.             |

Raw strings are accepted for forward compatibility:

```typescript
query({ prompt: '...', approvalMode: 'some-future-mode' });  // passes through
```

When `approvalMode` is unset, the flag is omitted entirely and gemini-cli's own default applies.

## Caller-Defined Custom Tools — NOT supported in v1 (TOL-04)

The SDK does **not** support caller-defined custom tools in v1.0. `QueryOptions` has no `customTools` or `tools.customDefinitions` field. Only:

1. **Built-in `gemini-cli` tools** (read_file, write_file, shell, etc.) are available via `allowedTools`.
2. **MCP server passthrough** (Phase 9) — external tool servers you launch yourself and expose to gemini-cli via `options.mcpServers`.

Caller-defined tool functions (Claude-Agent-SDK-style JavaScript/Python callbacks) require a stub MCP bridge + hook infrastructure. Tracked as v2 requirements CTL-01..03.

## Policy Engine Migration (TOL-03)

`--allowed-tools` was deprecated in `gemini-cli` 0.30.0 (2026-02-25) in favor of the Policy Engine (`--policy` flag with TOML rule files). The SDK is pinned to the `.gemini-cli-compat` version range (0.37.1 today), where `--allowed-tools` still works.

**SDK strategy:** Emit `--allowed-tools` unconditionally for the pinned range. Phase 11's `gemini --version` compat probe (REL-06) warns users when their installed CLI is outside the tested range. No runtime `--help` probe, no dual-emit, no silent fallback.

When the upstream rename lands, a patch release bumps `.gemini-cli-compat` and swaps the flag name in `buildArgv`. The compat probe warns users still on an old CLI.

## Known Issues

### `--allowed-tools` can fail with "denied by policy" in headless mode

Gemini CLI issue [#16012](https://github.com/google-gemini/gemini-cli/issues/16012) reports that `--allowed-tools` may be denied by the Policy Engine itself in non-interactive (`-p`) mode on certain versions. The SDK emits the flag as documented; if the subprocess rejects it, the error surfaces as a typed `GeminiError` via the standard `ErrorMapper` pipeline.

Workaround: pin to a known-good `gemini-cli` version via the compat matrix, or use `approvalMode: 'yolo'` plus explicit `allowedTools` filtering.

### `approvalMode: 'default'` blocks on approval prompts in non-TTY contexts

gemini-cli's default mode surfaces approval prompts interactively. In a non-TTY SDK context (headless `-p`), prompts have nowhere to go and the subprocess may stall. Use `'auto_edit'`, `'yolo'`, or `'plan'` for automation.

## Contributors: Live E2E Suite

Phase 8 ships an opt-in live integration test suite at `ts/tests-live/e2e.live.spec.ts`
that spawns a real `gemini-cli` to verify CLI-level enforcement of `allowedTools` and
`approvalMode`. It is **not** part of the default `pnpm test` run.

To execute it locally:

```bash
cd ts
RUN_LIVE_E2E=1 GEMINI_API_KEY=sk-... pnpm test:live
```

Both env vars are required — missing either one skips (does not fail) all tests in the
suite. See [`ts/tests-live/README.md`](../ts/tests-live/README.md) for sandbox behavior,
cost estimates, and CI guidance.

## See Also

- [docs/structured-output.md](./structured-output.md) — best-effort JSON schema via `outputSchema`
- [docs/auth.md](./auth.md) — auth environment setup (Phase 6)
- [gemini-cli CLI reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md) — upstream flag docs
- [gemini-cli Policy Engine](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md) — `--policy` replacement
