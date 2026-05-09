# Migrating from Codex SDK (Python)

Mapping of 5 top call-site patterns between the OpenAI Codex SDK Python client and `lrilai-gemini-cli-sdk` (import name: `gemini_sdk`).

## Pattern 1 — Construct the client

```diff
- from openai import OpenAI
- client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
+ from gemini_sdk import query
+ # GEMINI_API_KEY picked up from env
```

No client class — `query()` is a module-level async generator. Authentication is env-var-only.

## Pattern 2 — Send a query

```diff
- response = client.chat.completions.create(
-     model="gpt-4o",
-     messages=[{"role": "user", "content": "Hi"}],
- )
+ async for chunk in query(prompt="Hi"):
+     ...
```

`query()` takes a single `prompt` string (wraps headless `gemini-cli -p`). For multi-turn, use `resume_session_id` — see Pattern 5.

## Pattern 3 — Stream chunks

Codex yields OpenAI-style delta chunks. Gemini yields normalized dict variants:

```diff
- for chunk in client.chat.completions.create(stream=True, ...):
-     delta = chunk.choices[0].delta.content or ""
-     print(delta, end="", flush=True)
+ async for chunk in query(prompt=prompt):
+     if chunk["type"] == "assistant":
+         print(chunk["text"], end="", flush=True)
```

## Pattern 4 — Tool use

```diff
- tools = [{"type": "function", "function": {"name": "search", ...}}]
- client.chat.completions.create(messages=messages, tools=tools)
+ async for chunk in query(
+     prompt=prompt,
+     allowed_tools=["read_file"],
+     approval_mode="yolo",
+     # mcp_servers for custom tools — see MCP docs
+ ):
+     ...
```

Caller-defined Python function tools are deferred to v2. Use MCP servers for custom tool logic.

## Pattern 5 — Session / conversation resume

Codex manages conversations server-side via thread IDs. Gemini's session is client-owned:

```diff
- thread = client.beta.threads.create()
- client.beta.threads.messages.create(thread_id=thread.id, role="user", content="turn 1")
- run = client.beta.threads.runs.create(thread_id=thread.id, assistant_id=assistant_id)
+ from gemini_sdk import query, query_full
+
+ first = await query_full(prompt="turn 1")
+ session_id = first["session"]["id"]
+
+ async for chunk in query(prompt="turn 2", resume_session_id=session_id):
+     ...
```

## Key differences

- **Single prompt string** instead of a messages array. Multi-turn via `resume_session_id`.
- **No streaming of function-call arguments** — tool invocations arrive as complete `tool` chunks.
- **No server-side conversation state** — the `session` dict is immutable, identifier-only, and trivially serializable.
- **No model parameter per-call** — the model is configured via `gemini-cli` defaults or `GEMINI_MODEL` env var.
