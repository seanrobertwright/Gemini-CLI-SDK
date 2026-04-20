# Structured Output (Best-Effort)

> **@experimental** — This feature ships best-effort JSON-schema-shaped output. The underlying gemini-cli does not yet guarantee schema-conformant output; see [Known Limitations](#known-limitations) and upstream [gemini-cli #13388](https://github.com/google-gemini/gemini-cli/issues/13388).

Phase 8 ships `outputSchema` / `output_schema` on `queryFull()` / `query_full()`. The SDK:

1. Injects your JSON Schema into the system prompt as a hard terminal constraint.
2. Validates the assistant text after the stream completes.
3. Retries **once** with validation feedback on failure.
4. Returns parsed + validated output in `QueryResult.structured`, OR raises `SchemaValidationError` after the second failure.

`outputSchema` is only supported on `queryFull()`/`query_full()`. Calling `query()` or `queryRaw()` with this option raises `UnsupportedFeatureError` before any subprocess spawns.

## Quick Start

**TypeScript:**

```typescript
import { queryFull } from '@gemini-sdk/core';

const result = await queryFull({
  prompt: 'What is the capital of France? Return as JSON.',
  outputSchema: {
    type: 'object',
    properties: {
      capital: { type: 'string' },
      country: { type: 'string' },
    },
    required: ['capital', 'country'],
  },
});

console.log(result.structured);  // { capital: 'Paris', country: 'France' }
console.log(result.text);        // the raw assistant text (still available)
```

**Python:**

```python
from gemini_sdk import query_full

result = await query_full({
    "prompt": "What is the capital of France? Return as JSON.",
    "output_schema": {
        "type": "object",
        "properties": {
            "capital": {"type": "string"},
            "country": {"type": "string"},
        },
        "required": ["capital", "country"],
    },
})

print(result["structured"])  # {'capital': 'Paris', 'country': 'France'}
print(result["text"])        # the raw assistant text
```

## How It Works

### 1. Schema Injection

The SDK appends a fixed deterministic block to your `systemPrompt`/`system_prompt` (or uses it standalone if you didn't provide one):

```markdown
## Required Output Format
Your response MUST be valid JSON matching this JSON Schema:

```json
{ <your schema, pretty-printed> }
```

Return ONLY the JSON object. No prose, no markdown fences in the output.
```

This goes into the temp `GEMINI_SYSTEM_MD` file (SYS-01) and is cleaned up in `finally` (SYS-02).

### 2. Validation

After the stream completes, the SDK:

1. Strips markdown code fences if present (the model often wraps JSON in ` ```json ... ``` `).
2. Parses the stripped text with `JSON.parse` (TS) / `json.loads` (Python).
3. Validates against your JSON Schema using Zod (TS via `zod-from-json-schema`) or `jsonschema` (Python).

On success → `QueryResult.structured` contains the parsed validated object.

### 3. Retry (exactly once)

On validation failure, the SDK spawns a second subprocess with a retry prompt:

```
<your original prompt>

Your previous response was invalid JSON for the required schema.
Validator error: <the validator's error message>
Your previous response was:
```
<the raw invalid response>
```

Return ONLY valid JSON matching the schema.
```

The retry:

- **Reuses the first call's session** via `--resume` (Phase 7), so the model sees its own previous response in context.
- **Strips `outputSchema` from the retry call** — the schema guidance is already embedded in the retry prompt directly; passing `outputSchema` again would cause recursive injection and (theoretically) a retry-of-the-retry.
- **Respects `abortSignal`/`cancel_scope`** — if aborted between the first and second call, `AbortError` is raised and no retry spawns.
- **Inherits your `approvalMode`** — if you set `'default'`, the retry also uses `'default'` (which may block in non-TTY contexts; see [docs/tools.md](./tools.md)).

### 4. Final Failure

If the retry response also fails validation, the SDK raises `SchemaValidationError`:

```typescript
import { SchemaValidationError } from '@gemini-sdk/core';

try {
  await queryFull({ prompt: '...', outputSchema: {...} });
} catch (e) {
  if (e instanceof SchemaValidationError) {
    console.error('Schema failed after retry:', e.message);
    // e.retryable === false
    // e.bucket === 'unknown'
  }
}
```

`SchemaValidationError` extends `GeminiError`, `retryable = false`, Archon bucket = `unknown`.

## Markdown Fence Stripping

LLMs often return JSON wrapped in ` ```json ... ``` ` fences even when told not to. The SDK strips these automatically before parsing:

| Raw assistant text             | After fence strip |
| ------------------------------ | ----------------- |
| `{"x": 1}`                     | `{"x": 1}`        |
| ` ```json\n{"x": 1}\n``` `     | `{"x": 1}`        |
| ` ```\n{"x": 1}\n``` `         | `{"x": 1}`        |
| `   {"x": 1}   ` (padded)      | `{"x": 1}`        |
| ` ```json\n{"x": 1} ` (partial fence, no closing) | passes through as-is |

## JSON Schema Support

The SDK accepts a plain JSON Schema object (`Record<string, unknown>` in TS; `dict` in Python). Under the hood:

- **TS** uses [`zod-from-json-schema`](https://www.npmjs.com/package/zod-from-json-schema) to convert the schema to a Zod schema at validation time. Supports the JSON Schema draft-07 subset commonly used for LLM output: `type`, `properties`, `required`, `enum`, `minLength`/`maxLength`, `items`, `anyOf`/`allOf`/`oneOf`, `$ref`.
- **Python** uses the [`jsonschema`](https://pypi.org/project/jsonschema/) library (JSON Schema draft-07). Full spec compliance.

Schemas that exercise exotic JSON Schema features (custom formats, vocabulary imports, etc.) may behave differently between TS and Python. For parity-critical applications, stick to the common subset above.

## Known Limitations

### Upstream #13388: No native JSON Schema enforcement in gemini-cli

gemini-cli does not currently expose a native JSON-schema-enforced output mode. The SDK's approach — **schema injection + runtime validation + single retry** — is best-effort by design.

Track: [gemini-cli #13388](https://github.com/google-gemini/gemini-cli/issues/13388). When upstream lands native enforcement, the SDK will add a `responseFormat: 'json_schema'` path that guarantees shape and deprecates the retry loop.

### One retry only

OUT-03 mandates a single retry. If the model fails validation twice, the SDK raises `SchemaValidationError` and does not attempt further retries. Callers needing more resilience can wrap `queryFull` in their own retry loop:

```typescript
for (let i = 0; i < 3; i++) {
  try {
    return await queryFull({ prompt, outputSchema });
  } catch (e) {
    if (!(e instanceof SchemaValidationError)) throw e;
  }
}
```

### Streaming is not supported with `outputSchema`

Validation inherently requires the complete assistant text. `query()` and `queryRaw()` raise `UnsupportedFeatureError` pre-spawn when `outputSchema` is set. Use `queryFull()`.

### No `outputSchemaTemplate` customization

The injection template is fixed in v1. If you need custom prose (e.g., different language, different tone), you'll need to pre-process your schema into the `systemPrompt` manually and skip `outputSchema`. Tracked for v2 if real callers need it.

### No `outputSchema` + `plan` approval mode

Combining `approvalMode: 'plan'` with `outputSchema` is undefined behavior. Plan mode produces a plan description (not executable JSON), so schema validation will almost certainly fail and waste a retry. Don't combine them.

## See Also

- [docs/tools.md](./tools.md) — `allowedTools` + `approvalMode`
- [docs/auth.md](./auth.md) — auth environment setup
- [gemini-cli #13388](https://github.com/google-gemini/gemini-cli/issues/13388) — upstream JSON-schema enforcement tracker
- [JSON Schema draft-07](https://json-schema.org/draft-07/json-schema-release-notes.html) — supported schema spec
- [Zod documentation](https://zod.dev) — TS validator
- [jsonschema (Python)](https://python-jsonschema.readthedocs.io/) — Python validator
