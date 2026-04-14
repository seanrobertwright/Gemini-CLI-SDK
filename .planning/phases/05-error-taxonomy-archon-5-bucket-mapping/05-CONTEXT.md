# Phase 5: Error Taxonomy + Archon 5-Bucket Mapping - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Define the typed `GeminiError` hierarchy (base + `RateLimitError`, `AuthError` with subtypes, `ModelAccessError`, `InvalidPromptError`, `ProcessError`, `ProcessCrashError`, `ParseError`, `AbortError`, `UnsupportedFeatureError`, `GeminiNotFoundError`), generate both language implementations from a single `spec/errors.yaml` source, and build the `ErrorMapper` that pattern-matches `(exit code, stderr tail, last events)` into typed errors. Every error carries `.retryable` and optional `.retryAfterMs`. Error classes map 1:1 to Archon's 5 retry buckets (`rate_limit | auth | model_access | crash | unknown`). A CI linter cross-checks YAML against both language implementations to prevent drift.

Auth modes (Phase 6), session resume (Phase 7), tool/schema errors (Phase 8), MCP passthrough (Phase 9), and the Archon adapter (Phase 10) are out of scope — those phases consume the taxonomy, they don't extend it.

</domain>

<decisions>
## Implementation Decisions

### YAML schema design

- **Stderr matchers:** Regex strings (e.g. `/UNAUTHENTICATED|API key not valid/i`). TS uses `RegExp`, Python uses `re.compile`. Same source, both languages interpret the subset identically.
- **AuthError subtypes:** Separate top-level YAML entries per subtype (`NotConfigured`, `Forbidden403`, `Expired`, `ToSViolation`) with `parent: AuthError`. Codegen emits distinct classes — one-to-one with typed class hierarchy. Clearest for the linter; preserves `instanceof` narrowing.
- **Exit-code matching:** Optional `exit_codes: [1]` field per entry. Omit when exit code isn't discriminating. Matches the shape already used in `spec/errors.md` §3.
- **Retryable + retryAfterMs:** `retryable: true|false` is a static YAML field per entry. Optional `retry_after_ms_source` names a matcher-captured group (e.g. `error.retryAfter`) so `RateLimitError` can surface real upstream `Retry-After` hints when present (ERR-02). Static default + dynamic extraction.

### ErrorMapper integration

- **Two entry points, one taxonomy (ERR-05):**
  - Stream-json `{"type":"error"}` events → `dispatch()` calls `ErrorMapper` and throws the typed error inline.
  - Exit-code + stderr path → `query()` calls `ErrorMapper` in a `finally`/`catch` block when the subprocess exits non-zero, passing `(exitCode, stderrTail, lastEvents)`.
  - Both paths MUST resolve to the identical typed class for the same underlying condition.
- **Stderr capture:** `ProcessManager` attaches a listener to `child.stderr` and keeps the last 4–8 KiB in a ring buffer. Exposes `.getStderrTail()`. Bounded memory, enough bytes for all fingerprints in `spec/errors.md`.
- **AbortError relocation:** Move `AbortError` from `ts/src/query/types.ts` into the errors module as a subclass of `ProcessError` (which is itself a `GeminiError`). Defined in `errors.yaml`. `query/types.ts` may re-export for backward-compat within the repo during the migration.
- **ERR-06 detection ("stream ended without terminal result"):** `query()` tracks a `sawResult` flag. If the generator reaches end-of-stream (or the subprocess exits) without `sawResult === true`, `query()` throws `ProcessError` via `ErrorMapper` — regardless of exit code (even on exit 0, per ERR-06).

### Codegen strategy

- **Script-based codegen:** `scripts/gen-errors.mjs` emits `ts/src/errors.ts`; `scripts/gen-errors.py` emits `python/src/gemini_sdk/errors.py`. Generated files carry an `// AUTO-GENERATED` header. Matches the repo's existing script-heavy style (`capture-fixtures`, `diff-test-names`, `validate-fixtures`, `sync-version`).
- **Generated files are committed:** Developer runs the codegen after editing YAML. CI runs the script and `git diff --exit-code` to fail merge on drift. Mirrors how `spec/events.schema.json` → generated types already works in Phases 1/3.
- **Single linter script:** `scripts/lint-errors.sh` handles both responsibilities: (1) re-run codegen and diff against committed files; (2) import `errors.ts` and `errors.py`, enumerate classes, cross-check against YAML. One CI job, one failure point. Satisfies ERR-07 and PAR-05 together.

### Synthetic fixture handling

- **Re-capture as a Phase 5 prerequisite:** Before `ErrorMapper` implementation, re-capture `spec/fixtures/error-auth.*` and `spec/fixtures/error-rate-limit.*` against a real API-key-only host. Update `.ndjson` + `.stderr.txt` + `.expected.json`, remove `"synthetic": true` sidecars. Real stderr regex patterns derived from what gemini-cli actually emits. ERR-05 contract rests on real shapes, not speculation.
- **Unknown-pattern fallback:** Any unmatched failure (exit!=0, no stream error, unknown stderr) becomes a generic `GeminiError` with `.bucket = 'unknown'`, `.retryable = false`. Include stderr tail + exit code in `.message` for debugging. Non-retryable by default — safer for Archon's retry classifier.
- **Contract test shape:** A parametrized data-driven test in each language iterates every `spec/fixtures/*.stderr.txt` + its `.ndjson` sibling, runs both the stream-json and exit-code+stderr paths through `ErrorMapper`, and asserts identical typed class + `.retryable` + `.retryAfterMs` + bucket. Adding a new error fixture = a new test case for free. Matches Phase 3's fixture-corpus parity pattern.

### Claude's Discretion

- Exact regex syntax subset that's portable between TS `RegExp` and Python `re` (likely avoid look-around variants beyond the basics)
- Generated file formatting (prettier/ruff config)
- Exact ring buffer implementation in `ProcessManager` (simple byte-capped array vs circular buffer)
- Whether `ProcessError` and `ProcessCrashError` are siblings or parent-child in the hierarchy (spec/errors.md lists both; refine during planning)
- Error message templating (string interpolation vs static strings per class)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Error taxonomy (primary contract)
- `spec/errors.md` — Normative draft of error patterns, classifier logic, Archon bucket mapping, and Phase 5 handoff section. Read §3 (observed patterns), §4 (pattern detail), §5 (gaps), §6 (handoff).
- `spec/errors.yaml` — TO BE CREATED in this phase; single source of truth for codegen.

### Requirements
- `.planning/REQUIREMENTS.md` §"Error Taxonomy" — ERR-01 through ERR-07 (hierarchy, retryability, buckets, dual-path mapping, ERR-06 "no terminal result", CI linter).
- `.planning/REQUIREMENTS.md` §"Parity (TS ↔ Python)" — PAR-05 (error taxonomy generated from one YAML source).
- `.planning/ROADMAP.md` §"Phase 5" — Goal + 4 success criteria.

### Fixtures
- `spec/fixtures/error-auth.ndjson` + `.stderr.txt` + `.expected.json` — SYNTHETIC; to be re-captured.
- `spec/fixtures/error-rate-limit.ndjson` + `.stderr.txt` + `.expected.json` — SYNTHETIC; to be re-captured.
- `spec/fixtures/abort-midstream.ndjson` + `.expected.json` — REAL capture; ERR-06 evidence.
- `spec/fixtures/` (corpus) — all `*.stderr.txt` + `*.ndjson` pairs feed the parametrized contract test.

### Phase 1 handoff context
- `.planning/phases/01-feasibility-spike-fixture-capture/01-CONTEXT.md` — Synthetic-fixture caveat; OAuth vs API-key distinction; feasibility fallback decisions.

### Upstream references
- gemini-cli discussion #22970 — API-key default rationale (referenced from AUT-08, relevant for `AuthError` error message copy).
- gemini-cli issue tracker — 401/429 response shape (to be validated during re-capture).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ts/src/errors/GeminiNotFoundError.ts` — Existing `GeminiNotFoundError extends Error`. Reparent to extend `GeminiError`; keep the helpful "install gemini-cli" message. Already exported from `ts/src/errors/index.ts` (barrel).
- `python/src/gemini_sdk/errors/not_found.py` — Python counterpart; same reparenting treatment.
- `ts/src/query/types.ts:89` — Existing `AbortError extends Error`. Relocate into `errors/` as part of the generated hierarchy.
- `ts/src/parser/dispatch.ts` — Currently throws generic `Error` for non-rate-limit error events (per Phase 3 session notes: "Phase 3 throws generic Error for non-rate-limit errors; Phase 5 replaces with GeminiError from error taxonomy"). Replace call site with `ErrorMapper` lookup.
- `ts/src/process/ProcessManager.ts` + `python/src/gemini_sdk/process/process_manager.py` — Extend with `.getStderrTail()` + bounded ring buffer for stderr.
- `ts/src/query/query.ts` + Python counterpart — Extend with `sawResult` flag (ERR-06) + `finally` hook that calls `ErrorMapper` on non-zero exit.

### Established Patterns
- **Generated-from-spec pattern:** Phase 1/3 already generate types from `spec/events.schema.json` via `json-schema-to-typescript` (TS) and `datamodel-code-generator` (Python). Phase 5's YAML→code pipeline follows the same philosophy with custom scripts instead of third-party generators.
- **Scripts directory:** `scripts/` at repo root hosts Node and Bash scripts (e.g. `scripts/diff-test-names.sh`, `scripts/sync-version.sh`, `scripts/validate-fixtures.mjs`). `scripts/gen-errors.mjs` and `scripts/lint-errors.sh` slot in naturally.
- **Fixture-corpus parity:** Phase 3's dispatch test suite parametrizes over every `spec/fixtures/*.ndjson` with AST-extracted `run_*` helpers in both languages (see Phase 3 context). Phase 5's contract test uses the same shape.
- **Two-stage parser pipeline:** `parseNdjson` → `dispatch` → `query`. ErrorMapper hooks are surgical: dispatch for stream errors, query for exit-code path.
- **No symlinks, relative-path fixtures:** Both languages read fixtures via `../../spec/fixtures/*` (Phase 2 decision).

### Integration Points
- **dispatch.ts / dispatch.py:** Replace `throw new Error(...)` for stream-error events with `throw ErrorMapper.fromStreamEvent(event)`.
- **query.ts / query.py:** Wrap the `for await` in a try/finally that (a) tracks `sawResult`, (b) on non-zero exit or premature EOF, invokes `ErrorMapper.fromExit(exitCode, processManager.getStderrTail(), lastEvents)` and throws the result.
- **ProcessManager:** Add `.getStderrTail(): Uint8Array | string` returning the last N bytes of stderr. Zero-allocation path when stderr is empty.
- **CI workflow:** Add `lint-errors.sh` step to the existing `parity` job in `.github/workflows/ci.yml`.
- **Barrel exports:** `ts/src/errors/index.ts` re-exports all generated classes + ErrorMapper; `python/src/gemini_sdk/errors/__init__.py` likewise.

</code_context>

<specifics>
## Specific Ideas

- Existing synthetic stderr patterns in `spec/errors.md` §4.1/4.2 (`"API key not valid"`, `"UNAUTHENTICATED"`, `"quota"`, `"RESOURCE_EXHAUSTED"`) are starting hypotheses only — to be replaced with real captures.
- `retry_after_ms_source` is specifically motivated by ERR-02 wanting `RateLimitError.retryAfterMs` to reflect real upstream hints when the 429 response includes them (currently unknown per spec/errors.md §5 gap table).
- The `AUTO-GENERATED` header convention matches how `json-schema-to-typescript` output looks — consistency across codegen surfaces.

</specifics>

<deferred>
## Deferred Ideas

- Model-deprecation captures (post-2026-06-17 for 2.5 series) — defer until models are actively deprecated (spec/errors.md §5, gap row 6).
- Content-policy-violation capture (`InvalidPromptError`) — synthesize from docs in Phase 5; live capture deferred to a later phase that has a known policy-violating prompt.
- Streaming cost hooks / per-error telemetry — out of SDK scope per PROJECT.md ("real-time hard budget enforcement" out of scope).
- Error message i18n — not in v1 scope.

</deferred>

---

*Phase: 05-error-taxonomy-archon-5-bucket-mapping*
*Context gathered: 2026-04-14*
