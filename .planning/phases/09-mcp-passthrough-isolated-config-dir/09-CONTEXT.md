# Phase 9: MCP Passthrough + Isolated Config Dir - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Accept `options.mcpServers` (map of server name → server config) and `options.allowedMcpServerNames` (string[]), write a temp `settings.json` plus any supporting scaffolding into a per-query isolated `GEMINI_CONFIG_DIR`, gate which MCP servers gemini-cli can use via `--allowed-mcp-server-names`, and clean up the temp dir in `finally` — even on abort, error, or Windows MCP grandchild holding a file handle (#13604). The SDK **MUST NEVER mutate the user's real `~/.gemini/settings.json`** (MCP-02, verified by mtime-invariant test). The phase starts with a short research spike that pins a golden working `settings.json`, a known-fragile map against upstream bugs, and the minimum config-dir scaffolding that reliably avoids "server not detected" failures (#3406).

Requirements: MCP-01, MCP-02, MCP-03, MCP-04.

**Out of scope:**
- Caller-defined custom tools via stub MCP sidecar (CTL-01..03 — v2).
- HTTP MCP OAuth token refresh beyond pass-through documentation (#23296 / #23776 are upstream bugs; SDK won't paper over them).
- Archon-adapter wiring of `mcpServers` (Phase 10).
- `docs/mcp.md` hosting / typedoc / mkdocs publication (Phase 11 — the file is authored in Phase 9 but shipped in Phase 11).
- Hooks into MCP lifecycle events (HOK-01..04 — v2).
- Runtime `gemini --version` probe for Policy-Engine-style MCP flag renames (Phase 8 TOL-03 decision applies — rely on `.gemini-cli-compat` + Phase 11 REL-06 probe).

</domain>

<decisions>
## Implementation Decisions

### `mcpServers` API shape (MCP-01)

- **`options.mcpServers?: Record<string, Record<string, unknown>>`** — raw pass-through map, matching MDL-02 / TOL-01 transparent-wrapper ethos. SDK JSON-stringifies the value verbatim into `settings.json`. No compile-time discriminated union over stdio/http/sse — forward-compatible with any new upstream transport without a SDK release.
- **Python mirror: `dict[str, dict[str, Any]]`**. Identical wire format.
- **No SDK-side shape validation in v1.** Unknown / malformed server configs pass through unchallenged; gemini-cli is the source of truth. Mirrors Phase 8's `allowedTools` "unknown names pass through" decision and `Model` raw-string escape hatch.
- **Empty map (`mcpServers: {}`) behaves identically to `undefined`** — no `GEMINI_CONFIG_DIR` temp dir created, no `--allowed-mcp-server-names` flag emitted. Avoids the footgun where a caller's `.filter()` collapses the map to empty and accidentally turns isolation off by accident (symmetric with Phase 8's `allowedTools: []` decision).

### `allowedMcpServerNames` API shape (MCP-03)

- **`options.allowedMcpServerNames?: string[]`** — separate field from `mcpServers`; no auto-derivation. Mirrors Phase 8 `allowedTools` shape exactly. `undefined` or empty array → flag omitted at the argv boundary.
- **Argv emission: CSV-joined, matching `allowedTools` exactly.**
  ```
  buildArgv emits ['--allowed-mcp-server-names', names.join(',')]
  ```
  Skip flag when `undefined` or empty. No per-name quoting — MCP server names are conventionally simple identifiers.
- **When `mcpServers` is set but `allowedMcpServerNames` is empty/undefined: pre-spawn throw `InvalidPromptError`** with a message pointing the caller at `allowedMcpServerNames`. Configuring MCP servers without allowing any is almost certainly a bug — gemini-cli's default behavior here is underdocumented and likely to silently ignore the servers (#3406-shape failures). Matches Phase 7 (empty-session-id) and Phase 8 (`outputSchema` + `query()`) pre-spawn guard precedent.

### Isolated `GEMINI_CONFIG_DIR` strategy (MCP-01, MCP-02)

- **Per-query ephemeral temp dir.** Every `query()` / `queryRaw()` / `queryFull()` invocation that sets `mcpServers` gets a fresh `mktemp` dir populated once, passed as `GEMINI_CONFIG_DIR`, and removed in `finally`. Matches Phase 2 `SpawnPerCallStrategy` + Phase 4 `writeTempSystemPrompt` lifecycle exactly.
- **Temp-dir content: `settings.json` at the dir root PLUS a `.gemini/` subdirectory scaffolding.** User chose "settings.json + .gemini/ subdir scaffolding" over the minimum `{mcpServers}`-only fragment. The extra scaffolding is insurance against upstream "server not detected despite valid config" bugs like #3406. **The exact file list inside the scaffolding (whether `.gemini/GEMINI.md` is empty, which other placeholder files are needed) is DEFERRED to the Phase 9 research spike** — that spike must study a real working gemini-cli config dir plus the known-fragile map before planning nails the shape.
- **`settings.json` fragment structure: only `{ "mcpServers": <verbatim input> }`.** All other gemini-cli settings (auth, memory, model, directories) flow through env vars and argv per Phases 4–8. Do NOT populate `selectedAuthType`, `memoryImportFormat`, or any other key inside the temp `settings.json` — those would fight Phase 6 auth resolution and the existing argv-driven config channels.
- **`GEMINI_CONFIG_DIR` is already in the `buildEnv` allowlist** (Phase 6, verified at `ts/src/process/EnvBuilder.ts:16`). Phase 9 only needs to SET it via the `overrides` parameter when spawning; no changes to `EnvBuilder` itself.

### Temp-dir cleanup semantics (MCP-04, SC-3, SC-4)

- **Success-path cleanup: blocking `await fs.rm(tempDir, { recursive: true, force: true })` inside the same `finally` block as `unlink`-ing the systemPrompt temp file.** The caller's `await` does not resolve until disk is clean. Deterministic SC-3 assertion.
- **Abort / error cleanup path on Windows (hardening against #13604 grandchild file-handle retention):**
  1. `killTree` on the subprocess (Phase 2 FDN-09 — existing helper).
  2. `await proc.wait()` with the Phase-2 5-second SIGTERM grace window.
  3. `await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })` — Node.js `fs.rm` retry options natively handle Windows `EBUSY` when an MCP grandchild is still holding a file handle. Python mirror uses `shutil.rmtree` with a custom retry loop (3 attempts × 200ms).
- **If cleanup still fails after retries** — emit a single `console.warn`/`warnings.warn` with the stranded path and move on. Do NOT re-throw; an MCP-related cleanup glitch must not shadow the original error the caller is already handling. A leaked temp dir is recoverable; masking a real exception is not. This warning path is exercised by a Windows-specific test that injects a file-handle-holding stub.
- **Cleanup uses the same `finally` block as the existing `systemPrompt` temp-file `unlink`** — single source of truth for "resources this call owned." Do NOT introduce a separate finalizer, exit hook, or per-process cleanup registry.

### Env safety + interaction with `options.env` (MCP-02 safety)

- **Pre-spawn guard: if caller passes `env: { GEMINI_CONFIG_DIR: <anything> }` alongside `mcpServers`, throw `InvalidPromptError` before spawn** with message: "Cannot set env.GEMINI_CONFIG_DIR when mcpServers is provided; SDK manages this variable for isolation (MCP-02)." No silent override, no caller-wins-losing-isolation.
- **If `mcpServers` is NOT set but caller passes `env.GEMINI_CONFIG_DIR`** — pass-through as normal; no guard. Caller is opting into gemini-cli's real config resolution and the SDK stays out of the way.
- **The guard lives alongside Phase 7's session-id guard and Phase 8's `outputSchema + query()` guard** in the pre-spawn validation block of `query()`.

### Error taxonomy (consumed from Phase 5)

- **No new error classes in Phase 9.** The guards above raise existing `InvalidPromptError` (bucket: `user`, `retryable: false`). If the research spike surfaces a distinct MCP-specific failure mode that doesn't map cleanly, a new class can be added following the Phase 5 `spec/errors.yaml` + codegen pipeline, but the default posture is "reuse existing taxonomy."
- **No `source: 'sdk'` entries needed** (unlike Phase 8's `SchemaValidationError`) — Phase 9's SDK-side failures (bad env combo, empty `allowedMcpServerNames`) are all `InvalidPromptError` shape.
- **Subprocess-level MCP failures** (server spawn failed, tool call timed out upstream, #2654 crash) are already covered by Phase 5's stderr-regex-based `ErrorMapper` and the Phase 3 dispatcher — gemini-cli will emit `error` events or non-zero exit codes that the existing pipeline classifies. Phase 9 adds no new regex, no new mapper branch.

### `@experimental` / stability posture (MCP-01..04 docs posture)

- **JSDoc `@experimental` tag on `options.mcpServers` AND `options.allowedMcpServerNames` in `QueryOptions`.** Python mirrors with `**Experimental:**` docstring prefix. Matches Phase 8 `outputSchema` / `SchemaValidationError` precedent.
- **No runtime warning on first use.** No `console.warn('mcpServers is experimental')`. Phase 8 explicitly rejected runtime nag for `@experimental`; Phase 9 holds the line.
- **No env-var gating** (no `GEMINI_SDK_ENABLE_MCP`). Contradicts the roadmap: Phase 10 Archon adapter depends on MCP passthrough being callable without a special opt-in, and Phase 8 explicitly rejected env-var gating for experimental features.
- **Prominence of fragility callout: dedicated `docs/mcp.md`** with a top-of-page "Known Limitations" section linking #2654, #3406, #20694, #13604, #17787, #23296, #23776 verbatim (mirrors OUT-04's #13388 treatment in `docs/structured-output.md`). The known-fragile map produced by the research spike feeds directly into this section.
- **`docs/mcp.md` is authored in Phase 9, published in Phase 11.** Same split as Phase 8's `docs/tools.md` / `docs/structured-output.md`.

### Research spike deliverables (pre-planning, phase 9)

The roadmap mandates a short research spike before planning. That spike MUST produce, inside `09-RESEARCH.md`:
1. **A captured golden working `settings.json` fragment** from a manual `gemini-cli` run with an MCP server (stdio, minimum viable). Full verbatim file contents, not a summary.
2. **A known-fragile map** summarizing each of #2654, #3406, #20694, #13604, #17787, #23296/#23776: current upstream status, concrete workaround the SDK will apply (or "document; do not work around"), and the specific test-level evidence that the workaround landed.
3. **The minimum config-dir scaffolding shape** that reliably avoids #3406-style "server not detected" — the exact file/directory list beyond just `settings.json`. If the research concludes "minimum fragment is enough," that overturns the tentative scaffolding decision and CONTEXT.md must be updated during plan revision.
4. **Pinned `gemini-cli` version known to work end-to-end for stdio MCP** — feeds into `.gemini-cli-compat` (Phase 2 output). If current pin is already sufficient, spike confirms that explicitly.

Spike output gates planning: planner reads `09-RESEARCH.md` and lays out plans around the pinned shape. If the spike surfaces a blocker (e.g., #13604 still reproduces on Windows 0.37.1 with no workaround), that becomes a `CHECKPOINT REACHED` escalation in the research agent's output.

### SC-1 integration test scaffold: stub MCP server

- **Use the official MCP SDK to scaffold the stub server.** TS: `@modelcontextprotocol/sdk`. Python: `mcp` package (PyPI). Guarantees protocol compliance — if gemini-cli rejects the stub, the bug is in gemini-cli, not our test harness. Both are small, MIT-licensed, official reference implementations.
- **One stub per language, shared canned response shape** — TS test spawns a Node stub; Python test spawns a Python stub. Both stubs expose a single tool (e.g., `echo`) that returns the same canned result so the Phase 3/5/7 NDJSON-fixture-parity infrastructure can compare event streams byte-for-byte. Matches PAR-01 lock-step convention.
- **Stub content: transport = stdio, one tool, canned deterministic output.** No state, no random behavior. The tool call round-trip is what SC-1 verifies; the stub's business logic is intentionally trivial.
- **Test code location: per-language test files under existing conventions** — `ts/test/mcp-passthrough.test.ts` and `python/tests/test_mcp_passthrough.py`. These files import / path-reference the stubs from `spec/fixtures/mcp/`.

### Stub MCP server + test helpers: repo layout

- **`spec/fixtures/mcp/`** holds the stubs and any shared canned-response fixtures:
  - `spec/fixtures/mcp/stub.mjs` — Node stub using `@modelcontextprotocol/sdk`
  - `spec/fixtures/mcp/stub.py` — Python stub using `mcp`
  - `spec/fixtures/mcp/echo-tool.{ndjson,expected.json}` (naming tentative) — golden canned round-trip events, optional (research spike decides whether fixtures need to be captured or whether live invocation + shape assertion is enough)
- **No top-level `test-helpers/` directory** — reuses the existing Phase 3/5/7 `spec/fixtures/` convention and the new-module-new-directory rule (`ts/src/mcp/`, `python/src/gemini_sdk/mcp/`) for SDK code.
- **CI runs the MCP passthrough test on all three OSes** (SC-4). The runners already install Node + Python for parity tests; adding `@modelcontextprotocol/sdk` + `mcp` as test-only deps is the only new infrastructure.

### `QueryOptions` extensions (additive, zero breaking changes)

```ts
interface QueryOptions {
  // ... existing fields ...

  /**
   * @experimental MCP server map (MCP-01). Written verbatim into a temp
   * settings.json inside an isolated GEMINI_CONFIG_DIR per query.
   * Empty/undefined → no temp dir created.
   * See docs/mcp.md Known Limitations (#2654, #3406, #20694, #13604, #17787).
   */
  mcpServers?: Record<string, Record<string, unknown>>;

  /**
   * @experimental Whitelist of MCP server names passed via
   * --allowed-mcp-server-names (MCP-03). CSV-joined at argv boundary.
   * Empty/undefined → flag omitted. REQUIRED when mcpServers is set
   * (else pre-spawn InvalidPromptError).
   */
  allowedMcpServerNames?: string[];
}
```

Python mirror with identical field names in `QueryOptions` TypedDict / dataclass.

### Claude's Discretion

- Exact module layout under `ts/src/mcp/` and `python/src/gemini_sdk/mcp/` — likely split into `writeConfigDir.ts` (create temp dir + write settings.json + scaffolding), `cleanupConfigDir.ts` (rm-rf with retry), and a small `index.ts` barrel. Planner decides final granularity; the new-module-new-directory rule is the only hard constraint.
- Exact tempdir naming prefix (`gemini-sdk-mcp-` seems consistent with the existing `gemini-sdk-system-` prefix at `ts/src/query/query.ts:60`, but any unique-collision-safe prefix is acceptable).
- Whether the TS `fs.rm` retry and Python `shutil.rmtree` retry wrapper are inlined into `cleanupConfigDir` or extracted into a `ts/src/mcp/retryingRm.ts` helper — small enough either way; planner's call.
- Whether to golden-file the stub MCP server's tool-call round-trip events into `spec/fixtures/mcp/` or simply assert shape in the integration test at runtime — the research spike informs this by showing how stable gemini-cli's event ordering is.
- Whether `docs/mcp.md` includes a "porting from gemini-cli CLI MCP config" section (nice-to-have; not a v1 requirement).
- Exact prose of the `InvalidPromptError` messages for the two new pre-spawn guards — should name the offending field and link `docs/mcp.md` when published.
- Whether Phase 9 adds a `--scenario mcp-stdio` branch to `scripts/capture-fixtures.*` (if the research spike decides NDJSON fixtures are needed).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 9 requirements & roadmap
- `.planning/REQUIREMENTS.md` §"MCP Passthrough" — MCP-01 through MCP-04 (full requirement text, lines 74-79)
- `.planning/ROADMAP.md` §"Phase 9: MCP Passthrough + Isolated Config Dir" (lines 166-175) — Goal, dependency (Phase 8), 4 success criteria
- `.planning/PROJECT.md` §"Requirements → Active" — "MCP server passthrough" line 31; §"Context" — `gemini-cli` surface (line 66) on MCP extensibility
- `.planning/research/PITFALLS.md` §"Pitfall 2: MCP stdio transport hang and orphan subprocesses" — #13604 grandchild-cleanup guidance; §"Pitfall 12: Tool-calling via MCP fragility" — #2654, #3406, #20694, #17787, #23296, #13604 catalog; §"Integration Gotchas" table MCP row

### Query composer + argv builder (Phase 4/7/8 outputs extended here)
- `ts/src/query/types.ts` — `QueryOptions` gains `mcpServers?` + `allowedMcpServerNames?` with `@experimental` JSDoc tags mirroring Phase 8 `outputSchema`
- `ts/src/query/buildArgv.ts` — pure-function argv builder; Phase 9 adds `--allowed-mcp-server-names` CSV branch mirroring Phase 8's `--allowed-tools` branch at `buildArgv.ts:74-76`
- `ts/src/query/query.ts` — composer; Phase 9 adds two pre-spawn guards (empty `allowedMcpServerNames` when `mcpServers` set; conflicting `env.GEMINI_CONFIG_DIR`), writes temp config dir before spawn, sets `GEMINI_CONFIG_DIR` in env overrides, reuses existing `finally` block for cleanup
- `python/src/gemini_sdk/query/` — Python mirrors (PAR-01)

### Process + env infrastructure (Phase 2 / Phase 6 outputs consumed here)
- `ts/src/process/EnvBuilder.ts:16` — `GEMINI_CONFIG_DIR` already in the allowlist; Phase 9 uses the existing `overrides` parameter of `buildEnv` to set it per-query
- `ts/src/process/ProcessManager.ts` — `spawn()` already accepts `options.env` and calls `buildEnv(options.env)` (line 42); no changes
- `ts/src/process/killTree.ts` (Phase 2 FDN-09) — used unchanged in the abort/crash cleanup path
- `python/src/gemini_sdk/process/` — Python mirrors

### Error taxonomy (Phase 5 outputs consumed here; NOT modified)
- `spec/errors.yaml` — existing `InvalidPromptError` entry is reused; Phase 9 adds NO new error classes
- `ts/src/errors/index.ts` + `python/src/gemini_sdk/errors/__init__.py` — barrel exports unchanged
- `ts/src/errors/ErrorMapper.ts` — unchanged; subprocess-level MCP errors flow through the existing stderr-regex + exit-code pipeline

### Prior phase context
- `.planning/phases/04-public-query-argvbuilder-systemprompt-workspace-model-selection/04-CONTEXT.md` — `writeTempSystemPrompt` lifecycle + temp-file finally-block pattern (template for the config-dir cleanup), `QueryOptions` additive-extension philosophy, `buildArgv` purity contract
- `.planning/phases/06-auth-environment/06-CONTEXT.md` — `EnvBuilder` allowlist pattern, env-var-as-escape-hatch precedent, new-module-new-directory convention
- `.planning/phases/07-session-resume-multi-turn/07-CONTEXT.md` — pre-spawn guard template (empty-session-id `InvalidPromptError`), mirrored for Phase 9's two new guards
- `.planning/phases/08-tools-approval-mode-structured-output-best-effort/08-CONTEXT.md` — `@experimental` tag convention, `allowedTools` CSV-join argv branch (template for `allowedMcpServerNames`), Policy-Engine compat-matrix stance (applied unchanged to MCP flag renames), docs-file split between authoring-phase + Phase 11 publication

### Gemini CLI upstream references
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md` — `settings.json` schema, `mcpServers` shape, `GEMINI_CONFIG_DIR` env var semantics
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md` — `--allowed-mcp-server-names` flag
- `https://github.com/google-gemini/gemini-cli/issues/2654` — `toUpperCase()` crash on multi-type JSON schema; SDK avoids by passing schemas through verbatim and documenting the trap
- `https://github.com/google-gemini/gemini-cli/issues/3406` — "MCP servers not detected despite valid config on macOS"; drives the scaffolding decision
- `https://github.com/google-gemini/gemini-cli/issues/20694` — `gemini mcp enable` "Server not found" config-parsing bug
- `https://github.com/google-gemini/gemini-cli/issues/13604` — "CLI hangs spawning npx subprocess for MCP stdio transport"; drives Windows cleanup + retry-on-EBUSY decision
- `https://github.com/google-gemini/gemini-cli/issues/17787` — "Gemini CLI ignores MCP timeout configuration"; documented; SDK does not work around
- `https://github.com/google-gemini/gemini-cli/issues/23296` / `https://github.com/google-gemini/gemini-cli/issues/23776` — MCP HTTP OAuth token refresh fails during tool calls; documented; SDK does not work around

### Reference SDK + MCP protocol
- `https://modelcontextprotocol.io/specification` — MCP protocol spec (stdio / http / sse transports)
- `https://github.com/modelcontextprotocol/typescript-sdk` — `@modelcontextprotocol/sdk` used in the TS stub server
- `https://github.com/modelcontextprotocol/python-sdk` — `mcp` PyPI package used in the Python stub server

### Fixture + test infrastructure
- `spec/fixtures.manifest.json` — manifest; Phase 9 research spike decides whether to add `mcp-stdio` captured fixture entries
- `scripts/capture-fixtures.*` — reproducible capture script (Phase 1); may gain `--scenario mcp-stdio` branch if research spike requires
- `spec/fixtures/tool-use-builtin.{ndjson,expected.json}` — existing pattern for tool-round-trip fixtures; template for any MCP fixtures Phase 9 adds

### Compat + platform
- `.gemini-cli-compat` (Phase 2 output) — pinned gemini-cli version range; research spike confirms or bumps for MCP stdio reliability
- CI matrix — already runs on Windows / macOS / Linux per FDN-06; Phase 9 test adds to the existing suite, no CI config changes beyond installing the MCP SDK packages as test deps

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`QueryOptions` + `QueryResult`** (`ts/src/query/types.ts`) — additive extension only. Gains `mcpServers?` + `allowedMcpServerNames?` on options; `QueryResult` unchanged. Zero breaking changes.
- **`buildArgv`** (`ts/src/query/buildArgv.ts`) — pure function; Phase 9 adds one branch for `--allowed-mcp-server-names` mirroring Phase 8's `--allowed-tools` branch exactly (CSV join, skip when undefined or empty).
- **`writeTempSystemPrompt` helper in `query.ts`** (`ts/src/query/query.ts:48-63`) — canonical template for per-query temp-file lifecycle. Phase 9 adds a parallel `writeTempConfigDir` helper with the same `finally`-block cleanup shape, substituting `mkdtemp` + `fs.rm(..., recursive:true, maxRetries:3, retryDelay:200)` for `writeFile` + `unlink`.
- **`EnvBuilder`** (`ts/src/process/EnvBuilder.ts`) — `GEMINI_CONFIG_DIR` already in the allowlist (line 16); Phase 9 uses the existing `overrides` parameter on `buildEnv(overrides)` to inject the temp-dir path. Zero changes to `EnvBuilder.ts`.
- **`ProcessManager`** (`ts/src/process/ProcessManager.ts:42`) — already passes `options.env` through `buildEnv`; no changes.
- **`killTree`** (Phase 2 FDN-09, `ts/src/process/`) — used unchanged in the abort/crash cleanup path to terminate MCP grandchildren before `fs.rm` on Windows.
- **Pre-spawn guard pattern** — Phase 7 empty-session-id + Phase 8 `outputSchema + query()` guards establish the template. Phase 9 adds two more guards adjacent to them in `query.ts`.
- **`@experimental` JSDoc / `**Experimental:**` docstring convention** — Phase 8 precedent on `outputSchema` + `SchemaValidationError`. Phase 9 applies identically to `mcpServers` + `allowedMcpServerNames`.
- **`spec/fixtures/` convention** (Phases 1/3/5/7) — Phase 9 stub servers live under `spec/fixtures/mcp/`.
- **`InvalidPromptError`** (`spec/errors.yaml`) — existing class reused for both new pre-spawn guards. No new error classes or taxonomy changes.
- **Windows-first CI matrix** (FDN-06) — already tests every phase on all 3 OSes; Phase 9 test slots in with no CI config changes.

### Established Patterns
- **New module = new directory.** Phase 5 → `errors/`, 6 → `auth/`, 7 → `session/`, 8 → `output/` (+ tools logic co-located in `query/buildArgv.ts`). Phase 9 → `ts/src/mcp/` + `python/src/gemini_sdk/mcp/` for the temp-dir write/cleanup helpers. Barrel exports updated.
- **Additive `QueryOptions` extension.** Phases 4, 6, 7, 8 all extend without breaking; Phase 9 adds two `@experimental` fields.
- **Pure-function compose chain.** `buildArgv` → pre-spawn guards → `writeTempSystemPrompt` / `writeTempConfigDir` → `resolveAuth` → `buildEnv` → `ProcessManager.spawn`. Phase 9 slots one new step (write config dir) into this chain before spawn.
- **Per-query ephemeral temp artifacts with `finally` cleanup.** Phase 4 SYS-01/02 (system prompt temp file). Phase 9 mirrors exactly for the config dir; both are cleaned up in the same `finally` block.
- **Pre-spawn guards before `resolveAuth`.** Phase 7/8 pattern: validate cheap client-side checks first. Phase 9 adds the two new guards (empty `allowedMcpServerNames`, conflicting `env.GEMINI_CONFIG_DIR`) in that same block.
- **Fixture-corpus parity tests.** Phase 3/5/7 parametrize TS + Python tests over `spec/fixtures/*`; Phase 9 SC-1 stubs follow the convention.
- **Test-name parity enforced by `scripts/diff-test-names.sh`** — TS + Python MCP passthrough test names must match after grep extraction.
- **Doc files for new features.** Phase 6 `docs/auth.md`, Phase 7 `docs/sessions.md`, Phase 8 `docs/tools.md` + `docs/structured-output.md` → Phase 9 adds `docs/mcp.md`. Phase 11 publishes it.
- **Research spike documented in `09-RESEARCH.md` before planning.** Standard gsd flow; the spike's deliverables (golden settings.json, known-fragile map, scaffolding shape, pinned version) are enumerated in the Decisions section above.

### Integration Points
- `ts/src/query/types.ts` + Python mirror — ADD `mcpServers?: Record<string, Record<string, unknown>>` and `allowedMcpServerNames?: string[]` to `QueryOptions` with `@experimental` tags.
- `ts/src/query/buildArgv.ts` + Python mirror — ADD `--allowed-mcp-server-names` CSV branch (skip when undefined or empty). Purely additive; no changes to existing branches.
- `ts/src/query/query.ts` + Python mirror — ADD two pre-spawn `InvalidPromptError` guards (empty `allowedMcpServerNames` when `mcpServers` set; conflicting `env.GEMINI_CONFIG_DIR`); ADD `writeTempConfigDir` call before spawn when `mcpServers` is non-empty; ADD `GEMINI_CONFIG_DIR` to env overrides; EXTEND existing `finally` block to call `cleanupConfigDir` (rm-rf with retry) after `unlink`-ing the systemPrompt temp file.
- New files: `ts/src/mcp/writeConfigDir.ts` + spec; `ts/src/mcp/cleanupConfigDir.ts` + spec; `ts/src/mcp/index.ts` barrel. Python mirrors in `python/src/gemini_sdk/mcp/`. (Exact file granularity is planner's call; the new-module-new-directory rule is the only hard constraint.)
- Barrel exports — ADD `mcp` module to `ts/src/index.ts` and `python/src/gemini_sdk/__init__.py` IF any symbols are re-exported publicly (likely internal-only; the public surface is just `QueryOptions` fields).
- `spec/fixtures/mcp/stub.mjs` + `spec/fixtures/mcp/stub.py` (NEW) — stub MCP servers using `@modelcontextprotocol/sdk` and `mcp` packages respectively; one tool, canned response, stdio transport.
- `ts/test/mcp-passthrough.test.ts` + `python/tests/test_mcp_passthrough.py` (NEW) — SC-1 round-trip, SC-2 mtime invariant, SC-3 tempdir-gone-in-finally (success + abort + error paths), SC-4 Windows-specific cleanup-with-held-handle regression.
- `ts/package.json` + `python/pyproject.toml` — ADD `@modelcontextprotocol/sdk` and `mcp` as **test-only / dev deps** (not runtime deps — the stub servers are test fixtures, not SDK code).
- `docs/mcp.md` (NEW, authored here, published in Phase 11) — mcpServers + allowedMcpServerNames guide; Known Limitations section linking #2654, #3406, #20694, #13604, #17787, #23296, #23776; note on per-query isolated config dir guarantee (MCP-02); porting-from-gemini-cli-CLI-config section (optional, planner's call).
- `spec/fixtures.manifest.json` — potentially ADD `mcp-stdio` scenario (Phase 9 research spike decides).
- `scripts/capture-fixtures.*` — potentially ADD `--scenario mcp-stdio` branch (Phase 9 research spike decides).
- `.gemini-cli-compat` — potentially BUMP if research spike finds current pin is unreliable for stdio MCP; otherwise confirm unchanged in RESEARCH.md.

</code_context>

<specifics>
## Specific Ideas

- The `mcpServers: Record<string, Record<string, unknown>>` shape mirrors TOL-01's `allowedTools: string[]` and MDL-02's raw-string model escape hatch EXACTLY — the SDK remains a transparent wrapper rather than a curated catalog of upstream types that will rot.
- The `allowedMcpServerNames` CSV argv format is a verbatim copy of Phase 8's `allowedTools` branch; planner should literally copy that code pattern to reduce cognitive load and fuzz-test coverage gaps.
- The "settings.json + .gemini/ subdir scaffolding" decision is INSURANCE against #3406 "not detected despite valid config," but the EXACT scaffolding content is deferred to the research spike. CONTEXT.md locks intent; research spike locks shape. If the spike concludes the minimum fragment is sufficient, that's a legitimate override of the scaffolding tentative.
- The two pre-spawn guards (empty `allowedMcpServerNames`, conflicting `env.GEMINI_CONFIG_DIR`) are the MCP-02 safety contract in code — without them, either the feature silently misbehaves or the caller can trivially sidestep the isolation guarantee. Both throw `InvalidPromptError`, reusing existing taxonomy.
- `fs.rm({ recursive: true, force: true, maxRetries: 3, retryDelay: 200 })` is Node's native antidote to the Windows MCP-grandchild file-handle issue (#13604). Python's `shutil.rmtree` needs a manual retry wrapper — Phase 9's Python `mcp` module owns that wrapper.
- The `@experimental` tag + `docs/mcp.md` Known Limitations section directly mirrors Phase 8's OUT-04 treatment of `#13388` — that precedent is deliberately being applied unchanged here because the upstream fragility story is identical in shape (feature works today, upstream bugs could reshape it, SDK documents + passes through).
- The stub MCP server using the **official MCP SDK** (TS + Python) is the "don't reinvent the protocol" choice — hand-rolling JSON-RPC framing for a test harness buys nothing and accumulates technical debt the moment upstream bumps the MCP protocol version.
- PAR-01 lock-step parity is NON-NEGOTIABLE for Phase 9 per the roadmap: "TypeScript and Python move in lock-step from Phase 2 through Phase 9." This phase is the LAST of the lock-step phases — Phase 10 is TS-only. So both stubs, both tests, identical canned tool response shape.
- The research spike deliverables list is specific and gated: if any item is missing, planning cannot proceed. This is intentional — Phase 9 is the only phase on the roadmap that the roadmap text itself explicitly calls out as starting with a spike, which signals the upstream fragility is too severe to plan around without empirical evidence.
- Zero new error classes in Phase 9 is a deliberate discipline choice — Phase 5 covered the taxonomy, Phase 8 added one `source:'sdk'` entry, Phase 9 resists the pull to add `McpConfigError` / `McpServerSpawnError` until a subprocess-level failure mode actually fails to fit existing classification (it probably doesn't).

</specifics>

<deferred>
## Deferred Ideas

- **Caller-defined custom tools via stub MCP sidecar** — CTL-01..03, v2 scope. Phase 9 builds the isolated-config-dir primitive that the v2 stub-MCP feature will reuse, but does NOT expose caller-provided JS/Python tool functions.
- **HTTP MCP OAuth token refresh workaround** — Blocked on gemini-cli upstream #23296 / #23776. Phase 9 passes HTTP server configs through verbatim and documents the upstream bug in `docs/mcp.md` Known Limitations. SDK does NOT implement a local token-refresh shim.
- **MCP server lifecycle hooks** (HOK-01..04) — `onServerReady` / `onToolCall` / `onToolResult` callbacks. v2 scope. Phase 9 passes tool-call events through the existing Phase 3 dispatcher unchanged.
- **Typed `McpServerConfig` discriminated union** — Discussed and declined per user selection of the raw-pass-through shape. Revisit in v2 if callers push back on autocomplete ergonomics and upstream transport list stabilizes.
- **Runtime `gemini --version` probe for MCP flag renames** — Explicitly declined per Phase 8 TOL-03 decision. Phase 11 REL-06 `gemini --version` compat probe is the documented bulwark.
- **Env-var gating (`GEMINI_SDK_ENABLE_MCP`)** — Declined. Matches Phase 8's rejection of `GEMINI_SDK_ENABLE_EXPERIMENTAL`. Phase 10 Archon adapter requires the feature to be on by default.
- **Runtime warning on first `mcpServers` use** — Declined, matches Phase 8 stance on `@experimental` (docs-only, no runtime nag).
- **Per-process cached config dir with rewrite-on-change** — Declined; per-query ephemeral is SC-3 compliant and matches Phase 2 SpawnPerCallStrategy.
- **Caller-provided `mcpConfigDir` escape hatch** — Declined; introduces a second API surface and breaks isolation if misused. Can be reconsidered in v2 if a concrete use case emerges.
- **Full-shape `settings.json` (auth, memory, model keys inside the temp file)** — Declined; would fight Phase 6 auth resolution and the argv-driven config channels. Temp `settings.json` contains ONLY `{mcpServers}`.
- **Auto-deriving `allowedMcpServerNames` from `mcpServers` keys** — Declined; contradicts transparent-wrapper ethos and hides magic. Caller explicitly lists what they want allowed.
- **Snapshotting the user's real `~/.gemini/` layout into the temp dir** — Declined; subtly violates MCP-02 (reads user files even if not mutating) and is complexity theater.
- **Warning on MCP+HTTP transport combined with auth** — Declined; transparent pass-through means the SDK doesn't inspect server config shape.
- **Tool-call timeout enforcement at the SDK level** — Declined; upstream #17787 means gemini-cli already ignores MCP timeouts. SDK documents the bug; does not invent a second-tier timeout layer.
- **`ResultChunk.mcpServersContacted` telemetry** — Interesting for observability but not required by MCP-01..04. Revisit in v2 if Archon adapter or other callers need it.
- **Golden-file fixture of the full MCP round-trip event stream** — Deferred to the research spike; spike decides whether stable enough to fixture vs. asserted by shape at runtime.
- **`docs/mcp.md` "porting from gemini-cli CLI MCP config" section** — Nice-to-have; planner's call whether to include in the v1 doc.

</deferred>

---

*Phase: 09-mcp-passthrough-isolated-config-dir*
*Context gathered: 2026-04-20*
