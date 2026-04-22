# Migrating from Claude Agent SDK

This is not a full API cross-reference — those rot quickly. Instead, here are the top 5 call-site patterns mapped between `@anthropic-ai/claude-agent-sdk` and `@gemini-sdk/core`.

## Pattern 1 — Construct the client

| Claude | Gemini |
|--------|--------|
| `const client = new ClaudeAgentClient({ apiKey })` | No client class — `query()` is a module-level function. Pass `GEMINI_API_KEY` via env. |

```diff
- import { ClaudeAgentClient } from '@anthropic-ai/claude-agent-sdk';
- const client = new ClaudeAgentClient({ apiKey: process.env.ANTHROPIC_API_KEY });
+ import { query } from '@gemini-sdk/core';
+ // process.env.GEMINI_API_KEY is picked up automatically
```

## Pattern 2 — Send a query

```diff
- for await (const chunk of client.sendQuery({ prompt: 'Hi' })) { ... }
+ for await (const chunk of query({ prompt: 'Hi' })) { ... }
```

## Pattern 3 — Stream chunks

Both SDKs emit the same 8-variant `MessageChunk` union (`assistant | system | thinking | result | rate_limit | tool | tool_result | workflow_dispatch`). Discriminate on `chunk.type`.

```typescript
for await (const chunk of query({ prompt })) {
  switch (chunk.type) {
    case 'assistant': process.stdout.write(chunk.text); break;
    case 'tool': console.log('[tool]', chunk.toolName, chunk.input); break;
    case 'result': console.log('[done]', chunk.usage); break;
  }
}
```

## Pattern 4 — Tool use

| Claude | Gemini |
|--------|--------|
| `tools: [myTool]` (caller-defined tools allowed in v1) | `allowedTools: ['read_file']` + MCP passthrough. Caller-defined JS tools deferred to v2 (see Known Issues #13388). |

```diff
- for await (const chunk of client.sendQuery({
-   prompt,
-   tools: [myCustomTool],
- })) { ... }
+ for await (const chunk of query({
+   prompt,
+   allowedTools: ['read_file'],
+   approvalMode: 'yolo',
+   mcpServers: { /* register MCP server for custom tools */ },
+ })) { ... }
```

## Pattern 5 — Session resume

```diff
- const session = await client.createSession();
- for await (const chunk of client.sendQuery({ prompt, sessionId: session.id })) { ... }
+ import { queryFull, query } from '@gemini-sdk/core';
+ const first = await queryFull({ prompt: 'turn 1' });
+ for await (const chunk of query({ prompt: 'turn 2', resumeSessionId: first.session.id })) { ... }
```

## Key differences

- **No client construction step.** `query()` is stateless; auth comes from env.
- **Caller-defined tools deferred to v2.** Use MCP servers for custom tool logic (see [MCP passthrough docs](./api/)).
- **Approval mode vocabulary differs:** Gemini uses `default | auto_edit | yolo | plan` (maps to `gemini-cli --approval-mode`), not Claude's `permissionMode` names.
