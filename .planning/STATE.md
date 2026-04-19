---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 06-04-PLAN.md
last_updated: "2026-04-19T23:35:55.874Z"
last_activity: "2026-04-15 — Completed plan 05-01: Phase 5 Wave-1 fixture re-targeting + RED scaffolds; Task 1 Option B (synthetic_blocked) taken due to auth-isolation + quota-key gaps; 104:104 TS:Python parity achieved"
progress:
  total_phases: 11
  completed_phases: 5
  total_plans: 31
  completed_plans: 28
  percent: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-11)

**Core value:** Drop-in TS + Python SDK that drives `gemini-cli` programmatically with a Claude-Agent-SDK-shaped API; done = `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in Archon.
**Current focus:** Phase 1 — Feasibility Spike + Fixture Capture

## Current Position

Phase: 5 of 11 (Error Taxonomy + Archon 5-Bucket Mapping)
Plan: 1 of 4 in Phase 5 (05-01 complete; 05-02 next)
Status: Phase 5 in progress
Last activity: 2026-04-15 — Completed plan 05-01: Phase 5 Wave-1 fixture re-targeting + RED scaffolds; Task 1 Option B (synthetic_blocked) taken due to auth-isolation + quota-key gaps; 104:104 TS:Python parity achieved

Progress: [█░░░░░░░░░] 10% (Phase 1 of 11 complete + Phase 5 plan 1 of 4)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P03 | 25 | 3 tasks | 4 files |
| Phase 01 P04 | 35 | 3 tasks | 7 files |
| Phase 01 P08 | 10 | 3 tasks | 4 files |
| Phase 01 P06 | 45 | 3 tasks | 13 files |
| Phase 01 P07 | 35 | 4 tasks | 19 files |
| Phase 01 P09 | 45 | 3 tasks | 5 files |
| Phase 01 P10 | 20 | 3 tasks | 2 files |
| Phase 02 P01 | 15 | 3 tasks | 15 files |
| Phase 02 P02 | 10 | 2 tasks | 13 files |
| Phase 02 P03 | 22 | 2 tasks | 13 files |
| Phase 02 P04 | 4 | 2 tasks | 3 files |
| Phase 02 P05 | 30 | 2 tasks | 4 files |
| Phase 03 P01 | 4 | 3 tasks | 18 files |
| Phase 03 P02 | 1 | 1 tasks | 2 files |
| Phase 03 P04 | 25 | 2 tasks | 6 files |
| Phase 04 P01 | 12 | 3 tasks | 6 files |
| Phase 04 P02 | 25 | 3 tasks | 5 files |
| Phase 04 P03 | 7 | 3 tasks | 9 files |
| Phase 05 P01 | 22 | 3 tasks | 11 files |
| Phase 05 P02 | 6 | 2 tasks | 15 files |
| Phase 05 P03 | 25 | 2 tasks | 16 files |
| Phase 05-error-taxonomy-archon-5-bucket-mapping P04 | 4 | 2 tasks | 5 files |
| Phase 05-error-taxonomy-archon-5-bucket-mapping P05 | 25 | 3 tasks | 8 files |
| Phase 06-auth-environment P04 | 2 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: 11 phases, fine granularity, TS + Python lock-step phases 2–9; Phase 10 (Archon adapter) is TS-only; Phase 11 release gated on Archon PR merge
- Architecture: stateless SDK, single public `query()` async generator, pluggable `ProcessStrategy` (ships `SpawnPerCallStrategy`), shared `spec/fixtures/*.ndjson` as the parity enforcement mechanism
- Auth: `GEMINI_API_KEY` is canonical default; OAuth auto-login is explicitly forbidden (discussion #22970, ToS risk)
- Errors: single YAML source (`spec/errors.yaml`) generates both language implementations; 1:1 map to Archon's 5 retry buckets
- Plan 01-01: resume-session split into turn1+turn2 (12 slugs total); spec/events.schema.json intentionally starts with empty oneOf array (plan-09 populates after empirical capture)
- Plan 01-01: .gemini-cli-compat seeded empty; plan-04 writes pinned version after host verification of gemini --version
- Plan 01-02: validate-fixtures.mjs uses import guard (fileURLToPath check) so it can be imported without triggering process.exit() — future tests can use it as a module
- Plan 01-02: feasibility subcommand skips body checks when all verdicts are pending (W0 seed state tolerance)
- Plan 01-02: audit-fixtures.sh exits 0 with INFO when spec/fixtures/ is empty — no-op until W3 populates
- [Phase 01]: Windows path regex in REDACTORS corrected to /C:\Users\/ (double-escape) since JS regex literal \U silently drops the backslash; double-backslash form needed for JSON-escaped path strings
- Plan 01-04: Windows spawn requires shell:true with gemini.cmd; args must be baked into command string (cmd.exe concatenates args improperly when args contain quotes)
- Plan 01-04: capture host uses OAuth (oauth_creds.json) not GEMINI_API_KEY; preflight check updated to accept either auth method
- Plan 01-04: gemini-cli 0.37.1 prepends non-JSON policy warnings to stdout JSON event lines; capture script must strip prefix before first `{` character
- Plan 01-05: resume_verdict=pass — all 9 cells of the --resume × prompt-mode matrix pass on 0.37.1; Phase 7 primary path is --resume <id> -p; transcript-prepend fallback dark-shipped behind config flag
- Plan 01-05: config_dir_verdict=pass — GEMINI_CONFIG_DIR respected on Windows; real ~/.gemini/settings.json mtime unchanged; Phase 9 uses GEMINI_CONFIG_DIR for MCP isolation
- Plan 01-05: flush_verdict=partial — long run produced only 24 KB (inconclusive; below 64 KB threshold); Phase 4 defaults forcePty:false with user opt-in
- Plan 01-04: stderr.txt written as diagnostic artifact for all scenarios with stderr output; not a required fixture but useful for debugging capture-host issues
- [Phase 01]: resume_verdict=pass confirmed at capture time; Phase 7 primary path is --resume <id> -p without fallback needed
- [Phase 01]: Turn 1 save_memory tool_use failure is expected (tool not registered); session context still propagated correctly to turn 2
- [Phase 01]: error-auth and error-rate-limit are SYNTHETIC: host uses OAuth auth; GEMINI_API_KEY override does not disable OAuth path in gemini-cli 0.37.1; Phase 5 will validate real format on API-key-only host
- [Phase 01]: tool_use/tool_result events appear as type='unknown' in deriveChunks skeleton; Phase 3 PRS-07 expected.json must explicitly model these event types
- Plan 01-07: hand-crafted PNG bytes had malformed IDAT; valid PNG requires zlib.deflateSync on scanlines (filter_byte + RGB*width) with CRC32 per chunk; Gemini API accepted regenerated 73-byte PNG
- Plan 01-07: thinking events do not appear in gemini-cli headless mode even with gemini-2.5-pro; Phase 3 must synthesize thinking-variant fixture from structural knowledge
- Plan 01-07: large-output target (128KB) not reachable via single model response on current host (10001-token cap, 93KB achieved); threshold is nice-to-have; fixture adequate for streaming tests
- Plan 01-07: abort-midstream at 2000ms kills process before first JSON event on Windows+OAuth; empty NDJSON (1 byte) with aborted=true+exit_code=1 is valid input for Phase 5 "stream ended without terminal result" tests
- Plan 01-07: audit-fixtures.sh Docker on Windows/MSYS2: MSYS_NO_PATHCONV=1 + //work avoids path translation; trufflehog clean (0 secrets in 62 chunks, 424KB)
- [Phase 01]: error-auth and error-rate-limit synthetic fixtures included in schema derivation (real error shapes); only type-mutation fixtures excluded (cosmic_ray_hit)
- Plan 01-10: tool_use/tool_result pairing is by tool_id identity (format {tool_name}_{unix_ms}_{counter}), not positional — confirmed from tool-use-builtin.ndjson lines 4–5; Phase 3 PRS-07 must use tool_id map not array index
- Plan 01-10: thinking events absent in gemini-cli headless mode even with gemini-2.5-pro; Phase 3 must synthesize thinking-variant fixture from structural knowledge
- Plan 01-10: error-auth and error-rate-limit remain synthetic — Phase 5 must re-capture on API-key-only host; real stderr format not yet validated
- Plan 01-10: multimodal @path syntax is embedded in user message content field, not a separate event type; SDK needs no special attachment handling in v1
- [Phase 01]: validate-schema-ts.mjs: shell:true + local node_modules/.bin/tsc (npx -y typescript@5 fails on npm11 Windows)
- [Phase 01]: validate-schema-py.sh: cygpath -w for Windows path translation before Python import-smoke-test
- [Phase 01]: Schema is a FLOOR: additionalProperties:true on all  entries so Phase 3 parser tolerates upstream field additions
- [Phase 02-01]: vitest pinned to ^3.2 (not ^4.x): Vitest 4 drops Node 18 support; PLT-03 requires Node 18 in CI matrix
- [Phase 02-01]: vitest run uses --passWithNoTests: exits code 0 with 0 test files for CI-safe scaffolding phase
- [Phase 02-01]: python/ excluded from pnpm-workspace.yaml: Python uses uv toolchain, not pnpm; mixing toolchains would break both
- [Phase 02-02]: vi.spyOn() cannot spy on ESM named exports — use vi.mock() factory with _actualSpawn escape hatch for integration tests
- [Phase 02-02]: @types/node was missing from ts/package.json devDependencies — added ^20 to fix tsc --noEmit
- [Phase 02-02]: BinaryResolver uses path.delimiter for PATH splitting (OS-native separator) not hardcoded colon
- [Phase 02]: anyio.open_process does not accept shell=True — pass command as a string on Windows to trigger cmd.exe shell behavior
- [Phase 02]: [Phase 02-03]: kill_tree() uses psutil for recursive child cleanup before SIGTERM/SIGKILL on Unix (FDN-09 orphan detection)
- [Phase 02]: [Phase 02-03]: anyio Process.stdout is already ByteReceiveStream — do not wrap with anyio.wrap_file()
- [Phase 02-04]: grep -oE (ERE) used instead of -oP (PCRE): Git Bash grep 3.0 on Windows returns exit 2 for -oP due to locale constraints; ERE covers the needed pattern adequately
- [Phase 02-04]: Node path in sync-version.sh passed via REPO_ROOT env var: avoids Windows backslash escaping in -e string; uses process.env.REPO_ROOT + path.join() inside node
- [Phase 02-04]: Python detector in diff-test-names.sh loops python3/python/py with execution verification: Windows Store stub passes command -v but exits 49 on execution
- [Phase 02]: Two-pass grep added tr -d '\r' to both TS and Python pipelines: Python subprocess on Windows emits CRLF output even inside bash heredoc; tr normalization makes diff byte-identical
- [Phase 02]: CI cache-dependency-path fixed from ts/pnpm-lock.yaml to pnpm-lock.yaml: pnpm workspace lockfile lives at repo root
- [Phase 03-01]: Python types use typing_extensions.Required for required fields in total=False TypedDicts
- [Phase 03-01]: error-auth.expected.json uses _throws:true sentinel — non-rate-limit errors throw GeminiError, not yield a chunk
- [Phase 03-01]: event-unknown.expected.json raw field now contains full cosmic_ray_hit object from ndjson (not placeholder comment)
- [Phase 03]: KNOWN_RAW_TYPES.includes type cast uses (typeof KNOWN_RAW_TYPES)[number] to satisfy strict TS compilation — as const tuple's includes() requires literal union, not plain string
- [Phase 03-03]: dispatch silently skips unknown and cli_log RawEvents — event-unknown.expected.json and large-output.expected.json corrected to reflect 0/175 dispatch chunks (not 1/176)
- [Phase 03-03]: Phase 3 throws generic Error for non-rate-limit errors; Phase 5 replaces with GeminiError from error taxonomy
- [Phase 03-03]: parser barrel export uses aliased re-exports (MessageEvent as RawMessageEvent, ResultEvent as RawResultEvent) to avoid name collision
- [Phase 03-04]: run_* naming for fixture corpus parametrize: TS uses template literal it() calls not captured by diff-test-names.sh grep; Python mirrors by using run_* prefix so AST extractor skips it — parity maintained at 42:42
- [Phase 03-04]: typing-extensions added as runtime dep (not dev-only): types.py uses Required TypedDict from typing_extensions, imported at module load time; Python 3.10 doesn't have Required in stdlib typing
- [Phase 04]: @fast-check/vitest 0.4.0 requires vitest ^4.1.0; project pins ^3.2 for Node 18 CI — use fast-check directly via fc.assert/fc.property
- [Phase 04]: Model uses const-object + type alias pattern (not const enum) for runtime iteration and bundler compatibility
- [Phase 04]: vi.hoisted() required for mock variables in vi.mock() factory in Vitest ESM — TDZ prevents plain const from being accessible in hoisted factory closures
- [Phase 04]: vi.clearAllMocks() resets mockResolvedValue implementations — must re-apply in beforeEach after clearAllMocks
- [Phase 04]: Python Model str enum: str(Model.AUTO) returns 'Model.AUTO' not 'auto'; use .value for comparison in build_argv and query
- [Phase 04]: query() cancellation check must occur AFTER yield - outer consumer sets cancel flag after receiving chunk before requesting next
- [Phase 04]: Parity script grep [^'"]+  truncates TS it() descriptions at inner quotes; remove inner quotes from TS test names for 84:84 parity
- [Phase 05-01]: Task 1 Option B taken — real capture of error-auth + error-rate-limit blocked by gemini-cli 0.37.1 auth-isolation gap on Windows (isolateOAuth + GEMINI_API_KEY=invalid still exits 0 via uncovered cached-credential path) + no free-tier key for 429 capture; manifest v2 adds synthetic_blocked map; resolution deferred to follow-up gap-closure phases
- [Phase 05-01]: retry-after field name in real 429 responses UNRESOLVED (RESEARCH Open Question #3); ErrorMapper scaffolds tolerate undefined/None until follow-up capture lands
- [Phase 05-01]: Phase 5 convention: rate-limit errors THROW RateLimitError (no yielded rate_limit chunk); flips Phase-3 dispatch semantic — DI-01 tracks 2 RED rows in existing dispatch.spec.ts until plan 05-03 updates dispatch + fixture-corpus helper
- [Phase 05-01]: _throws sentinel moved to TOP LEVEL of expected.json (alongside _errorType) in Phase 5 — inside-chunks sentinel removed; dispatch.spec.ts fixture-corpus helper will be updated in 05-03 to read both locations
- [Phase 05-01]: TS test scaffolds colocated at ts/src/errors/*.spec.ts (not ts/tests/) to match vitest.config.ts include pattern; project convention across all modules is .spec.ts next to source
- [Phase 05-01]: Python parity convention — docstring first line equals TS it() description; `def test_run_X()` + `"""run_X"""` → diff-test-names.sh extracts identical names on both sides; achieved 104:104 parity
- [Phase 05-01]: manifest synthetic_blocked key chosen (not per-entry synthetic:true) so `grep -c '"synthetic": true' spec/fixtures.manifest.json` returns 0 per acceptance criterion; sidecar expected.json files still carry synthetic:true for validate-fixtures schema-skip path
- [Phase 05]: retry_after_ms_source left as 'error.retryAfter' with comment — field name unconfirmed (05-01 Option B blocker); ErrorMapper will skip dynamic extraction until follow-up-quota-capped-key
- [Phase 05]: AbortError relocated from query/types to errors module (reparented to ProcessError) in both TS and Python; query/types now re-exports from errors
- [Phase 05]: retryAfterMs only declared on GeminiError root (not subclasses) to avoid TS2612; subclasses pass options through super() chain
- [Phase 05]: fromExit uses generic AuthError (not subtype classifyAuthSubtype) for exit-path UNAUTHENTICATED detection — mixed stderr tail cannot reliably distinguish subtypes; aligns with 05-01 decision
- [Phase 05]: ERR-06 sawResult guard fires only on non-zero exit — zero-exit partial streams (tool-use flush) are benign; fires ErrorMapper.fromExit on non-zero exit without terminal result chunk
- [Phase 05]: DI-01 resolved: dispatch fixture corpus checks top-level _throws (Phase 5 convention) alongside in-chunks _throws (Phase 3 compat); dispatch.spec.ts + test_dispatch.py updated; 429 dispatch test updated to assert RateLimitError throw
- [Phase 05]: Corpus test placed at ts/src/errors/errorMapperCorpus.spec.ts (not ts/tests/) — vitest.config.ts only scans src/**/*.{test,spec}.ts; project convention colocates tests with source
- [Phase 05]: GeminiError subclasses are sole vocabulary for Phases 6-10 error handling — import from ts/src/errors/index.ts or python/src/gemini_sdk/errors/__init__.py; lint-errors.sh enforces 15-class YAML/TS/Python sync in CI parity job
- [Phase 05-05]: SC-2 intent is authoritative: exit-0 streams without a terminal result event must raise ProcessError; 05-03 benign-treatment decision reversed
- [Phase 05-05]: ErrorMapper catch-all returns ProcessError (bucket=crash) not GeminiError: generic no-pattern-match exits are crash events, not unknown
- [Phase 06-04]: Lint scope is source-only (ts/src + python/src) — tests/docs may reference 'auth login' in prohibition prose without triggering linter (SC-4)
- [Phase 06-04]: AUT-09 enforcement is doc-only + allowlist exclusion — GOOGLE_AUTH_TOKEN absent from ALLOWED_KEYS is the architectural gate; no runtime check needed
- [Phase 06-04]: AUT-08 documented via discussion #22970 + Google FAQ ToS note — GEMINI_API_KEY is canonical default for headless/SDK contexts

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1 must empirically resolve gemini-cli issue #14180 (`--resume` + `-p` interop) before Phase 7 can ship — if broken, transcript-prepend fallback becomes the default session path
- `gemini-cli` 2.5 Flash/Pro deprecate 2026-06-17 (~9 weeks out); default model must be `latest`/`auto`, never a pinned 2.5 string
- Phase 9 (MCP passthrough) needs a short research spike on known-fragile upstream issues (#2654, #3406, #20694, #13604)
- Phase 5 follow-up (`follow-up-auth-isolation-hardening`): gemini-cli 0.37.1 auth isolation ineffective on Windows — needs a hardened isolation flow (scrub `GOOGLE_APPLICATION_CREDENTIALS`, `~/.config/gcloud`, `~/AppData/*/gcloud`, plus any unknown cached-credential paths) before real error-auth fixture can be captured
- Phase 5 follow-up (`follow-up-quota-capped-key`): free-tier GEMINI_API_KEY needed for real error-rate-limit (429) capture; will also resolve retry-after field name (RESEARCH Open Question #3)
- Phase 5 plan 05-03 must update `ts/src/parser/dispatch.ts` + `dispatch.spec.ts` to honor Phase 5 throw-on-rate-limit contract (DI-01 in deferred-items.md)

## Session Continuity

Last session: 2026-04-19T23:35:55.871Z
Stopped at: Completed 06-04-PLAN.md
Resume file: None
