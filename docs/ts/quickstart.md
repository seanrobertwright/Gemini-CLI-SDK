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

Pick whichever package manager your project uses — they all install the same package:

```bash
# npm
npm install @lrilai/gemini-cli-sdk

# pnpm
pnpm add @lrilai/gemini-cli-sdk

# bun
bun add @lrilai/gemini-cli-sdk

# yarn
yarn add @lrilai/gemini-cli-sdk
```

Requires Node 18+. The package ships compiled ESM (`dist/index.js`) plus `.d.ts` types — no build step needed in your project.

> **Tip — don't mix package managers in one project.** If your `node_modules` was previously populated by a different tool, npm's resolver can crash with `Cannot read properties of null (reading 'matches')`. Stick to one package manager per project, or delete `node_modules` and the foreign lockfile before switching.

## 3. Set your API key

```bash
export GEMINI_API_KEY="your-key-from-ai.google.dev"
```

`GEMINI_API_KEY` is the canonical fallback, but if you are already authenticated via `gemini auth login` or `gcloud auth application-default login`, the SDK will automatically use your CLI session. Vertex AI is also supported — see the auth reference.

## 4. Your first `query()`

```typescript
import { query } from '@lrilai/gemini-cli-sdk';

for await (const chunk of query({ prompt: 'Say hello' })) {
  if (chunk.type === 'assistant') {
    process.stdout.write(chunk.text);
  }
}
```

## 5. Multi-turn session

```typescript
import { queryFull, query } from '@lrilai/gemini-cli-sdk';

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
import { query } from '@lrilai/gemini-cli-sdk';

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

## 7. Use it as a provider in Archon

If you're plugging Gemini into [coleam00/Archon](https://github.com/coleam00/Archon) as a third assistant alongside Claude and Codex, install the SDK inside the Archon `packages/providers` workspace and follow the bundle steps in the [Archon integration guide](../archon-integration.md):

```bash
cd packages/providers
bun add @lrilai/gemini-cli-sdk
```

Then in your Archon `.env`:

```bash
DEFAULT_AI_ASSISTANT=gemini
GEMINI_API_KEY=your-key-from-ai.google.dev
```

The SDK exposes only `GEMINI_*` and `GEMINI_SDK_*` env vars, so it never collides with Archon's existing Claude/Codex configuration.

## Next steps

- [API reference](./api/)
- [Migration from Claude Agent SDK](./migration-claude.md)
- [Migration from Codex SDK](./migration-codex.md)
- [Archon integration](../archon-integration.md) — full provider bundle instructions
