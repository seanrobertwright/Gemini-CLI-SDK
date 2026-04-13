# Phase 3: NDJSON Parser + EventDispatcher + MessageChunk Types — Research

**Researched:** 2026-04-12
**Domain:** NDJSON stream parsing, async generators, discriminated union types, fixture-driven testing, cross-language parity
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Event-to-MessageChunk mapping**

The 6 CLI event types map to 7 of the 8 Archon MessageChunk variants (workflow_dispatch is reserved for Phase 10):

| CLI event type | MessageChunk variant | Routing rule |
|---|---|---|
| `init` | `system` (subtype: init) | Always. Carries session_id + model metadata. |
| `message` (role=assistant) | `assistant` | Role-based split on the `role` field. |
| `message` (role=user/system) | `system` | Role-based split on the `role` field. |
| `message` (thought=true or role=thinking) | `thinking` | Thinking detection (see below). |
| `tool_use` | `tool` | 1:1 mapping. Buffered until paired (see pairing). |
| `tool_result` | `tool_result` | Triggers release of buffered tool chunk. |
| `error` (rate limit) | `rate_limit` | Inspect error payload to distinguish rate limit from other errors. |
| `error` (other) | _(throws)_ | Non-rate-limit errors throw a generic ParseError/GeminiError. |
| `result` | `result` | 1:1 mapping. Terminal event. |

- `workflow_dispatch` variant is defined in the MessageChunk type but Phase 3's EventDispatcher never emits it. Reserved for Phase 10's Archon adapter.

**Tool use/result pairing**

- Buffer `tool_use` events in a Map keyed by `tool_id`. Do NOT yield the `tool` chunk immediately.
- When a matching `tool_result` arrives (same `tool_id`), yield BOTH chunks in sequence: `tool` then `tool_result`.
- If stream ends with unpaired `tool_use` still in the buffer: flush each buffered chunk with an `incomplete: true` flag, then proceed to yield the result/error chunk.
- Pairing is by `tool_id` identity, NOT positional.

**Thinking variant**

- Thinking events are absent in gemini-cli headless mode. The `thinking` variant is future-proofed.
- Define the `thinking` variant in the MessageChunk union and wire a real dispatcher code path.
- Discriminator: match `event.thought === true`, `event.role === 'thinking'`, OR `event.type === 'thinking'`.
- Test with a hand-crafted synthetic fixture (`thinking.ndjson` already exists; update its `.expected.json` to map through the thinking variant).

**Parser output shape**

- **Two-stage pipeline:** `parseNdjson(stream) -> AsyncIterable<RawEvent>` then `dispatch(events) -> AsyncIterable<MessageChunk>`.
- **Standalone async generator functions**, not classes. Composable, testable, no lifecycle management.
- Internal state (UTF-8 decoder buffer, tool pairing buffer) lives inside the generator closures.

### Claude's Discretion

- Exact UTF-8 decoder implementation (TextDecoder vs manual state machine)
- Fuzz test strategy and random input generation approach
- Internal chunk/buffer sizes within the 1 MiB line limit
- How to structure the `RawEvent` type (interface vs type alias, field naming)
- Test file organization within `ts/src/` and `python/src/gemini_sdk/`
- Whether `isRateLimitError()` uses string matching or structured field checks in Phase 3

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PRS-01 | SDK parses `--output-format stream-json` NDJSON with a stateful UTF-8 decoder and 1 MiB line limit | TextDecoder API with fatal:false; line buffer with 1 MiB cap; async generator pattern |
| PRS-02 | NDJSON parser tolerates CRLF line endings | Strip `\r` before `\n` split; confirmed Windows fixtures use LF but spec requires CRLF tolerance |
| PRS-03 | Unknown event types yield `{type:'unknown', raw}` and never throw | Discriminator switch with default fallback; event-unknown.ndjson fixture covers this |
| PRS-04 | Non-JSON stdout lines yield `{type:'cli_log'}` events and never throw | try/catch around JSON.parse; forward raw line in `{type:'cli_log', line}` shape |
| PRS-05 | EventDispatcher maps parsed events into normalized MessageChunk discriminated union | dispatch() async generator implementing the routing table from CONTEXT.md |
| PRS-06 | SDK emits shapes compatible with Archon's MessageChunk type (8 variants) | Types generated from spec/events.schema.json; MessageChunk union defined manually per Archon contract |
| PRS-07 | SDK guarantees tool_use and tool_result chunks are always paired | Map<tool_id, buffered_tool_chunk>; yield both on pair arrival; flush with incomplete:true on stream end |
| PAR-02 | Both language suites consume the same spec/fixtures/*.ndjson in CI | Fixture-driven test pattern established in Phase 2; diff-test-names.sh parity enforcement already exists |

</phase_requirements>

---

## Summary

Phase 3 builds two composable async generator functions — `parseNdjson` and `dispatch` — that form a two-stage NDJSON processing pipeline. The parser handles byte-stream-to-RawEvent conversion with UTF-8 decoding, CRLF tolerance, 1 MiB line limiting, and lenient fallback. The dispatcher maps RawEvents to MessageChunk variants per Archon's contract, including stateful tool pairing.

The project already has all 12 fixture files with `.expected.json` sidecars. However, the `.expected.json` files currently use placeholder chunk shapes from Phase 1 (`{type:'unknown'}` for tool events, `{type:'user'}` for user message echoes). Phase 3 must update these expected files to their final EventDispatcher-produced shapes before writing tests that assert against them — this is the most critical setup task.

Both the TypeScript (Vitest 3.x, ESM, `--passWithNoTests`) and Python (pytest 8.x, anyio, `pytest-anyio`) test frameworks are already configured. The `diff-test-names.sh` parity enforcer is already wired in CI and will block merge if TS and Python test names diverge.

**Primary recommendation:** Build TS-first, then Python as a mechanical port. Update `.expected.json` files in Wave 0 as the ground truth before writing any assertions against them.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `TextDecoder` | built-in (ES2022) | Stateful UTF-8 decoding of byte chunks | Built-in, handles split code points across chunks correctly, `fatal:false` replaces malformed bytes |
| Vitest | ^3.2 (pinned) | TS test runner | Already installed in ts/package.json; pinned because Vitest 4 drops Node 18 |
| pytest | ^8.0 | Python test runner | Already in python/pyproject.toml |
| pytest-anyio | ^0.0.0 | Async test support for Python | Already in python/pyproject.toml; conftest.py registers anyio plugin |
| json-schema-to-typescript | 15.0.4 (pinned) | Generate TS types from spec/events.schema.json | Already installed in root package.json; scripts/validate-schema-ts.mjs already validates it |
| datamodel-code-generator | 0.30.2 (pinned via uvx) | Generate Pydantic v2 models from spec/events.schema.json | Already validated in scripts/validate-schema-py.sh; run via `uvx --from "datamodel-code-generator==0.30.2"` |
| anyio | >=4.0 | Async runtime abstraction for Python (asyncio/trio) | Already in python/pyproject.toml; anyio.open_process ByteReceiveStream is the stream type for Python |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `ReadableStream` / `AsyncIterable<Uint8Array>` | built-in | Input stream type for parseNdjson in TS | ProcessManager.spawn() returns ChildProcess whose stdout is a Readable — wrap as AsyncIterable |
| anyio ByteReceiveStream | anyio>=4.0 | Input stream type for parse_ndjson in Python | anyio Process.stdout is already ByteReceiveStream — do not wrap with anyio.wrap_file() (Phase 2 lesson) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TextDecoder (built-in) | Manual UTF-8 state machine | TextDecoder is simpler and battle-tested; manual only needed if streaming perf is critical (it isn't here) |
| Standalone async generator functions | Class-based parser | Context.md mandates standalone generators — composable, no lifecycle management |
| Fixture-driven tests only | Property-based fuzz only | Both required: fixtures validate known shapes, fuzz validates robustness |

### Installation

No new packages needed. All dependencies already installed from Phase 2. The only new runtime artifacts are generated files:

```bash
# TS types from schema (run once, check in generated file)
node scripts/validate-schema-ts.mjs  # already exists

# Python Pydantic models from schema (run once, check in generated file)
bash scripts/validate-schema-py.sh   # already exists
```

---

## Architecture Patterns

### Recommended Project Structure

```
ts/src/
├── parser/
│   ├── parseNdjson.ts        # Stage 1: bytes → AsyncIterable<RawEvent>
│   ├── dispatch.ts           # Stage 2: AsyncIterable<RawEvent> → AsyncIterable<MessageChunk>
│   ├── types.ts              # RawEvent, MessageChunk union, generated type imports
│   ├── parseNdjson.spec.ts   # Unit tests for parseNdjson
│   └── dispatch.spec.ts      # Unit tests for dispatch + EventDispatcher logic
├── process/                  # (Phase 2 — do not modify)
└── errors/                   # (Phase 2 — do not modify)

python/src/gemini_sdk/
├── parser/
│   ├── __init__.py
│   ├── parse_ndjson.py       # Stage 1: bytes → AsyncIterable[RawEvent]
│   ├── dispatch.py           # Stage 2: AsyncIterable[RawEvent] → AsyncIterable[MessageChunk]
│   └── types.py              # RawEvent TypedDict, MessageChunk Union, generated model imports
python/tests/
├── test_parse_ndjson.py      # Mirror of parseNdjson.spec.ts (PAR-02 parity)
└── test_dispatch.py          # Mirror of dispatch.spec.ts (PAR-02 parity)

spec/fixtures/
├── *.ndjson                  # Input corpus (12 files, do not modify)
├── *.expected.json           # MUST be updated in Wave 0 (currently have Phase 1 placeholders)
└── multi-tool.ndjson         # NEW: synthesize for concurrent tool call coverage
```

### Pattern 1: NDJSON Line Buffer with TextDecoder

**What:** Stateful byte-accumulation generator that splits on `\n` (or `\r\n`), enforces 1 MiB cap, and decodes UTF-8 spanning chunk boundaries.

**When to use:** Any byte stream from ProcessManager stdout.

**Implementation notes:**
- Use `new TextDecoder('utf-8', { fatal: false })` — replaces malformed bytes with U+FFFD instead of throwing
- Accumulate bytes in a `Uint8Array` or string buffer; scan for `\n`
- On `\r\n`: strip the `\r` before emitting the line
- If buffer exceeds 1 MiB before newline: emit the accumulated content as `{type:'cli_log'}` and reset buffer
- Try `JSON.parse(line)` — on failure emit `{type:'cli_log', line}` (PRS-04)
- On success but unknown `type` field: emit `{type:'unknown', raw: parsed}` (PRS-03)

```typescript
// Source: Phase 3 design (no upstream library — purpose-built per PRS-01)
async function* parseNdjson(
  stream: AsyncIterable<Uint8Array>
): AsyncIterable<RawEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const MAX_LINE = 1024 * 1024; // 1 MiB (PRS-01)
  let buf = '';

  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1); // CRLF (PRS-02)
      if (line.length === 0) continue;
      yield parseLine(line); // returns RawEvent
    }
    if (buf.length > MAX_LINE) {
      yield { type: 'cli_log', line: buf.slice(0, MAX_LINE) };
      buf = buf.slice(MAX_LINE);
    }
  }
  // Flush remaining bytes
  buf += decoder.decode(); // flush TextDecoder internal state
  if (buf.length > 0) yield parseLine(buf);
}
```

### Pattern 2: EventDispatcher with Tool Pairing Buffer

**What:** Async generator that consumes `AsyncIterable<RawEvent>` and yields `AsyncIterable<MessageChunk>`, maintaining an in-flight `Map<tool_id, tool_chunk>` for pairing.

**When to use:** After parseNdjson; feeds Phase 4's `query()` return value.

```typescript
// Source: Phase 3 design — locked decision from CONTEXT.md
async function* dispatch(
  events: AsyncIterable<RawEvent>
): AsyncIterable<MessageChunk> {
  const pending = new Map<string, ToolChunk>(); // tool pairing buffer

  for await (const event of events) {
    switch (event.type) {
      case 'init':
        yield { type: 'system', subtype: 'init', sessionId: event.session_id, model: event.model };
        break;
      case 'message':
        if (isThinking(event)) {
          yield { type: 'thinking', content: event.content };
        } else if (event.role === 'assistant') {
          yield { type: 'assistant', content: event.content };
        } else {
          yield { type: 'system', subtype: 'message', role: event.role, content: event.content };
        }
        break;
      case 'tool_use':
        pending.set(event.tool_id, buildToolChunk(event)); // buffer, do NOT yield yet
        break;
      case 'tool_result': {
        const toolChunk = pending.get(event.tool_id);
        if (toolChunk) {
          pending.delete(event.tool_id);
          yield toolChunk;                         // tool chunk first
          yield buildToolResultChunk(event);       // then tool_result
        } else {
          // Orphan tool_result — yield without pair (defensive)
          yield buildToolResultChunk(event);
        }
        break;
      }
      case 'error':
        if (isRateLimitError(event)) {
          yield { type: 'rate_limit', code: event.error.code, message: event.error.message };
        } else {
          throw new ParseError(`Unhandled error event: ${JSON.stringify(event.error)}`);
        }
        break;
      case 'result':
        yield buildResultChunk(event);
        break;
    }
  }

  // Flush unpaired tool_use on stream end (PRS-07)
  for (const toolChunk of pending.values()) {
    yield { ...toolChunk, incomplete: true };
  }
}

function isThinking(event: MessageEvent): boolean {
  return (event as any).thought === true
    || event.role === 'thinking'
    || (event as any).type === 'thinking';
}
```

### Pattern 3: Python async generator equivalent

```python
# Source: Phase 3 design — mechanical port of TS parseNdjson
from __future__ import annotations
import json
from typing import AsyncIterable
from anyio.abc import ByteReceiveStream
from .types import RawEvent

MAX_LINE = 1024 * 1024  # 1 MiB (PRS-01)

async def parse_ndjson(stream: ByteReceiveStream) -> AsyncIterable[RawEvent]:
    buf = b''
    async for chunk in stream:
        buf += chunk
        while b'\n' in buf:
            line_bytes, buf = buf.split(b'\n', 1)
            line = line_bytes.rstrip(b'\r').decode('utf-8', errors='replace')
            if not line:
                continue
            yield _parse_line(line)
            if len(buf) > MAX_LINE:
                yield {'type': 'cli_log', 'line': buf[:MAX_LINE].decode('utf-8', errors='replace')}
                buf = buf[MAX_LINE:]
    # flush remaining
    if buf:
        line = buf.decode('utf-8', errors='replace')
        yield _parse_line(line)

def _parse_line(line: str) -> RawEvent:
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return {'type': 'cli_log', 'line': line}  # PRS-04
    if obj.get('type') not in KNOWN_TYPES:
        return {'type': 'unknown', 'raw': obj}    # PRS-03
    return obj  # type: ignore[return-value]
```

### Pattern 4: Fixture-Driven Test Structure

Both TS and Python tests must iterate all `spec/fixtures/*.ndjson` files and assert identity with their `.expected.json` sibling. Test names MUST match between languages for PAR-02 and `diff-test-names.sh`.

```typescript
// ts/src/parser/parseNdjson.spec.ts — fixture-driven parity test
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const fixturesDir = new URL('../../../spec/fixtures/', import.meta.url);

describe('parseNdjson fixture corpus', () => {
  const fixtures = readdirSync(fixturesDir).filter(f => f.endsWith('.ndjson'));
  for (const fixture of fixtures) {
    it(`parses ${fixture} identically to expected.json`, async () => {
      // ...
    });
  }
});
```

```python
# python/tests/test_parse_ndjson.py — mirror test name pattern
import pytest, json
from pathlib import Path

FIXTURES = sorted((Path(__file__).parents[2] / 'spec' / 'fixtures').glob('*.ndjson'))

class TestParseNdjsonFixtureCorpus:
    @pytest.mark.parametrize('ndjson_path', FIXTURES, ids=lambda p: p.name)
    @pytest.mark.anyio
    async def test_parses_fixture_identically_to_expected_json(self, ndjson_path):
        # ...
```

### Anti-Patterns to Avoid

- **Positional tool pairing:** Never assume Nth `tool_use` matches Nth `tool_result`. Always use `tool_id` as the correlation key.
- **Eager tool_use emission:** Do NOT yield a `tool` chunk when you see `tool_use`. Buffer it.
- **Fatal TextDecoder:** `new TextDecoder('utf-8', { fatal: true })` throws on malformed bytes. Use `fatal: false`.
- **Copying fixture files into test directories:** Tests read from `spec/fixtures/` relative path directly (Phase 2 pattern).
- **Using `anyio.wrap_file()` on Process.stdout:** Phase 2 confirmed `anyio Process.stdout` is already a `ByteReceiveStream`. Do not double-wrap.
- **Class-based parser state:** Internal state lives in generator closures, not external state objects.
- **Emitting `{type:'user'}` chunks:** There is no `user` variant in the 8-variant Archon MessageChunk union. User message echoes map to `{type:'system', subtype:'message', role:'user'}`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TS type generation from JSON Schema | Custom type definitions | `json-schema-to-typescript@15.0.4` + `spec/events.schema.json` | Already installed, smoke-tested, codegen is deterministic |
| Python Pydantic model generation | Manual Pydantic classes | `datamodel-code-generator==0.30.2` via `uvx` | Already validated in scripts/validate-schema-py.sh |
| UTF-8 split-codepoint handling | Manual byte inspection | `TextDecoder` (TS) / `.decode('utf-8', errors='replace')` (Python) | Both handle split multibyte sequences correctly at chunk boundaries |
| Test framework async support | Custom async test runner | Vitest (already supports async/await natively) / `pytest-anyio` (already in devDependencies) | Both already configured |

**Key insight:** The type generation tooling is already installed and proven. The biggest risk is inventing a custom `MessageChunk` type definition instead of deriving from the schema — don't do this.

---

## Common Pitfalls

### Pitfall 1: Phase 1 expected.json files use placeholder chunk shapes

**What goes wrong:** Tests written against current `.expected.json` files will pass with the WRONG output. The Phase 1 expected files contain `{type:'unknown'}` for `tool_use`/`tool_result` events (Phase 1 used a skeleton deriveChunks that didn't implement EventDispatcher) and `{type:'user'}` for user message echoes (which is not an Archon variant).

**Why it happens:** Phase 1's `deriveChunks` was a stub that forwarded unknown types as `{type:'unknown'}`. Phase 3 is the first phase that implements the real mapping.

**How to avoid:** Wave 0 of the plan MUST update all `.expected.json` files to reflect EventDispatcher output BEFORE writing any test assertions. The fixtures to update:
- `tool-use-builtin.expected.json` — `tool_use` and `tool_result` events currently show as `{type:'unknown'}`; update to `{type:'tool', ...}` + `{type:'tool_result', ...}`
- `resume-session-turn1.expected.json` — same issue with `save_memory` tool call
- `resume-session-turn2.expected.json` — check for user message `{type:'user'}` → `{type:'system'}`
- `simple-text.expected.json` — `{type:'user'}` echo → `{type:'system', subtype:'message', role:'user'}`
- All other expected.json files — verify user message echo shape

**Warning signs:** CI passes with a stub dispatcher that emits `{type:'unknown'}` everywhere.

### Pitfall 2: Rate-limit detection using string matching is fragile

**What goes wrong:** Using `error.message.includes('quota')` or `error.message.includes('RESOURCE_EXHAUSTED')` will break if the upstream message text changes.

**Why it happens:** The synthetic rate-limit fixture was derived from known gemini-cli error format, but the real format may differ (Phase 5 will validate).

**How to avoid:** Use structured field checks: `event.error.code === 429 || event.error.status === 'RESOURCE_EXHAUSTED'`. Phase 5 will refine — Phase 3 just needs to distinguish rate-limit from non-rate-limit for the `rate_limit` vs throw decision.

### Pitfall 3: Missing `incomplete: true` flush on stream end

**What goes wrong:** If a `tool_use` arrives but no `tool_result` follows (stream ends or is aborted), the tool chunk is silently dropped.

**Why it happens:** Easy to forget the end-of-stream flush path.

**How to avoid:** After the `for await` loop in `dispatch()`, iterate `pending.values()` and yield each with `incomplete: true`. Write an explicit test for this path using a hand-crafted fixture.

### Pitfall 4: Thinking fixture needs expected.json update

**What goes wrong:** `thinking.expected.json` currently maps the thinking fixture to plain `assistant` chunks (because no thinking events appear in the real capture). Phase 3 must synthesize a NEW fixture with fake `thinking`-typed events and update the expected.json to show `{type:'thinking'}` chunks.

**Why it happens:** The CONTEXT.md says the thinking variant must be wired and tested, but the only existing thinking fixture contains no thinking events.

**How to avoid:** Create `spec/fixtures/thinking-synthetic.ndjson` with hand-crafted `{"type":"thinking","content":"..."}` events, and a matching `thinking-synthetic.expected.json` that asserts `{type:'thinking'}` chunks. The real `thinking.ndjson` fixture remains as-is (maps to assistant chunks). Document the two purposes clearly.

### Pitfall 5: Test name parity with diff-test-names.sh

**What goes wrong:** Adding a TS test without an exact-match Python counterpart (or vice versa) blocks CI via `diff-test-names.sh`.

**Why it happens:** The parity script extracts test names from `describe/it` (TS) and class/method docstrings (Python) and diffs them.

**How to avoid:** Write TS tests first, then copy the test names exactly into Python test docstrings. The description string in `it('...', ...)` must match the Python method docstring verbatim.

### Pitfall 6: Stream type mismatch between TS and Python

**What goes wrong:** `parseNdjson` in TS accepts `AsyncIterable<Uint8Array>`, but `ProcessManager.spawn().stdout` is a Node.js `Readable` stream — which IS an `AsyncIterable<Buffer>` in Node 18+ but requires explicit iteration or conversion.

**Why it happens:** `Buffer` extends `Uint8Array` but the type system may require an explicit cast.

**How to avoid:** Accept `AsyncIterable<Uint8Array | Buffer>` or use `Readable.from()` / an async iteration adapter. Document the stream type contract clearly in `parseNdjson`'s JSDoc.

---

## Code Examples

Verified patterns from project analysis:

### Consuming a Node.js Readable as AsyncIterable

```typescript
// Node.js Readable is AsyncIterable<Buffer> in Node 18+
// Buffer extends Uint8Array so TextDecoder.decode() accepts it directly
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

async function* processStdoutToRawEvents(proc: ChildProcess) {
  const stdout = proc.stdout!; // Readable
  for await (const raw of stdout as AsyncIterable<Buffer>) {
    // raw is Buffer (subclass of Uint8Array) — safe to pass to TextDecoder
  }
}
```

### Vitest fixture-parameterization pattern (existing project pattern)

```typescript
// Uses import.meta.url for ESM-safe path resolution (required — project is ESM throughout)
const FIXTURES_DIR = new URL('../../../spec/fixtures/', import.meta.url);
```

### pytest-anyio async test (existing project pattern from conftest.py)

```python
# conftest.py already registers anyio plugin — just use @pytest.mark.anyio
@pytest.mark.anyio
async def test_something() -> None:
    ...
```

### datamodel-code-generator invocation (existing scripts/validate-schema-py.sh)

```bash
uvx --from "datamodel-code-generator==0.30.2" datamodel-codegen \
  --input spec/events.schema.json \
  --input-file-type jsonschema \
  --output ts/src/parser/generated/events.py \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.10 \
  --use-annotated \
  --use-union-operator
```

### json-schema-to-typescript invocation (existing scripts/validate-schema-ts.mjs)

```javascript
import { compileFromFile } from 'json-schema-to-typescript';
const tsSource = await compileFromFile('spec/events.schema.json', {
  bannerComment: '',
  additionalProperties: true,
  strictIndexSignatures: false,
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Class-based stream parsers with external state | Standalone async generators with closure state | Node 10+ | Simpler, composable, no lifecycle management overhead |
| Positional tool pairing | `tool_id` identity-based pairing | gemini-cli 0.37.1 confirmed | Required for correctness with concurrent tool calls |
| Manual UTF-8 decoding | `TextDecoder` with `stream: true` option | Node 11+ | Correct multibyte split-boundary handling built-in |
| `{type:'unknown'}` placeholder for tool events | `{type:'tool'}` / `{type:'tool_result'}` paired chunks | Phase 3 (this phase) | Aligns with Archon's MessageChunk contract |

**Deprecated/outdated in this project:**
- `{type:'user'}` in `.expected.json` files: This is a Phase 1 placeholder. The Archon MessageChunk union has no `user` variant. Correct shape is `{type:'system', subtype:'message', role:'user'}`.
- `{type:'unknown'}` for tool_use/tool_result in `.expected.json`: Phase 1 placeholder. Phase 3 must update these to `{type:'tool', ...}` and `{type:'tool_result', ...}`.

---

## Open Questions

1. **Exact MessageChunk shape for each variant**
   - What we know: The Archon contract defines 8 variants but the field-level schema is in `packages/core/src/types/index.ts`. The CONTEXT.md table gives routing rules but not the full field definitions.
   - What's unclear: Exact required/optional fields for each variant (e.g., does `result` carry `stats`? Does `system` carry `subtype` and `sessionId`?)
   - Recommendation: Read `https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts` before implementing `types.ts`. The existing `simple-text.expected.json` shows `{type:'result', sessionId, stopReason}` and `{type:'system', subtype:'init', sessionId, model}` which are informative but may not be authoritative.

2. **Multi-tool concurrent call fixture**
   - What we know: Phase 1 only captured single-tool invocations. The spec's section 11.1 flags concurrent tools as unresolved.
   - What's unclear: Whether gemini-cli emits interleaved `tool_use`/`tool_result` pairs.
   - Recommendation: Synthesize a `multi-tool.ndjson` fixture with two tool_use events followed by two tool_result events (possibly interleaved) to test the `Map`-based pairing. This is required for PRS-07 correctness confidence.

3. **Rate-limit detection robustness**
   - What we know: The synthetic fixture uses `code: 429` and `status: 'RESOURCE_EXHAUSTED'`. Phase 5 will validate real format.
   - What's unclear: Whether real rate-limit errors also have `code: 429` OR only have `status: 'RESOURCE_EXHAUSTED'`.
   - Recommendation: Check BOTH conditions (`event.error.code === 429 || event.error.status === 'RESOURCE_EXHAUSTED'`). Phase 5 will tighten.

4. **`session_id` field on `result` chunk**
   - What we know: `simple-text.expected.json` shows `{type:'result', sessionId:'<REDACTED_SESSION_ID>', stopReason:'end_turn'}` but the raw `result` event only has `status` and `stats` — no `session_id`.
   - What's unclear: Where does the `sessionId` on the result chunk come from? Must the dispatcher track the session_id from the `init` event and attach it to the `result` chunk?
   - Recommendation: Yes — the dispatcher should capture `session_id` from the `init` event in a closure variable and attach it to the `result` chunk. This is internal state in the closure.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| TS Framework | Vitest ^3.2 |
| TS Config file | `ts/vitest.config.ts` |
| TS Quick run | `cd ts && pnpm test` |
| TS Full suite | `cd ts && pnpm test:coverage` |
| Python Framework | pytest ^8.0 + pytest-anyio |
| Python Config file | `python/pyproject.toml` (`testpaths = ["tests"]`) |
| Python Quick run | `cd python && uv run pytest tests/test_parse_ndjson.py tests/test_dispatch.py -x` |
| Python Full suite | `cd python && uv run pytest` |
| Parity check | `bash scripts/diff-test-names.sh` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRS-01 | 1 MiB line limit — lines over 1 MiB emit cli_log and don't throw | unit | `cd ts && pnpm test -- --reporter=verbose parseNdjson` | ❌ Wave 0 |
| PRS-01 | Stateful UTF-8 decoder handles split codepoints across chunks | unit | `cd ts && pnpm test -- parseNdjson` | ❌ Wave 0 |
| PRS-02 | CRLF line endings parsed identically to LF | unit | `cd ts && pnpm test -- parseNdjson` | ❌ Wave 0 |
| PRS-03 | Unknown event type yields `{type:'unknown', raw}` and never throws | fixture+unit | `cd ts && pnpm test -- parseNdjson` | ❌ Wave 0 |
| PRS-04 | Non-JSON line yields `{type:'cli_log', line}` and never throws | unit | `cd ts && pnpm test -- parseNdjson` | ❌ Wave 0 |
| PRS-05 | All 12 fixture files produce expected.json-identical output | fixture | `cd ts && pnpm test -- dispatch` | ❌ Wave 0 |
| PRS-06 | Generated MessageChunk type has all 8 variants, imports cleanly | smoke | `node scripts/validate-schema-ts.mjs` (already exists) | ✅ |
| PRS-07 | tool_use + tool_result always yielded as a pair | unit | `cd ts && pnpm test -- dispatch` | ❌ Wave 0 |
| PRS-07 | Stream-end with unpaired tool_use flushes with `incomplete:true` | unit | `cd ts && pnpm test -- dispatch` | ❌ Wave 0 |
| PRS-07 | Every tool_use in fixture corpus has paired tool_result | fixture corpus | `cd ts && pnpm test -- dispatch` | ❌ Wave 0 |
| PAR-02 | Python and TS parsers produce byte-identical output for all fixtures | parity | `bash scripts/diff-test-names.sh && cd python && uv run pytest` | Partial (diff-test-names.sh ✅, test files ❌ Wave 0) |

### Sampling Rate

- **Per task commit:** `cd ts && pnpm test` (Vitest, all parser specs)
- **Per wave merge:** `cd ts && pnpm test && cd python && uv run pytest && bash scripts/diff-test-names.sh`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `ts/src/parser/parseNdjson.ts` — main parser implementation
- [ ] `ts/src/parser/dispatch.ts` — EventDispatcher implementation
- [ ] `ts/src/parser/types.ts` — RawEvent and MessageChunk type definitions
- [ ] `ts/src/parser/parseNdjson.spec.ts` — PRS-01/02/03/04 coverage
- [ ] `ts/src/parser/dispatch.spec.ts` — PRS-05/07 coverage
- [ ] `python/src/gemini_sdk/parser/parse_ndjson.py` — Python port
- [ ] `python/src/gemini_sdk/parser/dispatch.py` — Python port
- [ ] `python/tests/test_parse_ndjson.py` — Python mirror tests
- [ ] `python/tests/test_dispatch.py` — Python mirror tests
- [ ] `spec/fixtures/*.expected.json` — update all 12 files to reflect real EventDispatcher output (Phase 1 placeholders must be replaced)
- [ ] `spec/fixtures/thinking-synthetic.ndjson` + `thinking-synthetic.expected.json` — synthetic fixture for thinking variant coverage
- [ ] `spec/fixtures/multi-tool.ndjson` + `multi-tool.expected.json` — synthetic fixture for concurrent tool pairing

---

## Sources

### Primary (HIGH confidence)

- Project files directly read:
  - `spec/protocol.md` — normative event field reference with fixture citations
  - `spec/events.schema.json` — JSON Schema 2020-12 discriminated union, all 6 event types
  - `spec/errors.md` — error pattern table; rate_limit detection rules (code:429, status:RESOURCE_EXHAUSTED)
  - `spec/fixtures/*.ndjson` + `*.expected.json` — 12 fixture pairs; Phase 1 placeholder shapes identified
  - `ts/package.json` — Vitest ^3.2, json-schema-to-typescript@15.0.4, typescript ^5.6.3
  - `ts/vitest.config.ts` — test include glob, coverage config
  - `ts/tsconfig.json` — ES2022 target, NodeNext module, strict mode
  - `python/pyproject.toml` — pytest ^8.0, pytest-anyio, anyio^4.0
  - `python/tests/conftest.py` — anyio plugin registration
  - `ts/src/process/ProcessManager.ts` — spawn() returns ChildProcess; stdout is Node.js Readable
  - `python/src/gemini_sdk/process/process_manager.py` — anyio Process.stdout is ByteReceiveStream
  - `scripts/validate-schema-ts.mjs` — json-schema-to-typescript@15.0.4 invocation pattern
  - `scripts/validate-schema-py.sh` — datamodel-code-generator==0.30.2 invocation pattern via uvx
  - `.planning/phases/03-ndjson-parser-eventdispatcher-messagechunk-types/03-CONTEXT.md` — locked decisions
  - `.planning/STATE.md` — Phase 2 lessons (anyio ByteReceiveStream, vitest ESM patterns)

### Secondary (MEDIUM confidence)

- Node.js `TextDecoder` with `{stream: true}` option: standard Web API available in Node 11+, well-documented behavior for split codepoints
- `anyio ByteReceiveStream` iteration: confirmed in Phase 2 (STATE.md note: "anyio Process.stdout is already ByteReceiveStream — do not wrap with anyio.wrap_file()")

### Tertiary (LOW confidence)

- Archon `MessageChunk` type field-level schema: needs direct verification from `https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts` before implementing `types.ts` — the existing `.expected.json` files give hints but may not be authoritative on all field names.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already installed and validated in Phase 1/2
- Architecture: HIGH — two-stage async generator pattern confirmed in CONTEXT.md decisions; patterns are ESM-standard Node.js
- Pitfalls: HIGH — most discovered by direct inspection of existing `.expected.json` placeholder shapes and STATE.md lessons
- Archon type field-level details: LOW/MEDIUM — requires reading Archon source before implementing

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable stack; no fast-moving dependencies)
