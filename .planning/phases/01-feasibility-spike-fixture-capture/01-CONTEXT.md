# Phase 1: Feasibility Spike + Fixture Capture - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Empirically resolve three load-bearing unknowns about `gemini-cli` (`--resume` + `-p` interop per issue #14180, `GEMINI_CONFIG_DIR` redirect behavior, `stream-json` per-event flushing), capture real NDJSON traces for the downstream parser phase, and freeze the shared event JSON Schema that generates both TS types and Pydantic models. **Phase 1 ships no SDK code** — deliverables are spec documents, NDJSON fixtures, a pinned `gemini-cli` version, and feasibility verdicts.

This phase is the empirical ground truth that every subsequent phase builds on. Phase 3's parser is built *from* these fixtures, not from upstream docs. Phase 5's error taxonomy is built *from* observed stderr samples, not speculatively. Phase 7's session design is gated on the `--resume`+`-p` verdict. Phase 9's MCP passthrough is gated on the `GEMINI_CONFIG_DIR` verdict.

Requirements mapped to this phase: **PRS-08** (shared JSON Schema at `spec/events.schema.json` generating TS types and Pydantic models), **PRS-09** (shared fixture corpus at `spec/fixtures/*.ndjson` with sibling `.expected.json` files consumed by both TS and Python CI).

</domain>

<decisions>
## Implementation Decisions

### Version pinning strategy

- **Pin target:** Latest stable `gemini-cli` at the time Phase 1 runs. Full version string (e.g. `0.39.2`) committed to `.gemini-cli-compat` at repo root.
- **Bump policy:** On-demand only. Pin gets bumped when a blocking upstream bug is fixed or a needed feature lands — NOT on every upstream release. Stability > freshness, especially given gemini-cli's weekly cadence and 2.4k open issues.
- **Minimum-supported version floor:** Separate from the CI pin. The SDK publishes a runtime floor (documented and enforced by a version probe) that is typically broader than the CI-pinned version. The CI pin is a subset of the floor — anything from the floor upward should work, but the pin is what CI guarantees.
- **Single-version fixture capture:** Phase 1 captures fixtures against ONE pinned version only. No second-version compat-matrix testing in this phase — that's Phase 11's job. Keeps Phase 1 focused.

### Fixture capture environment

- **Auth source:** Project author's personal `GEMINI_API_KEY` (local only). The key never touches CI, never touches the repo, never touches committed artifacts. Passed into `gemini-cli` via environment variable at capture time.
- **Capture host:** Local Windows machine (project author's primary dev box). This is deliberate: Phase 1 capture under Windows exposes encoding issues (CRLF, non-en-US locales, Unicode normalization) at the earliest possible moment, matching the project's Windows-first posture.
- **Secrets sanitization:** `scripts/capture-fixtures.sh` (and its platform-native equivalent for Windows — probably `.ps1` or `.cmd` wrapper) pipes gemini-cli output through a **redactor** before writing to disk. Redactor patterns match: API key prefixes, Google Cloud project IDs, OAuth token formats, session tokens, absolute file paths from the capture host. **Plus** manual human review of each fixture diff before commit. Belt-and-braces.
- **Re-capture mechanism:** Single reproducible command — `scripts/capture-fixtures.sh` (or platform equivalent) replays every scenario and regenerates `spec/fixtures/*.ndjson` + `*.expected.json` pairs in one shot. Version bumps + fresh captures = one command, not manual per-scenario work.

### Feasibility failure response

The three smoke tests resolve toward **"Complete with documented fallback verdict"** rather than blocking on upstream. Phase 1 always ships something actionable. The fallback machinery lives in downstream phases but is *gated* by Phase 1's verdict flags.

- **If `--resume` + `-p` smoke test FAILS (#14180 confirmed broken):**
  Phase 1 completes. `spec/feasibility.md` documents the failure. A config flag `transcript_prepend_fallback: true` is set for Phase 7 consumption. Phase 7 lands the transcript-prepend fallback as its **default** path (not dark-shipped). `Session` value object stores previous turns locally and `buildArgv` prepends them to each `-p` invocation.

- **If `GEMINI_CONFIG_DIR` / HOME override smoke test FAILS (can't isolate settings.json):**
  Phase 1 completes. `spec/feasibility.md` documents the failure. Phase 9 falls back to `gemini mcp add --scope project` into a temp `cwd` for MCP passthrough instead of writing a temp `settings.json` fragment via env var redirect. Phase 9's "never mutate user's real `~/.gemini/settings.json`" invariant is preserved either way.

- **If `stream-json` is block-buffered (not per-event flushed):**
  Phase 1 completes. `spec/feasibility.md` records timing measurements. Phase 4 exposes `forcePty: true` as a `query()` option that routes subprocess stdout through `node-pty` (TS) / `pty` equivalent (Python) to force line-buffering. Default is `false`; users opt in when they need real-time streaming.

- **If ALL THREE smoke tests fail catastrophically:**
  Phase 1 returns `## ROADMAP BLOCKED` with a re-scoping conversation required. Possible pivots: synchronous-only SDK (no streaming), single-turn-only SDK (no sessions), or pause the project until a gemini-cli minor release addresses at least one of the three. Do NOT forge ahead with all three fallbacks stacked — the resulting SDK would be too far from the Claude Agent SDK shape to serve the Archon integration goal.

### Fixture scope

Minimum set of **6 required fixtures** from ROADMAP.md success criterion #1, plus **5 additional scenarios** for a total of **11 fixtures**. Each fixture is an `spec/fixtures/<name>.ndjson` file with a sibling `spec/fixtures/<name>.expected.json` documenting the normalized `MessageChunk` event sequence the parser should yield.

**Required (6):**
1. `simple-text.ndjson` — Single-turn text prompt, no tool use. Baseline.
2. `tool-use-builtin.ndjson` — Prompt that triggers a built-in gemini-cli tool call (e.g. `read_file` on a fixture workspace file).
3. `resume-session.ndjson` — Pair of captures: turn 1 captures a session ID from the `init` event; turn 2 passes `--resume <id>` and demonstrates context continuity.
4. `error-rate-limit.ndjson` — A `stream-json` `error` event + exit code + stderr for a rate-limit failure (trigger by running rapid-fire captures or using a capped key).
5. `error-auth.ndjson` — Similar capture for an auth failure (trigger with an invalid API key).
6. `event-unknown.ndjson` — Synthetic: a captured NDJSON line with an invented `type` value that the parser must yield as `{type:'unknown', raw}` without throwing.

**Added (5):**
7. `thinking.ndjson` — gemini-2.5-pro with extended reasoning enabled, emitting `thinking` events. Phase 3's `MessageChunk` union includes a `thinking` variant; capturing now prevents Phase 3 from needing to synthesize it. Capture from the 2.5-pro model specifically (the deprecation on 2026-06-17 is noted; re-capture against the successor model after EOL).
8. `multimodal-image.ndjson` — Prompt with an image attachment. Validates the event schema's attachment representation on the input side and any image-reasoning event types on the output side.
9. `multimodal-pdf.ndjson` — Prompt with a PDF attachment. Distinct from image — PDF processing may emit different event types (page markers, extracted-text events) that image doesn't.
10. `large-output.ndjson` — Long-running output (e.g. "list 200 facts about topic X"). **Critical for the stream-json flushing smoke test** — without a fixture long enough to cross OS pipe buffer thresholds, block-buffering bugs hide. Also exercises the 1 MiB line-limit + chunk-boundary UTF-8 decoder code in Phase 3.
11. `abort-midstream.ndjson` — Kill the subprocess partway through output. Produces a truncated NDJSON stream + non-zero exit. Phase 5 uses this as the canonical "stream ended without a terminal `result` event" fixture for the error classifier.

**Image and PDF source assets:** Committed to `spec/fixtures/_assets/` (e.g. a small test image and a small test PDF) so fixture re-capture is reproducible.

### Claude's Discretion

- Exact filenames under `spec/fixtures/` (follow the convention above but feel free to disambiguate)
- Exact prompt text for each scenario (document in `spec/capture.md` so re-capture is deterministic)
- The specific redactor regex patterns (derive from known key/token/ID formats; err on side of over-redaction)
- Directory structure under `spec/` beyond what's already implied (e.g. whether `spec/protocol.md` has subsections for each event type, how `spec/errors.md` organizes the pattern table)
- Whether `.gemini-cli-compat` is a plain-text file, YAML, or JSON (plain version string is simplest; pick it unless there's a strong reason otherwise)
- `spec/events.schema.json` internal structure (discriminated-union JSON Schema pattern — discover it empirically from fixtures, don't design it a priori)
- Platform-native fixture capture script format (Windows: `.cmd` or `.ps1` wrapping a shared core; document in `spec/capture.md`)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level specs (this repo)

- `.planning/PROJECT.md` — Project vision, core value, constraints, key decisions from questioning
- `.planning/REQUIREMENTS.md` — All v1 requirements; PRS-08 and PRS-09 are the two mapped to Phase 1
- `.planning/ROADMAP.md` §"Phase 1: Feasibility Spike + Fixture Capture" — Goal, success criteria, dependencies
- `.planning/research/SUMMARY.md` — Synthesis of all research; "Critical Corrections to PROJECT.md Assumptions" section captures 9 load-bearing findings Phase 1 must honor
- `.planning/research/SUMMARY.md` §"Phase 1: Feasibility spike + fixture capture" — Research-side rationale for exactly why this phase exists
- `.planning/research/STACK.md` — Technology choices (JSON Schema tooling, fixture-corpus pattern, polyglot monorepo layout) that inform Phase 1 outputs
- `.planning/research/FEATURES.md` — Full feature feasibility matrix with per-feature Direct/Workaround/Blocked classification cited with gemini-cli issues
- `.planning/research/ARCHITECTURE.md` — 11-phase build order; fork points; Phase-1 deliverable list
- `.planning/research/PITFALLS.md` — 18 pitfalls with pitfall-to-phase mapping; Pitfalls 1, 17 are directly addressed by this phase

### Gemini CLI upstream (external)

- https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md — Canonical auth env vars and modes (confirms `GEMINI_API_KEY` is the right canonical default and that `GOOGLE_AUTH_TOKEN` does not exist)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md — Full CLI flag reference
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md — `stream-json` event schema and non-interactive mode reference (primary source for expected fixture shapes)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/settings.md — `settings.json` keys (affects Phase 9 config-dir fallback strategy)
- https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md — Hooks reference (context for why hooks are v1.x, not v1)
- https://github.com/google-gemini/gemini-cli/issues/14180 — `--resume` + `-p` interop bug; Phase 1 smoke test #1 resolves this empirically
- https://github.com/google-gemini/gemini-cli/issues/13388 — Custom output schema feature request (blocker for guaranteed structured output)
- https://github.com/google-gemini/gemini-cli/issues/14435 — Session ID in headless JSON output
- https://github.com/google-gemini/gemini-cli/issues/8203 — `stream-json` output format shipping issue
- https://github.com/google-gemini/gemini-cli/discussions/22970 — March 2026 Google routing change; justifies API-key-canonical auth

### Reference SDKs (external, for API-shape cross-checking)

- https://code.claude.com/docs/en/agent-sdk/overview — Claude Agent SDK feature surface (the reference shape our SDK mirrors)
- https://github.com/anthropics/claude-agent-sdk-python — Python reference for subprocess wrapping patterns; `_internal/transport/subprocess_cli.py` has directly applicable primitives

### Archon integration target (external)

- https://github.com/coleam00/Archon/blob/dev/packages/core/src/types/index.ts — `IAssistantClient`, `MessageChunk`, `AssistantRequestOptions` definitions. Phase 1's event JSON Schema must emit events that map cleanly into Archon's 8-variant `MessageChunk` union.
- https://github.com/coleam00/Archon/blob/dev/packages/core/src/clients/claude.ts — Reference implementation of the interface Phase 10 will match.

</canonical_refs>

<code_context>
## Existing Code Insights

This is a greenfield repo. The only committed files are `.planning/` (project docs), `.git/`, and whatever files are materialized by Phase 1 itself. There is no existing code to scout.

### Reusable Assets

None. Everything Phase 1 touches is new.

### Established Patterns

None from this repo. The patterns Phase 1 *establishes* (which Phase 2 onward consumes):
- `spec/` directory as the single source of truth for event schemas, fixture corpus, error taxonomy specs, and capture procedures
- `.gemini-cli-compat` root file as the single-version pin
- `scripts/capture-fixtures.*` as the single reproducible re-capture entry point

### Integration Points

- Phase 2 will create `ts/`, `python/`, and `adapter-archon/` package directories. Phase 1's `spec/` directory is peer to those and consumed by all.
- Phase 3's parsers import generated types from `spec/events.schema.json` via `json-schema-to-typescript` (TS) and `datamodel-code-generator` (Python). Phase 1 must ensure the schema file compiles cleanly in both generators before Phase 1 can be marked complete.
- Phase 5's error taxonomy YAML consumes stderr fragments captured as part of the error fixtures (`error-rate-limit.ndjson`, `error-auth.ndjson`). Phase 1's `spec/errors.md` draft cites those fixtures as evidence for every pattern.

</code_context>

<specifics>
## Specific Ideas

- **"Dogfood capture on Windows."** Project author is Windows-first; fixture capture happens there deliberately to surface encoding and path-separator issues at the earliest possible point. If something doesn't work on Windows during capture, it's a Phase 1 blocker, not a Phase 2 surprise.
- **"Fixtures are frozen; captures are reproducible."** Committed fixtures are the spec. Re-capture is a discipline, not an ad-hoc action — it always runs through `scripts/capture-fixtures.*`, never manual CLI invocations outside the script.
- **"No fake fixtures where real ones are possible."** `event-unknown.ndjson` is synthetic by necessity (the whole point is to test unknown-event handling, which gemini-cli won't produce on its own). Everything else comes from real CLI runs.
- **"`spec/feasibility.md` is normative, not informational."** The three verdicts in that file directly drive config flags that Phases 4, 7, 9 read. It is a load-bearing document, not a report.

</specifics>

<deferred>
## Deferred Ideas

- **Compat-matrix testing against multiple gemini-cli versions** — deferred to Phase 11 (Docs Site + Compat Matrix + Release). Phase 1 is single-version only.
- **Runtime version probe implementation** — deferred to Phase 11 where it belongs with the compat matrix. Phase 1 only *declares* the minimum-supported version floor; the probe enforcement lands later.
- **CI-driven fixture regeneration** — if local capture becomes untenable, consider moving to a manually-triggered GitHub Actions workflow with a CI secret. Not a v1 concern.
- **Third Vertex AI fixture** (service account JSON path + `GOOGLE_API_KEY` path) — auth-mode fixtures belong in Phase 6 (Auth Environment), not Phase 1. Phase 1's auth fixtures are error-path only (rate limit, auth failure).
- **Thinking fixture re-capture against post-2.5 successor model** — due 2026-06-17 or earlier, whenever Gemini 2.5 Pro is replaced as the extended-reasoning model. Tracked here so it's not forgotten.

</deferred>

---

*Phase: 01-feasibility-spike-fixture-capture*
*Context gathered: 2026-04-11*
