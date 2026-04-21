---
phase: 09-mcp-passthrough-isolated-config-dir
verified: 2026-04-20T00:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 9: MCP Passthrough + Isolated Config Dir Verification Report

**Phase Goal:** Accept `options.mcpServers`, write a temp `settings.json` fragment into an isolated `GEMINI_CONFIG_DIR` per query, gate via `--allowed-mcp-server-names`, and clean up in `finally` — never mutate the user's real `~/.gemini/settings.json`.

**Verified:** 2026-04-20
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `writeConfigDir` creates a temp dir with `settings.json` containing `{mcpServers: <verbatim>}` and returns the absolute path | VERIFIED | `ts/src/mcp/writeConfigDir.ts` — `randomBytes(8).toString('hex')` suffix, `gemini-sdk-mcp-` prefix, single `writeFile('settings.json')`, no `.gemini/` subdir |
| 2 | `cleanupConfigDir` removes the temp dir with `maxRetries:3 retryDelay:200`, never re-throws, warns on persistent failure | VERIFIED | `ts/src/mcp/cleanupConfigDir.ts` — `fs.rm({recursive:true,force:true,maxRetries:3,retryDelay:200})`, `console.warn` in catch, zero actual `throw` statements in source |
| 3 | Python `write_config_dir` mirrors TS behavior with `secrets.token_hex(8)` suffix and `settings.json` content `{"mcpServers":...}` | VERIFIED | `python/src/gemini_sdk/mcp/write_config_dir.py` — `anyio.Path`, `json.dumps({"mcpServers":...})`, no `.gemini/` subdir |
| 4 | Python `cleanup_config_dir` has `_MAX_RETRIES=3`, `_RETRY_DELAY_MS=200`, manual retry loop, never re-raises | VERIFIED | `python/src/gemini_sdk/mcp/cleanup_config_dir.py` — explicit module constants, `warnings.warn` on exhaustion, zero `raise` statements |
| 5 | `QueryOptions` (TS + Python) exposes `mcpServers`/`mcp_servers` and `allowedMcpServerNames`/`allowed_mcp_server_names` as `@experimental` fields | VERIFIED | `ts/src/query/types.ts` lines 130+138; `python/src/gemini_sdk/query/types.py` lines 109+117 — both with `@experimental`/`**Experimental:**` markers |
| 6 | `buildArgv` (TS + Python) emits `--allowed-mcp-server-names <csv>` when `allowedMcpServerNames` is non-empty; never references `mcpServers` | VERIFIED | TS: `buildArgv.ts` — CSV-join branch, `grep mcpServers` returns 0; Python: `build_argv.py` — `argv.extend(["--allowed-mcp-server-names", ...])`, `grep mcp_servers` returns 0 |
| 7 | `query()`/`queryRaw()`/`queryFull()` throw `InvalidPromptError` pre-spawn when `env.GEMINI_CONFIG_DIR` is set with `mcpServers`, or when `mcpServers` is non-empty without `allowedMcpServerNames` | VERIFIED | `ts/src/query/query.ts` — `assertMcpOptions` helper defined at module scope (1 def + 3 callsites = 4 occurrences); `python/src/gemini_sdk/query/query.py` — `_assert_mcp_options` (1 def + 3 callsites = 4 occurrences) |
| 8 | When guards pass, `query()`/`queryRaw()` materialize a temp config dir via `writeConfigDir`, set `GEMINI_CONFIG_DIR` in env overrides, and clean it up in `finally` | VERIFIED | `ts/src/query/query.ts` — `writeConfigDir` imported, called in both `query()` and `queryRaw()`, `GEMINI_CONFIG_DIR` env override set, `cleanupConfigDir` in both `finally` blocks; Python mirrors identically |
| 9 | Empty `mcpServers: {}` is a no-op — no temp dir, no guard, no flag | VERIFIED | TS `assertMcpOptions`: `Object.keys(options.mcpServers).length > 0` check guards entry; same in Python `len(servers) == 0` |
| 10 | MCP-02 mtime-invariant test exists (mock spawn, verifies real `~/.gemini/settings.json` is never touched) | VERIFIED | `ts/src/mcp/mcpPassthrough.spec.ts` — 8 occurrences of `mtime`; `python/tests/test_mcp_passthrough.py` — exists |
| 11 | Stub MCP servers (TS: `stub.mjs`, Python: `stub.py`) exist using official SDK packages, with diagnostics to stderr only | VERIFIED | `spec/fixtures/mcp/stub.mjs` — `McpServer`, `StdioServerTransport`, `server.tool`, zero `console.log`; `spec/fixtures/mcp/stub.py` — `FastMCP`, `transport="stdio"`, zero bare `print(` |
| 12 | `docs/mcp.md` exists with `@experimental`, Known Limitations section, and all 7 upstream issue links (#2654, #3406, #20694, #13604, #17787, #23296, #23776) | VERIFIED | `docs/mcp.md` — `grep` returns 9 matches covering all 7 issues + `@experimental` + "Known Limitations" heading |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `ts/src/mcp/writeConfigDir.ts` | VERIFIED | Exports `writeConfigDir`; `randomBytes(8)` suffix; `gemini-sdk-mcp-` prefix; `JSON.stringify`; no `.gemini/` subdir |
| `ts/src/mcp/cleanupConfigDir.ts` | VERIFIED | Exports `cleanupConfigDir`; `maxRetries: 3`; `retryDelay: 200`; `console.warn`; no `throw` statements |
| `ts/src/mcp/index.ts` | VERIFIED | Barrel exports both `writeConfigDir` and `cleanupConfigDir` |
| `ts/src/mcp/writeConfigDir.spec.ts` | VERIFIED | 5 `it()` tests covering content, path format, uniqueness, empty map, verbatim passthrough |
| `ts/src/mcp/cleanupConfigDir.spec.ts` | VERIFIED | 4 `it()` tests covering success, missing-path, warn-and-continue, retry constants |
| `ts/src/mcp/mcpPassthrough.spec.ts` | VERIFIED | MCP-02 mtime-invariant test with mock spawn |
| `ts/src/query/types.ts` | VERIFIED | `mcpServers?: Record<string, Record<string, unknown>>` + `allowedMcpServerNames?: string[]` with `@experimental` JSDoc |
| `ts/src/query/buildArgv.ts` | VERIFIED | `--allowed-mcp-server-names` CSV branch; zero `mcpServers` references |
| `ts/src/query/query.ts` | VERIFIED | `assertMcpOptions` at module scope (4 occurrences); `writeConfigDir` import + 2 callsites; `cleanupConfigDir` + 2 finally callsites; `GEMINI_CONFIG_DIR` env override |
| `python/src/gemini_sdk/mcp/__init__.py` | VERIFIED | Barrel exporting `write_config_dir` and `cleanup_config_dir`; `__all__` declared |
| `python/src/gemini_sdk/mcp/write_config_dir.py` | VERIFIED | `async def write_config_dir`; `secrets.token_hex(8)`; `gemini-sdk-mcp-` prefix; `{"mcpServers": ...}`; no `.gemini/` |
| `python/src/gemini_sdk/mcp/cleanup_config_dir.py` | VERIFIED | `_MAX_RETRIES = 3`; `_RETRY_DELAY_MS = 200`; manual retry loop; `warnings.warn`; zero `raise` statements |
| `python/tests/test_mcp_module.py` | VERIFIED | 9 tests mirroring TS spec (5 write + 4 cleanup) with parity docstrings |
| `python/tests/test_mcp_passthrough.py` | VERIFIED | MCP-02 mtime-invariant test (Python mirror) |
| `python/src/gemini_sdk/query/types.py` | VERIFIED | `mcp_servers: Dict[str, Dict[str, Any]]` + `allowed_mcp_server_names: List[str]` with `**Experimental:**` |
| `python/src/gemini_sdk/query/build_argv.py` | VERIFIED | `--allowed-mcp-server-names` branch; zero `mcp_servers` references |
| `python/src/gemini_sdk/query/query.py` | VERIFIED | `_assert_mcp_options` (4 occurrences); `write_config_dir`/`cleanup_config_dir` imported and wired in `query`, `query_raw`, `query_full` |
| `spec/fixtures/mcp/stub.mjs` | VERIFIED | `McpServer`, `StdioServerTransport`, `server.tool('echo', ...)`, no `console.log` |
| `spec/fixtures/mcp/stub.py` | VERIFIED | `FastMCP`, `mcp.run(transport="stdio")`, no bare `print(` |
| `spec/fixtures/mcp/README.md` | VERIFIED | Exists; documents both stubs and wiring example |
| `ts/tests-live/mcp-passthrough.live.spec.ts` | VERIFIED | `describe.skipIf`, `RUN_LIVE_E2E`, SC-1/SC-2/SC-3a/b/c, `gemini-sdk-mcp-` leak detection |
| `docs/mcp.md` | VERIFIED | Known Limitations, `@experimental`, all 7 upstream issue links |
| `ts/package.json` devDeps | VERIFIED | `@modelcontextprotocol/sdk` present |
| `python/pyproject.toml` dev optional-deps | VERIFIED | `mcp[cli]` present |
| `ts/tests-live/README.md` | VERIFIED | `mcp-passthrough` entry present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ts/src/query/query.ts` | `ts/src/mcp/index.js` (`writeConfigDir` + `cleanupConfigDir`) | `import { writeConfigDir, cleanupConfigDir } from '../mcp/index.js'` | WIRED | Line 39 of query.ts; used in `query()`, `queryRaw()` bodies + `finally` blocks |
| `ts/src/query/query.ts` | `GEMINI_CONFIG_DIR` env override | `envOverrides['GEMINI_CONFIG_DIR'] = mcpConfigDir` | WIRED | Lines 166-167 (query), 351-352 (queryRaw) |
| `ts/src/query/buildArgv.ts` | `--allowed-mcp-server-names` argv flag | CSV-join mirroring `--allowed-tools` branch | WIRED | Lines 83-88 |
| `python/src/gemini_sdk/query/query.py` | `python/src/gemini_sdk/mcp/` | `from ..mcp import cleanup_config_dir, write_config_dir` | WIRED | Line 43; called in `query`, `query_raw`, `query_full` |
| `python/src/gemini_sdk/query/build_argv.py` | `--allowed-mcp-server-names` | `argv.extend(["--allowed-mcp-server-names", ...])` | WIRED | Lines 104-106 |
| `ts/tests-live/mcp-passthrough.live.spec.ts` | `spec/fixtures/mcp/stub.mjs` | `STUB_PATH = resolve(process.cwd(), 'spec/fixtures/mcp/stub.mjs')` | WIRED | `mcpServers.command: 'node', args: [STUB_PATH]` |
| `spec/fixtures/mcp/stub.mjs` | `@modelcontextprotocol/sdk` | `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'` | WIRED | Lines 1-3 of stub.mjs |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| MCP-01 | 09-01, 09-02, 09-03, 09-04 | SDK accepts `options.mcpServers` and writes a temp `settings.json` fragment | SATISFIED | `writeConfigDir` / `write_config_dir` implemented; `QueryOptions` extended; `query()` calls it pre-spawn |
| MCP-02 | 09-01, 09-02, 09-03, 09-04 | SDK uses an isolated temp `GEMINI_CONFIG_DIR` per query — never mutates `~/.gemini/settings.json` | SATISFIED | Isolated `GEMINI_CONFIG_DIR` set per-query; pre-spawn guard rejects `env.GEMINI_CONFIG_DIR` + `mcpServers` combination; mtime-invariant test in both languages |
| MCP-03 | 09-02, 09-03 | SDK gates via `--allowed-mcp-server-names` | SATISFIED | `buildArgv` (TS + Python) emits the flag; pre-spawn guard requires non-empty `allowedMcpServerNames` when `mcpServers` is set |
| MCP-04 | 09-01, 09-02, 09-03 | Temp config dir cleaned up in `finally` (even on error/cancel) | SATISFIED | `cleanupConfigDir`/`cleanup_config_dir` called in `finally` blocks of `query()` and `queryRaw()` in both languages; retry semantics handle Windows EBUSY; never re-throws |

All four MCP requirements are SATISFIED. No orphaned requirements — every ID declared across plans (09-01 through 09-04) is accounted for and implemented.

---

### Anti-Patterns Found

No blockers or warnings detected:

- Zero `TODO`/`FIXME`/`PLACEHOLDER` comments in new source files
- Zero actual `throw` statements in `cleanupConfigDir.ts` (3 occurrences of the word "throw" are all in comments)
- Zero `raise` statements in `cleanup_config_dir.py`
- Zero `mcpServers` references in `buildArgv.ts`
- Zero `mcp_servers` references in `build_argv.py`
- Zero `.gemini/` subdir references in either `writeConfigDir.ts` or `write_config_dir.py`
- Zero `console.log` in `stub.mjs`; zero bare `print(` in `stub.py` (stdout-pollution prohibition respected)
- No empty return stubs (`return null`, `return {}`) in implementation files

---

### Human Verification Required

Two items that require live credentials to fully exercise but are intentionally gated:

**1. SC-1: MCP Tool-Call Round-Trip (Live)**

Test: `RUN_LIVE_E2E=1 GEMINI_API_KEY=<key> pnpm --filter @gemini-sdk/core test:live` — specifically `mcp-passthrough.live.spec.ts` SC-1 test.

Expected: `queryFull` with `mcpServers: {'test-stub': {command:'node', args:['spec/fixtures/mcp/stub.mjs']}}` produces `type:'tool'` and `type:'tool_result'` chunks in the event stream, and `result.text` contains `'echo:'`.

Why human: Requires a live `gemini-cli` binary, a valid `GEMINI_API_KEY`, and actual MCP subprocess invocation. Automated unit tests mock the spawn layer. The suite compiles and is correctly gated by `describe.skipIf(!LIVE_ENABLED)`.

**2. SC-4: Windows Cross-Platform Cleanup (CI)**

Test: Live suite on the CI Windows matrix runner (`windows-latest`) with `RUN_LIVE_E2E=1`.

Expected: SC-3b (abort path cleanup) passes on Windows where MCP grandchild processes can hold file handles (`#13604`). The `maxRetries:3, retryDelay:200` mitigation is code-verified; Windows subprocess behavior can only be confirmed by actually running on Windows.

Why human: CI-gated; requires Windows runner + credentials. The Phase 2 FDN-06 matrix is the vehicle.

---

### Gaps Summary

No gaps. All 12 observable truths are VERIFIED, all 25 artifacts are substantive and wired, all 4 MCP requirements are SATISFIED, and zero blocker anti-patterns were found.

The two human verification items (SC-1 live round-trip and SC-4 Windows CI) are correctly deferred to credential-gated CI runs per the established Phase 8/9 live-suite pattern — they do not block phase goal achievement.

---

_Verified: 2026-04-20T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
