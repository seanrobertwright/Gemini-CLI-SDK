# Phase 7: Session Resume + Multi-Turn — Research

**Researched:** 2026-04-19
**Domain:** Session identity, argv construction, transcript-prepend fallback, multi-turn continuity
**Confidence:** HIGH — all material decisions are grounded in captured fixtures, live source code,
  and an empirically-validated feasibility verdict.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Session value object shape**
- Plain immutable record, three required fields: `id: string`, `model: string`, `createdAt: string`.
- Optional fourth field: `transcript?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>`.
- No class, no methods, no `toJSON`/`fromJSON`. TS `Readonly<interface>`, Python `@dataclass(frozen=True)`.
- JSON round-trip free: `JSON.parse(JSON.stringify(s))` yields an equivalent Session.
- Two construction paths: (1) returned from `queryFull()` as `QueryResult.session`; (2) built directly by caller from stored string `{ id: savedId, model: "", createdAt: "" }`.
- No stream-capture side-channel on `query()`.

**Resume API surface**
- Single `options.session` field accepting `Session | string`. SDK normalises internally.
- `QueryResult` gains `.session: Session` alongside existing `.sessionId: string`. Additive.
- `buildArgv` branch: no session → no `--resume`; session + fallback env NOT set → `--resume <id> -p <prompt>`; session + fallback env SET + `session.transcript` present → omit `--resume`, prepend transcript.
- Name chosen: `session` (not `resume` or `resumeSession`).

**Transcript-prepend fallback gating (SES-04)**
- Activation: env var `GEMINI_SDK_TRANSCRIPT_FALLBACK=1`. Absent/empty → fallback off.
- NOT a `QueryOptions` field. Dark-shipped — invisible unless documented internally.
- Semantics: always-on when set, not auto-retry. Single deterministic branch in `buildArgv`.
- `Session` carries optional `transcript` array. Undefined when fallback is off.
- Each new turn produces a NEW Session with extended transcript — never mutates.

**Bad/missing session-id error handling**
- Layer 1: pre-spawn guard in `query()` — empty/whitespace id throws `InvalidPromptError("session id is empty")`. Runs BEFORE `resolveAuth`.
- Layer 2: init-event mismatch detection — `ResultChunk` gains optional `requestedSessionId` + `actualSessionId` (non-fatal).
- Layer 3: existing `ErrorMapper` catch-all handles CLI-side session errors.
- NO new error subclass added in Phase 7 (evidence-driven rule; research may produce one if bad-id probe shows distinct stderr pattern).

**No `SessionNotFoundError` upfront** — Phase 5 rule: classes require real captured stderr patterns.

### Claude's Discretion

- Exact file layout under `ts/src/session/` and `python/src/gemini_sdk/session/` (barrel exports, naming).
- Whether `Session.transcript` entries include timestamps or tool calls beyond `{ role, content }`.
- Prompt format string used when prepending transcript (e.g. `"User: ...\nAssistant: ...\n\nUser: <new>"` vs. richer template). Must be deterministic and unit-testable.
- Whether `queryFull()` is the only path that populates `Session.transcript` or `query()` also accumulates.
- Exact wording of `InvalidPromptError` message for empty session ids.
- Whether bad-id probe runs on all three OSes or Windows only.
- Python-side naming (`created_at` vs `createdAt` — parity says `snake_case`).

### Deferred Ideas (OUT OF SCOPE)

- `SessionNotFoundError` subclass — add only if Phase 7 research yields a distinct stderr pattern.
- `forkSession(id)` — SES-V2-01, checkpoint-file format stability required.
- Durable session serialization — SES-V2-02.
- Session turn count / token accumulation on `QueryResult`.
- `SessionHistory` / list-sessions helper.
- Auto-detect fallback activation from runtime compat probe.
- Expose transcript-prepend format string as a `QueryOptions` field.
- Session expiration / TTL.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SES-01 | SDK captures session ID from the `stream-json` `init` event | `init` event `session_id` field confirmed in `spec/fixtures/resume-session-turn1.ndjson` line 1 and `spec/protocol.md` §4.1; already dispatched as `SystemChunk.sessionId` by existing parser |
| SES-02 | SDK resumes a session by passing `--resume <id>` when `resumeSessionId` is provided | `spec/feasibility.md` `resume_verdict=pass`; `buildArgv` is a pure function where the new branch is surgical; captured turn-2 fixture proves `--resume <id> -p` works |
| SES-03 | SDK provides a `Session` value object (immutable, identifier-based; NOT process-bound) | Decision locked: `Readonly<interface>` in TS, `@dataclass(frozen=True)` in Python; no process handles; JSON round-trip trivial |
| SES-04 | SDK includes transcript-prepend fallback gated on Phase-1 verdict | Phase-1 verdict: `resume_verdict=pass` → fallback dark-shipped behind `GEMINI_SDK_TRANSCRIPT_FALLBACK=1` env var; fallback logic lives in `buildArgv` only |
</phase_requirements>

---

## Summary

Phase 7 ships session continuity for the SDK. The work is purely additive — no existing module is refactored. A new `session/` directory follows the Phase 5/6 "new module = new directory" convention. The `buildArgv` pure function gains a single three-way branch (no session / `--resume <id>` / transcript-prepend). The `query()` composer gains a pre-spawn guard and init-event mismatch detection mirroring the MDL-04 pattern. `QueryResult` and `QueryOptions` each receive one additive field.

The **Phase-1 feasibility verdict is `resume_verdict=pass`** (all 9 cells of the `--resume × prompt-mode` matrix pass on `gemini-cli@0.37.1`). This is the single most important upstream fact for Phase 7: the primary session path is `--resume <id> -p <prompt>` and the transcript-prepend fallback is dark-shipped behind `GEMINI_SDK_TRANSCRIPT_FALLBACK=1`. The fallback is code-complete but inactive by default.

The existing fixture corpus (`spec/fixtures/resume-session-turn{1,2}.ndjson` + `.expected.json`) already covers the happy-path multi-turn test. Phase 7 does not need new fixture captures for SC-1 or SC-2. The empirical bad-id probe (empty-session-id or `gemini --resume nonexistent-id -p "hello"`) is a Phase 7 research deliverable that may produce a one-off fixture addition — but only if the stderr pattern is distinct.

**Primary recommendation:** Implement the three-file kernel (`Session.ts`, `Session.spec.ts`, and their Python mirrors), extend `buildArgv` + `query()` + types with additive fields, and dark-ship the transcript-prepend fallback. No error subclass, no new fixtures, no parser changes.

---

## Standard Stack

### Core (all previously installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript (existing) | project-pinned | `Readonly<interface>` for `Session` type | Already in use; `Readonly<T>` is stdlib |
| Python `dataclasses` + `frozen=True` | stdlib 3.10+ | `Session` value object | Consistent with Phase 5 error data classes; no new dep |
| `fast-check` (existing) | project-pinned | Property-based fuzz on `buildArgv` with new `session` option | Already used in `buildArgv.spec.ts` |
| `hypothesis` (existing) | `>=6.0` | Python fuzz mirror | Already in `pyproject.toml` dev deps |
| `vitest` (existing) | `^3.2` | TS unit + integration tests | Project-pinned; Node 18 compat locked |
| `pytest` (existing) | `>=8.0` | Python unit tests | Project standard |

**No new packages required.** All needed libraries are present in the monorepo.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Readonly<interface>` | `class` with `Object.freeze()` | Class would appear in typedoc/autocomplete as a constructor; plain record is simpler for JSON round-trip and Archon adapter forwarding |
| `@dataclass(frozen=True)` | Pydantic `BaseModel` | Pydantic already excluded from runtime deps; `dataclass` is stdlib and consistent with Phase 4 `QueryResult` pattern |
| env var gating | `QueryOptions` boolean field | A public field leaks into typedoc and autocomplete, breaking "dark-shipped" intent |

---

## Architecture Patterns

### New Module Layout

```
ts/src/session/
├── Session.ts          # Session interface + helper (normalise session|string → id)
├── Session.spec.ts     # Round-trip, construction paths, mismatch guard tests
└── index.ts            # Barrel: export Session type + normaliseSessionId

python/src/gemini_sdk/session/
├── session.py          # @dataclass(frozen=True) + normalise_session_id helper
├── __init__.py         # Barrel: Session, normalise_session_id
python/tests/session/
└── test_session.py     # Mirror of Session.spec.ts test names (parity enforced)
```

### Pattern 1: Session Type Definition

**TS canonical:**
```typescript
// ts/src/session/Session.ts
export interface Session {
  readonly id: string;
  readonly model: string;
  readonly createdAt: string;
  readonly transcript?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

/** Normalise Session | string to a session id string. */
export function normaliseSessionId(session: Session | string): string {
  return typeof session === 'string' ? session : session.id;
}
```

**Python mirror (snake_case per parity convention):**
```python
# python/src/gemini_sdk/session/session.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Tuple

@dataclass(frozen=True)
class TranscriptEntry:
    role: str          # "user" | "assistant"
    content: str

@dataclass(frozen=True)
class Session:
    id: str
    model: str
    created_at: str
    transcript: Optional[Tuple[TranscriptEntry, ...]] = field(default=None)

def normalise_session_id(session: "Session | str") -> str:
    if isinstance(session, str):
        return session
    return session.id
```

Note: Python uses `tuple` (immutable) not `list` for transcript to honour `frozen=True` semantics. `Tuple[TranscriptEntry, ...]` is the Python counterpart of `ReadonlyArray`.

### Pattern 2: buildArgv Extension (three-way branch)

The branch is inserted BEFORE the `additionalDirectories` block (session state precedes directory scoping in argv order). This is a surgical additive change to `buildArgv.ts` and `build_argv.py`:

```typescript
// Inserted into buildArgv.ts after model block, before additionalDirectories block
if (options.session) {
  const id = normaliseSessionId(options.session);
  const fallbackActive = process.env['GEMINI_SDK_TRANSCRIPT_FALLBACK'] === '1';
  const hasTranscript =
    typeof options.session !== 'string' && options.session.transcript?.length;

  if (fallbackActive && hasTranscript) {
    // Transcript-prepend path: prompt = formatted prior turns + new prompt
    const session = options.session as Session;
    const priorTurns = session.transcript!
      .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n');
    argv[3] = `${priorTurns}\n\nUser: ${options.prompt}`;
    // --resume intentionally omitted; fallback uses single -p call with full context
  } else {
    // Primary path (resume_verdict=pass): --resume <id> before -p
    argv.splice(2, 0, '--resume', id);
    // -p is now at index 4 (splice shifted it), value unchanged
  }
}
```

**Important:** `argv` starts as `['--output-format', 'stream-json', '-p', prompt]`. Inserting `--resume <id>` with `splice(2, 0, ...)` shifts `-p` to index 4. The prompt value at argv[3] is replaced in the fallback path; the primary path splices before index 2. The planner should verify index arithmetic in tests.

**Python mirror:** `build_argv.py` appends `["--resume", session_id]` before `["-p", prompt]` using list construction (Python's `build_argv` builds the list in parts; inserting before `-p` is cleaner than `list.insert`).

Simpler Python approach — rebuild the list with `--resume` in position:
```python
if session := options.get("session"):
    session_id = normalise_session_id(session)
    fallback_active = os.environ.get("GEMINI_SDK_TRANSCRIPT_FALLBACK") == "1"
    has_transcript = (
        not isinstance(session, str)
        and session.transcript
        and len(session.transcript) > 0
    )
    if fallback_active and has_transcript:
        prior = "\n".join(
            f"{'User' if t.role == 'user' else 'Assistant'}: {t.content}"
            for t in session.transcript  # type: ignore[union-attr]
        )
        argv = ["--output-format", "stream-json", "-p", f"{prior}\n\nUser: {options['prompt']}"]
        # --resume intentionally omitted; fallback uses full transcript prepend
    else:
        argv = ["--output-format", "stream-json", "--resume", session_id, "-p", options["prompt"]]
```

The planner should decide: is it cleaner to inject `--resume` into the existing list or rebuild it? The Python approach above rebuilds; the TS approach splices. Both are pure-function safe. Recommend rebuilding in both languages for clarity.

### Pattern 3: query() Pre-Spawn Guard (SES-01 + mismatch detection)

Inserted at the TOP of `query()`, before `resolveAuth`:
```typescript
// Layer 1 guard — before resolveAuth (cheapest checks first)
if (options.session) {
  const id = normaliseSessionId(options.session);
  if (!id || !id.trim()) {
    throw new InvalidPromptError('session id is empty');
  }
}
```

Inserted in the dispatch loop after `actualModel` capture:
```typescript
// Layer 2 — mismatch detection (symmetric with MDL-04)
if (chunk.type === 'result') {
  sawResult = true;
  const enrichedResult: ResultChunk = { ...chunk as ResultChunk };
  // MDL-04: model mismatch
  if (requestedModel && actualModel && requestedModel !== actualModel) {
    enrichedResult.requestedModel = requestedModel;
    enrichedResult.actualModel = actualModel;
  }
  // SES mismatch detection
  if (options.session) {
    const requestedSessionId = normaliseSessionId(options.session);
    const actualSessionId = (chunk as ResultChunk).sessionId;
    if (requestedSessionId !== actualSessionId) {
      enrichedResult.requestedSessionId = requestedSessionId;
      enrichedResult.actualSessionId = actualSessionId;
    }
  }
  // ...
}
```

Note: `requestedSessionId`/`actualSessionId` must be added to `ResultChunk` in `parser/types.ts` as optional fields (both TS and Python mirror).

### Pattern 4: QueryResult.session population in queryFull()

```typescript
export async function queryFull(options: QueryOptions): Promise<QueryResult> {
  // ...existing accumulation...
  let sessionObj: Session | undefined;

  for await (const chunk of query(options)) {
    chunks.push(chunk);
    if (chunk.type === 'assistant') text += chunk.content;
    if (chunk.type === 'result') {
      sessionId = chunk.sessionId;
      stopReason = chunk.stopReason;
      // Construct Session from init event data (captured via SystemChunk earlier)
      // initSessionId and initModel captured during iteration before result chunk
    }
    if (chunk.type === 'system' && chunk.subtype === 'init') {
      // Capture for Session construction
      initSessionId = chunk.sessionId ?? '';
      initModel = chunk.model ?? '';
    }
  }

  sessionObj = {
    id: initSessionId,
    model: initModel,
    createdAt: new Date().toISOString(), // wall clock at queryFull call time
    // transcript populated only when fallback env var is set (Claude's discretion — planner decides)
  };

  return { text, sessionId, session: sessionObj, stopReason, chunks };
}
```

The `createdAt` field is the SDK's wall-clock timestamp of when `queryFull()` ran (the `init` event has its own `timestamp` field but it is already in the NDJSON, not a constructor arg). Using `new Date().toISOString()` is consistent and deterministic for tests via `vi.useFakeTimers()`.

### Pattern 5: Transcript Accumulation (fallback path, queryFull only)

When `GEMINI_SDK_TRANSCRIPT_FALLBACK=1` and `queryFull()` is called with an existing `session`:

```typescript
// Before returning, extend transcript
const priorTranscript = typeof options.session !== 'string'
  ? (options.session as Session).transcript ?? []
  : [];
const newEntries = chunks
  .filter(c => c.type === 'assistant' || (c.type === 'system' && c.subtype === 'message' && c.role === 'user'))
  .map(c => c.type === 'assistant'
    ? { role: 'assistant' as const, content: (c as AssistantChunk).content }
    : { role: 'user' as const, content: (c as SystemChunk).content ?? '' }
  );
sessionObj = { ...sessionObj!, transcript: [...priorTranscript, ...newEntries] };
```

Each call to `queryFull()` returns a NEW `Session` with the accumulated transcript. Old `Session` instances remain valid (immutability preserved, callers can "rewind").

### Anti-Patterns to Avoid

- **Mutating argv array in-place after construction:** `buildArgv` must remain a pure function. No `push`-after-the-fact on the `-p` index; rebuild or splice before returning.
- **Reading `process.env` inside `buildArgv`:** The GEMINI_SDK_TRANSCRIPT_FALLBACK check in `buildArgv` reads `process.env` — this is acceptable for a compile-time-known env flag, but the planner may prefer to pass `fallbackActive: boolean` as a parameter to keep `buildArgv` fully pure. Document the trade-off.
- **Storing process handles in Session:** `Session` must be plain data. No reference to the subprocess, no stream handle, no file descriptor.
- **Blocking on transcript accumulation in streaming `query()`:** Transcript accumulation belongs only in `queryFull()`. Streaming callers pull `sessionId` off the `init` SystemChunk on the wire.
- **`SessionNotFoundError` before empirical capture:** Phase 5 rule — no new error class without a real captured stderr pattern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON round-trip serialization | Custom `toJSON`/`fromJSON` | Plain `Readonly<interface>` + `JSON.parse(JSON.stringify(s))` | Standard JSON handles all scalar fields; no date objects in Session |
| Immutable record in Python | Custom `__setattr__` override | `@dataclass(frozen=True)` | Python stdlib; raises `FrozenInstanceError` on mutation attempt |
| Property-based fuzz for new `session` option | Manual combinatorial cases | `fast-check` (TS) / `hypothesis` (Python) — extend existing fuzz tests | Already present in `buildArgv.spec.ts`; add `session` option to the existing fc.record |
| Mismatch detection logic | Custom diff | Mirror the MDL-04 `requestedModel`/`actualModel` pattern exactly | Already battle-tested and paired with ResultChunk extension |
| Transcript prepend format | Markdown or JSON format | Simple `"User: ...\nAssistant: ...\n\nUser: <new>"` | Deterministic, unit-testable, readable in CLI debug output |

---

## Common Pitfalls

### Pitfall 1: buildArgv reads process.env (purity concern)

**What goes wrong:** `buildArgv` becomes impure if it calls `process.env['GEMINI_SDK_TRANSCRIPT_FALLBACK']` directly. The existing fuzz tests assume `buildArgv` is a pure function. Tests that mock the env var become order-sensitive.

**Why it happens:** The transcript-prepend gate is an env var, and it lives inside `buildArgv` per the locked decision ("logic location honors SES-04 literally"). Reading env inside a pure function is a side effect.

**How to avoid:** Two options: (a) accept it as a "configuration read" side effect (like `buildArgv` already implicitly depends on `GEMINI_BIN_PATH` resolution upstream), and document it; or (b) pass `fallbackActive: boolean` as a second parameter to `buildArgv`. Option (b) is cleaner for fuzz tests. Planner should pick one and update the fuzz test accordingly.

**Warning signs:** Fuzz test failures after adding `session` option, or tests that pass in isolation but fail in parallel (env var state leak).

### Pitfall 2: Turn 2 init event session_id differs from Turn 1 session_id

**What goes wrong:** The resume fixture (`resume-session-turn2.ndjson`) shows that turn 2 emits its OWN `init` event with its own `session_id`. This `session_id` may or may not match the turn-1 id depending on gemini-cli's internal checkpoint mechanics. The mismatch detection logic checks whether the `init` event's `session_id` matches the `--resume <id>` argument passed.

**What the fixtures show:** Both turns have `<REDACTED_SESSION_ID>` in the fixture (redacted), so the exact value cannot be confirmed from the fixture alone. `spec/protocol.md` §6 states "Turn 2 — resumed session emits a NEW `init` event with its own `session_id`" but does not confirm whether the two ids are equal.

**How to avoid:** The mismatch detection compares `requestedSessionId` (what was passed to `--resume`) against `actualSessionId` (the `init` event's `session_id` on the resumed turn). If gemini-cli issues a new id on resume, every resumed turn would trigger mismatch — that would be a protocol quirk to document, not an error. The mismatch detection should be NON-fatal (annotations only on `ResultChunk`).

**Warning signs:** All resumed queries showing `requestedSessionId !== actualSessionId`. If this happens in the integration test, document it and relax the mismatch check.

### Pitfall 3: `--resume` flag position in argv

**What goes wrong:** gemini-cli's `--resume` flag must appear BEFORE the `-p` flag in argv. The existing `buildArgv` always puts `-p` at index 2-3. If `--resume <id>` is appended AFTER `-p`, gemini-cli may interpret it incorrectly or ignore it.

**How to avoid:** The `--resume <id>` pair must be inserted BEFORE `-p`. In the TS splice approach: `argv.splice(2, 0, '--resume', id)` before `-p` which was at index 2. In the rebuild approach: `['--output-format', 'stream-json', '--resume', id, '-p', prompt]`. Verify against `gemini-cli` docs and the Phase 1 test matrix (which confirmed `--resume <id> -p` works).

**Evidence from feasibility:** Phase 1 row `"-p flag | --resume <id>" → PASS` confirms the working combination is `gemini --resume <id> -p <prompt>` (resume before -p).

### Pitfall 4: Python `frozen=True` with mutable transcript type

**What goes wrong:** `@dataclass(frozen=True)` requires all fields to be hashable. `list` is not hashable. Using `list[TranscriptEntry]` for `transcript` will raise `TypeError: unhashable type 'list'` on construction or hashing.

**How to avoid:** Use `tuple[TranscriptEntry, ...]` for the Python transcript field. The TS counterpart is `ReadonlyArray` which is structurally tuple-like. When extending transcript across turns, create a new `Session` with `transcript=(*old.transcript, new_entry)` (tuple concatenation, not `.append()`).

### Pitfall 5: diff-test-names.sh parity enforcement

**What goes wrong:** Phase 7 adds new test files. Every `it('description')` in `Session.spec.ts` must have a matching `def test_xxx(self): """description"""` docstring in `test_session.py`. If descriptions don't match exactly (including capitalisation, punctuation), `diff-test-names.sh` blocks CI.

**How to avoid:** Write TS test names first, then copy them verbatim as Python docstrings. Avoid internal quotes in TS `it()` descriptions (prior known issue from Phase 04 — grep truncates at inner quotes). Use em-dash or colon instead of inner quotes.

### Pitfall 6: `GEMINI_SDK_TRANSCRIPT_FALLBACK` must NOT be in EnvBuilder allowlist

**What goes wrong:** If `GEMINI_SDK_TRANSCRIPT_FALLBACK` is added to `ts/src/process/EnvBuilder.ts`'s `ALLOWED_KEYS`, it will be forwarded to the subprocess. This is wrong — the flag is read by the SDK, not the CLI.

**How to avoid:** The SDK reads this env var directly from `process.env` (or is passed as a parameter). It is never forwarded to the subprocess. The CONTEXT.md explicitly documents this (Phase 6 code context section). Do not add it to `ALLOWED_KEYS`.

---

## Code Examples

Verified patterns from existing source:

### SystemChunk.sessionId — where session_id already lives

```typescript
// Source: ts/src/parser/types.ts (confirmed existing)
export interface SystemChunk {
  type: 'system';
  subtype: 'init' | 'message';
  sessionId?: string;   // ← populated from init event's session_id field
  model?: string;
  role?: string;
  content?: string;
}
```

The `sessionId` is already on `SystemChunk` (dispatched by Phase 3). Session construction reads it from here — no parser changes needed.

### ResultChunk — existing requestedModel/actualModel pattern (MDL-04 template)

```typescript
// Source: ts/src/parser/types.ts (confirmed existing)
export interface ResultChunk {
  type: 'result';
  sessionId: string;
  stopReason: string;
  requestedModel?: string;  // MDL-04: populated only on mismatch
  actualModel?: string;     // MDL-04: populated only on mismatch
  // Phase 7 adds:
  // requestedSessionId?: string;
  // actualSessionId?: string;
}
```

### Existing queryFull() accumulation pattern

```typescript
// Source: ts/src/query/query.ts (confirmed existing)
export async function queryFull(options: QueryOptions): Promise<QueryResult> {
  const chunks: MessageChunk[] = [];
  let text = '';
  let sessionId = '';
  let stopReason = '';

  for await (const chunk of query(options)) {
    chunks.push(chunk);
    if (chunk.type === 'assistant') text += chunk.content;
    if (chunk.type === 'result') {
      sessionId = chunk.sessionId;     // ← already captured
      stopReason = chunk.stopReason;
    }
  }

  return { text, sessionId, stopReason, chunks };
}
// Phase 7: add 'session: Session' field populated from init SystemChunk + result sessionId
```

### Existing buildArgv pure-function shape

```typescript
// Source: ts/src/query/buildArgv.ts (confirmed existing)
export function buildArgv(options: QueryOptions): string[] {
  const argv: string[] = [
    '--output-format', 'stream-json',
    '-p', options.prompt,
  ];
  // model branch...
  // additionalDirectories branch...
  return argv;
}
// Phase 7 inserts a session branch between the preamble and model/dirs blocks
```

### Resume fixture — confirmed happy path shape

```ndjson
// Source: spec/fixtures/resume-session-turn2.ndjson (confirmed captured 2026-04-12)
{"type":"init","timestamp":"2026-04-12T12:33:07.492Z","session_id":"<REDACTED_SESSION_ID>","model":"auto-gemini-3"}
{"type":"message","timestamp":"2026-04-12T12:33:07.493Z","role":"user","content":"What number did I just say?"}
{"type":"message","timestamp":"2026-04-12T12:33:11.631Z","role":"assistant","content":"You just said that your favorite number is **47**.","delta":true}
{"type":"result","timestamp":"2026-04-12T12:33:11.687Z","status":"success","stats":{...}}
```

Context recall confirmed: assistant answered "47" without re-prompting. This is the evidence for SC-1.

### Python frozen dataclass pattern (from Phase 5 precedent)

```python
# Established pattern from Phase 5 error data classes (confirmed in errors module)
# Phase 7 Session follows the same frozen=True discipline:
from dataclasses import dataclass, field
from typing import Optional, Tuple

@dataclass(frozen=True)
class Session:
    id: str
    model: str
    created_at: str
    transcript: Optional[Tuple["TranscriptEntry", ...]] = field(default=None)
```

---

## Phase-1 Verdict: The Governing Constraint

**This is the single most important fact for Phase 7.**

File: `spec/feasibility.md`

```yaml
resume_verdict: pass
```

All 9 cells of the `--resume × prompt-mode` matrix pass on `gemini-cli@0.37.1`:

| Prompt mode | Session mode | Verdict |
|-------------|-------------|---------|
| positional  | fresh       | PASS    |
| positional  | --resume latest | PASS |
| positional  | --resume \<id\> | PASS |
| stdin       | fresh       | PASS    |
| stdin       | --resume latest | PASS |
| stdin       | --resume \<id\> | PASS |
| -p flag     | fresh       | PASS    |
| -p flag     | --resume latest | PASS |
| -p flag     | --resume \<id\> | PASS    |

**Implication:** `--resume <id> -p <prompt>` is the primary session path. The transcript-prepend fallback (`GEMINI_SDK_TRANSCRIPT_FALLBACK=1`) is dark-shipped — code-complete but inactive by default.

**If upstream gemini-cli issue #14180 regresses:** A future regression is a one-env-var flip away from activating the fallback. No SDK release required.

---

## Wire Protocol: Session ID Flow

Based on `spec/protocol.md` §4.1 and §6 (HIGH confidence, captured evidence):

1. Every `gemini-cli` stream starts with an `init` event carrying `session_id` (UUID string).
2. The Phase 3 dispatcher maps `InitEvent.session_id` → `SystemChunk.sessionId` (already implemented).
3. The terminal `result` event carries `sessionId` on `ResultChunk` (already implemented in Phase 4).
4. When resuming with `--resume <id>`, turn 2 emits its own `init` event. The `session_id` in that event is the session continuation identifier.
5. The `model` field on the `init` event reflects the actual model used (auto-routing may choose a sub-model not equal to the requested model string).

**No parser changes required.** The session_id is already on the wire and already dispatched.

---

## Cross-Platform: Kill-Mid-Session Resume Semantics

Based on Phase 2 implementation (`ts/src/process/ProcessManager.ts`) and REQUIREMENTS.md (FDN-06):

**What the SDK already does:**
- Unix: SIGTERM → 5s grace → SIGKILL via `killTree()` (psutil-based recursive child cleanup)
- Windows: `taskkill /T /F` tree-kill (prevents MCP grandchild orphans)
- Both: `ProcessManager.spawn()` returns a `SpawnResult` with `pid` for cleanup

**Phase 7 SC-4 (kill-mid-session + resume):**
- No new process teardown logic is needed. Killing mid-session just terminates the subprocess normally. The `session_id` was already emitted in the `init` event at stream start.
- If the kill happens BEFORE the `init` event is emitted (e.g. the `abort-midstream` fixture scenario — process dies within 2s before any event), the `SystemChunk.sessionId` will be `undefined`. The pre-spawn guard cannot prevent this; callers must handle `queryFull()` returning a `Session` with `id = ''` in the aborted case.
- If the kill happens AFTER the `init` event but before `result`, the session id IS captured (it's the first event). Resume in a subsequent call works normally.
- The transcript-prepend fallback is only relevant when the fallback is active. Mid-session kill + resume in fallback mode means the caller must have saved the prior `Session.transcript` externally.

**Windows-specific:** No additional teardown is needed for session state. gemini-cli stores checkpoint state in its own data directory (`~/.gemini/` or `GEMINI_CONFIG_DIR`), not as files managed by the SDK. The SDK's only cleanup responsibility is the subprocess PID (already handled) and any temp files (system prompt, future: none for sessions).

**macOS/Linux:** SIGTERM to the gemini-cli process group handles cleanup. No session-specific teardown.

---

## Session JSON Serialization Contract

**Fields that MUST survive JSON round-trip:**
- `id: string` — the session identifier
- `model: string` — the model string for logging/debugging
- `createdAt: string` — ISO 8601 timestamp (already a string, no Date object)
- `transcript?: Array<{ role: string; content: string }>` — plain objects

**Fields that MUST NOT appear in Session:**
- Process handles (ChildProcess, anyio Process)
- File descriptors
- Stream references (Readable, ByteReceiveStream)
- Subprocess PID
- AbortController / CancelScope references

**Serialization test (SC-2 unit test):**
```typescript
const s: Session = { id: 'abc-123', model: 'auto-gemini-3', createdAt: '2026-04-19T00:00:00.000Z' };
const roundTripped = JSON.parse(JSON.stringify(s));
expect(roundTripped).toEqual(s);  // structural equality
```

Because `Session` contains only string scalars and optionally an array of `{role, content}` objects, the round-trip is trivially free.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Positional `resumeSessionId` param (Archon `sendQuery` signature) | Single `options.session: Session \| string` field | Phase 7 decision (mirrors Claude Agent SDK "spirit") | Archon adapter (Phase 10) unwraps `session.id` cleanly; no Archon API breakage |
| No session object, just string id in `QueryResult.sessionId` | `QueryResult.sessionId: string` (preserved) + `QueryResult.session: Session` (new) | Phase 7 additive | Zero breaking changes for Phase 4 callers reading `.sessionId` |
| `query()` always starts fresh | `query()` with `options.session` passes `--resume <id>` | Phase 7 | Multi-turn continuity without architectural change |

**Not deprecated:** `QueryResult.sessionId` is preserved as-is. Phase 7 is fully additive.

---

## Open Questions

1. **Does turn 2's init event emit the same session_id as turn 1?**
   - What we know: `spec/protocol.md` §6 says turn 2 "emits a NEW init event with its own session_id" but the fixture has both ids redacted — we cannot confirm if they are the same or different.
   - What's unclear: If gemini-cli issues a fresh id on each resume, the mismatch detection would fire on every resumed turn. This would be a false-positive detector.
   - Recommendation: Wire the mismatch detection as specified (it is non-fatal/annotation-only), then verify against a live resume integration test. If ids always differ on resume, remove the cross-turn mismatch check or document that `actualSessionId !== requestedSessionId` is expected on resume.

2. **Bad-id probe output shape**
   - What we know: Phase 7 research should run `gemini --resume nonexistent-id-12345 -p "hello"` and capture exit code + stderr + init event.
   - What's unclear: Does gemini-cli emit an error event, a non-zero exit, or silently start a fresh session?
   - Recommendation: Run the probe on Windows (capture host). If exit code is non-zero with a distinct stderr pattern → add `SessionNotFoundError` to `spec/errors.yaml`. If it silently starts fresh → the Layer 2 mismatch detection is the only signal.

3. **`queryFull()` vs `query()` for transcript accumulation**
   - What we know: CONTEXT.md marks this as Claude's Discretion.
   - What's unclear: If `query()` streaming callers also want transcript accumulation, they have no `QueryResult` to pull from.
   - Recommendation: Limit transcript accumulation to `queryFull()` in Phase 7. Streaming callers can extract the user prompt from `options.prompt` and assistant content from `AssistantChunk` themselves. This keeps `query()` stateless.

4. **`createdAt` source: init event timestamp vs wall clock**
   - What we know: The `init` event has a `timestamp` field (ISO string). The SDK could use this as `createdAt`.
   - What's unclear: The `init` event timestamp is the CLI's view of time (the server side), not the SDK's. For callers storing sessions in a database, either timestamp is fine.
   - Recommendation: Use the `init` event's `timestamp` field as `createdAt` for accuracy. This requires capturing it from the `SystemChunk.init` event during accumulation in `queryFull()`.

---

## Validation Architecture

`workflow.nyquist_validation = true` (from `.planning/config.json`).

### Test Framework

| Property | Value |
|----------|-------|
| TS framework | Vitest `^3.2` |
| TS config file | `ts/vitest.config.ts` (include: `src/**/*.{test,spec}.ts`) |
| TS quick run | `cd ts && pnpm test -- --run src/session/Session.spec.ts` |
| TS full suite | `cd ts && pnpm test` |
| Python framework | pytest `>=8.0` + hypothesis |
| Python config | `python/pyproject.toml` (testpaths: `tests/`) |
| Python quick run | `cd python && uv run pytest tests/session/ -x` |
| Python full suite | `cd python && uv run pytest` |
| Parity check | `bash scripts/diff-test-names.sh` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SES-01 | Session id captured from init event + `QueryResult.session` populated | unit (mock spawn) | `cd ts && pnpm test -- --run src/query/query.spec.ts` | ✅ (extend existing) |
| SES-01 | Python: session_id captured from init event | unit (mock spawn) | `cd python && uv run pytest tests/test_query.py -x` | ✅ (extend existing) |
| SES-02 | `buildArgv` with `session` → `--resume <id>` before `-p` | unit (pure function) | `cd ts && pnpm test -- --run src/query/buildArgv.spec.ts` | ✅ (extend existing) |
| SES-02 | Python: `build_argv` with session → `--resume <id>` | unit | `cd python && uv run pytest tests/test_build_argv.py -x` | ✅ (extend existing) |
| SES-03 | Session round-trip: `JSON.parse(JSON.stringify(s))` equals original | unit | `cd ts && pnpm test -- --run src/session/Session.spec.ts` | ❌ Wave 0 |
| SES-03 | Session has no process handles, no file descriptors | unit (structural check) | `cd ts && pnpm test -- --run src/session/Session.spec.ts` | ❌ Wave 0 |
| SES-03 | Python: @dataclass(frozen=True) raises on mutation | unit | `cd python && uv run pytest tests/session/test_session.py -x` | ❌ Wave 0 |
| SES-04 | `buildArgv` with fallback env var → transcript prepend in prompt, no `--resume` | unit (env mock) | `cd ts && pnpm test -- --run src/query/buildArgv.spec.ts` | ✅ (extend existing) |
| SES-04 | Python: fallback path produces correct prompt string | unit | `cd python && uv run pytest tests/test_build_argv.py -x` | ✅ (extend existing) |
| SES-01+SES-02 | Multi-turn integration: turn 2 response references turn 1 context (fixture-based) | integration (mock spawn + real parser/dispatch) | `cd ts && pnpm test -- --run src/query/query.spec.ts` | ✅ (extend existing, uses resume-session-turn{1,2} fixtures) |
| SES-01+SES-03 | Pre-spawn guard: empty session id throws InvalidPromptError | unit | `cd ts && pnpm test -- --run src/query/query.spec.ts` | ✅ (extend existing) |
| SES-01+SES-03 | Init-event mismatch: ResultChunk gains requestedSessionId/actualSessionId fields | unit (mock spawn) | `cd ts && pnpm test -- --run src/query/query.spec.ts` | ✅ (extend existing) |
| SES-04 | `GEMINI_SDK_TRANSCRIPT_FALLBACK` NOT in EnvBuilder allowlist | CI linter (grep) | `grep -r GEMINI_SDK_TRANSCRIPT_FALLBACK ts/src/process/EnvBuilder.ts` exits 1 | Manual / SC-4 check |
| SC-4 | Kill-mid-session + resume on Windows (smoke) | integration (live gemini-cli) | manual or CI Windows job | ❌ manual-only — requires live CLI |

### Sampling Rate

- **Per task commit:** `cd ts && pnpm test -- --run src/session/Session.spec.ts src/query/buildArgv.spec.ts src/query/query.spec.ts` + `cd python && uv run pytest tests/session/ tests/test_build_argv.py tests/test_query.py -x`
- **Per wave merge:** `cd ts && pnpm test` + `cd python && uv run pytest` + `bash scripts/diff-test-names.sh`
- **Phase gate:** Full suite green + parity check green + SC-4 kill-mid-session manual smoke verified before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `ts/src/session/Session.spec.ts` — covers SES-03 round-trip, construction paths, normalisation
- [ ] `python/tests/session/__init__.py` — empty file to make `session/` a Python test package
- [ ] `python/tests/session/test_session.py` — Python mirror of Session.spec.ts (parity enforced)
- [ ] `ts/src/session/Session.ts` — Session interface + normaliseSessionId
- [ ] `ts/src/session/index.ts` — barrel export
- [ ] `python/src/gemini_sdk/session/session.py` — frozen dataclass
- [ ] `python/src/gemini_sdk/session/__init__.py` — barrel export

No new test framework install needed — vitest, pytest, fast-check, and hypothesis are already present.

---

## Sources

### Primary (HIGH confidence)
- `spec/feasibility.md` — resume_verdict=pass; 9-cell matrix; Phase 7 implication documented
- `spec/fixtures/resume-session-turn1.ndjson` + `resume-session-turn1.expected.json` — turn 1 NDJSON structure, session_id in init event, confirmed dispatch chunks
- `spec/fixtures/resume-session-turn2.ndjson` + `resume-session-turn2.expected.json` — turn 2 resume confirmation, context recall of "47" verified
- `spec/protocol.md` §4.1 + §6 — normative init event schema, session resume mechanics documented with fixture citations
- `ts/src/parser/types.ts` — InitEvent, SystemChunk, ResultChunk shapes; session_id already dispatched
- `ts/src/query/buildArgv.ts` — current pure function structure; insertion point identified
- `ts/src/query/query.ts` — current query() compose chain; guard insertion point before resolveAuth confirmed
- `ts/src/query/types.ts` — QueryOptions + QueryResult current shapes; additive extension plan verified
- `python/src/gemini_sdk/query/build_argv.py` — Python mirror structure confirmed
- `python/src/gemini_sdk/query/query.py` — Python mirror compose chain confirmed
- `spec/errors.yaml` — InvalidPromptError (bucket=unknown, retryable=false) confirmed for reuse
- `.planning/config.json` — nyquist_validation=true confirmed
- `ts/vitest.config.ts` + `python/pyproject.toml` — test infrastructure confirmed

### Secondary (MEDIUM confidence)
- `.planning/phases/07-session-resume-multi-turn/07-CONTEXT.md` — all locked decisions, discretion areas, deferred scope
- `.planning/STATE.md` — resume_verdict=pass decision logged, dark-ship decision logged
- `.planning/ROADMAP.md` — Phase 7 success criteria (SC-1 through SC-4)
- `scripts/diff-test-names.sh` — parity enforcement mechanism; naming constraints confirmed

### Tertiary (LOW confidence)
- Turn 2 `session_id` identity: whether `init.session_id` on a resumed turn equals the `--resume <id>` argument is unconfirmed (fixture ids are redacted). Mismatch detection designed to be non-fatal precisely because of this uncertainty.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already installed; Session type shape locked by decision
- Architecture: HIGH — directly derived from live source files; no speculative components
- Pitfalls: HIGH — pitfalls 1/3/4/5/6 come from existing Phase 2-6 incidents logged in STATE.md; pitfall 2 is protocol-derived
- Fallback gating: HIGH — Phase-1 verdict is empirical (captured 2026-04-12); `resume_verdict=pass`
- Cross-platform kill semantics: HIGH — ProcessManager already handles all three OSes; no new teardown needed
- Turn-2 session_id identity: LOW — fixture ids redacted; live probe needed in integration test

**Research date:** 2026-04-19
**Valid until:** 2026-06-01 (stable protocol; re-verify if gemini-cli upgrades past 0.37.1 or if #14180 status changes upstream)
