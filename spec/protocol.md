# Gemini CLI Wire Protocol — Event Specification

**Status:** Normative draft, Phase 1  
**Captured against:** gemini-cli 0.37.1 (see `.gemini-cli-compat`)  
**Capture host:** Windows 11 Pro, win32  
**Capture date:** 2026-04-11 – 2026-04-12  

---

## 1. Preamble

This document is a normative draft derived from real fixture captures taken against
`gemini-cli@0.37.1` (the version pinned in `.gemini-cli-compat`). It fills a deliberate gap
in the upstream documentation: `docs/cli/headless.md` and `geminicli.com/docs/cli/headless/`
enumerate the six event type names but provide **no field-level schemas and no example NDJSON
lines**. Every claim in this document is backed by at least one cited fixture file.

**Schema policy:** `spec/events.schema.json` is a FLOOR, not a ceiling. All `$defs` entries
set `additionalProperties: true` so the parser tolerates upstream field additions without a
schema bump. Unknown fields are silently forwarded.

**Open questions** inherited from `01-RESEARCH.md` that the fixture corpus did not fully
resolve are collected in section 10.

---

## 2. Transport

**Format:** Newline-delimited JSON (NDJSON) delivered over the child process's `stdout`.
Each event occupies exactly one line, terminated by a newline character.

**Line terminators:** LF (`\n`) on POSIX hosts; the parser MUST also tolerate CRLF (`\r\n`)
per requirement PRS-02. All captured Windows fixtures use LF because `gemini-cli` normalizes
line endings before writing to stdout.

**Line size limit:** Soft 1 MiB cap per PRS-01. Lines exceeding this limit may be truncated
by the parser's stateful UTF-8 decoder; the truncated event is treated as non-parseable and
forwarded as `{type: 'cli_log'}` per PRS-04.

**Non-JSON stdout lines:** Any stdout line that fails `JSON.parse` is forwarded as
`{type: 'cli_log', line: <raw string>}` and never throws (PRS-04). In practice,
`gemini-cli@0.37.1` may prepend non-JSON policy-warning strings to the first real event line;
the capture pipeline strips content before the first `{` character.

**Evidence:**
- `spec/fixtures/simple-text.ndjson` — happy-path shape: 4-line NDJSON (init, user message,
  assistant message, result). Each line is a self-contained JSON object.
- `spec/fixtures/large-output.ndjson` — multi-KB streaming evidence: 93 KB NDJSON across many
  delta message events, confirming the stream is flushed per event rather than buffered in bulk.

---

## 3. Event Type Discriminator

Every event object carries a `type` field as the discriminator. The six known types are:

| `type` value  | Schema `$defs` name | Description                                |
|---------------|---------------------|--------------------------------------------|
| `init`        | `InitEvent`         | Session initialization; first event emitted|
| `message`     | `MessageEvent`      | User or assistant text (delta or full)     |
| `tool_use`    | `ToolUseEvent`      | Tool invocation request from the model     |
| `tool_result` | `ToolResultEvent`   | Result returned from the invoked tool      |
| `error`       | `ErrorEvent`        | Structured error from the API layer        |
| `result`      | `ResultEvent`       | Terminal summary event; last event emitted |

All six types are present in `spec/events.schema.json` as `$defs` entries. Unknown `type`
values are handled by the lenient fallback (section 9) and are NOT modelled in the schema.

---

## 4. Per-Event-Type Reference

### 4.1 `init` — Session Initialization

**Discriminator:** `{"type": "init"}`

**Required fields:** `type`, `timestamp`, `session_id`, `model`

**Optional fields (schema extensions):** `_synthetic`, `_note` (used only in synthetic fixtures)

**Example (from `spec/fixtures/simple-text.ndjson`, line 1):**

```json
{"type":"init","timestamp":"2026-04-11T22:35:47.989Z","session_id":"<REDACTED_SESSION_ID>","model":"auto-gemini-3"}
```

The `session_id` is a UUID-formatted string that uniquely identifies the conversation session.
The SDK captures this value from the `init` event and exposes it via the session API (SES-01).

The `model` field reflects the model actually used — this may differ from the requested model
if the CLI's auto-routing selected a different variant (e.g., `auto-gemini-3` routing between
`gemini-2.5-flash-lite` and `gemini-3-flash-preview` as seen in the `stats.models` sub-object
of the terminal `result` event). When mismatch occurs, the SDK surfaces a
`ModelDowngradeWarning` per MDL-04.

**Evidence:** `spec/fixtures/simple-text.ndjson` (line 1), `spec/fixtures/thinking.ndjson`
(line 1 — model `gemini-2.5-pro`, pinned model request), `spec/fixtures/resume-session-turn2.ndjson`
(line 1 — second turn's init carries its own `session_id`).

---

### 4.2 `message` — User or Assistant Text

**Discriminator:** `{"type": "message"}`

**Required fields:** `type`, `timestamp`, `role`, `content`

**Optional fields:** `delta` (boolean) — present and `true` on streaming assistant chunks;
absent or `false` on user-role echo events.

**`role` values observed:** `"user"` (prompt echo) and `"assistant"` (model response).

**Streaming delta pattern:** The assistant response is emitted as one or more events with
`"delta": true`. These events MUST be concatenated in order to reconstruct the full response.
The terminal `result` event marks the end of all deltas; no explicit "end-of-stream" message
event is emitted.

**Example — user echo (from `spec/fixtures/simple-text.ndjson`, line 2):**

```json
{"type":"message","timestamp":"2026-04-11T22:35:47.991Z","role":"user","content":"Say \"hello\" in one word."}
```

**Example — assistant delta (from `spec/fixtures/simple-text.ndjson`, line 3):**

```json
{"type":"message","timestamp":"2026-04-11T22:35:50.616Z","role":"assistant","content":"hello","delta":true}
```

**Multi-delta streaming (from `spec/fixtures/large-output.ndjson`):** The 93 KB fixture
contains dozens of assistant delta events with multi-sentence content per chunk. No fixed chunk
size was observed; chunk boundaries are determined by the model's streaming cadence.

**Evidence:** `spec/fixtures/simple-text.ndjson` (lines 2–3), `spec/fixtures/large-output.ndjson`
(many assistant delta lines), `spec/fixtures/thinking.ndjson` (lines 2–5, three delta chunks).

---

### 4.3 `tool_use` — Tool Invocation

**Discriminator:** `{"type": "tool_use"}`

**Required fields:** `type`, `timestamp`, `tool_name`, `tool_id`, `parameters`

**`tool_id` format observed:** `{tool_name}_{unix_ms}_{counter}` — e.g.,
`"read_file_1775953086139_0"`. This is a stable correlation ID linking the `tool_use` event
to its paired `tool_result` event (see section 5).

**`parameters`** is an object with tool-specific fields (e.g., `{"file_path": "test.txt"}`
for the `read_file` tool).

**Example (from `spec/fixtures/tool-use-builtin.ndjson`, line 4):**

```json
{"type":"tool_use","timestamp":"2026-04-12T00:18:06.139Z","tool_name":"read_file","tool_id":"read_file_1775953086139_0","parameters":{"file_path":"test.txt"}}
```

**Evidence:** `spec/fixtures/tool-use-builtin.ndjson` (line 4),
`spec/fixtures/resume-session-turn1.ndjson` (line 4 — `save_memory` tool invocation that
resulted in a `tool_not_registered` error on this capture host).

---

### 4.4 `tool_result` — Tool Invocation Result

**Discriminator:** `{"type": "tool_result"}`

**Required fields:** `type`, `timestamp`, `tool_id`, `status`, `output`

**Optional fields:** `error` (object, present on failure — contains `type` and `message`)

**`status` values observed:** `"success"`, `"error"`

**`output` field:** A string; may be an empty string (`""`) on success when the tool produced
no readable output (observed: `spec/fixtures/tool-use-builtin.ndjson` line 5 — the
`read_file` result for `test.txt` returned `""` despite the file having content; the actual
content appeared in the subsequent assistant message stream).

**`error` field (on failure):** An object with `type` (string, e.g., `"tool_not_registered"`)
and `message` (string). Present only when `status` is `"error"`.

**Example — success with empty output (from `spec/fixtures/tool-use-builtin.ndjson`, line 5):**

```json
{"type":"tool_result","timestamp":"2026-04-12T00:18:06.217Z","tool_id":"read_file_1775953086139_0","status":"success","output":""}
```

**Example — error with error object (from `spec/fixtures/resume-session-turn1.ndjson`, line 5):**

```json
{"type":"tool_result","timestamp":"2026-04-12T12:32:55.592Z","tool_id":"save_memory_1775997175536_0","status":"error","output":"Tool \"save_memory\" not found. Did you mean one of: \"list_directory\", \"grep_search\", \"web_fetch\"?","error":{"type":"tool_not_registered","message":"Tool \"save_memory\" not found. Did you mean one of: \"list_directory\", \"grep_search\", \"web_fetch\""}}
```

**Evidence:** `spec/fixtures/tool-use-builtin.ndjson` (line 5),
`spec/fixtures/resume-session-turn1.ndjson` (line 5).

---

### 4.5 `error` — Structured API Error

**Discriminator:** `{"type": "error"}`

**Required fields:** `type`, `timestamp`, `error` (object)

**`error` object fields observed:** `message` (string), `code` (integer HTTP status code),
`status` (string — Google API status name)

**Example — auth failure (from `spec/fixtures/error-auth.ndjson`, line 2):**

```json
{"type":"error","timestamp":"2026-04-12T00:00:01.234Z","error":{"message":"API key not valid. Please pass a valid API key.","code":401,"status":"UNAUTHENTICATED"}}
```

**Example — rate limit (from `spec/fixtures/error-rate-limit.ndjson`, line 2):**

```json
{"type":"error","timestamp":"2026-04-12T00:01:01.456Z","error":{"message":"You have exceeded your quota. Please try again later.","code":429,"status":"RESOURCE_EXHAUSTED"}}
```

**NOTE on synthetic fixtures:** `spec/fixtures/error-auth.ndjson` and
`spec/fixtures/error-rate-limit.ndjson` are SYNTHETIC — the capture host uses OAuth auth
whose generous quota prevents triggering real 401/429 responses. The `error` event shapes are
derived from the known `gemini-cli` error format. Phase 5 will validate real shapes on an
API-key-only host.

**Evidence:** `spec/fixtures/error-auth.ndjson` (line 2),
`spec/fixtures/error-rate-limit.ndjson` (line 2).

---

### 4.6 `result` — Terminal Summary

**Discriminator:** `{"type": "result"}`

**Required fields:** `type`, `timestamp`, `status`, `stats`

**`status` values observed:** `"success"` (normal completion).

**`stats` object fields observed:**
- `total_tokens` (integer)
- `input_tokens` (integer)
- `output_tokens` (integer)
- `cached` (integer — cache-hit token count)
- `input` (integer — uncached input tokens)
- `duration_ms` (integer — total wall-clock time)
- `tool_calls` (integer — count of tool invocations in this session turn)
- `models` (object — per-model token breakdown, keyed by model name)

**The `result` event is always the LAST event in a successful stream.** Its absence (stream
ends without `result`) signals truncation or crash — the ERR-06 test case (section 8).

**Example (from `spec/fixtures/simple-text.ndjson`, line 4):**

```json
{"type":"result","timestamp":"2026-04-11T22:35:50.663Z","status":"success","stats":{"total_tokens":10270,"input_tokens":10155,"output_tokens":31,"cached":5818,"input":4337,"duration_ms":2674,"tool_calls":0,"models":{"gemini-2.5-flash-lite":{"total_tokens":1514,"input_tokens":1433,"output_tokens":30,"cached":0,"input":1433},"gemini-3-flash-preview":{"total_tokens":8756,"input_tokens":8722,"output_tokens":1,"cached":5818,"input":2904}}}}
```

**Evidence:** `spec/fixtures/simple-text.ndjson` (line 4),
`spec/fixtures/tool-use-builtin.ndjson` (line 9), `spec/fixtures/large-output.ndjson` (last
line — confirms terminal event still emitted after large streaming output).

---

## 5. Tool Use / Tool Result Pairing

**Load-bearing for PRS-07.** The SDK must guarantee `tool_use` and `tool_result` chunks are
always paired before forwarding to the caller.

**Correlation mechanism observed in `spec/fixtures/tool-use-builtin.ndjson`:**

The `tool_id` field is present on BOTH the `tool_use` event (line 4) and the paired
`tool_result` event (line 5), and their values are identical:

```
tool_use   → tool_id: "read_file_1775953086139_0"
tool_result → tool_id: "read_file_1775953086139_0"
```

**Conclusion: pairing is by `tool_id` identity, not positional.** The `tool_id` is a stable
correlation key generated at the time of tool invocation (format: `{tool_name}_{unix_ms}_{counter}`).

**Phase 3 implication (PRS-07):** The parser MUST track an in-flight map of `tool_id → tool_use`
event and emit a paired structure when the matching `tool_result` arrives. Positional pairing
(Nth `tool_use` with Nth `tool_result`) is NOT correct for concurrent tool invocations.

**Edge case (from `spec/fixtures/resume-session-turn1.ndjson`, line 4–5):** The `save_memory`
tool was called but is not registered on this capture host; the `tool_result` still carries the
matching `tool_id` and `status: "error"`, so the pairing contract holds even on tool failure.

**Evidence:** `spec/fixtures/tool-use-builtin.ndjson` (lines 4–5),
`spec/fixtures/resume-session-turn1.ndjson` (lines 4–5).

---

## 6. Session Resume Flow

**Feasibility verdict:** PASS — all 9 cells of the `--resume × prompt-mode` matrix pass on
`gemini-cli@0.37.1` (see `spec/feasibility.md`).

### 6.1 Init event carries session_id (SES-01)

Every gemini-cli NDJSON stream begins with an `init` event carrying a `session_id`
(UUID-shaped string) and `model` field. The SDK captures these into a `Session`
value object exposed on `QueryResult.session` (TS) / `result["session"]` (Python).

**Evidence:** `spec/fixtures/resume-session-turn1.ndjson` line 1 —
`{"type":"init", "session_id":"<REDACTED_SESSION_ID>", "model":"auto-gemini-3", ...}`

### 6.2 Resume via --resume \<id\> -p \<prompt\> (SES-02)

To resume a session, the SDK invokes gemini-cli with `--resume <id>` placed BEFORE
the `-p <prompt>` pair. Phase 1's feasibility matrix (`resume_verdict=pass`) confirmed
all 9 cells of (--resume × prompt-mode) pass against `gemini-cli@0.37.1`.

**Evidence:** `spec/fixtures/resume-session-turn2.ndjson` — captured via
`--resume <id> -p "What number did I just say?"`; assistant's response text
"You just said that your favorite number is **47**" demonstrates context recall
from turn 1 (which established the favorite number).

### 6.3 Resumed turns emit their own init event

A resumed turn (turn 2+) emits its OWN `init` event at stream start. The SDK's
mismatch detection compares the `session_id` in that init event against the
`<id>` passed to `--resume`; divergence is annotated non-fatally via the optional
`ResultChunk.requestedSessionId` / `actualSessionId` fields (symmetric with the
MDL-04 model-mismatch pattern).

**Evidence:** `spec/fixtures/resume-session-turn2.ndjson` line 1 — turn 2's init
event (redacted session_id — equality with turn 1's id cannot be confirmed from the
fixture alone; mismatch detection is intentionally non-fatal to tolerate either case).

### 6.4 Transcript-prepend fallback (SES-04)

Dark-shipped behind the environment variable `GEMINI_SDK_TRANSCRIPT_FALLBACK=1`.
Activation requires BOTH the env var AND a `Session` object carrying a populated
`transcript` field. When active, the SDK OMITS `--resume` and prepends the prior
turn transcript into the `-p` prompt string using the deterministic format
`User: <content>\nAssistant: <content>\n\nUser: <new prompt>`.

**Purpose:** A one-env-var flip away from a working workaround if upstream
gemini-cli issue #14180 regresses. The fallback lives inside `buildArgv` only
(per SES-04 literal wording); `query()` is agnostic.

**Not a QueryOptions field** — env var is invisible unless intentionally set,
matching the `GEMINI_BIN_PATH` / `GEMINI_CONFIG_DIR` / `GEMINI_SYSTEM_MD` pattern.

---

## 7. Thinking Events

**Finding:** Extended reasoning does NOT emit `thinking`-type events in gemini-cli headless
mode, even when using `gemini-2.5-pro` with an explicit "think step by step" prompt.

**Fixture `spec/fixtures/thinking.ndjson`** was captured using `gemini-2.5-pro` with prompt
`"What is 23*17? Think step by step."`. The stream contains only standard event types:
`init`, three `message` (delta) events, and `result`. No `thinking`-typed event appears.

The model's reasoning is embedded inline in the assistant `message` content (e.g.,
`"Step 1: Multiply 23 by 10..."`), not in a dedicated `thinking` event.

**Phase 3 implication:** Phase 3 must synthesize a `thinking` variant fixture from structural
knowledge (per RESEARCH.md §"Open Questions" #4) since no real `thinking` event was captured.
The schema `$defs` does not include a `ThinkingEvent` entry — if upstream adds one, the
parser's lenient fallback (section 9) will forward it as `{type: 'unknown', raw}` until the
schema is updated.

**Evidence:** `spec/fixtures/thinking.ndjson` (lines 1–6 — absence of thinking events
confirmed).

---

## 8. Multimodal References

**Attachment syntax:** Multimodal inputs use the `@path/to/file` inline syntax within the
prompt text. The attachment is NOT emitted as a separate event type — it is embedded in the
user `message` event's `content` string.

**Image example (from `spec/fixtures/multimodal-image.ndjson`, line 2):**

```json
{"type":"message","timestamp":"2026-04-12T12:33:21.487Z","role":"user","content":"Describe @spec/fixtures/_assets/sample-image.png in one sentence."}
```

The `@`-prefixed path is passed verbatim to `gemini-cli`. The CLI resolves the file, encodes
it, and forwards it to the Gemini API. The SDK does not need to handle the attachment —
callers embed `@path` references directly in the prompt string.

**PDF example (from `spec/fixtures/multimodal-pdf.ndjson`, line 2):**

```json
{"type":"message","timestamp":"2026-04-12T12:33:35.396Z","role":"user","content":"Summarize @spec/fixtures/_assets/sample-document.pdf in one sentence."}
```

**Implication:** The SDK does not need an explicit `attachments` option in v1 — callers embed
`@path` references in the `prompt` string. A higher-level helper may be added in a later phase.

**Evidence:** `spec/fixtures/multimodal-image.ndjson` (line 2),
`spec/fixtures/multimodal-pdf.ndjson` (line 2).

---

## 9. Truncation / Abort Semantics

**Finding:** When the `gemini-cli` child process is killed mid-run, the NDJSON stream is
empty (zero events) if the abort occurs before the first event is flushed.

**Fixture `spec/fixtures/abort-midstream.ndjson`** was captured by spawning a long-running
prompt and sending SIGTERM at approximately 2 seconds. On Windows with OAuth auth, the process
terminates before any JSON event line is written to stdout. The fixture file contains a single
whitespace byte (effectively empty NDJSON).

**Key observations:**
- No partial JSON line is emitted when the process is killed before stdout is flushed.
- No terminal `result` event is emitted — this is the ERR-06 test case.
- `abort-midstream.expected.json` records `exit_code: 1` and `chunks: []` (empty).
- `aborted: true` in the sidecar marks this as an intentional truncation scenario.

**Phase 5 implication (ERR-06):** The SDK MUST raise `ProcessError` if the stream ends
(stdout EOF + child exit) without a terminal `result` event, regardless of whether the exit
code is zero.

**Evidence:** `spec/fixtures/abort-midstream.ndjson` (1-byte empty file — absence of events
is itself the evidence), `spec/fixtures/abort-midstream.expected.json` (exit_code=1, aborted=true).

---

## 10. Unknown Event Handling

**Contract (PRS-03):** Unknown `type` values MUST yield `{type: 'unknown', raw: <original event>}`
in the parser output and MUST NOT throw.

**Synthetic test fixture `spec/fixtures/event-unknown.ndjson`** was created by mutating the
`type` field of a real `init` event from `spec/fixtures/simple-text.ndjson` line 1, replacing
it with the invented value `"cosmic_ray_hit"`. This fixture is marked `_synthetic: true` and
is used by Phase 3 PRS-03 test coverage.

**Example (from `spec/fixtures/event-unknown.ndjson`, line 1):**

```json
{"type":"cosmic_ray_hit","timestamp":"2026-04-11T22:35:47.989Z","session_id":"<REDACTED_SESSION_ID>","model":"auto-gemini-3","_synthetic":true}
```

**Parser contract:** When an event's `type` field does not match any known discriminator
value, the parser emits `{type: 'unknown', raw: <original parsed object>}` downstream.
The original object is forwarded intact so callers can inspect it.

**Evidence:** `spec/fixtures/event-unknown.ndjson` (line 1 — synthetic type-mutation fixture).

---

## 11. Open Questions / Known Gaps

The following items from RESEARCH.md §"Open Questions" remain unresolved by the Phase 1
fixture corpus. Each is documented with the fixture (or absence thereof) that bounds the gap.

1. **Concurrent tool calls:** The fixture corpus contains only single-tool invocations.
   Whether `gemini-cli` emits interleaved `tool_use` / `tool_result` pairs (concurrent MCP
   calls) is unconfirmed. Fixture evidence: `spec/fixtures/tool-use-builtin.ndjson` (single
   `read_file` call only). Phase 3 must synthesize a multi-tool fixture.

2. **`thinking` event type:** No `thinking`-typed events were observed in
   `spec/fixtures/thinking.ndjson` (gemini-2.5-pro, headless mode). If upstream adds a native
   `thinking` event, it will be forwarded as `{type: 'unknown', raw}` until Phase 3 updates
   the schema.

3. **Real auth / rate-limit stderr format:** `spec/fixtures/error-auth.stderr.txt` and
   `spec/fixtures/error-rate-limit.stderr.txt` are SYNTHETIC (host uses OAuth). Phase 5 must
   re-capture against an API-key-only host to validate real stderr fingerprints.

4. **`result.status` values other than `"success"`:** Only `"success"` was observed across
   all real captures. Whether the CLI emits a non-success `result` event (rather than omitting
   `result` entirely) on partial failures is unknown. `spec/fixtures/abort-midstream.ndjson`
   shows zero events (no `result`) on hard abort.

5. **`Retry-After` header hint in rate-limit stream:** The synthetic
   `spec/fixtures/error-rate-limit.ndjson` does not include a `retryAfter` field in the
   `error` object. Whether real 429 responses surface a `Retry-After` hint is unconfirmed;
   Phase 5 should capture this.

6. **Model deprecation post-2026-06-17:** The `gemini-2.5-flash-lite` and
   `gemini-3-flash-preview` model names seen in fixture `stats.models` objects may change
   when the 2.5 series is deprecated. The `auto-gemini-3` model string (seen in `init.model`)
   is the recommended escape hatch per MDL-03.
