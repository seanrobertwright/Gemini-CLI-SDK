---
phase: 9
slug: mcp-passthrough-isolated-config-dir
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-20
updated: 2026-04-20
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + pytest (Python mirror) |
| **Config file** | `ts/vitest.config.ts`, `python/pyproject.toml` |
| **Quick run command (TS, mcp module only)** | `pnpm --filter @gemini-sdk/core test run -- ts/src/mcp/` |
| **Quick run command (Python, mcp module only)** | `uv run pytest python/tests/test_mcp_module.py python/tests/test_mcp_passthrough.py -x` |
| **Full TS suite** | `pnpm --filter @gemini-sdk/core test run` |
| **Full Python suite** | `uv run pytest python/tests/ -x` |
| **Parity check** | `bash scripts/diff-test-names.sh` |
| **Live suite (opt-in)** | `RUN_LIVE_E2E=1 GEMINI_API_KEY=... pnpm --filter @gemini-sdk/core test:live` |
| **Estimated runtime (mandatory)** | ~45 seconds |
| **Estimated runtime (with live)** | ~3 minutes (5 live API calls) |

---

## Sampling Rate

- **After every task commit:** Run plan-scoped quick command for the active language
- **After every plan wave:** Run TS full + Python full + parity diff
- **Before `/gsd:verify-work`:** Full TS + Python + parity must all be green; live suite credential-gated (CI nightly)
- **Max feedback latency (mandatory):** 60 seconds

---

## Per-Task Verification Map

| Plan-Task | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|-----------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-T1 (writeConfigDir helper + spec) | 1 | MCP-01 | unit | `pnpm --filter @gemini-sdk/core test run -- ts/src/mcp/writeConfigDir.spec.ts` | ❌ Wave 0 (Plan 01 creates) | ⬜ pending |
| 09-01-T2 (cleanupConfigDir helper + spec + barrel) | 1 | MCP-04 | unit | `pnpm --filter @gemini-sdk/core test run -- ts/src/mcp/cleanupConfigDir.spec.ts` | ❌ Wave 0 (Plan 01 creates) | ⬜ pending |
| 09-02-T1 (QueryOptions extension + buildArgv branch) | 2 | MCP-01, MCP-03 | unit | `pnpm --filter @gemini-sdk/core test run -- ts/src/query/buildArgv.spec.ts && pnpm --filter @gemini-sdk/core typecheck` | ✅ extends existing | ⬜ pending |
| 09-02-T2 (query/queryRaw/queryFull guards + lifecycle + mtime spec) | 2 | MCP-01, MCP-02, MCP-03, MCP-04 | unit | `pnpm --filter @gemini-sdk/core test run -- ts/src/query/query.spec.ts ts/src/mcp/mcpPassthrough.spec.ts` | ❌ Wave 0 (Plan 02 creates mcpPassthrough.spec.ts; extends query.spec.ts) | ⬜ pending |
| 09-03-T1 (Python mcp module + tests) | 3 | MCP-01, MCP-04 | unit | `uv run pytest python/tests/test_mcp_module.py -x` | ❌ Wave 0 (Plan 03 creates) | ⬜ pending |
| 09-03-T2 (Python QueryOptions/build_argv/query mirror + parity) | 3 | MCP-01, MCP-02, MCP-03, MCP-04 | unit + parity | `uv run pytest python/tests/ -x && bash scripts/diff-test-names.sh` | ❌ Wave 0 (Plan 03 creates test_mcp_passthrough.py) | ⬜ pending |
| 09-04-T1 (Stub servers + dev deps + fixture README) | 4 | MCP-01 (test infra) | smoke | `pnpm --filter @gemini-sdk/core exec node -e "require.resolve('@modelcontextprotocol/sdk/server/mcp.js')" && uv run python -c "import mcp.server.fastmcp"` | ❌ Wave 0 (Plan 04 creates stubs) | ⬜ pending |
| 09-04-T2 (Live E2E suite + tests-live README + docs/mcp.md) | 4 | MCP-01, MCP-02, MCP-03, MCP-04 | integration (live, gated) | `pnpm --filter @gemini-sdk/core typecheck` (compile-time only; live run is credential-gated) | ❌ Wave 0 (Plan 04 creates live spec) | ⬜ pending |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `ts/src/mcp/` — new module directory (Plan 01)
  - [ ] `ts/src/mcp/writeConfigDir.ts`
  - [ ] `ts/src/mcp/cleanupConfigDir.ts`
  - [ ] `ts/src/mcp/index.ts`
  - [ ] `ts/src/mcp/writeConfigDir.spec.ts`
  - [ ] `ts/src/mcp/cleanupConfigDir.spec.ts`
- [ ] `ts/src/mcp/mcpPassthrough.spec.ts` — MCP-02 mtime invariant (Plan 02)
- [ ] `python/src/gemini_sdk/mcp/` — new module directory (Plan 03)
  - [ ] `python/src/gemini_sdk/mcp/__init__.py`
  - [ ] `python/src/gemini_sdk/mcp/write_config_dir.py`
  - [ ] `python/src/gemini_sdk/mcp/cleanup_config_dir.py`
- [ ] `python/tests/test_mcp_module.py` — Python mirror of TS mcp specs (Plan 03)
- [ ] `python/tests/test_mcp_passthrough.py` — Python mirror of mtime invariant (Plan 03)
- [ ] `spec/fixtures/mcp/stub.mjs` — TS stub server (Plan 04)
- [ ] `spec/fixtures/mcp/stub.py` — Python stub server (Plan 04)
- [ ] `spec/fixtures/mcp/README.md` — fixture docs (Plan 04)
- [ ] `ts/tests-live/mcp-passthrough.live.spec.ts` — opt-in SC-1/SC-2/SC-3 (Plan 04)
- [ ] `ts/package.json` — `@modelcontextprotocol/sdk` devDep (Plan 04)
- [ ] `python/pyproject.toml` — `mcp[cli]` dev dep (Plan 04)
- [ ] `docs/mcp.md` — user-facing docs authored here, published Phase 11 (Plan 04)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live SC-1 round-trip against real gemini-cli | MCP-01, MCP-03 | Requires GEMINI_API_KEY (paid creds); ~$0.01 per run | `RUN_LIVE_E2E=1 GEMINI_API_KEY=... pnpm --filter @gemini-sdk/core test:live -- mcp-passthrough` — should complete <90s with all SC-1/SC-2/SC-3 tests green |
| Windows-specific MCP grandchild EBUSY tolerance (SC-4) | MCP-04 | Requires Windows host with npx-spawned MCP server holding handles; covered by CI Windows matrix nightly | Push to main; verify GitHub Actions Windows job for the live suite passes — check logs for any "stranded path" warnings (acceptable; warning path is by design) |

*Mock-spawn unit tests cover the same invariants in CI without credentials; live suite is the authoritative end-to-end check before Phase 9 sign-off.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (mandatory suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-approved 2026-04-20 — execute Plan 01 first.
