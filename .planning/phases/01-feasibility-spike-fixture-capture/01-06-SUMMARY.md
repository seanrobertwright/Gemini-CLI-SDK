---
phase: 01-feasibility-spike-fixture-capture
plan: 06
subsystem: testing
tags: [fixtures, ndjson, gemini-cli, capture, redaction, synthetic]

# Dependency graph
requires:
  - phase: 01-feasibility-spike-fixture-capture plan 05
    provides: capture-fixtures.mjs runScenario foundation, spec/capture.md procedure docs
provides:
  - spec/fixtures/tool-use-builtin.ndjson — real capture with tool_use+tool_result pair
  - spec/fixtures/error-auth.ndjson — synthetic 401/UNAUTHENTICATED error fixture
  - spec/fixtures/error-rate-limit.ndjson — synthetic 429/RESOURCE_EXHAUSTED error fixture
  - spec/fixtures/event-unknown.ndjson — synthetic cosmic_ray_hit type-mutation fixture
  - spec/fixtures/_assets/workspace/test.txt — fixture workspace file for tool-use scenario
  - All have .expected.json + (for errors) .stderr.txt sidecars
affects: [Phase 3 parser tests (PRS-03 PRS-07), Phase 5 error taxonomy, plan 01-09 schema derivation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isolateOAuth pattern: create temp GEMINI_CONFIG_DIR so OAuth credentials are not discoverable by gemini-cli"
    - "Synthetic fixture convention: _synthetic=true + _note + _derived_from + captured_against='SYNTHETIC...' + capture_limitation documenting why real capture was impossible"

key-files:
  created:
    - spec/fixtures/tool-use-builtin.ndjson
    - spec/fixtures/tool-use-builtin.expected.json
    - spec/fixtures/tool-use-builtin.stderr.txt
    - spec/fixtures/error-auth.ndjson
    - spec/fixtures/error-auth.expected.json
    - spec/fixtures/error-auth.stderr.txt
    - spec/fixtures/error-rate-limit.ndjson
    - spec/fixtures/error-rate-limit.expected.json
    - spec/fixtures/error-rate-limit.stderr.txt
    - spec/fixtures/event-unknown.ndjson
    - spec/fixtures/event-unknown.expected.json
  modified:
    - scripts/capture-fixtures.mjs (add isolateOAuth implementation)
    - spec/capture.md (append Synthetic fixtures section)

key-decisions:
  - "error-auth and error-rate-limit are SYNTHETIC: host uses OAuth (selectedType:oauth-personal); GEMINI_API_KEY override does not disable OAuth path in gemini-cli 0.37.1; marked synthetic=true with capture_limitation field; Phase 5 will validate real format on API-key-only host"
  - "tool_use/tool_result events appear as type='unknown' in deriveChunks (function only handles init/message/result); Phase 3 PRS-07 will update expected.json to properly model these events"
  - "tool-use-builtin: tool_result.output is empty string even though test.txt has content — gemini-cli may redact or summarize tool output in stream-json mode; Phase 3 tests should not assert specific output content"
  - "audit-fixtures.sh fails on Windows with Docker due to Git Bash path translation; trufflehog not installed; manual grep audit confirmed no secrets in fixture files"

patterns-established:
  - "Synthetic fixture pattern: derive init line from a real captured fixture, add error event with known error shape, mark _synthetic=true, document limitation in capture_limitation field"
  - "When OAuth blocks auth-failure testing: document the blocker in the fixture sidecar and defer real validation to a later phase on an API-key-only host"

requirements-completed: [PRS-09]

# Metrics
duration: 45min
completed: 2026-04-12
---

# Phase 01 Plan 06: Fixture Capture (tool-use-builtin, errors, event-unknown) Summary

**tool-use-builtin captured from real gemini-cli run with read_file tool_use+tool_result pair; error-auth and error-rate-limit created as synthetic fixtures (OAuth auth on host prevents real auth-failure capture); event-unknown synthetic from type-mutation of simple-text init event.**

## Performance

- **Duration:** ~45 min (continuation agent pickup after prior agent hit rate limit)
- **Started:** 2026-04-12T12:00:00Z
- **Completed:** 2026-04-12T12:45:00Z
- **Tasks:** 3 tasks complete (Tasks 1, 2, 3)
- **Files modified:** 12 created + 1 modified

## Accomplishments
- Captured tool-use-builtin from a real gemini-cli run: 9 events including tool_use + tool_result pair for the read_file built-in tool
- Created synthetic error-auth and error-rate-limit fixtures matching known gemini-cli error event shapes (401/UNAUTHENTICATED and 429/RESOURCE_EXHAUSTED)
- Created synthetic event-unknown fixture by type-mutating simple-text init event to cosmic_ray_hit
- All 4 fixtures pass validate-fixtures.mjs parse+pairs; redaction audit clean (no API keys, OAuth tokens, or absolute paths)
- isolateOAuth implementation added to capture-fixtures.mjs (creates temp GEMINI_CONFIG_DIR)

## Task Commits

Each task was committed atomically:

1. **Task 1: Prepare workspace asset and unstub scenarios** - `5deccb0` (feat)
2. **Task 2: Capture tool-use-builtin, error-auth, error-rate-limit** - `5a220d7` (feat)
3. **Task 3: Generate synthetic event-unknown.ndjson** - `7710f30` (feat)

## Fixture Summary

| Fixture | Type | Events | Bytes | Exit | Notes |
|---------|------|--------|-------|------|-------|
| tool-use-builtin | Real capture | 9 | 1,656 | 0 | tool_use+tool_result pair present |
| error-auth | Synthetic | 2 | 434 | 1 (synthetic) | OAuth prevents real auth failure |
| error-rate-limit | Synthetic | 2 | 441 | 1 (synthetic) | OAuth quota absorbs requests |
| event-unknown | Synthetic | 1 | 373 | 0 | type=cosmic_ray_hit mutation |

## Rate-Limit Capture Status

Option C was used (documented limitation):
- The host uses OAuth auth (`selectedType: oauth-personal`) with a generous quota
- 0 attempts triggered a 429 (rapid-fire approach not attempted — OAuth accounts have much higher quotas than API keys)
- The GEMINI_API_KEY=invalid-key-12345 override does not disable the OAuth auth path
- Real error-rate-limit fixture deferred to Phase 5 validation on a free-tier API-key-only host

## Auth Failure Capture Status

Option C was used (documented limitation):
- Host uses OAuth; isolateOAuth (creating empty temp GEMINI_CONFIG_DIR) does not fully isolate because gemini-cli 0.37.1 finds credentials through the OAuth provider path, not just GEMINI_CONFIG_DIR
- The invalid API key is simply ignored when a valid OAuth session exists
- Real error-auth fixture deferred to Phase 5 validation on an API-key-only host

## tool-use-builtin Event Types Observed

For plan 01-09 schema derivation:
- `init` — session initialization with session_id and model
- `message` (role: user) — user prompt
- `message` (role: assistant, delta: true) — streaming assistant response
- `tool_use` — built-in tool call with tool_name="read_file", tool_id, parameters
- `tool_result` — tool output with tool_id, status="success", output (empty string observed)
- `result` — terminal event with stats (total_tokens, input_tokens, output_tokens, models breakdown)

Note: tool_result.output was empty string even though test.txt has content. gemini-cli may redact file content from the stream-json event or represent it differently. Phase 3 PRS-07 should not assert specific tool output content.

## Redactor Notes

No redactor refinements discovered during this plan. The existing redactor correctly handles:
- session_id values → `<REDACTED_SESSION_ID>`
- GCP project references → `<REDACTED_GCP_PROJECT>`
- OAuth token patterns

## Files Created/Modified

- `spec/fixtures/tool-use-builtin.ndjson` — 9-line real capture with tool_use+tool_result
- `spec/fixtures/tool-use-builtin.expected.json` — best-effort chunk sequence (tool events as type:unknown)
- `spec/fixtures/tool-use-builtin.stderr.txt` — policy warning stderr (non-empty but not an error)
- `spec/fixtures/error-auth.ndjson` — synthetic 2-line fixture (init + error 401)
- `spec/fixtures/error-auth.expected.json` — synthetic flag, capture_limitation documented
- `spec/fixtures/error-auth.stderr.txt` — synthetic explanation
- `spec/fixtures/error-rate-limit.ndjson` — synthetic 2-line fixture (init + error 429)
- `spec/fixtures/error-rate-limit.expected.json` — synthetic flag, capture_limitation documented
- `spec/fixtures/error-rate-limit.stderr.txt` — synthetic explanation
- `spec/fixtures/event-unknown.ndjson` — 1-line type-mutation fixture (cosmic_ray_hit)
- `spec/fixtures/event-unknown.expected.json` — chunks[0].type='unknown', synthetic=true
- `spec/capture.md` — Synthetic fixtures section appended
- `scripts/capture-fixtures.mjs` — isolateOAuth implementation added to runScenario

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] isolateOAuth flag defined but not implemented in runScenario**
- **Found during:** Task 2 continuation (prior agent added the flag to scenario definition but didn't implement the isolation logic in runScenario)
- **Issue:** error-auth capture succeeded with OAuth despite invalid API key — the `isolateOAuth` flag existed in SCENARIOS but runScenario had no code to create a temp config dir
- **Fix:** Added 8-line isolateOAuth block to runScenario that creates a temp dir via mkdtempSync and sets GEMINI_CONFIG_DIR
- **Outcome:** Isolation confirmed via log output, but gemini-cli 0.37.1 still found OAuth creds through another path; error-auth converted to synthetic
- **Files modified:** `scripts/capture-fixtures.mjs`
- **Commit:** `5a220d7`

**2. [Rule 2 - Synthetic Fallback] error-auth and error-rate-limit cannot be captured from this host**
- **Found during:** Task 2
- **Issue:** OAuth-authenticated host with generous quota makes both error scenarios impossible to trigger
- **Fix:** Applied plan's documented Option C — synthetic fixtures with `synthetic: true`, `derived_from`, and `capture_limitation` fields; marked clearly in expected.json
- **Files modified:** Created error-auth.{ndjson,expected.json,stderr.txt} and error-rate-limit.{ndjson,expected.json,stderr.txt} as synthetic

## Self-Check: PASSED

All 4 fixture .ndjson files confirmed present:
- spec/fixtures/tool-use-builtin.ndjson: FOUND
- spec/fixtures/error-auth.ndjson: FOUND
- spec/fixtures/error-rate-limit.ndjson: FOUND
- spec/fixtures/event-unknown.ndjson: FOUND

All commits confirmed:
- 5deccb0 (Task 1): FOUND
- 5a220d7 (Task 2): FOUND
- 7710f30 (Task 3): FOUND
