---
phase: 09-mcp-passthrough-isolated-config-dir
plan: "01"
subsystem: mcp
tags: [mcp, typescript, node-fs, vitest, tdd, temp-files, cleanup]

# Dependency graph
requires:
  - phase: 08-tools-approval-mode-structured-output-best-effort
    provides: writeTempSystemPrompt pattern in query.ts (lines 44-63) that writeConfigDir mirrors exactly

provides:
  - writeConfigDir: per-query isolated GEMINI_CONFIG_DIR creator; returns absolute temp dir path
  - cleanupConfigDir: retry-resilient temp dir cleanup that never re-throws (#13604 mitigation)
  - ts/src/mcp/index.ts barrel exporting both primitives

affects:
  - 09-02 (query.ts wiring: imports writeConfigDir + cleanupConfigDir from ts/src/mcp/index.js)
  - 09-03 (Python mirrors)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "writeConfigDir mirrors writeTempSystemPrompt: randomBytes(8).toString('hex') suffix, gemini-sdk-mcp- prefix, returns absolute path"
    - "cleanupConfigDir: fs.rm with {recursive:true, force:true, maxRetries:3, retryDelay:200} + console.warn-on-failure (never re-throw)"
    - "vi.mock + vi.hoisted + realRmHolder pattern for capturing actual rm from importOriginal without circular call stack"

key-files:
  created:
    - ts/src/mcp/writeConfigDir.ts
    - ts/src/mcp/writeConfigDir.spec.ts
    - ts/src/mcp/cleanupConfigDir.ts
    - ts/src/mcp/cleanupConfigDir.spec.ts
    - ts/src/mcp/index.ts
  modified: []

key-decisions:
  - "Prefix gemini-sdk-mcp- (consistent with existing gemini-sdk-system- in writeTempSystemPrompt)"
  - "8-byte randomBytes hex suffix (16 chars) for unique dir names with recognizable prefix in diagnostics"
  - "No .gemini/ subdirectory — Phase 9 research spike confirmed GEMINI_CONFIG_DIR/settings.json is the direct path (not GEMINI_CONFIG_DIR/.gemini/settings.json)"
  - "Single settings.json key: {mcpServers: verbatim} only — no other keys to avoid fighting Phase 6 auth resolution"
  - "cleanupConfigDir never re-throws: leaked temp dir is recoverable; masking original error in finally block is not"
  - "Test mock strategy: vi.hoisted + realRmHolder captures actual rm from importOriginal to avoid circular call stack in default-delegate beforeEach"

patterns-established:
  - "MCP module at ts/src/mcp/ with colocated .spec.ts files — matches all prior module conventions"
  - "Internal barrel (ts/src/mcp/index.ts) with no public re-exports — Plan 02 query.ts imports directly from barrel"

requirements-completed: [MCP-01, MCP-04]

# Metrics
duration: 2min
completed: 2026-04-20
---

# Phase 9 Plan 01: MCP Isolated Config Dir Primitives Summary

**writeConfigDir (8-byte hex suffix, gemini-sdk-mcp- prefix, settings.json with {mcpServers} only) and cleanupConfigDir (fs.rm maxRetries:3 retryDelay:200, warn-not-throw) as isolated unit-testable modules mirroring the writeTempSystemPrompt pattern**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-20T23:46:56Z
- **Completed:** 2026-04-20T23:49:20Z
- **Tasks:** 2
- **Files modified:** 5 (all new)

## Accomplishments

- writeConfigDir creates a uniquely-named temp dir with `settings.json` containing only `{mcpServers: verbatim}` — no `.gemini/` subdir per Phase 9 research spike verdict
- cleanupConfigDir uses Node's native `fs.rm` retry knobs (`maxRetries:3, retryDelay:200`) as the #13604 Windows EBUSY mitigation; catches-and-warns, never re-throws
- Internal barrel `ts/src/mcp/index.ts` ready for Plan 02's mechanical plug-in into `query.ts`
- 9 unit tests pass (5 writeConfigDir + 4 cleanupConfigDir); typecheck clean

## Task Commits

Each task was committed atomically:

1. **Task 1: writeConfigDir helper + unit tests** - `8fedaf1` (feat)
2. **Task 2: cleanupConfigDir helper + unit tests + barrel** - `b989080` (feat)

_Note: TDD tasks have single commits (test + implementation landed together after GREEN)_

## Files Created/Modified

- `ts/src/mcp/writeConfigDir.ts` - Async helper: randomBytes(8) hex suffix, gemini-sdk-mcp- prefix, writes settings.json at dir root
- `ts/src/mcp/writeConfigDir.spec.ts` - 5 tests: content integrity, absolute path, uniqueness, empty map, nested pass-through
- `ts/src/mcp/cleanupConfigDir.ts` - fs.rm with maxRetries:3/retryDelay:200; catch block emits console.warn with stranded path, never re-throws
- `ts/src/mcp/cleanupConfigDir.spec.ts` - 4 tests: real rm, missing-path tolerance, warn-and-continue (mocked), static maxRetries/retryDelay guard
- `ts/src/mcp/index.ts` - Internal barrel re-exporting both functions

## Decisions Made

- Prefix `gemini-sdk-mcp-` mirrors existing `gemini-sdk-system-` for diagnostic consistency
- 8-byte (16 hex char) suffix provides 64-bit entropy — sufficient for per-query isolation; matches `writeTempSystemPrompt` exactly
- No `.gemini/` subdir: Phase 9 research spike confirmed `$GEMINI_CONFIG_DIR/settings.json` is the direct read path, not `$GEMINI_CONFIG_DIR/.gemini/settings.json`
- `{mcpServers: verbatim}` only in settings.json — adding other keys would fight Phase 6 auth resolution and argv-driven channels
- `cleanupConfigDir` catch block: `console.warn(message, err)` two-arg form so both the human-readable path context and the raw error object reach the console; never re-throws per RESEARCH Pattern 2

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed circular call stack in cleanupConfigDir spec mock setup**
- **Found during:** Task 2 (cleanupConfigDir tests, first GREEN attempt)
- **Issue:** The `beforeEach` default-delegate used `fsp.rm(...)` directly inside `mockRm.mockImplementation` — but `fsp.rm` IS the mock, causing infinite recursion until stack overflow
- **Fix:** Used `vi.hoisted` to create a `realRmHolder` object; populated it inside the `vi.mock` factory's `importOriginal` call (which receives the actual module before mocking); `beforeEach` delegates to `realRmHolder.rm` instead of `fsp.rm`
- **Files modified:** `ts/src/mcp/cleanupConfigDir.spec.ts`
- **Verification:** 4 tests pass cleanly with no stack overflow
- **Committed in:** `b989080` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary for correct test mock wiring. No scope creep.

## Issues Encountered

- vitest mock circular recursion when delegating to real `fsp.rm` from inside `mockRm.mockImplementation` — resolved by capturing the actual `rm` reference in `vi.mock importOriginal` before the mock wraps it

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ts/src/mcp/writeConfigDir` and `cleanupConfigDir` are ready for Plan 02's mechanical plug-in into `query.ts`
- Plan 02 imports from `ts/src/mcp/index.js` (barrel): `import { writeConfigDir, cleanupConfigDir } from '../mcp/index.js'`
- Integration points: `writeConfigDir(options.mcpServers)` before spawn, `cleanupConfigDir(mcpConfigDir)` in `finally` block alongside existing `unlink(tempPath)` cleanup
- No blockers

---
*Phase: 09-mcp-passthrough-isolated-config-dir*
*Completed: 2026-04-20*
