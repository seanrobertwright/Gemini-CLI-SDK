# Phase 10: Archon Adapter (TS only) - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `GeminiClient implements IAssistantClient` in `adapter-archon/` as a thin TS-only shim (≤200 LOC stretch, ≤250 hard cap), prove `DEFAULT_AI_ASSISTANT=gemini` works end-to-end against a real Archon checkout via contract tests, and open a draft PR against `coleam00/Archon`. No Python work. No new SDK features — if the adapter is hard to write, loop back to an earlier phase rather than expanding Phase 10.

</domain>

<decisions>
## Implementation Decisions

### Contract test strategy (ARC-07)
- **Archon source:** CI clones `coleam00/Archon` at a pinned SHA recorded in `.archon-compat`. Adapter is symlinked into the clone's `node_modules` before tests run. No git submodule.
- **What the test asserts:** Run Archon's own existing e2e workflow-dispatch suite unchanged with `DEFAULT_AI_ASSISTANT=gemini`. We don't author parallel assertions — passing Archon's suite *is* the proof.
- **Live API calls:** One gated CI job uses a repo-secret `GEMINI_API_KEY` against a cheap prompt. Gated on main-branch + manual trigger so fork PRs don't leak the key. PR CI runs a fixture-backed variant; main also runs the live variant.
- **Drift guard:** Weekly scheduled CI re-pulls Archon's latest `main`, runs the contract suite, and opens an issue if it breaks. Goal: learn about upstream interface drift within a week.

### Options mapping triage (ARC-05)
- **Doc location:** `spec/archon/mapping.md` — canonical table (AssistantRequestOptions field → honored/partial/deferred/ignored → SDK behavior). Adapter source comments cite this doc; no duplicate inline table.
- **Triage source:** Mirror the Claude client's mapping as the starting point; drop a field to partial/deferred/ignored only when a concrete gemini-cli limitation forces it. Minimizes surprise for Archon reviewers and for Archon's retry classifier, which was written against Claude's behavior.
- **Drift guard:** Generated drift test imports Archon's `AssistantRequestOptions` type keys and asserts every key has an entry in `OPTION_MAPPING`. Unmapped field → failing test with `uncategorized: <name>`, forcing a conscious decision on every Archon bump.
- **Ignored-field runtime behavior:** Silently dropped in production; one-time `console.warn` per field when `NODE_ENV=development` or `DEBUG=gemini-sdk:*` is set. Matches "silently ignored per Claude/Codex precedent" while preserving a discovery hint for SDK users.

### PR packaging & timing (ARC-08)
- **Shape:** Single PR on branch `gemini-sdk-integration` against `coleam00/Archon` adding `packages/core/src/clients/gemini.ts`, a 3-line `factory.ts` edit, and `.env.example` entries for `GEMINI_API_KEY` and `GEMINI_BIN_PATH`. No split.
- **Draft state:** Open as **draft** during Phase 10 (satisfies ARC-08). Flip to ready-for-review in Phase 11 after `@gemini-sdk/gemini` is published to npm. Avoids chicken-and-egg with Phase 11's "tag v1.0.0 only after merge".
- **Dep reference in draft:** Use a GitHub tarball dep (`"@gemini-sdk/gemini": "github:<repo>#<sha>"`) so Archon maintainers can actually run it. Swap to `"^1.0.0"` before flipping to ready-for-review.
- **Announcement:** Open quietly. Ping `@coleam00` in the PR description only when flipped to ready-for-review, with links to the npm package and the Phase 11 compat matrix page.

### Session & workflow_dispatch handover
- **Resume arg:** Adapter is stateless. Archon's positional `resumeSessionId` is passed straight to `query()` as `options.resume`. The `Session` value object stays internal to the SDK — adapter never constructs one.
- **New session ID surfacing:** Pulled from the SDK's `init` event and stamped onto the first system `MessageChunk` the adapter emits, matching `claude.ts` convention. Archon already reads it there.
- **`workflow_dispatch` emission:** Emit one `workflow_dispatch` MessageChunk per tool call the SDK surfaces (tool name + args). Mirrors `claude.ts` cadence so Archon's workflow-dispatch e2e tests fire equivalently.
- **Error surfacing:** Adapter throws typed `GeminiError` subclasses unchanged. Archon's retry classifier reads the `bucket` field that Phase 5 already stamps on every error — zero translation layer, zero coupling to an Archon error type.

### Env-var namespace linter (ARC-09)
- **Scope:** `adapter-archon/src/**` only. SDK code (`ts/src/**`) is out of scope — it has legitimate reasons to touch non-namespaced vars (env scrubbing, PATH, etc.).
- **Allowlist (8 vars):** `GEMINI_*`, `GEMINI_SDK_*`, `PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`, `NODE_ENV`, `DEBUG`. `NODE_ENV`/`DEBUG` are required for the dev-warn behavior on ignored options.
- **Severity:** Hard CI failure, blocks merge. Matches ARC-09 wording ("fails merge if any env var outside the namespaces appears").
- **Implementation:** Shell script at `scripts/lint-env-namespace.sh` wired into the CI matrix. `grep -E` for `process\.env\.[A-Z_]+` + `env\[`, subtract allowlist, fail if non-empty. No ESLint plugin, no AST tooling — ~20 lines of bash.

### Claude's Discretion
- LOC budget enforcement mechanism (line-count CI check vs. review-time check; what counts as LOC — comments, blank lines, type aliases)
- Exact pin SHA choice (`coleam00/Archon@main` at phase start vs. last-tagged release — planner can pick based on Archon's release cadence at planning time)
- Structure of `spec/archon/mapping.md` (single table vs. per-bucket sections)
- Exact shape of the drift-test assertion (snapshot vs. runtime reflection over Archon types)
- Fixture-vs-live CI job split details (matrix layout, caching)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Archon interface (upstream, external)
- `https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts` — `IAssistantClient`, `AssistantRequestOptions`, 8-variant `MessageChunk` union. Adapter signature must match exactly (ARC-02).
- `https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/claude.ts` — Reference adapter. Our options triage mirrors this file's mapping unless gemini-cli forces divergence. Session-ID-in-first-system-chunk and workflow_dispatch-per-tool-call cadence both come from here.
- `https://github.com/coleam00/Archon/blob/dev/packages/core/src/factory.ts` — The 3-line edit site (ARC-08).

### Roadmap & requirements
- `.planning/ROADMAP.md` §Phase 10 — Goal, dependencies, 4 success criteria (lines 182–191).
- `.planning/REQUIREMENTS.md` §Archon Integration — ARC-01..09 full text (lines 118–128).

### SDK surface this adapter consumes
- `ts/src/query/index.ts` — Public `query()` generator. Adapter's only entry point into the SDK.
- `ts/src/session/` — `Session` value object (stays internal; adapter passes `resumeSessionId` as `options.resume`).
- `ts/src/errors/` — Typed `GeminiError` hierarchy with `.bucket` field for Archon's retry classifier.
- `ts/src/output/` — Phase 8 structured output + retry machinery, surfaced via `query()` options.

### Error bucket contract (Phase 5)
- `spec/errors.md` — Archon 5-bucket retry taxonomy (rate_limit, auth, model_access, crash, unknown). Adapter relies on these buckets already being stamped; doesn't re-classify.
- `spec/errors.yaml` — Single source for the error hierarchy.

### Event/chunk contract (Phase 3)
- `spec/events.schema.json` — Event shapes the adapter consumes via MessageChunk.
- `.planning/phases/03-ndjson-parser-eventdispatcher-messagechunk-types/03-CONTEXT.md` §Archon type contract — Documents that `workflow_dispatch` is reserved for Phase 10 and how the other 7 variants map from CLI events.

### Docs to be created in this phase
- `spec/archon/mapping.md` — Canonical 11/4/4/5 AssistantRequestOptions triage table (new in Phase 10).
- `.archon-compat` — Pinned Archon SHA for contract tests (new in Phase 10).
- `scripts/lint-env-namespace.sh` — Env-var namespace linter (new in Phase 10).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `adapter-archon/` package stub already wired (`package.json`, `tsconfig.json`, source-publishing `.ts` via `exports` field) from Phase 2. Only `src/index.ts` needs to be filled in.
- `ts/src/query/query` — async generator already returns MessageChunk-shaped events; adapter's `sendQuery` is mostly a delegation.
- Phase 5 `GeminiError` classes already carry `.bucket` matching Archon's 5-bucket taxonomy — no translation layer needed.
- Phase 7 `query({ resume })` already supports session resume — adapter just forwards the positional `resumeSessionId`.
- `tests-live/` harness from Phase 9 is the template for the live-API contract job (gated on secret, manual trigger).

### Established Patterns
- Spec docs live in `spec/*.md` with fixture citations — `spec/archon/mapping.md` should follow that convention.
- Shell-script CI helpers already exist (Phase 1 `scripts/validate-fixtures.mjs`, etc.) — `scripts/lint-env-namespace.sh` fits this pattern.
- Source-published `.ts` pattern already in place in `adapter-archon/package.json` `exports` — nothing new to decide there.
- Cross-language phases use shared fixtures; Phase 10 is TS-only and skips the parity CI diff for this phase.

### Integration Points
- `adapter-archon/src/index.ts` — single entry point. Must export `GeminiClient` class with `getType()` returning `'gemini'` and `sendQuery(prompt, cwd, resumeSessionId?, options?)` signature.
- CI matrix (Phase 2) — adds two new jobs: contract-test (clone + run Archon suite) and env-namespace-lint. Weekly drift-guard is a separate scheduled workflow.
- Upstream Archon repo — the draft PR is the terminal integration point.

</code_context>

<specifics>
## Specific Ideas

- "Adapter is a shim, business logic stays in the SDK" — if the adapter grows past 250 LOC, push logic down into the SDK rather than fattening the shim. The phase goal explicitly says a hard-to-write adapter means the SDK's shape is wrong.
- Mirror `claude.ts` wherever gemini-cli allows — Archon's retry classifier and workflow-dispatch tests were written against Claude's behavior, and deviating from that without cause multiplies integration-test flake risk.
- Dev-warn is a discovery affordance, not a feature — silent in prod, never an error, never throws.

</specifics>

<deferred>
## Deferred Ideas

- LOC budget enforcement (automated line-count gate, what counts) — Claude's discretion during planning.
- Archon pin SHA selection (latest `main` vs. last-tagged release) — Claude's discretion at plan time, based on Archon's release cadence.
- Importing `IAssistantClient` type directly from a published `@archon/core` npm package as an additional drift guard — depends on Archon's publishing decisions; revisit in Phase 11 or post-v1.
- Any v2 adapter enhancements (e.g., honoring the 4 "deferred" option fields) — out of scope for v1 per ARC-05.

</deferred>

---

*Phase: 10-archon-adapter-ts-only*
*Context gathered: 2026-04-21*
