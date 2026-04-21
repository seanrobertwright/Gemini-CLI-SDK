# Phase 9 MCP Stub Servers

Two tiny stub MCP servers used by the Phase 9 live integration tests.
Both implement a single `echo` tool over stdio transport:

- **`stub.mjs`** -- Node, uses `@modelcontextprotocol/sdk`. Run: `node stub.mjs`.
- **`stub.py`** -- Python, uses `mcp` (FastMCP). Run: `python stub.py`.

Both return `"echo: <message>"` for any input.

## Purpose

These stubs exist so SC-1 (MCP tool-call round-trip through the event stream)
can be exercised against a fully deterministic MCP server -- no flaky external
services, no API costs, no hand-rolled JSON-RPC. Using the official SDK
packages guarantees protocol compliance with whatever version of gemini-cli
is pinned in `.gemini-cli-compat`.

## Wiring in Tests

```typescript
await queryFull({
  prompt: 'Call the echo tool with "hello".',
  mcpServers: { 'test-stub': { command: 'node', args: ['spec/fixtures/mcp/stub.mjs'] } },
  allowedMcpServerNames: ['test-stub'],
  approvalMode: ApprovalMode.YOLO,
});
```

## Diagnostics

Never use `console.log()` / `print()` in the stubs -- those corrupt the
JSON-RPC stdout framing. All diagnostic output goes to stderr.
