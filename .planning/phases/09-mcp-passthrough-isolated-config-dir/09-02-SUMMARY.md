---
phase: 09-mcp-passthrough-isolated-config-dir
plan: "02"
subsystem: query
tags: [mcp, typescript, query, guards, config-dir, tdd, vitest]

# Dependency graph
requires:
  - phase: 09-01
    provides: writeConfigDir + cleanupConfigDir primitives consumed by query.ts

provides:
  - QueryOptions.mcpServers: per-query MCP server map field
  - QueryOptions.allowedMcpServerNames: whitelist field for --allowed-mcp-server-names
  - assertMcpOptions: module-scope guard helper in query.ts (MCP-02 + MCP-03)
  - query()/queryRaw() writeConfigDir/cleanupConfigDir lifecycle
  - buildArgv --allowed-mcp-server-names CSV branch

affects:
  - 09-03 (Python mirror: assertMcpOptions guard messages are canonical, Python must match)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "assertMcpOptions: module-scope DRY guard helper called from all 3 query entry points — mirrors session guard pattern"
    - "writeConfigDir/cleanupConfigDir lifecycle: placed symmetrically after writeTempSystemPrompt, before envOverrides, cleaned in finally after unlink"
    - "queryFull guard fires before outputSchema injection block to prevent schema side-effects on bad MCP input"

key-files:
  created:
    - ts/src/mcp/mcpPassthrough.spec.ts
  modified:
    - ts/src/query/types.ts
    - ts/src/query/buildArgv.ts
    - ts/src/query/buildArgv.spec.ts
    - ts/src/query/query.ts
    - ts/src/query/query.spec.ts

key-decisions:
  - "assertMcpOptions placed at module scope (not inline) — DRY deduplication across query/queryRaw/queryFull, mirrors writeTempSystemPrompt placement pattern"
  - "queryFull calls assertMcpOptions at function top before outputSchema injection block — guard fires without schema injection side-effects"
  - "Empty mcpServers ({}) returns immediately from assertMcpOptions — no guard, no temp dir, no flag; matches CONTEXT decision"
  - "cleanupConfigDir uses await in finally block (not .catch) — safe because cleanupConfigDir never re-throws (Plan 01 design)"
  - "MCP-02 guard message includes literal 'MCP-02' and 'GEMINI_CONFIG_DIR' — Plan 03 Python mirror must match for test parity"
  - "MCP-03 guard message includes 'allowedMcpServerNames' and 'MCP-03' — Plan 03 Python mirror must match"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-04]

# Metrics
duration: 3min
completed: 2026-04-20
---

# Phase 9 Plan 02: Query.ts MCP Wiring Summary

**Extended QueryOptions with mcpServers + allowedMcpServerNames @experimental fields; buildArgv emits --allowed-mcp-server-names CSV; assertMcpOptions DRY helper guards all 3 query entry points (MCP-02 collision, MCP-03 missing whitelist); writeConfigDir/cleanupConfigDir wired symmetrically in query() + queryRaw() finally blocks; 12 new tests including MCP-02 mtime-invariant spec**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-20T23:51:11Z
- **Completed:** 2026-04-20T23:54:49Z
- **Tasks:** 2
- **Files modified:** 5 modified + 1 created

## Accomplishments

- QueryOptions gains `mcpServers?: Record<string, Record<string, unknown>>` and `allowedMcpServerNames?: string[]` with `@experimental` JSDoc (MCP-01, MCP-03)
- buildArgv emits `--allowed-mcp-server-names <csv>` following `--allowed-tools` template exactly; no `mcpServers` reference in buildArgv source
- `assertMcpOptions` DRY helper at module scope (line 54) called from all 3 entry points (lines 134, 322, 405)
- writeConfigDir/cleanupConfigDir lifecycle wired symmetrically in query() (lines 154, 292) and queryRaw() (lines 341, 389)
- queryFull guard fires at line 405 before outputSchema injection block (line ~420)
- 12 new tests: 5 buildArgv + 6 query.spec + 1 mcpPassthrough.spec (mtime-invariant) — all pass
- Full TS test suite: 241/241 pass; typecheck clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend QueryOptions + buildArgv with MCP fields + tests** - `2d15275` (feat)
2. **Task 2: query()/queryRaw()/queryFull() guards + config dir lifecycle + mtime-invariant test** - `5e0faae` (feat)

## Files Created/Modified

- `ts/src/query/types.ts` — Added `mcpServers` + `allowedMcpServerNames` @experimental fields after `outputSchema`
- `ts/src/query/buildArgv.ts` — Added MCP-03 `--allowed-mcp-server-names` CSV branch after `--approval-mode`
- `ts/src/query/buildArgv.spec.ts` — Added 5 tests in `describe('buildArgv: --allowed-mcp-server-names (MCP-03)')`
- `ts/src/query/query.ts` — Added `assertMcpOptions` helper (lines 54-75), import (line 39), 3 callsites, writeConfigDir/cleanupConfigDir lifecycle in query() and queryRaw()
- `ts/src/query/query.spec.ts` — Added 6 tests in `describe('Phase 9: MCP passthrough guards (MCP-02, MCP-03)')`
- `ts/src/mcp/mcpPassthrough.spec.ts` — New file: MCP-02 mtime-invariant test using mock spawn

## Key Line Numbers in query.ts

| Construct | Line |
|-----------|------|
| `import { writeConfigDir, cleanupConfigDir }` | 39 |
| `function assertMcpOptions` (definition) | 54 |
| `assertMcpOptions(options)` in query() | 134 |
| `mcpConfigDir = await writeConfigDir(...)` in query() | 154 |
| `await cleanupConfigDir(mcpConfigDir)` in query() finally | 292 |
| `assertMcpOptions(options)` in queryRaw() | 322 |
| `mcpConfigDir = await writeConfigDir(...)` in queryRaw() | 341 |
| `await cleanupConfigDir(mcpConfigDir)` in queryRaw() finally | 389 |
| `assertMcpOptions(options)` in queryFull() | 405 |

## Exact Guard Error Messages (Plan 03 Python Mirror Must Match)

**MCP-02 collision guard:**
```
Cannot set env.GEMINI_CONFIG_DIR when mcpServers is provided; SDK manages this variable for isolation (MCP-02). See docs/mcp.md.
```

**MCP-03 required-whitelist guard:**
```
allowedMcpServerNames is required when mcpServers is set (MCP-03). gemini-cli silently ignores servers not in this whitelist. See docs/mcp.md.
```

## Test Counts Added

| File | New Tests |
|------|-----------|
| `ts/src/query/buildArgv.spec.ts` | 5 |
| `ts/src/query/query.spec.ts` | 6 |
| `ts/src/mcp/mcpPassthrough.spec.ts` | 1 |
| **Total** | **12** |

## Decisions Made

- `assertMcpOptions` placed at module scope (not inline) — mirrors `writeTempSystemPrompt` placement; DRY deduplication across all 3 entry points
- `queryFull` guard fires before `outputSchema` injection block — prevents schema side-effects on invalid MCP input (caller gets `InvalidPromptError`, not `UnsupportedFeatureError`)
- `cleanupConfigDir` uses `await` in `finally` (not `.catch()`) — safe because Plan 01 guarantees `cleanupConfigDir` never re-throws
- Empty `mcpServers: {}` is truly a no-op: `assertMcpOptions` returns immediately, `writeConfigDir` is never called, no flag emitted
- Comment in `buildArgv.ts` reworded to avoid the word `mcpServers` (acceptance criterion: `grep -c "mcpServers" buildArgv.ts` === 0)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Comment in buildArgv.ts referenced `mcpServers` word causing grep acceptance criterion failure**
- **Found during:** Task 1 (acceptance criteria verification)
- **Issue:** The plan's snippet for the MCP-03 comment said `"whether mcpServers is set"` but the criterion requires `grep -c "mcpServers" ts/src/query/buildArgv.ts` === 0
- **Fix:** Reworded comment to "The MCP server map is consumed by query.ts (config dir lifecycle), not emitted into argv."
- **Files modified:** `ts/src/query/buildArgv.ts`
- **Verification:** grep returns 0

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking)
**Impact on plan:** Trivial wording change; no behavioral change.

## Issues Encountered

None beyond the comment grep criterion — resolved immediately.

## User Setup Required

None.

## Next Phase Readiness

- Plan 03 Python mirror: use exact guard messages above for `InvalidPromptError` equivalents
- `assertMcpOptions` guard logic: check `len(options.mcp_servers or {}) > 0` before guard fires
- Python test parity: 6 guard tests + 1 mtime invariant = 7 tests to mirror (or skip mtime test if `~/.gemini/settings.json` absent)
- No blockers

---
*Phase: 09-mcp-passthrough-isolated-config-dir*
*Completed: 2026-04-20*
