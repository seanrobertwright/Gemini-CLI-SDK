# Gemini CLI SDK

TypeScript and Python SDK for driving [`gemini-cli`](https://github.com/google-gemini/gemini-cli) programmatically. Mirrors the shape of `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk` so you can swap providers without rewiring your application.

[![npm](https://img.shields.io/npm/v/@lrilai/gemini-cli-sdk)](https://www.npmjs.com/package/@lrilai/gemini-cli-sdk)
[![PyPI](https://img.shields.io/pypi/v/lrilai-gemini-cli-sdk)](https://pypi.org/project/lrilai-gemini-cli-sdk/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quickstart](#quickstart)
  - [TypeScript](#typescript)
  - [Python](#python)
- [Multi-turn sessions](#multi-turn-sessions)
- [Authentication](#authentication)
- [MCP passthrough](#mcp-passthrough-experimental)
- [Structured output](#structured-output-experimental)
- [Archon integration](#archon-integration)
- [Error handling](#error-handling)
- [Compatibility](#compatibility)
- [Contributing](#contributing)

---

## Features

- **Subprocess-based** — wraps `gemini-cli` via `child_process` (TS) / `anyio` (Python); no library entry point required
- **Streaming-first** — `query()` is an async generator yielding typed `MessageChunk` events
- **Convenience wrapper** — `queryFull()` / `query_full()` accumulates chunks into a single result object
- **Session resume** — multi-turn conversations via `--resume` with automatic fallback to transcript injection
- **MCP passthrough** — inject Model Context Protocol servers per-query without touching `~/.gemini/settings.json`
- **Structured output** — best-effort JSON schema validation with one automatic retry
- **Auth chain** — four auth modes with documented precedence; no interactive prompts in headless contexts
- **Archon-ready** — ships an `IAssistantClient` adapter enabling `DEFAULT_AI_ASSISTANT=gemini` in [Archon](https://github.com/coleam00/Archon)
- **Parity-enforced** — TypeScript and Python consume the same fixture corpus in CI

---

## Prerequisites

| Dependency | Version | Notes |
|-----------|---------|-------|
| [`gemini-cli`](https://github.com/google-gemini/gemini-cli) | `0.37.x` | Install separately — not bundled |
| Node.js | `>=18` (20 or 22 recommended) | TypeScript SDK only |
| Python | `>=3.10` | Python SDK only |

Install `gemini-cli` first:

```bash
npm install -g @google/gemini-cli
gemini --version  # should print 0.37.x
```

---

## Installation

**TypeScript**

```bash
npm install @lrilai/gemini-cli-sdk
```

**Python**

```bash
pip install lrilai-gemini-cli-sdk
```

---

## Quickstart

### TypeScript

#### Streaming response

```typescript
import { query } from '@lrilai/gemini-cli-sdk';

for await (const chunk of query({ prompt: 'Explain async generators in one paragraph.' })) {
  if (chunk.type === 'assistant') {
    process.stdout.write(chunk.content);
  }
}
```

#### Accumulated result

```typescript
import { queryFull } from '@lrilai/gemini-cli-sdk';

const result = await queryFull({ prompt: 'What is the capital of France?' });
console.log(result.text);     // "Paris"
console.log(result.sessionId); // session ID for resume
```

### Python

#### Streaming response

```python
import asyncio
from gemini_sdk import query

async def main():
    async for chunk in query(prompt="Explain async generators in one paragraph."):
        if chunk["type"] == "assistant":
            print(chunk["content"], end="", flush=True)

asyncio.run(main())
```

#### Accumulated result

```python
import asyncio
from gemini_sdk import query_full

async def main():
    result = await query_full(prompt="What is the capital of France?")
    print(result.text)
    print(result.session_id)

asyncio.run(main())
```

---

## Multi-turn sessions

Pass the `Session` object returned by `queryFull()` / `query_full()` directly into the next call.

**TypeScript**

```typescript
import { queryFull, query } from '@lrilai/gemini-cli-sdk';

const first = await queryFull({ prompt: 'Remember the number 7.' });

for await (const chunk of query({
  prompt: 'What number did I ask you to remember?',
  session: first.session,  // resumes via --resume <sessionId>
})) {
  if (chunk.type === 'assistant') process.stdout.write(chunk.content);
}
```

**Python**

```python
import asyncio
from gemini_sdk import query_full, query

async def main():
    first = await query_full(prompt="Remember the number 7.")

    async for chunk in query(
        prompt="What number did I ask you to remember?",
        session=first.session,
    ):
        if chunk["type"] == "assistant":
            print(chunk["content"], end="", flush=True)

asyncio.run(main())
```

You can also pass a bare session ID string when restoring a session from storage:

```typescript
const result = await queryFull({ prompt: 'Next question.', session: 'abc-123-session-id' });
```

---

## Authentication

The SDK does not implement its own auth layer — it passes credentials through to `gemini-cli`. Set one of the following environment variables before running:

| Variable | Auth mode | Notes |
|----------|----------|-------|
| `GEMINI_API_KEY` | Gemini API key | **Default. Recommended for headless/SDK use.** |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI service account | Path to JSON key file |
| `GOOGLE_API_KEY` | Vertex AI alternative | Alternative Vertex path |
| *(none)* | ADC / Sign-in-with-Google | Interactive; not recommended for automation |

**Precedence** (highest to lowest): ADC (CLI Auth) → `GEMINI_API_KEY` → `GOOGLE_APPLICATION_CREDENTIALS` → `GOOGLE_API_KEY`.

If more than one is set, the SDK emits a single warning naming the winner and reprinting the full chain. The SDK never calls `gemini auth login` or any interactive OAuth flow.

```bash
export GEMINI_API_KEY="your-key-from-ai.google.dev"
```

For Vertex AI, also set project/region if needed:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
export GOOGLE_CLOUD_PROJECT="my-project"
export GOOGLE_CLOUD_LOCATION="us-central1"
```

---

## MCP passthrough *(experimental)*

Inject [Model Context Protocol](https://modelcontextprotocol.io/) servers into a single query without touching your real `~/.gemini/settings.json`. The SDK writes a temp `settings.json` into an isolated `GEMINI_CONFIG_DIR` and cleans it up in `finally`.

```typescript
import { query } from '@lrilai/gemini-cli-sdk';

for await (const chunk of query({
  prompt: 'Use the time tool to report the current UTC time.',
  mcpServers: {
    time: { command: 'node', args: ['./time-mcp-server.js'] },
  },
  allowedMcpServerNames: ['time'],  // required when mcpServers is set
})) {
  console.log(chunk);
}
```

> **Note:** `allowedMcpServerNames` is required when `mcpServers` is set. Omitting it throws `InvalidPromptError` before the subprocess spawns. See [docs/mcp.md](docs/mcp.md) for known limitations.

---

## Structured output *(experimental)*

Pass a JSON Schema to `queryFull()` / `query_full()`. The SDK injects the schema into the system prompt, validates the response, and retries once on failure.

```typescript
import { queryFull } from '@lrilai/gemini-cli-sdk';

const result = await queryFull({
  prompt: 'What is the capital of France? Respond as JSON.',
  outputSchema: {
    type: 'object',
    properties: {
      capital: { type: 'string' },
      country: { type: 'string' },
    },
    required: ['capital', 'country'],
  },
});

console.log(result.structured); // { capital: 'Paris', country: 'France' }
console.log(result.text);       // raw assistant text (always available)
```

Only supported on `queryFull()` — calling `query()` or `queryRaw()` with `outputSchema` throws `UnsupportedFeatureError` immediately. See [docs/structured-output.md](docs/structured-output.md) for caveats.

---

## Archon integration

The `@lrilai/adapter-archon` package implements Archon's `IAssistantClient` interface, enabling Gemini as a first-class provider alongside Claude and Codex.

Set in your Archon `.env`:

```bash
DEFAULT_AI_ASSISTANT=gemini
GEMINI_API_KEY=your-key-here
```

Then apply the adapter bundle from `.planning/phases/10-archon-adapter-ts-only/pr-artifacts/` to your Archon fork. Full instructions: [docs/archon-integration.md](docs/archon-integration.md).

> The Archon `dev` branch is the integration target. Branch from `dev`, not `main`.

---

## Error handling

All SDK errors extend `GeminiError`. Each error carries a `bucket` (for Archon routing) and a `retryable` flag.

| Class | Bucket | Retryable | Cause |
|-------|--------|-----------|-------|
| `GeminiError` | `unknown` | No | Base class |
| `RateLimitError` | `rate_limit` | Yes | 429 / quota exceeded |
| `AuthError` | `auth` | No | Auth misconfiguration |
| `NotConfigured` | `auth` | No | No auth variable set |
| `Forbidden403` | `auth` | No | API key lacks permission |
| `ModelAccessError` | `model_access` | No | Model not available |
| `ProcessError` | `crash` | No | Subprocess crashed |
| `ProcessCrashError` | `crash` | No | Non-zero exit |
| `AbortError` | `crash` | No | `AbortSignal` fired |
| `InvalidPromptError` | `crash` | No | Bad option combination |
| `UnsupportedFeatureError` | `crash` | No | Feature not available |
| `SchemaValidationError` | `crash` | No | Structured output failed after retry |

```typescript
import { query, RateLimitError, AuthError } from '@lrilai/gemini-cli-sdk';

try {
  for await (const chunk of query({ prompt: 'Hello' })) { /* ... */ }
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${err.retryAfterMs}ms`);
  } else if (err instanceof AuthError) {
    console.error('Auth failed — check GEMINI_API_KEY');
  } else {
    throw err;
  }
}
```

---

## Compatibility

| Component | Tested range | CI enforcement |
|-----------|-------------|----------------|
| `gemini-cli` | `0.37.x` | Pinned in `.gemini-cli-compat` |
| Node.js | 18, 20, 22 | Matrix job per release |
| Python | 3.10, 3.11, 3.12, 3.13 | Matrix job per release |
| Platforms | Windows, macOS, Linux | Windows is a hard-required job |

On the first `query()` call per process, the SDK spawns `gemini --version` once and validates the version against the pinned range. Control this with:

```bash
# Default: warn and continue
# GEMINI_SDK_COMPAT=strict  → throw on version mismatch
# GEMINI_SDK_COMPAT=silent  → suppress the warning
export GEMINI_SDK_COMPAT=strict
```

---

## Contributing

```bash
# Clone and install
git clone https://github.com/seanrobertwright/Gemini-CLI-SDK.git
cd Gemini-CLI-SDK
pnpm install

# Run TypeScript tests
cd ts && pnpm test

# Run Python tests
cd python && pip install -e ".[dev]" && pytest

# Validate fixtures
pnpm validate:all
```

Contributions welcome. Please open an issue before submitting a large PR.

---

MIT License — see [LICENSE](LICENSE).
