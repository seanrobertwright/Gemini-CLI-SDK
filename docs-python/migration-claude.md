# Migrating from Claude Agent SDK (Python)

This guide maps the top 5 call-site patterns between the Claude Agent SDK Python client and `gemini-sdk`.

## Pattern 1 — Construct the client

| Claude | Gemini |
|--------|--------|
| `client = ClaudeAgentClient(api_key=...)` | No client class — `query()` is a module-level async generator. Pass `GEMINI_API_KEY` via env. |

```diff
- from anthropic import ClaudeAgentClient
- client = ClaudeAgentClient(api_key=os.environ["ANTHROPIC_API_KEY"])
+ from gemini_sdk import query
+ # os.environ["GEMINI_API_KEY"] is picked up automatically
```

## Pattern 2 — Send a query

```diff
- async for chunk in client.send_query(prompt="Hi"):
-     ...
+ async for chunk in query(prompt="Hi"):
+     ...
```

## Pattern 3 — Stream chunks

Both SDKs yield dict-shaped chunks. Discriminate on `chunk["type"]`:

```python
from gemini_sdk import query

async for chunk in query(prompt="Hello"):
    match chunk["type"]:
        case "assistant":
            print(chunk["text"], end="", flush=True)
        case "tool":
            print(f"[tool] {chunk['tool_name']} — {chunk['input']}")
        case "result":
            print(f"[done] {chunk['usage']}")
```

The 8-variant chunk union (`assistant | system | thinking | result | rate_limit | tool | tool_result | workflow_dispatch`) is identical between the TS and Python SDKs.

## Pattern 4 — Tool use

| Claude | Gemini |
|--------|--------|
| `tools=[my_tool]` (caller-defined functions in v1) | `allowed_tools=["read_file"]` + MCP passthrough. Caller-defined Python tools deferred to v2 (see Known Issues #13388). |

```diff
- async for chunk in client.send_query(
-     prompt=prompt,
-     tools=[my_custom_tool],
- ):
-     ...
+ async for chunk in query(
+     prompt=prompt,
+     allowed_tools=["read_file"],
+     approval_mode="yolo",
+     mcp_servers={"my-server": {"command": "node", "args": ["./server.js"]}},
+ ):
+     ...
```

## Pattern 5 — Session resume

```diff
- session = await client.create_session()
- async for chunk in client.send_query(prompt=prompt, session_id=session.id):
-     ...
+ from gemini_sdk import query, query_full
+
+ first = await query_full(prompt="turn 1")
+ session_id = first["session"]["id"]
+
+ async for chunk in query(prompt="turn 2", resume_session_id=session_id):
+     ...
```

## Key differences

- **No client construction step.** `query()` reads `GEMINI_API_KEY` from the environment directly.
- **Caller-defined tools deferred to v2.** Use MCP servers for custom tool logic.
- **Approval mode vocabulary differs:** Gemini uses `default | auto_edit | yolo | plan` (maps to `gemini-cli --approval-mode`).
- **Session is identifier-only.** The `session` dict is immutable and trivially serializable — no server-side session state to clean up.
