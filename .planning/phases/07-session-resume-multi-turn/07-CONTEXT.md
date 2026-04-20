# Phase 7: Session Resume + Multi-Turn - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship multi-turn session continuity for `gemini-cli`. Capture `session_id` from the `init` event, wire `--resume <id>` into `buildArgv`, expose an immutable identifier-based `Session` value object, and land the transcript-prepend fallback inside `Session` + `buildArgv` dark-shipped behind an env-var flag (gated off by Phase 1's `resume_verdict=pass`). The primary path is `--resume <id> -p`; the fallback is code-complete but inactive by default so a future upstream regression (gemini-cli #14180) is a flag-flip away from a working workaround.

Requirements: SES-01, SES-02, SES-03, SES-04.

Out of scope: tool/approval flag passthrough (Phase 8), MCP passthrough (Phase 9), Archon adapter integration (Phase 10), doc site session guide (Phase 11), session forking / v2 durable serialization (SES-V2-01, SES-V2-02 — deferred).

</domain>

<decisions>
## Implementation Decisions

### Session value object shape

- **Plain immutable record, three fields: `id`, `model`, `createdAt`.** No class, no methods, no `toJSON`/`fromJSON` helpers. TS uses `Readonly<interface>`, Python uses `@dataclass(frozen=True)`. JSON round-trip is free — `JSON.parse(JSON.stringify(s))` yields an equivalent Session.
  - `id: string` — session_id from the `init` event (SES-01)
  - `model: string` — model reported by `init`, captured for logging / UI / debugging
  - `createdAt: string` — ISO timestamp of first init event
- **Two construction paths, both supported:**
  1. Returned from `queryFull()` as a new `QueryResult.session` field (populated from the init event captured during the query).
  2. Built directly by the caller from a stored string: `{ id: savedId, model: "", createdAt: "" }` — covers "restored from DB/disk" scenarios.
- **No stream-capture side-channel on `query()`.** Streaming callers pull `sessionId` off the `init` system chunk or the final `result` chunk — already on the wire. No new Promise/iterator surface.
- **JSON round-trip locked by unit test.** Serialize → deserialize → structural equals. Mirrors SC-2 verbatim.

### Resume API surface

- **Single `options.session` field accepting `Session | string`.** No separate `resumeSessionId` field. Caller passes whatever shape they have; SDK normalizes internally (`typeof session === "string" ? session : session.id`).
- **`QueryResult` gains `.session: Session` alongside existing `.sessionId: string`.** Additive — Phase 4 callers that read `.sessionId` keep working. Both point to the same id (`result.session.id === result.sessionId`).
- **`buildArgv` branch:**
  - No `options.session` → no `--resume` flag (fresh session).
  - `options.session` set, fallback env var NOT set → `--resume <id> -p <prompt>`.
  - `options.session` set, fallback env var SET, `session.transcript` present → omit `--resume`, prepend transcript into prompt (see next section).
- **Name chosen: `session`.** Not `resume` or `resumeSession` — shorter, unambiguous in context, mirrors Claude Agent SDK "spirit" (a single config field that accepts a resume identifier).

### Transcript-prepend fallback gating (SES-04)

- **Activation: env var `GEMINI_SDK_TRANSCRIPT_FALLBACK=1`.** Namespaced under the `GEMINI_SDK_*` prefix reserved by ARC-09. Absent or empty → fallback off (default, matches Phase 1 `resume_verdict=pass`).
- **NOT a `QueryOptions` field.** Dark-shipped means "here but not advertised" — a public field would appear in autocomplete, typedoc, and user mental models, defeating the purpose. Env var is invisible unless documented internally; matches `GEMINI_BIN_PATH` / `GEMINI_CONFIG_DIR` patterns.
- **Semantics: always-on when set, not auto-retry on --resume failure.** A single deterministic branch in `buildArgv`. No subprocess restart / failure-detection / retry logic — that would be stateful, fragile, and complicate abort handling.
- **Session carries optional transcript:**
  ```
  interface Session {
    readonly id: string;
    readonly model: string;
    readonly createdAt: string;
    readonly transcript?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  }
  ```
  Undefined when fallback is off (Session stays small; round-trip unaffected). Populated by `query()` accumulating turns when the env var is set.
- **Immutability preserved.** Each new turn produces a NEW Session with an extended transcript array — never mutates the old one. `query()` returns the new Session via `QueryResult.session`; caller passes it to the next call.
- **Logic location honors SES-04 literally:** "fallback lives inside `Session` + `ArgvBuilder` only." `query()` composer is agnostic — it reads env + hands Session to `buildArgv`, which owns the branching.

### Bad/missing session-id error handling

Three-layer defense; NO new error subclass added to `spec/errors.yaml` in Phase 7 (evidence-driven — add only if empirical capture justifies it).

- **Layer 1 — Pre-spawn guard.** `query()` rejects empty / whitespace-only session ids before spawning:
  ```
  if (options.session) {
    const id = typeof options.session === "string" ? options.session : options.session.id;
    if (!id || !id.trim()) throw new InvalidPromptError("session id is empty");
  }
  ```
  Reuses existing Phase 5 `InvalidPromptError` (retryable: false). Saves a subprocess round-trip for client-side mistakes.
- **Layer 2 — Init-event mismatch detection.** Symmetric with MDL-04. `ResultChunk` gains optional `requestedSessionId` + `actualSessionId` fields, populated only when the requested id doesn't match the `init` event's `session_id` (e.g. gemini-cli silently started fresh). Non-fatal, non-throwing — callers who care can detect drop-outs; callers who don't aren't bothered.
- **Layer 3 — Existing ErrorMapper catch-all.** If gemini-cli exits non-zero with session-related stderr, `ErrorMapper.fromExit` raises `ProcessError` via its generic catch-all branch (Phase 5 behavior). No new regex, no new class.
- **Research-time empirical probe (Phase 7 research).** Run `gemini --resume nonexistent-id-12345 -p "hello"` once, capture exit code + stderr + init event, record in `.planning/phases/07-session-resume-multi-turn/RESEARCH.md`. Only if the stderr pattern is clean and distinct do we add `SessionNotFoundError` to `spec/errors.yaml` — otherwise `ProcessError` is the honest answer.
- **No `SessionNotFoundError` upfront.** Phase 5's golden rule: error classes must map to real captured stderr patterns, not hypothesized ones. Speculative classes break the Phase 5 `lint-errors.sh` invariant.

### Claude's Discretion

- Exact file layout under `ts/src/session/` + `python/src/gemini_sdk/session/` (barrel exports, file naming).
- Whether `Session.transcript` is an array of `{ role, content }` or a slightly richer shape (timestamps? tool calls?) — the contract is "carries enough to prepend a faithful transcript"; field specifics are open.
- Format string used to prepend transcript into the prompt (e.g. `"User: ...\nAssistant: ...\n\nUser: <new prompt>"` vs. a more elaborate template). Must be deterministic and unit-testable.
- Whether `queryFull()` is the only path that populates `Session.transcript` when fallback is on, or whether streaming `query()` also accumulates into a session the caller passes back on the next turn.
- Exact wording of the `InvalidPromptError` message for empty session ids.
- Whether Phase 7 research runs the bad-id probe on all three OSes or just Windows (the capture host).
- Python-side naming (`created_at` vs `createdAt` — parity convention says snake_case in Python, camelCase in TS, same logical field).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 7 requirements & roadmap
- `.planning/REQUIREMENTS.md` §"Sessions / Multi-Turn" — SES-01 through SES-04 (full requirement text)
- `.planning/ROADMAP.md` §"Phase 7: Session Resume + Multi-Turn" — Goal statement, dependencies (Phase 6), 4 success criteria

### Phase 1 feasibility verdict (gates the transcript fallback)
- `spec/feasibility.md` §"Resume Verdict" — `resume_verdict=pass`; all 9 cells of the `--resume` × prompt-mode matrix pass on gemini-cli 0.37.1. Transcript-prepend fallback is dark-shipped.
- `spec/fixtures/resume-session-turn1.ndjson` + `.expected.json` — turn 1 capture (user states a number, assistant acknowledges, init event carries session_id)
- `spec/fixtures/resume-session-turn2.ndjson` + `.expected.json` — turn 2 capture (`--resume <id>` + follow-up prompt; assistant correctly recalls prior turn's context)

### Wire protocol and parser (Phase 3 outputs consumed here)
- `spec/protocol.md` — `init` event fields (`session_id`, `model`, `timestamp`) used for Session construction and MDL-04-style mismatch detection
- `spec/events.schema.json` — frozen JSON Schema (`additionalProperties: true`; schema is a FLOOR)
- `ts/src/parser/types.ts` — `RawEvent.InitEvent`, `MessageChunk.SystemChunk` (subtype `init`), `ResultChunk` (needs new optional `requestedSessionId` / `actualSessionId` fields)
- `ts/src/parser/dispatch.ts` + `python/src/gemini_sdk/parser/dispatch.py` — dispatch stage; Phase 7 does not modify (session id already on SystemChunk + ResultChunk)

### Query composer + argv builder (Phase 4 outputs extended here)
- `ts/src/query/types.ts` — `QueryOptions` (gains `session?: Session | string`), `QueryResult` (gains `.session: Session` alongside existing `.sessionId: string`)
- `ts/src/query/buildArgv.ts` — pure-function argv builder; Phase 7 adds the single `--resume` / transcript-prepend branch
- `ts/src/query/query.ts` — composer; Phase 7 adds pre-spawn session-id guard + init-event mismatch detection
- `python/src/gemini_sdk/query/` — Python mirrors of all of the above (parity per PAR-01)

### Error taxonomy (Phase 5 outputs consumed here; NO new classes in Phase 7)
- `spec/errors.yaml` — `InvalidPromptError` reused for empty-id pre-spawn guard; `ProcessError` catch-all handles CLI-side failures
- `spec/errors.md` §3, §4 — classifier logic, stderr regex catalog (reference only; Phase 7 adds no regexes)
- `ts/src/errors/ErrorMapper.ts` + `python/src/gemini_sdk/errors/error_mapper.py` — existing classifier; Phase 7 does not modify
- `scripts/lint-errors.sh` — Phase 5 CI linter; Phase 7 must not break YAML/TS/Python 3-way sync (achieved automatically since no new classes)

### Process / env infrastructure (Phase 2/6 outputs consumed here unmodified)
- `ts/src/process/EnvBuilder.ts` + `python/src/gemini_sdk/process/env_builder.py` — allowlist filter; `GEMINI_SDK_TRANSCRIPT_FALLBACK` does NOT need to be in the allowlist (it is read by the SDK, not forwarded to the subprocess)
- `ts/src/auth/resolveAuth.ts` + `python/src/gemini_sdk/auth/resolve_auth.py` — Phase 6 composes before spawn; Phase 7's pre-spawn session-id guard runs BEFORE `resolveAuth` (cheapest checks first)

### Prior phase context
- `.planning/phases/01-feasibility-spike-fixture-capture/01-CONTEXT.md` — resume-session fixture provenance, synthetic-vs-real fixture caveat, capture-host OAuth context
- `.planning/phases/03-ndjson-parser-eventdispatcher-messagechunk-types/03-CONTEXT.md` — `SystemChunk.init` subtype carries `sessionId` + `model`; `ResultChunk` is the terminal chunk
- `.planning/phases/04-public-query-argvbuilder-systemprompt-workspace-model-selection/04-CONTEXT.md` — MDL-04 downgrade-detection pattern (Phase 7 mirrors for session id), `QueryResult` shape, `buildArgv` purity, `query()` composer lifecycle
- `.planning/phases/05-error-taxonomy-archon-5-bucket-mapping/05-CONTEXT.md` — taxonomy codegen rules, fixture-evidence-required-before-adding-a-class rule, `ErrorMapper` dual-path contract
- `.planning/phases/06-auth-environment/06-CONTEXT.md` — pure-function compose chain (`resolveAuth` → `buildEnv`), env-var-as-escape-hatch precedent, "new module = new directory" convention (Phase 7 introduces `session/`)

### Gemini CLI reference
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md` — `--resume` flag documentation; confirms `-p` + `--resume` interop (matches Phase 1 empirical verdict)
- `https://github.com/google-gemini/gemini-cli/issues/14180` — historical `--resume` + `-p` regression; root cause of SES-04 fallback requirement
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md` — `stream-json` init event schema (`session_id`, `model` fields)

### Reference SDK patterns
- `https://code.claude.com/docs/en/agent-sdk/overview` — single-resume-field shape; Phase 7 mirrors spirit (one field) not letter (name differs)
- Archon `IAssistantClient.sendQuery(prompt, cwd, resumeSessionId?, options?)` — Archon passes resume id as a string; Phase 7's `session: Session | string` union accepts this directly (Phase 10 adapter will unwrap cleanly)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`SystemChunk.init` + `ResultChunk`** (Phase 3 `ts/src/parser/types.ts`) — already carry `sessionId` + `model`. Session construction reads these directly from the dispatch stream; no parser changes.
- **`ResultChunk.requestedModel` / `actualModel`** (Phase 4 MDL-04 pattern) — exact template for Phase 7's `requestedSessionId` / `actualSessionId` mismatch fields.
- **`QueryOptions` + `QueryResult`** (`ts/src/query/types.ts`) — additive extension only. `QueryOptions` gains `session?`; `QueryResult` gains `.session` alongside existing `.sessionId`. Zero breaking changes.
- **`buildArgv`** (`ts/src/query/buildArgv.ts`) — pure function; Phase 7 adds one branch (no refactor). Fuzz-coverable with the existing property test infrastructure.
- **`query()` composer** (`ts/src/query/query.ts`) — already threads `resolveAuth` + `buildArgv` + `ProcessManager.spawn` + dispatch. Phase 7 inserts the session-id guard BEFORE `resolveAuth` and the mismatch detection AFTER dispatch yields each chunk.
- **`InvalidPromptError`** (Phase 5 `spec/errors.yaml`) — pre-existing class, `retryable: false`, used for the empty-id guard.
- **`ProcessError`** (Phase 5) — catch-all for CLI-side session errors until empirical capture justifies a subclass.
- **`resume-session-turn{1,2}.{ndjson,expected.json}`** (`spec/fixtures/`) — complete multi-turn fixture pair; Phase 7 SC-1 integration test consumes these directly (no new capture needed for the happy path).
- **`spec/fixtures.manifest.json`** — fixture corpus manifest; Phase 7 does not add fixtures for happy-path tests. May add ONE bad-id fixture if Phase 7 research shows a distinct stderr pattern worth typing.

### Established Patterns
- **New module = new directory.** Phase 5 → `errors/`, Phase 6 → `auth/`, Phase 7 → `session/`. Files: `ts/src/session/Session.ts` (type + constructor), `ts/src/session/Session.spec.ts`, Python mirrors in `python/src/gemini_sdk/session/`.
- **Pure-function compose chain.** `buildArgv` → `resolveAuth` → `buildEnv` → `ProcessManager.spawn` — all pure, all unit-testable without subprocess. Phase 7's session logic plugs into `buildArgv` (argv side) and `query()` (Session construction side) without breaking this pattern.
- **Env-var escape hatch.** `GEMINI_BIN_PATH`, `GEMINI_CONFIG_DIR`, `GEMINI_SYSTEM_MD` set precedent; `GEMINI_SDK_TRANSCRIPT_FALLBACK` is the next entry. Namespace reserved by ARC-09 for SDK-internal flags.
- **Symmetric request/actual fields on `ResultChunk`.** MDL-04 `requestedModel` / `actualModel` is the template; Phase 7's `requestedSessionId` / `actualSessionId` follows identically.
- **Fixture-corpus parity tests.** Phase 3 + Phase 5 parametrize TS + Python tests over `spec/fixtures/*`; Phase 7 SC-1 test slots into this by parametrizing over `resume-session-turn1` then `resume-session-turn2` in order.
- **`@dataclass(frozen=True)` for Python value objects** — consistent with how Phase 5 `AuthError` subtypes and Phase 4 `QueryResult` are rendered on the Python side; `Session` follows suit.
- **Test-name parity enforced by `scripts/diff-test-names.sh`.** All Phase 7 tests must have TS + Python test names that match after grep extraction.

### Integration Points
- **`ts/src/query/types.ts` + Python mirror** — ADD `Session` type (or import from new `session/` module), ADD `session?: Session | string` to `QueryOptions`, ADD `session: Session` to `QueryResult`, ADD `requestedSessionId?` / `actualSessionId?` to `ResultChunk`.
- **`ts/src/query/buildArgv.ts` + Python mirror** — ADD session handling branch (three cases: no session / session + default path / session + transcript fallback). Fuzz test gains new option combinations.
- **`ts/src/query/query.ts` + Python mirror** — ADD pre-spawn empty-id guard (before `resolveAuth`); ADD init-event mismatch detection (annotate `ResultChunk` when `requestedSessionId !== actualSessionId`); ADD transcript accumulation if `GEMINI_SDK_TRANSCRIPT_FALLBACK=1` and caller passes a Session (new Session returned with extended `transcript`).
- **New files: `ts/src/session/Session.ts` + `ts/src/session/Session.spec.ts`** — type definition + round-trip test + construction-path tests. Python: `python/src/gemini_sdk/session/session.py` + `python/tests/session/test_session.py`.
- **Barrel exports** — add `Session` to `ts/src/index.ts` and `python/src/gemini_sdk/__init__.py` alongside `query`, `queryFull`, `queryRaw`, error classes.
- **`spec/protocol.md`** — document the session-id flow end-to-end (init event → Session construction → --resume echo → init event on resume). Small prose-only update.
- **`docs/sessions.md` (NEW file, Phase 11 publishes)** — author the session guide now so Phase 11 can consume; covers happy path + fallback env var + restore-from-storage pattern.
- **`spec/fixtures/` + `spec/fixtures.manifest.json`** — NO new fixtures required for Phase 7 SC-1..SC-4. Potentially ONE bad-id fixture added only if research justifies it.

</code_context>

<specifics>
## Specific Ideas

- Session mirrors the pattern established by Phase 4's `QueryResult` and Phase 5's error data classes — plain immutable records, language-idiomatic naming (camelCase TS, snake_case Python). Consistency over novelty.
- The `session: Session | string` union exists specifically because real-world callers restore sessions from string ids stored in databases, chat history rows, or URL params — forcing them to reconstruct a full Session object first is friction with no benefit.
- Dark-shipping the transcript fallback via an env var (not a `QueryOptions` field) is the key "invisible unless you need it" discipline. Public API fields leak into typedoc / autocomplete / user mental models; env vars don't.
- Init-event mismatch detection catches the worst case: gemini-cli silently ignores a bad session id and starts fresh. Without this, callers think they resumed turn 3 but actually started turn 1 — invisible data corruption from the caller's perspective.
- Phase 7 deliberately adds NO new error subclass. The Phase 5 rule "error classes must map to real captured stderr patterns" means we capture empirical evidence first, then add taxonomy. Speculative `SessionNotFoundError` would break the `lint-errors.sh` invariant and is premature.
- Transcript immutability: each turn's resume produces a NEW Session with an extended transcript array. Old Session instances stay valid and serializable — callers can "rewind" to a prior turn by holding onto the old Session.

</specifics>

<deferred>
## Deferred Ideas

- **`SessionNotFoundError` subclass** — Add only if Phase 7 research produces a distinct stderr pattern from a real `gemini --resume nonexistent-id` capture. Otherwise `ProcessError` is the honest answer. Tracked as a Phase 7 research deliverable; may produce a follow-up "add session error class" plan if evidence warrants.
- **`forkSession(id)`** — Creating a branch from a checkpoint is SES-V2-01 (v2 scope); depends on checkpoint-file format stability upstream.
- **Durable session serialization if `--resume` + `-p` remains unreliable** — SES-V2-02 (v2 scope); Phase 7's transcript-prepend fallback is the v1 bridge.
- **Session turn count / token accumulation on `QueryResult`** — potentially useful for UI/logging but not required by SES-01..SES-04. Callers can track turn count themselves from `transcript.length` (when fallback is on) or by counting their own calls.
- **`SessionHistory` / list-sessions helper** — gemini-cli doesn't expose a "list my sessions" command; would require reading its internal checkpoint directory. Out of scope; speculative utility.
- **Auto-detect fallback activation from a runtime compat probe** — Could query gemini-cli's `--version` and flip fallback on for known-broken versions. Adds runtime complexity + a version-to-behavior matrix that must be maintained. Defer until we have data that upstream actually regresses.
- **Expose transcript-prepend format string as a `QueryOptions` field** — Let advanced callers customize how prior turns are formatted. Premature; fixed deterministic format suffices for v1.
- **Session expiration / TTL** — gemini-cli's own checkpoint TTL is undocumented; SDK-level expiration would be a fiction on top of undefined behavior.

</deferred>

---

*Phase: 07-session-resume-multi-turn*
*Context gathered: 2026-04-19*
