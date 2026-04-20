# Roadmap: Gemini CLI SDK

## Overview

This project ships a TypeScript + Python SDK that wraps Google's `gemini-cli` as a subprocess, shaped like the Claude Agent SDK, and proves "done" by merging a thin adapter into `coleam00/Archon` so `DEFAULT_AI_ASSISTANT=gemini` works end-to-end. The journey is strict bottom-up: (1) capture real CLI output into fixtures before writing any parser, (2) get a subprocess spawning safely on all three OSes, (3) parse NDJSON into a normalized `MessageChunk` stream, (4) expose the public `query()` generator that plumbs everything together, (5) classify errors into Archon's 5-bucket retry taxonomy, (6) wire auth, (7) sessions, (8) tools + structured output, (9) MCP passthrough, (10) the Archon adapter (which is simultaneously the integration test for the SDK's shape), and (11) the docs site + release. TypeScript and Python move in lock-step from Phase 2 through Phase 9 — every PR touches both languages, parity is enforced by shared NDJSON fixtures under `spec/fixtures/`, and a CI job diffs test names across the two suites. Phase 10 (Archon adapter) is the only TS-only phase. The Windows-first and parity requirements are cross-cutting — every phase's "done" must honor them.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Feasibility Spike + Fixture Capture** - Empirically validate three load-bearing unknowns against a pinned `gemini-cli`, capture real NDJSON output into `spec/fixtures/`, and freeze the shared event schema before any SDK code is written
- [x] **Phase 2: Process Foundation + Workspace Scaffolding + CI Matrix** - Stand up the polyglot monorepo (TS + Python), bring up `BinaryResolver` + `ProcessManager` (spawn-per-call) + `EnvBuilder` behind a pluggable strategy interface, and turn on the `{ubuntu, macos, windows} × {node, python}` CI matrix with a non-en-US Windows runner (completed 2026-04-13)
- [x] **Phase 3: NDJSON Parser + EventDispatcher + MessageChunk Types** - Build the line-buffered, lenient, CRLF-tolerant NDJSON parser and the `EventDispatcher` that normalizes CLI events into Archon's 8-variant `MessageChunk` union, with both TS and Python test suites running the shared fixture corpus (completed 2026-04-13)
- [x] **Phase 4: Public query() + ArgvBuilder + systemPrompt + Workspace + Model Selection** - Ship the public `query()` async generator, the pure-function `buildArgv`, temp-file `GEMINI_SYSTEM_MD` for system prompts, `cwd` + `--include-directories`, and the typed model enum with downgrade-warning detection (completed 2026-04-13)
- [x] **Phase 5: Error Taxonomy + Archon 5-Bucket Mapping** - Define the typed `GeminiError` hierarchy, generate it from a single YAML source consumed by both languages, and classify `(exit code, stderr tail, last events)` → typed error → one of Archon's 5 retry buckets
 (completed 2026-04-15)
- [x] **Phase 6: Auth Environment** - Wire the canonical `GEMINI_API_KEY` default plus Vertex AI (service account JSON + Google Cloud API key) plus ADC/OAuth fallback, with precedence warnings and typed `AuthError` subtypes (completed 2026-04-19)
- [x] **Phase 7: Session Resume + Multi-Turn** - Ship the `Session` value object, capture session IDs from the `init` event, wire `--resume`, and gate the transcript-prepend fallback on the Phase-1 decision about gemini-cli issue #14180 (completed 2026-04-20)
- [ ] **Phase 8: Tools + Approval Mode + Structured Output (Best-Effort)** - Pass through `--allowed-tools` / Policy Engine + `--approval-mode`, document that caller-defined custom tools are not in v1, and ship best-effort structured output via system-prompt schema injection + runtime validation + single retry
- [ ] **Phase 9: MCP Passthrough + Isolated Config Dir** - Accept `options.mcpServers`, write a temp `settings.json` fragment inside an isolated `GEMINI_CONFIG_DIR` per query, gate via `--allowed-mcp-server-names`, and clean up in `finally` — never mutate the user's real `~/.gemini/settings.json`
- [ ] **Phase 10: Archon Adapter (TS only)** - Implement `GeminiClient implements IAssistantClient` in the `adapter-archon/` subpackage, prove `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in a real Archon checkout, and open the PR against `coleam00/Archon`
- [ ] **Phase 11: Docs Site + Compat Matrix + Release** - Publish the VitePress + mkdocs-material doc site, ship the runtime `gemini --version` compat probe, dual-publish to npm (changesets) + PyPI (`uv publish`), and tag v1.0.0 **only after** the Archon PR merges

## Phase Details

### Phase 1: Feasibility Spike + Fixture Capture
**Goal**: Empirically resolve three load-bearing unknowns about `gemini-cli` (`--resume` + `-p` interop #14180, `GEMINI_CONFIG_DIR` redirect behavior, `stream-json` per-event flushing), capture real NDJSON traces for the parser phase, and freeze the shared event JSON Schema that generates both TS types and Pydantic models. This phase ships **no SDK code** — deliverables are spec documents, fixtures, and a pinned `gemini-cli` version. The output of this phase is what every subsequent phase builds on.
**Depends on**: Nothing (first phase)
**Requirements**: PRS-08, PRS-09
**Success Criteria** (what must be TRUE):
  1. `spec/fixtures/*.ndjson` contains at least 6 captured real-CLI traces (simple text, tool use builtin, resume session, rate-limit error, auth error, unknown event), each with a sibling `.expected.json` listing the SDK event sequence that should emit
  2. `spec/events.schema.json` exists and is pinned — `json-schema-to-typescript` and `datamodel-code-generator` both run against it and produce compilable output in their target languages
  3. A pinned `gemini-cli` version (e.g. `0.X.Y`) is committed to `.gemini-cli-compat` and the three feasibility smoke tests (`--resume`+`-p`, `GEMINI_CONFIG_DIR`, stream-json flushing) have a documented pass/fail verdict per `spec/feasibility.md`
  4. `spec/protocol.md` draft and `spec/errors.md` draft exist and cite fixture filenames as evidence for every normative claim
**Plans**: 10 plans
Plans:
- [x] 01-01-PLAN.md — Wave 0: repo-root manifest + spec/ skeleton (package.json, .gitattributes, fixtures.manifest.json, seeded placeholders)
- [x] 01-02-PLAN.md — Wave 0: validation scripts (validate-fixtures.mjs + validate-schema-ts/py + audit-fixtures)
- [x] 01-03-PLAN.md — Wave 0: capture engine scaffold + redactor module + platform wrappers
- [x] 01-04-PLAN.md — Wave 1: install gemini-cli 0.37.1, pin version, npm install, capture first simple-text fixture
- [x] 01-05-PLAN.md — Wave 2: three feasibility smoke tests → spec/feasibility.md verdicts (resume=pass, config_dir=pass, flush=partial)
- [x] 01-06-PLAN.md — Wave 3: capture tool-use-builtin, error-rate-limit, error-auth, event-unknown
- [x] 01-07-PLAN.md — Wave 3: capture thinking, multimodal-image, multimodal-pdf, large-output, abort-midstream + binary assets
- [x] 01-08-PLAN.md — Wave 3: capture resume-session pair with verdict-aware branching
- [x] 01-09-PLAN.md — Wave 4: derive spec/events.schema.json from fixtures + run both codegen smoke tests
- [x] 01-10-PLAN.md — Wave 5: draft spec/protocol.md + spec/errors.md with fixture citations (depends on 01-09 schema)

### Phase 2: Process Foundation + Workspace Scaffolding + CI Matrix
**Goal**: Stand up the polyglot monorepo layout (`spec/`, `ts/`, `python/`, `adapter-archon/`), bring up `BinaryResolver`, `EnvBuilder`, and `ProcessManager` with a pluggable `ProcessStrategy` interface shipping `SpawnPerCallStrategy`, and turn on the full `{ubuntu, macos, windows} × {node 18/20/22} × {python 3.10–3.13}` CI matrix with a non-en-US Windows runner. This is where every hard Windows/subprocess gotcha gets retired at the source, and where TS ↔ Python lock-step begins. A "hello world" spawn test passes on all three OSes in both languages by the end of this phase.
**Depends on**: Phase 1
**Requirements**: FDN-01, FDN-02, FDN-03, FDN-04, FDN-05, FDN-06, FDN-07, FDN-08, FDN-09, PLT-03, PLT-04, PLT-05, PAR-01, PAR-03, PAR-04
**Success Criteria** (what must be TRUE):
  1. Running `pnpm test` in `ts/` and `uv run pytest` in `python/` both spawn `gemini --version` as a child process on Windows/macOS/Linux, capture stdout, and assert a non-empty version string — confirming binary discovery, env building, UTF-8 forcing, Windows `.cmd` CVE handling, and window-hiding all work
  2. A kill-mid-stream integration test on each OS verifies that sending an abort signal terminates `gemini-cli` plus its MCP grandchildren within the 5-second SIGTERM grace window (no orphans detectable by `psutil` / `ps`)
  3. The GitHub Actions matrix job `{ubuntu, macos, windows} × {node 18/20/22} × {python 3.10–3.13}` is green with Windows as a hard-required job (not `continue-on-error`), and at least one Windows runner uses a non-en-US locale
  4. The parity CI job runs `scripts/diff-test-names.sh` comparing TS `*.spec.ts` test names to Python `test_*.py` test names and fails merge on divergence; the shared-version source is a single file consumed by both `ts/package.json` and `python/pyproject.toml`
**Plans**: 5 plans
Plans:
- [ ] 02-01-PLAN.md — Wave 1: Workspace scaffolding (VERSION, pnpm workspace, ts/package.json, python/pyproject.toml, adapter-archon stub)
- [ ] 02-02-PLAN.md — Wave 2: TS process modules (BinaryResolver, EnvBuilder, ProcessStrategy, SpawnPerCallStrategy, ProcessManager + tests)
- [ ] 02-03-PLAN.md — Wave 3: Python process modules (mechanical port of TS canonical + tests with parity docstrings)
- [ ] 02-04-PLAN.md — Wave 4: CI matrix + parity scripts (sync-version.sh, diff-test-names.sh, GitHub Actions workflow)
- [ ] 02-05-PLAN.md — Gap closure: Python test parity alignment + CI lockfile path fix

### Phase 3: NDJSON Parser + EventDispatcher + MessageChunk Types
**Goal**: Build the line-buffered NDJSON reader with a stateful UTF-8 decoder, 1 MiB line limit, CRLF tolerance, and lenient fallback (unknown types become `{type:'unknown', raw}`, non-JSON lines become `{type:'cli_log'}`), plus the `EventDispatcher` that maps parsed events into the 8-variant `MessageChunk` discriminated union that matches Archon's contract. TS types come from `json-schema-to-typescript` against `spec/events.schema.json`; Pydantic models come from `datamodel-code-generator` against the same file. Both language test suites consume identical `spec/fixtures/*.ndjson` and assert identical `.expected.json` outputs.
**Depends on**: Phase 2
**Requirements**: PRS-01, PRS-02, PRS-03, PRS-04, PRS-05, PRS-06, PRS-07, PAR-02
**Success Criteria** (what must be TRUE):
  1. Both TS and Python parsers consume every fixture in `spec/fixtures/*.ndjson` and produce event sequences byte-identical to the matching `.expected.json` — a single parity CI job runs both suites against the same corpus and fails on any divergence
  2. Fuzz tests feeding the parser random bytes, CRLF line endings, split UTF-8 code points across chunk boundaries, lines over 1 MiB, and unknown event `type` values all complete without throwing — degraded output is yielded as `{type:'unknown'|'cli_log', raw}` events instead
  3. A unit test verifies that every `tool_use` chunk in the fixture corpus is followed by a paired `tool_result` chunk (Archon's `claude.ts` correctness bar), and that the `EventDispatcher` refuses to yield an unpaired tool use
  4. The generated TS `MessageChunk` type and Python `MessageChunk` TypedDict/dataclass both have all 8 variants (`assistant | system | thinking | result | rate_limit | tool | tool_result | workflow_dispatch`) and import cleanly into a small smoke script in each language
**Plans**: 4 plans
Plans:
- [ ] 03-01-PLAN.md — Wave 1: Types generation + expected.json ground truth + synthetic fixtures
- [ ] 03-02-PLAN.md — Wave 2: TS parseNdjson implementation + unit tests (PRS-01/02/03/04)
- [ ] 03-03-PLAN.md — Wave 2: TS dispatch (EventDispatcher) + fixture corpus tests (PRS-05/07)
- [ ] 03-04-PLAN.md — Wave 3: Python mechanical port + parity validation (PAR-02)

### Phase 4: Public query() + ArgvBuilder + systemPrompt + Workspace + Model Selection
**Goal**: Ship the public `query(options): AsyncIterable<MessageChunk>` async generator — the SDK's only public entry point — wired to the pure-function `buildArgv(options): string[]`, cancellation via `abortSignal`/`cancel_scope`, temp-file `GEMINI_SYSTEM_MD` (cleaned up in `finally`), `cwd` + `--include-directories` for workspace context, and the typed model enum with `@deprecated` 2.5-series markings + string escape hatch + silent-downgrade detection via the `init` event. First real `gemini-cli` round-trip happens here. Non-streaming helper is a thin wrapper. Raw-event API is exposed alongside the mapped generator.
**Depends on**: Phase 3
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, SYS-01, SYS-02, CWD-01, CWD-02, MDL-01, MDL-02, MDL-03, MDL-04
**Success Criteria** (what must be TRUE):
  1. A developer can `import { query }` in TS or `from gemini_sdk import query` in Python, call `for await (const chunk of query({prompt: "echo hello"}))` / `async for chunk in query(prompt="echo hello")`, and iterate a real `MessageChunk` stream backed by a live `gemini-cli` subprocess in both languages
  2. `buildArgv(options)` is a pure function with 100% branch coverage under unit tests that never spawn a process, and a fuzz test confirms it produces a non-empty `string[]` argv for every combinatoric option input without throwing
  3. Aborting a query mid-stream (TS `AbortController.abort()` / Python `cancel_scope.cancel()`) kills the subprocess within the SIGTERM grace window, the generator throws `AbortError` at the caller's next `await`, and the temp system-prompt file is deleted (verified by a post-abort `fs.stat` assertion)
  4. Passing `model: "2.5-pro"` when the CLI downgrades to Flash produces a non-fatal `ModelDowngradeWarning` on the terminal `result` chunk (no throw), and the default model is `latest`/`auto` (never a pinned 2.5 string)
**Plans**: 3 plans
Plans:
- [ ] 04-01-PLAN.md — Wave 1: TS types (QueryOptions, Model, AbortError) + pure buildArgv + fuzz tests
- [ ] 04-02-PLAN.md — Wave 2: TS query/queryRaw/queryFull + ResultChunk extension + mock-spawn tests
- [ ] 04-03-PLAN.md — Wave 3: Python mechanical port + parity tests

### Phase 5: Error Taxonomy + Archon 5-Bucket Mapping
**Goal**: Define the typed `GeminiError` hierarchy (base + `RateLimitError`, `AuthError` with subtypes, `ModelAccessError`, `InvalidPromptError`, `ProcessError`, `ProcessCrashError`, `ParseError`, `AbortError`, `UnsupportedFeatureError`, `GeminiNotFoundError`), generate both language implementations from a **single YAML source file** (`spec/errors.yaml`), and build the `ErrorMapper` that pattern-matches `(exit code, stderr tail, last events)` into typed errors. Both the exit-code path and stream-json `error`-event path must produce identical typed errors. Every error carries `.retryable: boolean` and optional `.retryAfterMs?: number`. A CI linter cross-checks the YAML against both language implementations. Error classes map 1:1 to Archon's 5 retry buckets.
**Depends on**: Phase 4
**Requirements**: ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, PAR-05
**Success Criteria** (what must be TRUE):
  1. A contract test runs every stderr fixture captured in Phase 1 through both TS and Python `ErrorMapper` implementations and asserts both produce the same typed `GeminiError` subclass, same `.retryable`, same `.retryAfterMs`, and same Archon retry bucket (`rate_limit | auth | model_access | crash | unknown`)
  2. A stream ending without a terminal `result` event always raises `ProcessError` — even on exit code 0 — verified by a fixture where the subprocess is SIGKILL'd mid-stream
  3. `scripts/lint-errors.sh` runs in CI and fails merge if any class in `spec/errors.yaml` is missing from either `ts/src/errors.ts` or `python/src/gemini_sdk/errors.py`, and vice versa
  4. A stream-json `{"type":"error"}` event and an exit-code+stderr match for the same underlying failure both produce the identical typed error instance (verified by a test that feeds both paths the same rate-limit scenario and `assertEquals` on the resulting error class)
**Plans**: 4 plans
Plans:
- [ ] 05-01-PLAN.md — Wave 1: Re-capture real error-auth + error-rate-limit fixtures against API-key-only host + failing TS/Python test scaffolds (ERR-01..07)
- [ ] 05-02-PLAN.md — Wave 2: Author spec/errors.yaml + codegen scripts + generated class files + reparent GeminiNotFoundError (ERR-01, ERR-02, ERR-03, PAR-05)
- [ ] 05-03-PLAN.md — Wave 3: Hand-written ErrorMapper (TS + Python) + ProcessManager stderr ring buffer + dispatch/query wiring + ERR-06 sawResult + AbortError relocation (ERR-04, ERR-05, ERR-06)
- [ ] 05-04-PLAN.md — Wave 4: scripts/lint-errors.sh CI drift linter + fixture-corpus contract tests + spec/errors.md finalization (ERR-07, PAR-05)

### Phase 6: Auth Environment
**Goal**: Wire all auth modes into `EnvBuilder`: `GEMINI_API_KEY` is the canonical default, Vertex AI via `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON) or `GOOGLE_API_KEY` (alternative Vertex path) is supported when explicitly selected, `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT_ID` / `GOOGLE_CLOUD_LOCATION` pass through for Vertex project+region scoping, and ADC/Sign-in-with-Google is picked up transparently if already configured — but the SDK **never automates interactive OAuth login**. A runtime warning fires if multiple auth modes are configured, and the documented precedence is `GEMINI_API_KEY` > `GOOGLE_APPLICATION_CREDENTIALS` > `GOOGLE_API_KEY` > ADC/OAuth fallback. Documentation captures why API key is the default (discussion #22970, ToS warning) and that no `GOOGLE_AUTH_TOKEN` bearer-token passthrough exists.
**Depends on**: Phase 5
**Requirements**: AUT-01, AUT-02, AUT-03, AUT-04, AUT-05, AUT-06, AUT-07, AUT-08, AUT-09
**Success Criteria** (what must be TRUE):
  1. Four auth fixtures (API key only, Vertex service-account JSON, Vertex Google API key, ADC fallback) each produce the expected env dict passed to the subprocess — verified by unit tests that call `buildEnv(options)` and snapshot-diff the output
  2. Setting two auth modes simultaneously (e.g. `GEMINI_API_KEY` + `GOOGLE_APPLICATION_CREDENTIALS`) emits a runtime warning naming the precedence winner, and a test asserts the warning text matches the documented precedence chain
  3. An auth-failure integration test (invalid API key) surfaces an `AuthError` subclass (`NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation`) distinct from the generic `GeminiError` base, with `.retryable = false` and Archon bucket `auth`
  4. The SDK never calls `gemini auth login` or any interactive OAuth entrypoint — verified by a grep-based CI linter that fails if `auth login` appears anywhere in the source tree
**Plans**: 4 plans
Plans:
- [ ] 06-01-PLAN.md — Wave 1: TS resolveAuth pure function + spec (AUT-01..06 TS side)
- [ ] 06-02-PLAN.md — Wave 1: Python resolve_auth port + pytest parity (AUT-01..06 Python side)
- [ ] 06-03-PLAN.md — Wave 2: query() wiring + error-auth-invalid-key fixture + corpus contract tests (AUT-06, AUT-07)
- [ ] 06-04-PLAN.md — Wave 1: lint-auth-login.sh + CI wiring + docs/auth.md (AUT-05, AUT-08, AUT-09)

### Phase 7: Session Resume + Multi-Turn
**Goal**: Ship the `Session` value object (immutable, identifier-based, NOT process-bound), capture session IDs from the `init` event, wire `--resume <id>` into `ArgvBuilder`, and land the transcript-prepend fallback inside `Session` + `ArgvBuilder` **gated by the Phase-1 verdict on gemini-cli issue #14180**. If `--resume` + `-p` works, `Session` is trivial and the fallback is dark-shipped. If it's broken, the fallback becomes the default path.
**Depends on**: Phase 6
**Requirements**: SES-01, SES-02, SES-03, SES-04
**Success Criteria** (what must be TRUE):
  1. A multi-turn integration test calls `query()` twice — the second call passes `resumeSessionId` captured from the first call's `init` event — and the second turn's response demonstrably references context from the first turn (asserted via a fixture-controlled prompt like "what number did I just say?")
  2. The `Session` value object has no open process handles, no file descriptors, and is trivially serializable (JSON round-trip returns an equivalent `Session`) — verified by a unit test
  3. The transcript-prepend fallback activates when a config flag (set by Phase 1's verdict) is `true`, and a unit test asserts that `buildArgv` with the fallback produces a single `-p` invocation whose prompt contains both the previous turn and the new turn in order
  4. Killing a session mid-stream and resuming it in a new `query()` call works on all three OSes (kill-mid-session integration test per OS)
**Plans**: 3 plans
Plans:
- [ ] 07-01-PLAN.md — Wave 1: Session value object (TS + Python types, frozen dataclass, normaliser, parity tests)
- [ ] 07-02-PLAN.md — Wave 2: TS extension (ResultChunk fields, buildArgv session branch, query guard + mismatch, queryFull Session construction, multi-turn fixture integration test)
- [ ] 07-03-PLAN.md — Wave 3: Python mechanical port + parity + spec/protocol.md §6 session-flow documentation

### Phase 8: Tools + Approval Mode + Structured Output (Best-Effort)
**Goal**: Pass `options.allowedTools` through to `--allowed-tools` / Policy Engine (runtime compat check to handle the migration gracefully), pass `options.approvalMode` through to `--approval-mode` (`default` | `auto_edit` | `yolo` | `plan`), explicitly document that caller-defined custom tool definitions are NOT supported in v1.0, and ship best-effort structured output: `options.outputSchema` injects schema guidance into the system prompt + runtime-validates output with Zod (TS) / Pydantic (Python) + retries ONCE on validation failure with feedback, then raises `SchemaValidationError`. Structured output is marked `@experimental` in types and docs with a clear limitation note linking upstream issue #13388.
**Depends on**: Phase 7
**Requirements**: TOL-01, TOL-02, TOL-03, TOL-04, OUT-01, OUT-02, OUT-03, OUT-04
**Success Criteria** (what must be TRUE):
  1. A test passes `allowedTools: ['read_file']` + a prompt that would otherwise call `write_file`, runs against a live `gemini-cli`, and asserts that the subprocess's tool calls are limited to `read_file` (via the CLI's own enforcement, verified in the streamed event log)
  2. Passing `approvalMode: 'yolo'` successfully executes a file-write tool call end-to-end in a fixture-sandboxed workspace without prompting, and `approvalMode: 'plan'` produces a plan-only event stream with no filesystem mutations (verified via post-run `fs.stat`)
  3. A `outputSchema` test with a prompt that returns non-conformant JSON triggers exactly one retry with validation feedback, and a second failure raises `SchemaValidationError` (extends `GeminiError`, `.retryable = false`, bucket `unknown`)
  4. The TS public API marks `outputSchema` and the `tools.customDefinitions` absence with `@experimental` / `@deprecated`-style JSDoc, and the docs site "Known Limitations" section links gemini-cli #13388
**Plans**: TBD

### Phase 9: MCP Passthrough + Isolated Config Dir
**Goal**: Accept `options.mcpServers` (map of server name → config), write a temp `settings.json` fragment into an isolated `GEMINI_CONFIG_DIR` per query, gate which servers `gemini-cli` can use via `--allowed-mcp-server-names`, and clean up the temp dir in `finally` (even on error or cancel). The SDK **must never mutate the user's real `~/.gemini/settings.json`** — this is a hard invariant verified by a test. The phase starts with a short research spike to pin the smallest reliable MCP configuration window against the known-fragile upstream (#2654, #3406, #20694, #13604).
**Depends on**: Phase 8
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04
**Success Criteria** (what must be TRUE):
  1. A test passing `mcpServers: {myserver: {command: 'node', args: ['stub.js']}}` + `allowedMcpServerNames: ['myserver']` successfully invokes the stub MCP server from within `gemini-cli` and the tool call round-trips back through the event stream
  2. A test that records the `mtime` of `~/.gemini/settings.json` before and after running a full `query()` with `mcpServers` asserts `mtime` is unchanged — the user's real settings file is never touched
  3. After a `query()` call with `mcpServers` completes (or is aborted mid-stream, or raises an error), the temp `GEMINI_CONFIG_DIR` is removed from disk — verified by a `fs.stat` assertion in the test's `finally` block
  4. The CI job runs the MCP passthrough test on all three OSes and it passes on Windows (the highest-risk platform for MCP child-process cleanup per pitfall #4)
**Plans**: TBD

### Phase 10: Archon Adapter (TS only)
**Goal**: Implement `GeminiClient implements IAssistantClient` in the `adapter-archon/` subpackage as a thin shim (~200 LOC target, business logic stays in the SDK), source-published `.ts` to match Archon's Bun-based monorepo convention. The adapter translates Archon's `AssistantRequestOptions` to SDK options (11 fully honored, 4 partially, 4 deferred, 5 silently ignored per Claude/Codex precedent), uses only `GEMINI_*` and `GEMINI_SDK_*` env vars (no collisions with Claude/Codex), and proves `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in a real Archon checkout via contract tests. Then opens a PR against `coleam00/Archon` adding `packages/core/src/clients/gemini.ts` + a 3-line `factory.ts` edit + `.env.example` entries. **This is the only TS-only phase — no Python work.** If the adapter is hard to write, the SDK's shape is wrong and we loop back to an earlier phase.
**Depends on**: Phase 9
**Requirements**: ARC-01, ARC-02, ARC-03, ARC-04, ARC-05, ARC-06, ARC-07, ARC-08, ARC-09
**Success Criteria** (what must be TRUE):
  1. In a real Archon checkout with `DEFAULT_AI_ASSISTANT=gemini` and `GEMINI_API_KEY` set, running Archon's existing end-to-end workflow suite produces the same workflow-dispatch events as the Claude/Codex clients (contract tests pass against Archon's retry classifier)
  2. `adapter-archon/gemini.ts` is ≤ 250 LOC (stretch: ≤ 200), `getType()` returns `'gemini'`, `sendQuery` signature exactly matches Archon's `IAssistantClient.sendQuery`, and the subpackage source-publishes `.ts` (no compiled artifacts in the Archon import path)
  3. `gh pr list --repo coleam00/Archon --head gemini-sdk-integration` shows an open PR adding `packages/core/src/clients/gemini.ts`, the 3-line `factory.ts` edit, and `.env.example` entries for `GEMINI_API_KEY` + `GEMINI_BIN_PATH`
  4. A grep-based CI linter fails merge if any env var outside the `GEMINI_*` / `GEMINI_SDK_*` namespaces appears in the adapter source
**Plans**: TBD

### Phase 11: Docs Site + Compat Matrix + Release
**Goal**: Publish the hosted doc site (VitePress for TS + mkdocs-material for Python, single site with two sections), auto-generate API reference via typedoc (TS) and mkdocstrings (Python), ship the compat matrix page with a runtime `gemini --version` warning probe, write the quickstart + migration + Archon integration guides, add the known-issues appendix with live upstream bug links, declare `gemini-cli` as a runtime prerequisite (not bundled, not auto-installed), dual-publish to npm via changesets and PyPI via `uv publish` with trusted publishing, write MIT `LICENSE`, maintain `CHANGELOG.md` via changesets mirrored into Python release notes, and **tag v1.0.0 only after the Phase-10 Archon PR merges and `DEFAULT_AI_ASSISTANT=gemini` is confirmed working**.
**Depends on**: Phase 10
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06, DOC-07, REL-01, REL-02, REL-03, REL-04, REL-05, REL-06, REL-07, PLT-01, PLT-02
**Success Criteria** (what must be TRUE):
  1. A developer can visit the public doc site, find the quickstart, install `gemini-cli`, obtain an API key, run the first `query()` example, start a multi-turn session, and register an MCP server — end-to-end in under 15 minutes on Windows/macOS/Linux
  2. `npm install @gemini-sdk/gemini` on Windows/macOS/Linux and `uv add gemini-sdk` on Windows/macOS/Linux both succeed from clean machines, the installed packages import and run their smoke tests, and the runtime `gemini --version` probe emits a warning (not an error) when the detected CLI version is outside the tested range
  3. `git tag` shows `v1.0.0` exists, `npm view @gemini-sdk/gemini version` and `pip index versions gemini-sdk` both report `1.0.0`, and the Archon PR from Phase 10 is in `merged` state — the tag was cut **after** the merge
  4. The compat matrix page lists the tested `gemini-cli` version range and links every upstream issue the SDK defends against (#14180, #13388, #3485, #22970, #4945 et al.), and the migration guide covers translating Claude Agent SDK / Codex SDK call sites to `query()`
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Feasibility Spike + Fixture Capture | 9/10 | In Progress|  |
| 2. Process Foundation + Workspace + CI Matrix | 5/5 | Complete   | 2026-04-13 |
| 3. NDJSON Parser + EventDispatcher + MessageChunk Types | 4/4 | Complete   | 2026-04-13 |
| 4. Public query() + ArgvBuilder + systemPrompt + Workspace + Model | 3/3 | Complete   | 2026-04-13 |
| 5. Error Taxonomy + Archon 5-Bucket Mapping | 5/5 | Complete   | 2026-04-15 |
| 6. Auth Environment | 4/4 | Complete   | 2026-04-19 |
| 7. Session Resume + Multi-Turn | 3/3 | Complete   | 2026-04-20 |
| 8. Tools + Approval Mode + Structured Output | 0/TBD | Not started | - |
| 9. MCP Passthrough + Isolated Config Dir | 0/TBD | Not started | - |
| 10. Archon Adapter (TS only) | 0/TBD | Not started | - |
| 11. Docs Site + Compat Matrix + Release | 0/TBD | Not started | - |

---
*Roadmap created: 2026-04-11*
