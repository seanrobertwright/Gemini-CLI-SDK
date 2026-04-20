# Phase 8: Tools + Approval Mode + Structured Output (Best-Effort) - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Pass `options.allowedTools` through to `--allowed-tools` (TOL-01), pass `options.approvalMode` through to `--approval-mode` (TOL-02), handle the eventual `--allowed-tools` → Policy Engine rename gracefully (TOL-03), document that caller-defined custom tool definitions are NOT supported in v1 (TOL-04), and ship best-effort structured output: `options.outputSchema` injects schema guidance into the system prompt, runtime-validates with Zod/Pydantic, retries ONCE with feedback on failure, then raises `SchemaValidationError` (OUT-01..04). Mark structured output `@experimental` with a docs callout linking gemini-cli upstream #13388.

Requirements: TOL-01, TOL-02, TOL-03, TOL-04, OUT-01, OUT-02, OUT-03, OUT-04.

Out of scope: caller-defined custom tool definitions via stub MCP (v2 — CTL-01..03); MCP-server passthrough (Phase 9); Archon adapter wiring for these fields (Phase 10); docs-site hosting / typedoc generation (Phase 11); hooks (v2 — HOK-01..04); JSON-schema enforcement beyond best-effort (blocked on upstream #13388, deferred forever at v1 level).

</domain>

<decisions>
## Implementation Decisions

### `allowedTools` API shape (TOL-01)

- **`options.allowedTools?: string[]`.** Plain array of tool-name strings. Maps directly to `--allowed-tools <csv>` at the argv boundary; matches Archon's `AssistantRequestOptions` shape; matches gemini-cli's CLI convention.
- **No validation against a known enum.** Unknown tool names pass through unchallenged — the subprocess is the source of truth. Mirrors MDL-02 (raw-string model escape hatch) and the SDK's "transparent wrapper" ethos. Forward-compatible with any new built-in tools added upstream without requiring an SDK release.
- **`allowedTools: []` (empty array) = omit flag entirely** — same behavior as `undefined`. Avoids the footgun where a caller `.filter()`s a list down to empty and accidentally disables all tools including mandatory ones. `buildArgv` skips the flag when the array is missing OR empty.
- **CSV join at argv boundary.** `buildArgv` emits `['--allowed-tools', tools.join(',')]`. No per-name quoting in v1 — gemini-cli tool names are conventionally `snake_case` / `mcp__server__tool` identifiers, no special characters to escape.

### Policy Engine migration handling (TOL-03)

- **Version-pinned assumption; no runtime probe.** SDK targets the `.gemini-cli-compat` pinned version range (0.37.1 today); emit `--allowed-tools` unconditionally. Phase 11's `gemini --version` compat probe warns users when their CLI version is outside the tested range (REL-06). Simplest implementation, honest about the pinned-range contract, no extra subprocess per session.
- **TOL-03 is satisfied by the Phase 11 compat probe, not a Phase 8 runtime check.** When the Policy Engine rename lands upstream, a patch release bumps `.gemini-cli-compat` and swaps the flag name in `buildArgv`. The compat probe warns users still on the old CLI.
- **No dual-emit, no one-shot `--help` probe.** Dual-emit risks hard-fails on unknown flags; `--help` probing adds an extra subprocess per process lifetime for a problem that the compat matrix already covers.

### `approvalMode` API shape (TOL-02)

- **Const-object + union type, mirrors Phase 4 Model exactly.** Locks the parity naming convention across phases:
  ```ts
  export const ApprovalMode = {
    DEFAULT: 'default',
    AUTO_EDIT: 'auto_edit',
    YOLO: 'yolo',
    PLAN: 'plan',
  } as const;
  export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode] | string;
  ```
  Python mirrors with a `str` Enum (matching Phase 4 Model). Autocomplete for known modes, raw-string escape hatch for forward compatibility.
- **Omitted when unset → CLI default applies.** No `--approval-mode` flag in argv when `options.approvalMode` is `undefined`. gemini-cli's own default (`default` mode) kicks in. Matches Phase 4 `model` / `additionalDirectories` pattern — unset options don't appear in argv. SDK imposes zero opinion.
- **No SDK-side warning when caller picks `'default'` in a headless context.** Document in `docs/tools.md` that `'default'` may block on approval prompts in non-TTY contexts; link gemini-cli's approval docs. Consistent with the transparent-wrapper principle; callers who set `'default'` explicitly know what they asked for.
- **No SchemaValidation-style intercept for `'plan'` mode.** Plan mode produces a different event stream naturally (no `tool_use` / `tool_result` events, just assistant text describing the plan). Existing `dispatch` handles whatever events arrive. Phase 8 SC-2's plan-mode test verifies via post-run `fs.stat` that no filesystem mutations occurred — that's the assertion. No code-path branching in `query()`.

### `outputSchema` input shape + injection (OUT-01, OUT-02)

- **Accept a plain JSON Schema object.** TS: `outputSchema?: Record<string, unknown>`. Python: `output_schema: dict | None = None`. SDK stringifies once (`JSON.stringify(schema, null, 2)` / `json.dumps(schema, indent=2)`) for prompt injection, then feeds to Zod (TS) via `zod-from-json-schema` and Pydantic (Python) via `RootModel`/`TypeAdapter` for validation. Identical wire format across languages — fixture tests can compare byte-for-byte. Callers who prefer authoring in Zod/Pydantic can `.toJSONSchema()` once at call time.
- **Schema guidance APPENDED after caller's `systemPrompt`** in the existing SYS-01/02 temp `GEMINI_SYSTEM_MD` pipeline. Single temp file, caller's instructions stay primary, schema block is a hard postscript. Deterministic fixed template:
  ```
  <caller's systemPrompt — empty string if none>

  ## Required Output Format
  Your response MUST be valid JSON matching this JSON Schema:

  ```json
  <pretty-printed schema>
  ```

  Return ONLY the JSON object. No prose, no markdown fences in the output.
  ```
  Unit-testable, parity-checkable, future-tunable in one place. If caller provides NO `systemPrompt`, the block is the whole temp file.
- **No `outputSchemaTemplate` option in v1.** Template is an internal implementation detail of a best-effort feature; configurability is premature. Defer to v2 if real callers want it.

### Streaming compatibility: `outputSchema` scope (OUT-02)

- **`outputSchema` only works with `queryFull()`.** Validation requires the complete assistant text — inherently non-streaming. `query()` / `queryRaw()` throw `UnsupportedFeatureError` at the pre-spawn guard layer (alongside the Phase 7 session-id check) when `options.outputSchema` is set.
- **`queryFull()` accumulates, then validates, then retries once, then throws.** The retry loop lives INSIDE `queryFull()`, not inside `query()` — `query()` stays a pure streaming primitive. `queryFull()` is already the accumulator; adding one retry branch fits naturally.
- **No third public entry point (no `queryStructured<T>`).** Callers reach for structured output via `queryFull({..., outputSchema})`. `QueryResult` gains an optional `structured?: T` field populated when validation succeeded. Keeps the public API at three functions (`query`, `queryRaw`, `queryFull`).

### Retry mechanism (OUT-03)

- **Fresh subprocess spawn for the retry** (matches Phase 2 `SpawnPerCallStrategy` — one spawn per call is the contract; retry is a second call under the hood).
- **Retry prompt APPENDS feedback to the original user prompt.** Template:
  ```
  <original prompt>

  Your previous response was invalid JSON for the required schema.
  Validator error: <validator message from Zod/Pydantic>.
  Your previous response was:
  ```
  <raw assistant text>
  ```

  Return ONLY valid JSON matching the schema.
  ```
  Unit-testable; preserves the caller's intent; gives the model self-context to fix the mistake.
- **Retry reuses the first call's session id via `--resume`.** First `query()` captures `session_id` from the init event; retry passes that id through as `options.session` so gemini-cli sees its own prior (invalid) response in its checkpoint. Leverages Phase 7's session-resume pipeline unmodified. If the caller did NOT pass a session, the first call still returns one (every `queryFull` creates a Session), which the retry reuses.
- **Retry respects the original `options.abortSignal`.** If the caller aborts between the first failure and the retry, `AbortError` propagates immediately — no subprocess is spawned for the retry.
- **On second validation failure → `throw new SchemaValidationError(...)`** with the validator's final error message and the raw invalid response as error metadata for debugging.

### `SchemaValidationError` classification (OUT-03, PAR-05)

- **Added to `spec/errors.yaml` with a new `source: 'sdk'` marker.** Keeps PAR-05 intact (single YAML source generates both languages); `lint-errors.sh` and `ErrorMapper` know the class is client-side (no stderr regex, no exit-code mapping). Extend the codegen schema in `scripts/gen-errors.*` to understand `source: 'sdk' | 'stderr'` (default `'stderr'` preserves existing entries).
- **`retryable: false`, bucket: `unknown`** (per ROADMAP Phase 8 goal text). SDK already raised one retry internally; exposing `retryable: true` would invite callers to retry-the-retry, which is pointless.
- **Class extends `GeminiError` directly** (not a subtype of any existing Phase 5 class). It's its own concept: "SDK could not coerce subprocess output into caller's schema after one retry."
- **`ErrorMapper` is NOT modified.** `ErrorMapper` classifies subprocess failures (exit code + stderr + events); `SchemaValidationError` is thrown directly by `queryFull()` post-stream. Phase 5's dual-path classifier stays focused on stderr/event-sourced errors.
- **`lint-errors.sh` updated to tolerate `source: 'sdk'` entries** — no regex expected, but class must still exist in both TS and Python implementations (3-way YAML/TS/Python sync preserved).

### `@experimental` surfacing (OUT-04)

- **JSDoc `@experimental` tag on `outputSchema`, `QueryResult.structured`, and `SchemaValidationError`.** TS uses the same shape as Phase 4's `@deprecated` markers on Model 2.5 entries. Python uses docstring prefix `**Experimental:**` on the `QueryOptions` field and the `SchemaValidationError` class.
- **No runtime warning on first use.** No `console.warn('outputSchema is experimental')` — adds nag noise for callers who already read the docs. Matches Phase 4's stance on `@deprecated` Models (tag only, no runtime warning).
- **No env-var gating (`GEMINI_SDK_ENABLE_EXPERIMENTAL`).** Overkill for a documented best-effort feature; hostile to the v1 primary audience (author dogfooding in Archon).
- **`docs/structured-output.md` Known Limitations section** links gemini-cli issue #13388 verbatim (OUT-04) and cites the retry-once policy, the "strip markdown fences" heuristic, and the JSON Schema subset supported by Zod/Pydantic adapters.

### `QueryOptions` + `QueryResult` extensions (additive, zero breaking changes)

```ts
interface QueryOptions {
  // ... existing fields ...

  /** Tool names to whitelist via `--allowed-tools`. Empty/undefined → no flag. */
  allowedTools?: string[];

  /** Approval mode passed as `--approval-mode <mode>`. Undefined → CLI default. */
  approvalMode?: ApprovalMode;

  /** @experimental JSON Schema for best-effort structured output. queryFull() only. */
  outputSchema?: Record<string, unknown>;
}

interface QueryResult {
  // ... existing fields ...

  /** @experimental Parsed + validated output when `outputSchema` was set. */
  structured?: unknown;
}
```

### Claude's Discretion

- Exact file layout under `ts/src/tools/` / `ts/src/output/` (or a combined `experimental/` umbrella) — modular organization is a planning concern; separation is encouraged following the Phase 6 `auth/` + Phase 7 `session/` precedent.
- Whether `approvalMode` and `allowedTools` share a `tools/` directory or live next to the `query/` composer as a pure-function branch in `buildArgv`. The pure-function extension may be small enough that a dedicated directory is over-abstraction.
- Exact validator library wiring — Zod version (`zod@^3` assumed since `zod-from-json-schema` has a ^3 peer dep), Pydantic v2 `TypeAdapter` vs `RootModel` (Pydantic v2 required, already project-standard).
- The precise wording of the schema-injection template (above is a strong starting point but may need empirical tuning during the feasibility smoke test in Phase 8 research).
- The precise wording of the retry-feedback prompt.
- Whether the second `query()` call for retry passes `approvalMode: 'yolo'` internally (to ensure it can actually produce output without prompting) or respects the caller's original approvalMode.
- Whether `UnsupportedFeatureError` thrown from `query()` when `outputSchema` is set is pre-spawn (lowest cost) or post-spawn — pre-spawn guard is strongly preferred for consistency with Phase 7's empty-session-id guard.
- CLI fence-stripping heuristic (e.g. strip leading `` ```json `` + trailing `` ``` ``) before validation — likely needed; exact regex is an implementation detail.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 8 requirements & roadmap
- `.planning/REQUIREMENTS.md` §"Tools" — TOL-01 through TOL-04 (full requirement text)
- `.planning/REQUIREMENTS.md` §"Structured Output (best-effort)" — OUT-01 through OUT-04
- `.planning/ROADMAP.md` §"Phase 8: Tools + Approval Mode + Structured Output (Best-Effort)" — Goal statement, dependencies (Phase 7), 4 success criteria

### Query composer + argv builder (Phase 4/7 outputs extended here)
- `ts/src/query/types.ts` — `QueryOptions` (gains `allowedTools?`, `approvalMode?`, `outputSchema?`), `QueryResult` (gains `structured?`), `Model` const-object + union pattern (template for `ApprovalMode`)
- `ts/src/query/buildArgv.ts` — pure-function argv builder; Phase 8 adds `allowedTools` CSV branch + `approvalMode` flag branch; unchanged for `outputSchema` (that flows through the system-prompt file, not argv)
- `ts/src/query/query.ts` — composer; Phase 8 adds pre-spawn `UnsupportedFeatureError` guard when `outputSchema` is set on `query()`/`queryRaw()`; `queryFull()` gains the accumulate → validate → retry → throw loop
- `python/src/gemini_sdk/query/` — Python mirrors of all of the above (parity per PAR-01)

### System prompt infrastructure (Phase 4 outputs extended here)
- `ts/src/query/query.ts` `writeTempSystemPrompt` helper — Phase 8 extends to append schema-injection template when `outputSchema` is set; temp-file lifecycle already handled (SYS-01/02)
- `python/src/gemini_sdk/query/query.py` — Python mirror

### Error taxonomy (Phase 5 outputs consumed + extended here)
- `spec/errors.yaml` — Phase 8 adds `SchemaValidationError` entry with new `source: 'sdk'` marker; existing entries default to `source: 'stderr'`
- `spec/errors.md` §3, §4 — classifier logic, stderr regex catalog (reference only; Phase 8 adds no stderr regex)
- `ts/src/errors/index.ts` + `python/src/gemini_sdk/errors/__init__.py` — Barrel exports; Phase 8 exports `SchemaValidationError`
- `ts/src/errors/ErrorMapper.ts` + `python/src/gemini_sdk/errors/error_mapper.py` — NOT modified; `SchemaValidationError` is thrown directly by `queryFull()`, not classified from subprocess output
- `scripts/gen-errors.*` + `scripts/lint-errors.sh` — Phase 5 codegen + linter; Phase 8 updates both to understand `source: 'sdk'` (default `'stderr'` preserves existing behavior)
- `ts/src/errors/UnsupportedFeatureError.ts` + Python mirror — Phase 5 class, reused for the pre-spawn guard when `outputSchema` is set on `query()`/`queryRaw()`

### Session resume (Phase 7 outputs consumed here)
- `ts/src/session/index.ts` + `python/src/gemini_sdk/session/` — `Session` value object; `queryFull()` retry path constructs a Session from the first call's init event and passes it to the second call's `options.session`
- `ts/src/query/buildArgv.ts` — `--resume <id>` branch already in place; retry call reuses it unmodified

### Fixture infrastructure
- `spec/fixtures/tool-use-builtin.{ndjson,expected.json}` — existing captured fixture; Phase 8 SC-1 integration test may reference it to verify `allowedTools` restricts the tool_use events
- `spec/fixtures/multi-tool.{ndjson,expected.json}` — existing captured fixture
- `spec/fixtures.manifest.json` — manifest; Phase 8 may add targeted fixtures for `--allowed-tools` enforcement + plan-mode (TBD during Phase 8 research)
- `scripts/capture-fixtures.*` — reproducible capture script (Phase 1); may gain `--scenario plan-mode` / `--scenario allowed-tools` branches

### Prior phase context
- `.planning/phases/04-public-query-argvbuilder-systemprompt-workspace-model-selection/04-CONTEXT.md` — Model const-object + union pattern (template for ApprovalMode), `QueryOptions` additive-extension philosophy, `buildArgv` purity contract, temp-file SYS-01/02 lifecycle
- `.planning/phases/05-error-taxonomy-archon-5-bucket-mapping/05-CONTEXT.md` — taxonomy codegen rules, PAR-05 single-YAML-source invariant, `lint-errors.sh` 3-way sync contract, fixture-evidence-before-class-creation rule (waived for `SchemaValidationError` since it's `source: 'sdk'`)
- `.planning/phases/06-auth-environment/06-CONTEXT.md` — new-module-new-directory convention (`auth/`), pure-function compose chain, env-var-as-escape-hatch precedent
- `.planning/phases/07-session-resume-multi-turn/07-CONTEXT.md` — `Session` value object shape, `--resume` branch in `buildArgv`, pre-spawn guard pattern (InvalidPromptError template for Phase 8's UnsupportedFeatureError guard), `ResultChunk` mismatch-annotation pattern (reference, not reused in Phase 8)

### Gemini CLI upstream references
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md` — `--allowed-tools`, `--approval-mode`, Policy Engine migration docs
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md` — headless mode + approval-mode interaction
- `https://github.com/google-gemini/gemini-cli/issues/13388` — JSON-schema output enforcement upstream tracker; OUT-04 links this for the Known Limitations section

### Reference SDK patterns
- `https://code.claude.com/docs/en/agent-sdk/overview` — Claude Agent SDK's `allowedTools` + `permissionMode` fields; Phase 8 mirrors spirit (single fields each) while adopting gemini-cli's vocabulary (`approvalMode` with gemini-specific values)
- Archon `AssistantRequestOptions` — the field names `allowedTools`, `approvalMode` (or equivalents) Archon adapter will translate from in Phase 10

### Validation libraries
- `https://github.com/colinhacks/zod` — Zod v3 (peer-dep floor for `zod-from-json-schema`); SDK accepts JSON Schema and adapts to Zod internally
- `https://github.com/StefanTerdell/zod-from-json-schema` — JSON Schema → Zod schema adapter (TS side)
- `https://docs.pydantic.dev/latest/concepts/type_adapter/` — `TypeAdapter` for arbitrary-type validation (Python side); accepts JSON Schema via `RootModel.model_validate_json`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`QueryOptions` + `QueryResult`** (`ts/src/query/types.ts`) — additive extension only. Gains `allowedTools?`, `approvalMode?`, `outputSchema?` on options; `structured?` on result. Zero breaking changes.
- **`Model` const-object + union** (Phase 4) — exact template for the new `ApprovalMode` const-object. Same type-parity convention (TS const-object, Python `str` Enum with matching keys).
- **`buildArgv`** (`ts/src/query/buildArgv.ts`) — pure function; Phase 8 adds two branches (`allowedTools` → CSV → `--allowed-tools`; `approvalMode` → `--approval-mode <mode>`). Existing fuzz-test infrastructure covers the new option combinations.
- **`writeTempSystemPrompt` helper in `query.ts`** — Phase 8 extends to append schema-injection template when `outputSchema` is set. Temp-file lifecycle already handled per SYS-02.
- **`queryFull()` accumulator** (`ts/src/query/query.ts`) — already accumulates assistant text + chunks + sessionId. Phase 8 inserts validate-retry-throw logic after the accumulation loop, before the return.
- **`Session` value object + `--resume` branch in `buildArgv`** (Phase 7) — retry path constructs a Session from first call's init event, passes it to second call's `options.session` unmodified.
- **`UnsupportedFeatureError`** (Phase 5 `spec/errors.yaml`) — pre-existing class for the `outputSchema + query()/queryRaw()` pre-spawn guard. No new class needed for that guard.
- **`InvalidPromptError` pre-spawn guard template** (Phase 7) — mirrored pattern for the Phase 8 `outputSchema + non-queryFull` guard.
- **`scripts/gen-errors.*` + `spec/errors.yaml` + `scripts/lint-errors.sh`** — codegen pipeline; Phase 8 extends YAML schema with `source: 'stderr' | 'sdk'` discriminator, regenerates TS + Python classes, updates linter to tolerate source='sdk' entries.
- **`spec/fixtures/tool-use-builtin.{ndjson,expected.json}`** + **`spec/fixtures/multi-tool.{ndjson,expected.json}`** — existing fixtures for verifying tool-enforcement in the integration suite; Phase 8 research decides whether additional captures are needed.

### Established Patterns
- **New module = new directory.** Phase 5 → `errors/`, Phase 6 → `auth/`, Phase 7 → `session/`. Phase 8 likely → `output/` (for schema validation + retry) and possibly `tools/` (for `ApprovalMode` const + tool-list normalization). Files: `ts/src/output/schemaValidator.ts`, `ts/src/output/retry.ts`, `ts/src/output/injectSchema.ts` + specs; Python mirrors.
- **Additive `QueryOptions` extension.** Phases 4, 6, 7 established this: never break prior call sites. Phase 8 adds three optional fields. Typedoc / docstring markers carry the `@experimental` tag for `outputSchema` + its result-field counterpart.
- **Pure-function compose chain.** `buildArgv` → `resolveAuth` → `buildEnv` → `ProcessManager.spawn`. Phase 8's tool/approval-mode logic plugs into `buildArgv` as two small branches. Schema injection composes with the `writeTempSystemPrompt` helper (pure once the temp path is chosen). Validation + retry logic lives in `queryFull()` only.
- **Pre-spawn guards before `resolveAuth`.** Phase 7 pattern: validate cheap client-side checks first. Phase 8 adds `if (options.outputSchema) throw new UnsupportedFeatureError(...)` to `query()` + `queryRaw()` before `resolveAuth`.
- **Fixture-corpus parity tests.** Phase 3/5/7 parametrize TS + Python tests over `spec/fixtures/*`; Phase 8 SC-1/SC-2 tests slot into this pattern if new fixtures are added.
- **`@dataclass(frozen=True)` or typed enum for Python value objects** — `ApprovalMode` as a `str` Enum in Python (matching Phase 4 Model); `SchemaValidationError` as a generated `@dataclass`-style error (matching existing Phase 5 taxonomy classes).
- **Test-name parity enforced by `scripts/diff-test-names.sh`** — all Phase 8 tests must have TS + Python test names that match after grep extraction (run_* prefix convention when parametrizing fixtures).
- **Doc files for new features.** Phase 6 `docs/auth.md`, Phase 7 (planned) `docs/sessions.md` → Phase 8 adds `docs/tools.md` (approval-mode + allowed-tools guide) and `docs/structured-output.md` (schema + retry + known limitations linking #13388). Phase 11 publishes these.

### Integration Points
- `ts/src/query/types.ts` + Python mirror — ADD `allowedTools?: string[]`, `approvalMode?: ApprovalMode | string`, `outputSchema?: Record<string, unknown>` to `QueryOptions`; ADD `structured?: unknown` to `QueryResult`; ADD `ApprovalMode` const-object + union type; ADD `@experimental` JSDoc tags.
- `ts/src/query/buildArgv.ts` + Python mirror — ADD `allowedTools` CSV branch (skip if undefined or empty); ADD `approvalMode` flag branch (skip if undefined). Both branches purely additive; no changes to existing session / model / directory branches.
- `ts/src/query/query.ts` + Python mirror — ADD pre-spawn `UnsupportedFeatureError` guard when `outputSchema` is set (before the Phase 7 session-id guard is fine; either order works). Extend `writeTempSystemPrompt` to append schema-injection template when `outputSchema` is set.
- `ts/src/query/query.ts` `queryFull()` + Python mirror — Replace final `return { ... }` with a flow that: (a) when `outputSchema` is unset → existing return; (b) when set → strip markdown fences from `text`, validate via Zod/Pydantic, on success populate `QueryResult.structured = parsed`, on failure spawn a second `query()` with retry-feedback prompt + reused session, validate again, on second failure throw `SchemaValidationError`.
- `spec/errors.yaml` — ADD `SchemaValidationError` entry with `source: 'sdk'`, `retryable: false`, `bucket: 'unknown'`, `description` pointing to OUT-04; existing entries default to `source: 'stderr'`.
- `scripts/gen-errors.*` — extend YAML parser to read `source` field; pass through to generated class metadata so `lint-errors.sh` can discriminate.
- `scripts/lint-errors.sh` — extend to tolerate `source: 'sdk'` entries (no stderr regex expected); still require class existence in both TS + Python implementations.
- New files: `ts/src/output/schemaValidator.ts` + spec; `ts/src/output/retry.ts` + spec; `ts/src/output/injectSchema.ts` + spec (or a smaller bundled layout — planner's call). Python mirrors in `python/src/gemini_sdk/output/`.
- Barrel exports — add `ApprovalMode` + `SchemaValidationError` to `ts/src/index.ts` and `python/src/gemini_sdk/__init__.py`.
- `spec/fixtures.manifest.json` — potentially ADD entries for `--allowed-tools` enforcement + `plan-mode` empty-mutation fixture (Phase 8 research decides).
- `scripts/capture-fixtures.*` — potentially ADD `--scenario allowed-tools` + `--scenario plan-mode` branches.
- `docs/tools.md` (NEW) — approval-mode + allowed-tools guide; policy-engine migration note; caveat about `'default'` in non-TTY contexts.
- `docs/structured-output.md` (NEW) — schema + retry docs; `@experimental` callout linking gemini-cli #13388; markdown-fence-stripping heuristic note; supported JSON Schema subset.
- `spec/protocol.md` — optional small prose update documenting the schema-injection temp-file format + retry-prompt structure (for transparency, not for parity).
- `ts/package.json` + `python/pyproject.toml` — ADD `zod` (^3) + `zod-from-json-schema` to TS; Pydantic (v2, existing) already has `TypeAdapter` / `RootModel`. Verify PAR-04 shared-version contract if any new runtime deps.

</code_context>

<specifics>
## Specific Ideas

- The `allowedTools: string[]` + pass-through-unknowns shape mirrors MDL-02's raw-string model escape hatch exactly — the SDK stays a transparent wrapper rather than inventing a curated catalog that rots.
- The version-pinned assumption for Policy Engine migration is the honest position: REL-06 (runtime `gemini --version` warning) is the documented bulwark against drift. A silent probe-and-fallback would paper over a contract the user already signed up for.
- `ApprovalMode` as a const-object + union locks Phase 4's `Model` convention into a cross-phase idiom. Any future enum-shaped field (Phase 10 might add more) will follow the same pattern — consistency beats novelty.
- JSON Schema as the wire format for `outputSchema` is the "parity over ergonomics" choice: Zod and Pydantic callers have one-line conversions to reach JSON Schema, and the SDK's prompt-injection text stays byte-identical across languages. Makes fixture-parity tests trivial to author.
- Appending schema guidance AFTER the caller's `systemPrompt` honors the caller's primary authority over the system prompt while still making the schema a hard terminal constraint. Matches how users reason about "system messages" in modern LLM contexts.
- Scoping `outputSchema` to `queryFull()` only is a deliberate simplification — streaming + validation is conceptually incoherent (can't validate until complete) and the tempting "partial validation" path would ship bugs. `UnsupportedFeatureError` on `query()`/`queryRaw()` is the honest answer.
- The retry-reuses-session trick leans on the Phase 7 pipeline so the model sees its own invalid response in its checkpoint context — the validator's error message is the cherry on top, not the sole signal. This makes the retry meaningfully likely to succeed rather than a coin flip.
- `source: 'sdk'` on `SchemaValidationError` is the principled extension of PAR-05: a single YAML remains the source of truth; the `source` discriminator tells ErrorMapper + lint-errors.sh that this class bypasses the stderr/exit-code classification pipeline. It's a schema extension, not a violation.
- `@experimental` tag + docs section, NO runtime warning, mirrors the Phase 4 stance on `@deprecated` Models. The v1 primary audience (author + experienced SDK consumers) reads types and docs; nagging them at runtime is disrespect dressed as helpfulness.
- Out of many tempting complications (`outputSchemaTemplate` option, env-var gating, third `queryStructured` function) Phase 8 chooses the minimum viable shape. Best-effort is best-effort; v2 can elaborate when real callers push back on real seams.

</specifics>

<deferred>
## Deferred Ideas

- **Caller-defined custom tools via stub MCP** — CTL-01..03, v2 scope. Phase 8 explicitly documents this as not-supported (TOL-04). Stub MCP bridge depends on Phase 9 isolated MCP passthrough + v2 hook-bridge subprocess layer.
- **`outputSchemaTemplate` option** — Let callers override the schema-injection prose. Premature; fixed deterministic template is enough for v1. Add in v2 if real callers complain the default hurts their tuning.
- **Hard JSON-Schema enforcement (not best-effort)** — Blocked on gemini-cli upstream #13388. Documented in OUT-04 and `docs/structured-output.md` Known Limitations. SDK cannot guarantee what gemini-cli doesn't expose.
- **Env-var gated experimental features (`GEMINI_SDK_ENABLE_EXPERIMENTAL`)** — Overkill for the v1 audience. If future experimental features multiply and need isolation, introduce the gate then.
- **`queryStructured<T>(): Promise<T>` as a third entry point** — Discussed and declined; `queryFull({..., outputSchema})` + `QueryResult.structured` is sufficient. Reconsider only if typed generics become painful on `QueryResult.structured?: unknown` (a v2 ergonomic polish).
- **Multi-retry with progressive prompts** — OUT-03 mandates exactly one retry; progressive retries are a cost-and-latency tax with diminishing returns. Callers who need more resilience can wrap `queryFull` in their own retry loop.
- **Runtime Policy-Engine probe (`--help` one-shot cache)** — Explicitly declined in favor of the `.gemini-cli-compat` pinned-range contract + Phase 11 REL-06 compat probe. Reconsider if we get bitten post-v1.
- **Structured output for plan-mode** — Plan mode's event stream doesn't naturally produce JSON; combining `approvalMode: 'plan'` with `outputSchema` is undefined behavior in v1. Document that the combination raises `UnsupportedFeatureError` if we observe empirical incompatibility during Phase 8 research; otherwise leave as "caller beware."
- **`ResultChunk.toolsRequested` / `.approvalDecisions` telemetry** — Exposing structured reporting of tool permissions on the terminal chunk could help observability but is not required by TOL-01..04. Revisit in v2 if telemetry needs emerge.
- **Warning on `'default'` approvalMode in non-TTY contexts** — Discussed and declined; docs-only. Reconsider if users report stuck subprocesses.
- **Typed tool-name enum for `allowedTools`** — Forward-compat cost outweighs autocomplete benefit given the SDK's "transparent wrapper" stance. Callers who want autocomplete can define their own union locally.
- **Schema injection at the user-prompt level rather than system prompt** — Discussed and declined; systemPrompt-append is cleaner and works with multi-turn sessions unmodified.
- **SDK-internal subprocess-crash retry loops (beyond OUT-03)** — Per roadmap, SDK classifies; consumer (Archon) decides retry policy. `OUT-03`'s one-retry is the ONLY internal retry the SDK ships.

</deferred>

---

*Phase: 08-tools-approval-mode-structured-output-best-effort*
*Context gathered: 2026-04-19*
