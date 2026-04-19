---
phase: 06-auth-environment
plan: "01"
subsystem: auth
tags: [typescript, vitest, pure-function, env-detection, auth-mode]

# Dependency graph
requires:
  - phase: 02-process-foundation
    provides: buildEnv() pure function with allowlisted env passthrough
  - phase: 05-error-taxonomy-archon-5-bucket-mapping
    provides: GeminiError subclass vocabulary for auth errors
provides:
  - resolveAuth() pure TS function with AUTH_PRECEDENCE constant and AuthMode/ResolvedAuth types
  - ts/src/auth/ barrel exporting resolveAuth for Phase 10 Archon adapter consumption
  - 8-test vitest suite covering all 4 auth modes + multi-mode warning + GCP passthrough
affects: [06-auth-environment-02, 06-auth-environment-03, 10-archon-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pure-function auth detection (no I/O, no imports, parameter-only env access)
    - AUTH_PRECEDENCE constant as single source of truth referenced by both impl and spec
    - vi.stubEnv isolation pattern (beforeEach stub-to-empty, afterEach unstubAllEnvs)

key-files:
  created:
    - ts/src/auth/resolveAuth.ts
    - ts/src/auth/index.ts
    - ts/src/auth/resolveAuth.spec.ts
  modified:
    - ts/src/index.ts

key-decisions:
  - "resolveAuth test assertions use toBeFalsy() (not toBeUndefined()) for auth keys stubbed to '' in beforeEach — vi.stubEnv to empty string means buildEnv returns '' not undefined"
  - "mode: 'none' kept in AuthMode union but documented as unreachable via current API (no ADC probe, no opt-out option); reserved for future explicit opt-out"
  - "envOverrides is empty object — resolveAuth is DIAGNOSIS not MUTATION; env vars already flow through buildEnv allowlist unchanged"

patterns-established:
  - "Pattern: AUTH_PRECEDENCE constant referenced by both implementation (warning template) and tests (assertion string) — single source of truth per RESEARCH Pitfall 3"
  - "Pattern: vi.stubEnv stub-to-empty-string in beforeEach for all auth keys to isolate from developer host environment"

requirements-completed: [AUT-01, AUT-02, AUT-03, AUT-04, AUT-06]

# Metrics
duration: 3min
completed: 2026-04-19
---

# Phase 6 Plan 01: Auth Environment Summary

**TypeScript resolveAuth() pure function with AUTH_PRECEDENCE constant, detecting GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC from env with multi-mode warning emission**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-19T23:32:34Z
- **Completed:** 2026-04-19T23:35:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Implemented `resolveAuth()` as a pure function with zero imports — inspects caller-supplied env dict, not `process.env` directly
- Exported `AUTH_PRECEDENCE` constant as single source of truth for the chain order, referenced by both impl (warning template) and spec (assertion)
- Created `ts/src/auth/index.ts` barrel and wired `export * from './auth/index.js'` into `ts/src/index.ts` for Phase 10 Archon adapter access
- 8 vitest tests covering all 4 modes (AUT-01/02/03/05), multi-mode warnings (AUT-06), GCP var passthrough (AUT-04), and constant equality

## Task Commits

Each task was committed atomically:

1. **Task 1: Create resolveAuth.ts + barrel** - `2313981` (feat)
2. **Task 2: Create resolveAuth.spec.ts covering AUT-01..06** - `1e124c5` (test)

**Plan metadata:** (docs commit - see below)

## Files Created/Modified
- `ts/src/auth/resolveAuth.ts` - Pure function + AUTH_PRECEDENCE constant + AuthMode/ResolvedAuth types (zero imports)
- `ts/src/auth/index.ts` - Barrel re-exporting resolveAuth, AUTH_PRECEDENCE, AuthMode, ResolvedAuth
- `ts/src/auth/resolveAuth.spec.ts` - 8 vitest tests covering all 4 modes, warnings, GCP passthrough
- `ts/src/index.ts` - Added `export * from './auth/index.js'` (Phase 6 auth line)

## Decisions Made
- **toBeFalsy() instead of toBeUndefined() for negative buildEnv checks:** When `vi.stubEnv(key, '')` stubs keys to empty string in `beforeEach`, `buildEnv` includes those keys with value `''` (since it checks `!== undefined`). The assertions were changed to `toBeFalsy()` to correctly capture "not meaningfully set" semantics.
- **`mode: 'none'` kept unreachable:** RESEARCH Open Question #1 recommends keeping `'none'` in the union for future explicit opt-out (e.g. `options.auth='off'`); today it is unreachable since ADC probe is out of scope. JSDoc comment added.
- **envOverrides always empty:** RESEARCH "Anti-Patterns to Avoid" — do not duplicate existing env vars in overrides; they already flow through `buildEnv`'s allowlist unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertion: toBeUndefined() → toBeFalsy() for keys stubbed to empty string**
- **Found during:** Task 2 (resolveAuth.spec.ts first run)
- **Issue:** `vi.stubEnv(key, '')` stubs to `''`, and `buildEnv` includes keys where value `!== undefined`, so `''` is returned not `undefined`. Three tests failed with `expected '' to be undefined`.
- **Fix:** Changed 6 assertions (2 per AUT-01/02/03) from `.toBeUndefined()` to `.toBeFalsy()` with explanatory comment.
- **Files modified:** ts/src/auth/resolveAuth.spec.ts
- **Verification:** All 8 tests pass after fix.
- **Committed in:** `1e124c5` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test assertion bug)
**Impact on plan:** Essential fix — assertion semantics were wrong for the stubbing strategy used. No scope creep.

## Issues Encountered
- Nested JSDoc `/** ... */` inside outer `/** ... */` comment caused TypeScript parse error on line 14 (TS1109 + TS1161). Fixed by moving the `mode: 'none'` description to a regular `//` comment above the type alias.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `resolveAuth()` + `AUTH_PRECEDENCE` exported from top-level `ts/src/index.ts` — ready for Phase 10 Archon adapter import
- Plan 06-02 can mirror this implementation in Python (Python auth files were pre-committed alongside this plan as a side-effect of git staging)
- Plan 06-03 wires `resolveAuth()` into `query()` using the established pure-compose chain pattern
- Deferred: `mode: 'none'` reachability (Open Question #1 from RESEARCH) — needs explicit `options.auth='off'` API decision before Phase 10

---
*Phase: 06-auth-environment*
*Completed: 2026-04-19*
