# Phase 3: NDJSON Parser + EventDispatcher + MessageChunk Types - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the line-buffered NDJSON parser (stateful UTF-8 decoder, 1 MiB line limit, CRLF tolerance, lenient fallback for unknown types and non-JSON lines) and the EventDispatcher that normalizes CLI events into Archon's 8-variant `MessageChunk` discriminated union. TS types generated from `spec/events.schema.json` via `json-schema-to-typescript`; Pydantic models via `datamodel-code-generator`. Both language test suites consume the shared `spec/fixtures/*.ndjson` corpus and assert identical `.expected.json` outputs.

Requirements: PRS-01, PRS-02, PRS-03, PRS-04, PRS-05, PRS-06, PRS-07, PAR-02.

</domain>

<decisions>
## Implementation Decisions

### Event-to-MessageChunk mapping

The 6 CLI event types map to 7 of the 8 Archon MessageChunk variants (workflow_dispatch is reserved for Phase 10):

| CLI event type | MessageChunk variant | Routing rule |
|---|---|---|
| `init` | `system` (subtype: init) | Always. Carries session_id + model metadata. |
| `message` (role=assistant) | `assistant` | Role-based split on the `role` field. |
| `message` (role=user/system) | `system` | Role-based split on the `role` field. |
| `message` (thought=true or role=thinking) | `thinking` | Thinking detection (see below). |
| `tool_use` | `tool` | 1:1 mapping. Buffered until paired (see pairing). |
| `tool_result` | `tool_result` | 1:1 mapping. Triggers release of buffered tool chunk. |
| `error` (rate limit) | `rate_limit` | Inspect error payload to distinguish rate limit from other errors. |
| `error` (other) | _(throws)_ | Non-rate-limit errors throw typed GeminiError (classification deferred to Phase 5; Phase 3 throws a generic ParseError/GeminiError). |
| `result` | `result` | 1:1 mapping. Terminal event. |

- `workflow_dispatch` variant is defined in the MessageChunk type but Phase 3's EventDispatcher never emits it. Reserved for Phase 10's Archon adapter.

### Tool use/result pairing

- Buffer `tool_use` events in a Map keyed by `tool_id`. Do NOT yield the `tool` chunk immediately.
- When a matching `tool_result` arrives (same `tool_id`), yield BOTH chunks in sequence: `tool` then `tool_result`.
- If stream ends (normally or via abort) with unpaired `tool_use` still in the buffer: flush each buffered chunk with an `incomplete: true` flag, then proceed to yield the result/error chunk. No silent data loss.
- Pairing is by `tool_id` identity (format `{tool_name}_{unix_ms}_{counter}`), NOT positional — confirmed from Phase 1 fixture analysis of `tool-use-builtin.ndjson`.

### Thinking variant

- Thinking events are absent in gemini-cli headless mode (Phase 1 confirmed). The `thinking` variant is future-proofed.
- Define the `thinking` variant in the MessageChunk union and wire a real dispatcher code path.
- Discriminator: match `event.thought === true`, `event.role === 'thinking'`, OR `event.type === 'thinking'` (covers multiple plausible upstream shapes).
- Test with a hand-crafted synthetic fixture (`thinking.ndjson` already exists in `spec/fixtures/` from Phase 1; update its `.expected.json` to map through the thinking variant).

### Parser output shape

- **Two-stage pipeline:** `parseNdjson(stream) -> AsyncIterable<RawEvent>` then `dispatch(events) -> AsyncIterable<MessageChunk>`.
- **Standalone async generator functions**, not classes. Composable, testable, no lifecycle management.
- Phase 4's `query()` can tap either stage: raw-event API (API-06) = `parseNdjson` only; high-level API = `parseNdjson` piped into `dispatch`.
- Internal state (UTF-8 decoder buffer, tool pairing buffer) lives inside the generator closures — no external state objects.

### Claude's Discretion

- Exact UTF-8 decoder implementation (TextDecoder vs manual state machine)
- Fuzz test strategy and random input generation approach
- Internal chunk/buffer sizes within the 1 MiB line limit
- How to structure the `RawEvent` type (interface vs type alias, field naming)
- Test file organization within `ts/src/` and `python/src/gemini_sdk/`
- Whether `isRateLimitError()` uses string matching or structured field checks in Phase 3 (Phase 5 will refine the error classification)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wire protocol and event schema
- `spec/protocol.md` — Normative event-by-event field reference with fixture citations; defines all 6 CLI event types, their required/optional fields, and transport rules (NDJSON, CRLF tolerance, 1 MiB limit)
- `spec/events.schema.json` — JSON Schema 2020-12 discriminated union of 6 event types; `additionalProperties: true` on all entries (schema is a FLOOR); input to `json-schema-to-typescript` and `datamodel-code-generator`
- `spec/errors.md` — Error pattern table with stderr/exit-code signals; Phase 3 needs the error event structure for rate_limit detection

### Fixture corpus
- `spec/fixtures/*.ndjson` — 12 fixture files (simple-text, tool-use-builtin, resume-session-turn1/turn2, error-auth, error-rate-limit, event-unknown, thinking, multimodal-image, multimodal-pdf, large-output, abort-midstream)
- `spec/fixtures/*.expected.json` — Expected MessageChunk sequences for each fixture; Phase 3 tests assert byte-identical output against these

### Archon type contract
- `https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts` — `MessageChunk` 8-variant union definition; Phase 3's output must be compatible
- `https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/claude.ts` — Reference impl showing how claude.ts emits system/assistant/tool chunks

### Phase 1 feasibility verdicts
- `spec/feasibility.md` — Verdicts (resume=pass, config_dir=pass, flush=partial); flush=partial means no PTY tricks needed in Phase 3 parser

### Prior phase context
- `.planning/phases/01-feasibility-spike-fixture-capture/01-CONTEXT.md` — Fixture scope, capture decisions, version pinning
- `.planning/phases/02-process-foundation-workspace-scaffolding-ci-matrix/02-CONTEXT.md` — Monorepo layout, test frameworks (Vitest + pytest), parity enforcement

### Requirements
- `.planning/REQUIREMENTS.md` — PRS-01 through PRS-07 (parsing), PAR-02 (parity)
- `.planning/ROADMAP.md` §"Phase 3" — Goal, success criteria, dependencies

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `spec/events.schema.json` — Input to type generation; both `json-schema-to-typescript` and `datamodel-code-generator` already validated in Phase 1
- `scripts/validate-schema-ts.mjs` — Existing codegen smoke test; can verify generated TS types compile
- `scripts/validate-schema-py.sh` — Existing codegen smoke test for Python; validates Pydantic model generation
- `ts/src/process/ProcessManager.ts` — Phase 4 will wire parser to ProcessManager's stdout stream; parser must accept the same stream type ProcessManager produces
- `python/src/gemini_sdk/process/process_manager.py` — Python equivalent; parser must accept anyio ByteReceiveStream

### Established Patterns
- ESM throughout TS (`"type": "module"` in root package.json) — parser module follows ESM
- Vitest for TS tests, pytest for Python — fixture-driven tests use these frameworks
- Relative paths to `spec/fixtures/` from test files (no symlinks, no copies) — established in Phase 2
- `scripts/diff-test-names.sh` enforces test name parity between TS and Python — new parser/dispatcher tests must have matching names

### Integration Points
- Parser consumes `stdout` stream from Phase 2's `ProcessManager` (bytes/ReadableStream)
- EventDispatcher output (`AsyncIterable<MessageChunk>`) is what Phase 4's `query()` yields to callers
- Raw event output (`AsyncIterable<RawEvent>`) is what Phase 4's raw-event API (API-06) exposes
- Generated TS types from `spec/events.schema.json` used as `RawEvent` type input; generated Pydantic models used in Python
- Phase 5 will refine the error classification in EventDispatcher (Phase 3 does basic rate_limit detection only)

</code_context>

<specifics>
## Specific Ideas

- Two-stage pipeline (`parseNdjson` -> `dispatch`) as standalone async generators — composable, no class overhead, internal state in closures
- Tool pairing buffer with `incomplete: true` flush on stream end — no silent data loss, no throws on abort
- Thinking discriminator covers three plausible upstream shapes (`thought` field, `role` field, `type` field) — future-proofed without over-engineering
- `workflow_dispatch` defined in type but never emitted by Phase 3 — honest about what the CLI actually produces

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-ndjson-parser-eventdispatcher-messagechunk-types*
*Context gathered: 2026-04-12*
