---
phase: 09-mcp-passthrough-isolated-config-dir
plan: "04"
subsystem: mcp+testing+docs
tags: [mcp, typescript, live-e2e, stub-server, docs, modelcontextprotocol]

# Dependency graph
requires:
  - phase: 09-02
    provides: queryFull mcpServers/allowedMcpServerNames + assertMcpOptions guards (TS)
  - phase: 09-03
    provides: Python mcp module + query pipeline wiring

provides:
  - spec/fixtures/mcp/stub.mjs: Node stub MCP server (McpServer + StdioServerTransport, echo tool)
  - spec/fixtures/mcp/stub.py: Python stub MCP server (FastMCP, echo tool, stdio)
  - spec/fixtures/mcp/README.md: fixture documentation + wiring example
  - ts/tests-live/mcp-passthrough.live.spec.ts: SC-1/SC-2/SC-3a/b/c live E2E coverage gated by RUN_LIVE_E2E
  - docs/mcp.md: user-facing MCP docs with Known Limitations (7 upstream issues)
  - @modelcontextprotocol/sdk ^1.29.0 in ts/package.json devDependencies
  - mcp[cli]>=1.27.0 in python/pyproject.toml dev optional-dependencies

affects:
  - 09-VALIDATION (nyquist_compliant + wave_0_complete can now be set true)
  - Phase 11 (docs/mcp.md publication via VitePress/mkdocs)

# Tech tracking
tech-stack:
  added:
    - "@modelcontextprotocol/sdk ^1.29.0 (devDependency — test-only, not runtime)"
    - "mcp[cli]>=1.27.0 (Python dev optional-dependency — test-only, not runtime)"
  patterns:
    - "Live E2E spec: describe.skipIf(!LIVE_ENABLED) gate identical to Phase 8 e2e.live.spec.ts"
    - "SC-3b abort cleanup: short polling loop (200ms intervals, 3s deadline) instead of fixed sleep — avoids race with Node async fs.rm retry window"
    - "Stub MCP servers: stderr-only diagnostics (stdout must be pure JSON-RPC per Pitfall 5)"

key-files:
  created:
    - spec/fixtures/mcp/stub.mjs
    - spec/fixtures/mcp/stub.py
    - spec/fixtures/mcp/README.md
    - ts/tests-live/mcp-passthrough.live.spec.ts
    - docs/mcp.md
  modified:
    - ts/package.json
    - python/pyproject.toml
    - ts/tests-live/README.md
    - pnpm-lock.yaml
    - python/uv.lock

key-decisions:
  - "docs/mcp.md uses -- instead of em dash in prose (ASCII-safe for all consumers)"
  - "Live suite is TS-only per STATE decision [Phase 08-07]: argv parity proves SDK contract; Python mirror is additive future work"
  - "SC-3b uses polling loop (not sleep) for abort cleanup verification — matches Node fs.rm async retry window without blocking the event loop"
  - "All 7 upstream issues documented in Known Limitations table; SDK only mitigates #13604 (Windows EBUSY); rest are pass-through with documentation"
  - "Stubs live at spec/fixtures/mcp/ (not ts/fixtures/ or python/fixtures/) — shared across both languages per CONTEXT decision"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-04]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 9 Plan 04: Live E2E Suite + Stub Servers + docs/mcp.md Summary

**Node + Python stub MCP servers using official SDK packages; SC-1/SC-2/SC-3 live E2E spec gated by RUN_LIVE_E2E; docs/mcp.md with Known Limitations linking 7 upstream issues; 241 TS / 345 Python / 226:226 parity all green**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-21T00:05:38Z
- **Completed:** 2026-04-21T00:09:41Z
- **Tasks:** 2
- **Files modified:** 5 created + 4 modified (incl. lockfiles)

## Accomplishments

- `spec/fixtures/mcp/stub.mjs` — Node stub: `@modelcontextprotocol/sdk` McpServer + StdioServerTransport, one `echo` tool, stderr-only diagnostics (no stdout pollution)
- `spec/fixtures/mcp/stub.py` — Python stub: `mcp` FastMCP, same `echo` tool, `transport="stdio"`, stderr-only
- `spec/fixtures/mcp/README.md` — documents purpose, wiring example, and diagnostics prohibition
- `ts/package.json` devDependencies: `@modelcontextprotocol/sdk ^1.29.0` added (test-only, not runtime)
- `python/pyproject.toml` dev optional-dependencies: `mcp[cli]>=1.27.0` added (test-only)
- `ts/tests-live/mcp-passthrough.live.spec.ts` — 5 tests covering SC-1 (tool-call round-trip), SC-2 (live mtime invariant), SC-3a (success cleanup), SC-3b (abort cleanup), SC-3c (error cleanup); gated by `describe.skipIf(!LIVE_ENABLED)`
- `ts/tests-live/README.md` — Phase 9 suite section added with SC descriptions, run instructions, cost estimate
- `docs/mcp.md` — MCP Passthrough docs: `@experimental` callout, Known Limitations table with all 7 upstream issues (#2654, #3406, #20694, #13604, #17787, #23296, #23776), Quick Start TS+Python, isolation guarantee, cleanup semantics

## Task Commits

1. **Task 1: Stub MCP servers + package manifest updates + fixture README** - `52dc6ba` (feat)
2. **Task 2: Live E2E suite + tests-live README delta + docs/mcp.md** - `97282f6` (feat)

## Files Created/Modified

- `spec/fixtures/mcp/stub.mjs` — Node stub server (McpServer, StdioServerTransport, echo tool)
- `spec/fixtures/mcp/stub.py` — Python stub server (FastMCP, echo tool, stdio transport)
- `spec/fixtures/mcp/README.md` — Fixture usage documentation
- `ts/package.json` — Added @modelcontextprotocol/sdk ^1.29.0 to devDependencies
- `python/pyproject.toml` — Added mcp[cli]>=1.27.0 to dev optional-dependencies
- `ts/tests-live/mcp-passthrough.live.spec.ts` — Live E2E suite: SC-1/SC-2/SC-3a/b/c
- `ts/tests-live/README.md` — Added Phase 9 suite section
- `docs/mcp.md` — MCP passthrough user docs with Known Limitations

## Test Counts

| Suite | Count | Status |
|-------|-------|--------|
| TS mandatory (`pnpm test`) | 241 | Pass |
| Python mandatory (`uv run pytest`) | 345 | Pass |
| TS:Python parity (`diff-test-names.sh`) | 226:226 | Pass |
| TS live (gated, not run in plan) | 5 | Gated — not run during this plan |

The live suite compiles (typecheck passes) but is not executed during this plan's auto-verify — it requires `RUN_LIVE_E2E=1 GEMINI_API_KEY=...` per Phase 11 CI scheduling.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. Both SDK packages installed cleanly, typecheck passed on first attempt.

## User Setup Required

None — no external service configuration required.

## Deferred Items for Phase 11

- `docs/mcp.md` publication via VitePress/mkdocs integration (docs build config)
- Runtime `gemini --version` compat probe (REL-06) — emit warning when CLI is outside tested range
- Live suite CI scheduling (`workflow_dispatch` + nightly) at `RUN_LIVE_E2E=1` gate
- Python mirror live suite (`python/tests-live/mcp-passthrough.py`) if contributors decide extra coverage is worth API budget

## Next Phase Readiness

- Phase 9 all four plans complete — MCP-01, MCP-02, MCP-03, MCP-04 fully satisfied
- `09-VALIDATION.md` can have `nyquist_compliant: true` and `wave_0_complete: true` set (all Wave 0 requirements met)
- Phase 10 (Archon adapter) can wire `QueryOptions.mcpServers` + `allowedMcpServerNames` — contract is stable
- Phase 11 release gate: live suite SC-1/SC-2/SC-3 must pass on CI before tagging v1.0

---
*Phase: 09-mcp-passthrough-isolated-config-dir*
*Completed: 2026-04-21*
