---
phase: 07-session-resume-multi-turn
verified: 2026-04-19T22:27:00Z
status: passed
score: 25/25 must-haves verified
---

# Phase 7: Session Resume + Multi-Turn Verification Report

**Phase Goal:** Ship the Session value object, capture session IDs from the init event, wire --resume, and gate the transcript-prepend fallback on the Phase-1 decision about gemini-cli issue #14180
**Verified:** 2026-04-19T22:27:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Session type exists in TS as Readonly interface with id, model, createdAt fields | VERIFIED | `ts/src/session/Session.ts` contains all three readonly fields + optional transcript |
| 2 | Session type exists in Python as frozen dataclass with id, model, created_at fields | VERIFIED | `python/src/gemini_sdk/session/session.py` has `@dataclass(frozen=True)` with all required fields |
| 3 | normaliseSessionId / normalise_session_id normalises Session or string to id string | VERIFIED | Both implementations present and substantive; covered by 2 tests each |
| 4 | Session type exported from package root barrel (TS and Python) | VERIFIED | `ts/src/index.ts` has `export * from './session/index.js'`; Python `__init__.py` has `from .session import Session, TranscriptEntry, normalise_session_id` |
| 5 | buildArgv with session produces `--resume <id>` BEFORE `-p` | VERIFIED | `ts/src/query/buildArgv.ts` and `python/src/gemini_sdk/query/build_argv.py` both implement the primary path; 6 tests each confirm ordering |
| 6 | buildArgv with GEMINI_SDK_TRANSCRIPT_FALLBACK=1 and transcript present omits --resume, prepends transcript | VERIFIED | Fallback branch in both implementations; 4 tests per language confirm the four cases |
| 7 | query() / query_raw() raise InvalidPromptError for empty/whitespace session id BEFORE spawn | VERIFIED | Guard present at top of both functions in TS and Python; 4 guard tests per language, mockSpawn / mock_pm not called |
| 8 | query() captures sessionId from init SystemChunk; surfaces requestedSessionId/actualSessionId on mismatch only | VERIFIED | Mismatch detection in query() in both languages; 3 mismatch tests per language confirm conditional enrichment |
| 9 | queryFull() / query_full() returns QueryResult with .session / ["session"] populated from init event | VERIFIED | queryFull and query_full both construct Session from initSessionId + initModel; 2 tests per language |
| 10 | QueryResult.sessionId / session_id legacy field preserved equal to session.id | VERIFIED | Both implementations preserve legacy field; explicit test "queryFull preserves legacy sessionId equal to session.id" |
| 11 | GEMINI_SDK_TRANSCRIPT_FALLBACK NOT in EnvBuilder allowlist (never forwarded to subprocess) | VERIFIED | `grep -c "GEMINI_SDK_TRANSCRIPT_FALLBACK" ts/src/process/EnvBuilder.ts` = 0; Python env_builder.py = 0 |
| 12 | ResultChunk gains optional requestedSessionId and actualSessionId fields (TS and Python) | VERIFIED | `ts/src/parser/types.ts` lines 130-131; `python/src/gemini_sdk/parser/types.py` lines 133-134 |
| 13 | Multi-turn integration test: turn 2 response text contains "47" | VERIFIED | Test "multi-turn fixture integration: turn 2 references turn 1 context via 47" passes in both TS and Python suites |
| 14 | TS-Python test name parity preserved at 149:149 | VERIFIED | `bash scripts/diff-test-names.sh` exits 0, reports "149 tests" for both |
| 15 | Session JSON round-trip preserved structural equality | VERIFIED | "JSON round-trip returns structurally-equal Session" tests pass in both languages |
| 16 | Python Session raises FrozenInstanceError on mutation | VERIFIED | `test_frozen_raises_on_mutation` passes |
| 17 | spec/protocol.md §6 documents Session Resume Flow with fixture citations | VERIFIED | Section "Session Resume Flow" present; 9 occurrences of "resume-session-turn"; GEMINI_SDK_TRANSCRIPT_FALLBACK documented |

**Score:** 17/17 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/session/Session.ts` | Session + TranscriptEntry interfaces + normaliseSessionId | VERIFIED | 37 lines; all 3 exports present; readonly fields confirmed |
| `ts/src/session/Session.spec.ts` | 9 it() tests (round-trip, shape, normalise) | VERIFIED | `grep -c "  it("` = 9 |
| `ts/src/session/index.ts` | Barrel: Session type + TranscriptEntry type + normaliseSessionId | VERIFIED | Both re-export lines present |
| `python/src/gemini_sdk/session/session.py` | Frozen dataclass + normalise_session_id | VERIFIED | `@dataclass(frozen=True)` appears twice (TranscriptEntry, Session); normalise_session_id present |
| `python/src/gemini_sdk/session/__init__.py` | Barrel: Session + TranscriptEntry + normalise_session_id | VERIFIED | `from .session import Session, TranscriptEntry, normalise_session_id` present |
| `python/tests/session/__init__.py` | Empty package init for pytest | VERIFIED | File exists |
| `python/tests/session/test_session.py` | 9 parity-matched tests (+ 1 Python-only frozen test = 9 total per parity) | VERIFIED | 9 tests pass; 8 docstrings match TS it() strings |
| `ts/src/parser/types.ts` | ResultChunk extended with requestedSessionId, actualSessionId | VERIFIED | Both optional fields present at lines 130-131 |
| `ts/src/query/types.ts` | QueryOptions.session + QueryResult.session | VERIFIED | `session?: Session | string` and `session: Session` both present; import at top |
| `ts/src/query/buildArgv.ts` | Session branch: primary + fallback | VERIFIED | 74 lines; normaliseSessionId import; GEMINI_SDK_TRANSCRIPT_FALLBACK read once; formatTranscriptPrompt defined and called |
| `ts/src/query/buildArgv.spec.ts` | 39 tests (prior + 10 new session + extended fuzz) | VERIFIED | 39 tests pass |
| `ts/src/query/query.ts` | Guard + mismatch detection + queryFull Session construction | VERIFIED | InvalidPromptError thrown × 2; normaliseSessionId used × 4; requestedSessionId/actualSessionId in enrichment; initSessionId captured |
| `ts/src/query/query.spec.ts` | 27 tests including 10 Phase 7 tests | VERIFIED | All 4 Phase 7 describe blocks present; 27 tests pass |
| `ts/src/query/index.ts` | Re-exports Session, TranscriptEntry, normaliseSessionId | VERIFIED | All three re-export lines present |
| `python/src/gemini_sdk/parser/types.py` | ResultChunk extended with requestedSessionId, actualSessionId | VERIFIED | Both fields at lines 133-134 |
| `python/src/gemini_sdk/query/types.py` | QueryOptions.session + QueryResult.session | VERIFIED | Both present; `from ..session import Session` present |
| `python/src/gemini_sdk/query/build_argv.py` | Session branch (primary + fallback) | VERIFIED | normalise_session_id × 2; GEMINI_SDK_TRANSCRIPT_FALLBACK × 1; _format_transcript_prompt × 2 |
| `python/src/gemini_sdk/query/query.py` | Guard + mismatch detection + query_full Session construction | VERIFIED | InvalidPromptError × 3; normalise_session_id × 4; requestedSessionId/actualSessionId in enrichment; init_session_id × 3; session_obj = Session × 1 |
| `python/src/gemini_sdk/query/__init__.py` | Re-exports Session, TranscriptEntry, normalise_session_id | VERIFIED | Phase 7 re-export line present |
| `python/tests/test_build_argv.py` | 39 tests including 10 new session tests | VERIFIED | TestBuildArgvSessionPrimaryPath + TestBuildArgvTranscriptFallback both present; 39 tests pass |
| `python/tests/test_query.py` | 54 test runs (27 unique × anyio double) including 10 Phase 7 | VERIFIED | All 4 Phase 7 class names present; no ellipsis stubs remain; 54 test runs pass |
| `spec/protocol.md` | §6 Session Resume Flow with fixture citations | VERIFIED | "Session Resume Flow" × 1; "resume-session-turn" × 9; GEMINI_SDK_TRANSCRIPT_FALLBACK × 1 |
| `ts/src/index.ts` | export * from './session/index.js' present | VERIFIED | Present at line 12 |
| `python/src/gemini_sdk/__init__.py` | from .session import Session, TranscriptEntry, normalise_session_id | VERIFIED | Present at line 25; all three in __all__ |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ts/src/index.ts` | `./session/index.js` | `export *` | WIRED | Line 12: `export * from './session/index.js'` |
| `python/src/gemini_sdk/__init__.py` | `.session` | `from .session import` | WIRED | Line 25: `from .session import Session, TranscriptEntry, normalise_session_id` |
| `ts/src/query/buildArgv.ts` | `ts/src/session/Session.ts` | `import { normaliseSessionId }` | WIRED | `import { normaliseSessionId } from '../session/index.js'` present and called |
| `ts/src/query/query.ts` | `ts/src/session/Session.ts` | `import { normaliseSessionId } + Session type` | WIRED | Two import lines from `'../session/index.js'` present; normaliseSessionId called × 4 |
| `ts/src/query/query.ts` | `ts/src/errors/errors.ts` | `throw new InvalidPromptError` | WIRED | `new InvalidPromptError('session id is empty')` × 2 (query + queryRaw) |
| `ts/src/query/buildArgv.ts` | `process.env.GEMINI_SDK_TRANSCRIPT_FALLBACK` | env var read | WIRED | `process.env['GEMINI_SDK_TRANSCRIPT_FALLBACK'] === '1'` at call time |
| `python/src/gemini_sdk/query/build_argv.py` | `python/src/gemini_sdk/session/session.py` | `from ..session import normalise_session_id` | WIRED | Line 20: `from ..session import Session, TranscriptEntry, normalise_session_id` |
| `python/src/gemini_sdk/query/query.py` | `python/src/gemini_sdk/errors/errors.py` | `from ..errors import InvalidPromptError` | WIRED | Line 34: `from ..errors import ErrorMapper, GeminiError, InvalidPromptError` |
| `python/src/gemini_sdk/query/build_argv.py` | `os.environ.GEMINI_SDK_TRANSCRIPT_FALLBACK` | env var read | WIRED | `os.environ.get("GEMINI_SDK_TRANSCRIPT_FALLBACK") == "1"` at call time |
| `spec/protocol.md` | `spec/fixtures/resume-session-turn*.ndjson` | citation | WIRED | 9 occurrences of "resume-session-turn"; both turn1 and turn2 cited |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SES-01 | 07-02, 07-03 | SDK captures session ID from the stream-json init event | SATISFIED | query()/queryFull()/query_full() capture initSessionId from SystemChunk.subtype=='init'; guard rejects empty ids before spawn; 4 tests per language |
| SES-02 | 07-02, 07-03 | SDK resumes a session by passing --resume \<id\> when resumeSessionId is provided | SATISFIED | buildArgv / build_argv primary path inserts ['--resume', id] before '-p'; 6 placement tests per language; multi-turn integration test proves context recall |
| SES-03 | 07-01 | SDK provides a Session value object (immutable, identifier-based; NOT process-bound) | SATISFIED | TS Readonly interface + Python frozen dataclass; JSON round-trip tests pass; FrozenInstanceError test passes; exported from package roots |
| SES-04 | 07-02, 07-03 | SDK includes transcript-prepend fallback gated on GEMINI_SDK_TRANSCRIPT_FALLBACK env var | SATISFIED | Fallback branch in buildArgv/build_argv; GEMINI_SDK_TRANSCRIPT_FALLBACK NOT in EnvBuilder allowlist; 4 fallback tests per language cover all activation conditions |

All 4 Phase 7 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

No blockers or warnings found.

| File | Pattern checked | Result |
|------|-----------------|--------|
| `ts/src/query/query.ts` | Stub returns, TODO comments | None — full implementation present |
| `python/tests/test_query.py` | Ellipsis (`...`) placeholder test bodies | None — `grep '\\.\\.\\.'` returns 0 |
| `ts/src/session/Session.ts` | PLACEHOLDER, return null | None |
| `python/src/gemini_sdk/query/query.py` | Empty handlers | None |
| `ts/src/query/buildArgv.ts` | env var in comment inflating grep count | Handled: GEMINI_SDK_TRANSCRIPT_FALLBACK appears exactly 1× (code only; comment uses different phrasing) |

---

### Human Verification Required

None. All assertions are programmatically verifiable via the test suites. The multi-turn fixture integration test (using real NDJSON fixtures) provides the strongest evidence for SC-1 without requiring a live gemini-cli subprocess.

---

## Test Suite Results

| Suite | Command | Result | Count |
|-------|---------|--------|-------|
| TS full suite | `cd ts && pnpm test` | PASS | 164 tests |
| Python session | `cd python && uv run pytest tests/session/` | PASS | 9 tests |
| Python build_argv | `cd python && uv run pytest tests/test_build_argv.py` | PASS | 39 tests |
| Python query | `cd python && uv run pytest tests/test_query.py` | PASS | 54 test runs (27 unique) |
| Parity | `bash scripts/diff-test-names.sh` | PASS | 149:149 |

---

## Phase Goal Verification

The phase goal has four components. Each is verified:

1. **"Ship the Session value object"** — `ts/src/session/Session.ts` (Readonly interface) and `python/src/gemini_sdk/session/session.py` (@dataclass frozen=True) exist, are substantive, are exported from both package roots, and pass 9 tests each (JSON round-trip, normaliser, shape, frozen contract).

2. **"Capture session IDs from the init event"** — `queryFull()` and `query_full()` both extract `initSessionId` from the SystemChunk with subtype='init' and populate `QueryResult.session.id`. Verified by tests "queryFull returns QueryResult with session field populated from init event" in both languages.

3. **"Wire --resume"** — `buildArgv()` and `build_argv()` both insert `['--resume', id]` before `-p` when `options.session` is provided. Verified by 6 primary-path tests per language and the multi-turn integration test that proves context recall via the "47" assertion.

4. **"Gate the transcript-prepend fallback on the Phase-1 decision about gemini-cli issue #14180"** — The fallback is dark-shipped behind `GEMINI_SDK_TRANSCRIPT_FALLBACK=1` (NOT in QueryOptions, NOT in EnvBuilder allowlist). The env var is read at call time only inside `buildArgv`/`build_argv`. Four tests per language confirm all activation conditions. `GEMINI_SDK_TRANSCRIPT_FALLBACK` does not appear in `EnvBuilder.ts` or `env_builder.py`.

---

_Verified: 2026-04-19T22:27:00Z_
_Verifier: Claude (gsd-verifier)_
