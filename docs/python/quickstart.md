# Python Quickstart

Drive `gemini-cli` from Python 3.10+ with an async `query()` iterator.

## Prerequisites

- Python 3.10+ (3.13 recommended)
- `gemini-cli` 0.37.x installed on PATH — see [compat matrix](../compat-matrix.md)
- A Gemini API key

## 1. Install gemini-cli

```bash
npm install -g @google/gemini-cli
gemini --version
```

## 2. Install the SDK

```bash
uv add lrilai-gemini-cli-sdk
# or: pip install lrilai-gemini-cli-sdk
```

## 3. Set your API key

```bash
export GEMINI_API_KEY="your-key-from-ai.google.dev"
```

`GEMINI_API_KEY` is the canonical fallback, but if you are already authenticated via `gemini auth login` or `gcloud auth application-default login`, the SDK will automatically use your CLI session. See the auth reference for Vertex AI alternatives.

## 4. Your first `query()`

```python
import anyio
from gemini_sdk import query

async def main():
    async for chunk in query(prompt="Say hello"):
        if chunk["type"] == "assistant":
            print(chunk["text"], end="", flush=True)

anyio.run(main)
```

## 5. Multi-turn session

```python
import anyio
from gemini_sdk import query, query_full

async def main():
    first = await query_full(prompt="Remember the number 7.")
    session_id = first["session"]["id"]

    async for chunk in query(prompt="What number did I just say?", resume_session_id=session_id):
        if chunk["type"] == "assistant":
            print(chunk["text"], end="", flush=True)

anyio.run(main)
```

## 6. Your first MCP server

```python
import anyio
from gemini_sdk import query

async def main():
    async for chunk in query(
        prompt="Use the time tool to report current UTC.",
        mcp_servers={"time": {"command": "node", "args": ["./time-mcp-server.js"]}},
        allowed_mcp_server_names=["time"],
    ):
        print(chunk)

anyio.run(main)
```

The SDK writes a temp `settings.json` in an isolated `GEMINI_CONFIG_DIR` for the query and cleans up on exit — your real `~/.gemini/settings.json` is never touched.

## Next steps

- [API reference](/python/api/)
- [Migration guides](./migration-claude.md) — Claude Agent SDK / Codex SDK
