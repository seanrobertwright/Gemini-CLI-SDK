# Migrating from Codex SDK

Mapping of 5 top call-site patterns between `@openai/codex-sdk` and `@lrilai/gemini-cli-sdk`.

## Pattern 1 — Construct the client

```diff
- import { CodexClient } from '@openai/codex-sdk';
- const client = new CodexClient({ apiKey: process.env.OPENAI_API_KEY });
+ import { query } from '@lrilai/gemini-cli-sdk';
+ // GEMINI_API_KEY picked up from env
```

## Pattern 2 — Send a query

```diff
- const stream = client.chat({ messages: [{ role: 'user', content: 'Hi' }] });
- for await (const event of stream) { ... }
+ for await (const chunk of query({ prompt: 'Hi' })) { ... }
```

Gemini's `query()` takes a single `prompt` string (the SDK wraps headless `gemini-cli -p`). For multi-turn, use `resumeSessionId` — see Pattern 5.

## Pattern 3 — Stream chunks

Codex yields OpenAI-style chunks (`choices[0].delta.content`). Gemini yields normalized `MessageChunk` variants:

```diff
- for await (const event of stream) {
-   process.stdout.write(event.choices[0].delta.content ?? '');
- }
+ for await (const chunk of query({ prompt })) {
+   if (chunk.type === 'assistant') process.stdout.write(chunk.text);
+ }
```

## Pattern 4 — Tool use

```diff
- const tools = [{ type: 'function', function: { name: 'search', ... } }];
- client.chat({ messages, tools });
+ query({
+   prompt,
+   allowedTools: ['read_file'],
+   approvalMode: 'yolo',
+   // MCP passthrough for custom tools — see MCP docs
+ });
```

## Pattern 5 — Session / conversation resume

Codex manages conversations server-side via `conversation_id`. Gemini's session is client-owned:

```diff
- const conv = await client.createConversation();
- client.chat({ conversationId: conv.id, messages: [...] });
+ const first = await queryFull({ prompt: 'turn 1' });
+ query({ prompt: 'turn 2', resumeSessionId: first.session.id });
```

## Key differences

- **Single prompt string** instead of a messages array. Multi-turn via `resumeSessionId`.
- **No streaming of function-call arguments** — tool invocations arrive as full `tool` chunks.
- **No server-side conversation state** — `Session` is immutable, identifier-only, trivially serializable.
