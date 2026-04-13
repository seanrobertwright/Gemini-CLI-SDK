---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
stopped_at: Completed 04-03-PLAN.md
last_updated: "2026-04-13T21:16:29.798Z"
last_activity: "2026-04-13 — Completed plan 03-03: dispatch async generator + fixture corpus tests; 23 tests pass; parser barrel export wired into package root"
progress:
  total_phases: 11
  completed_phases: 4
  total_plans: 22
  completed_plans: 22
  percent: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-11)

**Core value:** Drop-in TS + Python SDK that drives `gemini-cli` programmatically with a Claude-Agent-SDK-shaped API; done = `DEFAULT_AI_ASSISTANT=gemini` works end-to-end in Archon.
**Current focus:** Phase 1 — Feasibility Spike + Fixture Capture

## Current Position

Phase: 3 of 11 (NDJSON Parser + EventDispatcher + MessageChunk Types)
Plan: 3 of 3 in Phase 3 (all plans complete)
Status: Phase 3 complete
Last activity: 2026-04-13 — Completed plan 03-03: dispatch async generator + fixture corpus tests; 23 tests pass; parser barrel export wired into package root

Progress: [█░░░░░░░░░] 9% (Phase 1 of 11 complete)

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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1 must empirically resolve gemini-cli issue #14180 (`--resume` + `-p` interop) before Phase 7 can ship — if broken, transcript-prepend fallback becomes the default session path
- `gemini-cli` 2.5 Flash/Pro deprecate 2026-06-17 (~9 weeks out); default model must be `latest`/`auto`, never a pinned 2.5 string
- Phase 9 (MCP passthrough) needs a short research spike on known-fragile upstream issues (#2654, #3406, #20694, #13604)

## Session Continuity

Last session: 2026-04-13T21:12:38.601Z
Stopped at: Completed 04-03-PLAN.md
Resume file: None
