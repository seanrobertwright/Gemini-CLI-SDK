# TypeScript Quickstart

Drive `gemini-cli` from TypeScript with a streaming `query()` generator.

## Prerequisites

- Node.js 18+ (20 or 22 recommended)
- `gemini-cli` 0.37.x installed on PATH — **not bundled**, see [compat matrix](../compat-matrix.md)
- A Gemini API key

## 1. Install gemini-cli (runtime prerequisite)

```bash
npm install -g @google/gemini-cli
gemini --version  # should print 0.37.x
```

The SDK does not bundle or auto-install `gemini-cli`. See the [compat matrix](../compat-matrix.md) for supported versions.

## 2. Install the SDK

```bash
npm install @gemini-sdk/core
```

## 3. Set your API key

```bash
export GEMINI_API_KEY="your-key-from-ai.google.dev"
```

`GEMINI_API_KEY` is the canonical default. Vertex AI via `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_API_KEY` is also supported — see the auth reference.

## 4. Your first `query()`

```typescript
import { query } from '@gemini-sdk/core';

for await (const chunk of query({ prompt: 'Say hello' })) {
  if (chunk.type === 'assistant') {
    process.stdout.write(chunk.text);
  }
}
```

## 5. Multi-turn session

```typescript
import { queryFull, query } from '@gemini-sdk/core';

const first = await queryFull({ prompt: 'Remember the number 7.' });
const session = first.session;  // captured from init event

for await (const chunk of query({
  prompt: 'What number did I just say?',
  resumeSessionId: session.id,
})) {
  if (chunk.type === 'assistant') process.stdout.write(chunk.text);
}
```

## 6. Your first MCP server

```typescript
import { query } from '@gemini-sdk/core';

for await (const chunk of query({
  prompt: 'Use the time tool to report current UTC.',
  mcpServers: {
    time: { command: 'node', args: ['./time-mcp-server.js'] },
  },
  allowedMcpServerNames: ['time'],
})) {
  console.log(chunk);
}
```

The SDK writes a temp `settings.json` in an isolated `GEMINI_CONFIG_DIR` for the query and cleans up in `finally` — your real `~/.gemini/settings.json` is never touched.

## Next steps

- [API reference](./api/)
- [Migration from Claude Agent SDK](./migration-claude.md)
- [Migration from Codex SDK](./migration-codex.md)
- [Archon integration](../archon-integration.md)
