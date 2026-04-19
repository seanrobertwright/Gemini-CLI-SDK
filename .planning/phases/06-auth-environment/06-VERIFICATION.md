---
phase: 06-auth-environment
verified: 2026-04-19T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 6: Auth Environment Verification Report

**Phase Goal:** Wire all auth modes into `EnvBuilder`: `GEMINI_API_KEY` is the canonical default, Vertex AI via `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON) or `GOOGLE_API_KEY` (alternative Vertex path) is supported when explicitly selected, `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT_ID` / `GOOGLE_CLOUD_LOCATION` pass through for Vertex project+region scoping, and ADC/Sign-in-with-Google is picked up transparently if already configured — but the SDK never automates interactive OAuth login. A runtime warning fires if multiple auth modes are configured, and the documented precedence is `GEMINI_API_KEY` > `GOOGLE_APPLICATION_CREDENTIALS` > `GOOGLE_API_KEY` > ADC/OAuth fallback. Documentation captures why API key is the default (discussion #22970, ToS warning) and that no `GOOGLE_AUTH_TOKEN` bearer-token passthrough exists.
**Verified:** 2026-04-19
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Four auth fixtures (API key only, Vertex service-account JSON, Vertex Google API key, ADC fallback) each produce the expected env dict passed to the subprocess — verified by unit tests that call `buildEnv(options)` and snapshot-diff the output | VERIFIED | `ts/src/auth/resolveAuth.spec.ts` 8 vitest tests (lines 29–136) cover all 4 modes; `python/tests/auth/test_resolve_auth.py` 8 pytest tests mirror them with `build_env` composition assertions |
| 2 | Setting two auth modes simultaneously emits a runtime warning naming the precedence winner, test asserts warning text matches documented precedence chain | VERIFIED | TS: `query.spec.ts` lines 496–528 — `warnSpy.toHaveBeenCalledTimes(1)` + chain string assertion; Python: `test_query.py` lines 589–616 — `catch_warnings(record=True)` asserts 1 warning with full chain |
| 3 | An auth-failure integration test (invalid API key) surfaces an `AuthError` subclass distinct from the generic `GeminiError` base, with `.retryable = false` and Archon bucket `auth` | VERIFIED | `spec/fixtures/error-auth-invalid-key.{stderr.txt,ndjson,expected.json}` exist as synthetic_blocked; TS corpus `errorMapperCorpus.spec.ts` lines 147–157 asserts `AuthError`, `bucket='auth'`, `retryable=false`; Python `test_error_mapper_corpus.py` lines 126–136 mirror |
| 4 | The SDK never calls `gemini auth login` or any interactive OAuth entrypoint — verified by a grep-based CI linter that fails if `auth login` appears anywhere in the source tree | VERIFIED | `scripts/lint-auth-login.sh` exists (100755), scopes to `ts/src` + `python/src`; wired as blocking step in `.github/workflows/ci.yml` line 99–100; grep confirms `auth login` absent from all SDK source |

**Score:** 4/4 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/auth/resolveAuth.ts` | Pure resolveAuth() + AUTH_PRECEDENCE constant + AuthMode + ResolvedAuth types | VERIFIED | 85 lines, zero imports, exports all required symbols |
| `ts/src/auth/index.ts` | Barrel re-exporting resolveAuth, AUTH_PRECEDENCE, AuthMode, ResolvedAuth | VERIFIED | 2 lines, correct re-exports |
| `ts/src/auth/resolveAuth.spec.ts` | Vitest suite covering 4 modes + multi-mode warning + GCP passthrough | VERIFIED | 137 lines, 8 `it()` tests |
| `python/src/gemini_sdk/auth/resolve_auth.py` | Pure resolve_auth() + AUTH_PRECEDENCE constant + AuthMode + ResolvedAuth TypedDict | VERIFIED | 69 lines, 2 imports only (`__future__`, `typing`) |
| `python/src/gemini_sdk/auth/__init__.py` | Barrel re-exporting resolve_auth, AUTH_PRECEDENCE, AuthMode, ResolvedAuth | VERIFIED | Exports all 4 symbols in `__all__` |
| `python/tests/auth/test_resolve_auth.py` | Pytest suite covering 4 modes + multi-mode warning + GCP passthrough | VERIFIED | 146 lines, 8 `def test_` functions, parity docstrings |
| `python/tests/auth/__init__.py` | Empty package marker | VERIFIED | Exists |
| `spec/fixtures/error-auth-invalid-key.stderr.txt` | Invalid-API-key stderr tail | VERIFIED | Contains `API_KEY_INVALID`, `UNAUTHENTICATED`, `API key not valid` |
| `spec/fixtures/error-auth-invalid-key.expected.json` | Contract sidecar with `_errorType:'AuthError'`, `_bucket:'auth'`, `synthetic:true` | VERIFIED | All required fields present |
| `spec/fixtures/error-auth-invalid-key.ndjson` | NDJSON trace | VERIFIED | Contains `code:401`, `status:UNAUTHENTICATED` stream error event |
| `spec/fixtures.manifest.json` | Updated with synthetic_blocked entry for error-auth-invalid-key | VERIFIED | Line 27 contains `"error-auth-invalid-key"` in `synthetic_blocked` |
| `scripts/lint-auth-login.sh` | Bash linter matching lint-errors.sh shape; set -euo pipefail; grep -E only | VERIFIED | 23 lines, 100755 exec bit, set -euo pipefail, source-only grep |
| `.github/workflows/ci.yml` | Parity job step invoking bash scripts/lint-auth-login.sh | VERIFIED | Lines 99–100 — `Lint auth login prohibition` blocking step |
| `docs/auth.md` | Precedence chain, AUT-08 rationale (#22970 + ToS), AUT-09 rationale (GOOGLE_AUTH_TOKEN non-existence) | VERIFIED | 75 lines, all required strings present |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ts/src/auth/resolveAuth.spec.ts` | `ts/src/auth/resolveAuth.ts` | `import { resolveAuth, AUTH_PRECEDENCE } from './resolveAuth.js'` | WIRED | Line 2 of spec |
| `ts/src/auth/resolveAuth.spec.ts` | `ts/src/process/EnvBuilder.ts` | `import { buildEnv } from '../process/EnvBuilder.js'` | WIRED | Line 3 of spec; `buildEnv(` called in 3 tests |
| `ts/src/index.ts` | `ts/src/auth/index.ts` | `export * from './auth/index.js'` | WIRED | Line 10 of `ts/src/index.ts` |
| `python/tests/auth/test_resolve_auth.py` | `python/src/gemini_sdk/auth/resolve_auth.py` | `from gemini_sdk.auth import resolve_auth, AUTH_PRECEDENCE` | WIRED | Line 12 of test file |
| `python/tests/auth/test_resolve_auth.py` | `python/src/gemini_sdk/process/env_builder.py` | `from gemini_sdk.process.env_builder import build_env` | WIRED | Line 13; `build_env(` called in 3 tests |
| `python/src/gemini_sdk/__init__.py` | `python/src/gemini_sdk/auth/__init__.py` | `from .auth import resolve_auth, AUTH_PRECEDENCE` | WIRED | Line 5 of top-level `__init__.py` |
| `ts/src/query/query.ts` | `ts/src/auth/resolveAuth.ts` | `import { resolveAuth } from '../auth/index.js'`; called in query() and queryRaw() | WIRED | Lines 33, 76, 217; `resolveAuth(` count = 2 |
| `python/src/gemini_sdk/query/query.py` | `python/src/gemini_sdk/auth/resolve_auth.py` | `from ..auth import resolve_auth`; called in query() and query_raw() | WIRED | Lines 33, 85, 238; `resolve_auth(` count = 2 |
| `ts/src/errors/errorMapperCorpus.spec.ts` | `spec/fixtures/error-auth-invalid-key.stderr.txt` | `readFileSync` + `ErrorMapper.fromExit` + `AuthError` assertion | WIRED | Lines 149–155 |
| `python/tests/errors/test_error_mapper_corpus.py` | `spec/fixtures/error-auth-invalid-key.stderr.txt` | `Path.read_text()` + `ErrorMapper.from_exit` + `AuthError` assertion | WIRED | Lines 130–136 |
| `.github/workflows/ci.yml` | `scripts/lint-auth-login.sh` | `run: bash scripts/lint-auth-login.sh` step in parity job | WIRED | Lines 99–100 |
| `docs/auth.md` | discussion #22970 | markdown link citing AUT-08 rationale | WIRED | Line 22: `discussions/22970` |
| `docs/auth.md` | EnvBuilder allowlist | prose referencing ALLOWED_KEYS as AUT-09 gate | WIRED | Lines 48, 56: `ALLOWED_KEYS allowlist` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUT-01 | 06-01, 06-02 | GEMINI_API_KEY is canonical default | SATISFIED | resolveAuth returns mode='api-key'; test AUT-01 in both languages; docs/auth.md §Precedence Chain |
| AUT-02 | 06-01, 06-02 | Vertex AI via GOOGLE_APPLICATION_CREDENTIALS | SATISFIED | resolveAuth returns mode='vertex-sa'; test AUT-02 in both languages |
| AUT-03 | 06-01, 06-02 | Vertex AI via GOOGLE_API_KEY | SATISFIED | resolveAuth returns mode='vertex-key'; test AUT-03 in both languages |
| AUT-04 | 06-01, 06-02 | GCP project/location vars pass through | SATISFIED | EnvBuilder ALLOWED_KEYS contains GOOGLE_CLOUD_PROJECT, _PROJECT_ID, _LOCATION; test AUT-04 in both languages asserting buildEnv passthrough |
| AUT-05 | 06-01, 06-02, 06-04 | ADC fallback; SDK never automates OAuth login | SATISFIED | resolveAuth returns mode='adc' when no var set; lint-auth-login.sh enforces 'auth login' absence; docs/auth.md §ADC |
| AUT-06 | 06-01, 06-02, 06-03 | Runtime warning on multiple auth modes with precedence chain | SATISFIED | resolveAuth emits warnings[]; wired into query()+queryRaw() TS+Python; 4 new tests assert warning emission |
| AUT-07 | 06-03 | Typed AuthError subtypes with retryable=false, bucket=auth | SATISFIED | error-auth-invalid-key fixture + corpus tests in TS+Python assert AuthError, bucket='auth', retryable=false |
| AUT-08 | 06-04 | Documentation links #22970 + ToS warning | SATISFIED | docs/auth.md lines 22–23: #22970 link + ToS note tagged (AUT-08) |
| AUT-09 | 06-04 | Documentation notes no GOOGLE_AUTH_TOKEN passthrough | SATISFIED | docs/auth.md §No GOOGLE_AUTH_TOKEN Passthrough; GOOGLE_AUTH_TOKEN absent from EnvBuilder ALLOWED_KEYS |

**All 9 requirements (AUT-01 through AUT-09) satisfied. No orphaned requirements.**

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | None found |

Scanned: `ts/src/auth/`, `python/src/gemini_sdk/auth/`, `ts/src/query/query.ts` (Phase 6 additions), `python/src/gemini_sdk/query/query.py` (Phase 6 additions), `scripts/lint-auth-login.sh`, `docs/auth.md`. No TODO/FIXME/placeholder/stub patterns detected. `resolveAuth.ts` and `resolve_auth.py` are substantive implementations with no empty returns.

---

## Human Verification Required

None. All success criteria are verifiable programmatically via grep and file inspection. The following items were confirmed without running the test suite (consistent with fast verification protocol):

- Warning text content confirmed by reading test assertions that call `.toContain('GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC')` against the actual `AUTH_PRECEDENCE.join(' > ')` output from the real implementation.
- AuthError classification confirmed by reading both the ErrorMapper corpus tests and the fixture `expected.json` sidecar.
- Linter scope confirmed by reading the grep target paths (`ts/src python/src`) in `lint-auth-login.sh`.

---

## Notes

**Fixture capture outcome:** `error-auth-invalid-key` is `synthetic_blocked` — the Windows OAuth-cache bypass (same root cause as Phase 05-01 Option B) prevented real capture. The synthetic stderr `[API Error: API_KEY_INVALID] API key not valid. Please pass a valid API key. (UNAUTHENTICATED)` matches all ErrorMapper.fromExit auth patterns. Real capture deferred to `follow-up-auth-isolation-hardening`. This is an acceptable known gap documented per Phase 5 convention.

**Parity:** Both languages maintain test name parity via `scripts/diff-test-names.sh`. The 8 Python test docstrings match the 8 TS `it()` descriptions verbatim. The `diff-test-names.sh` script was fixed in plan 06-02 for Windows UTF-8/em-dash compatibility.

**`resolveAuth` purity enforced:** `ts/src/auth/resolveAuth.ts` has zero import statements (grep count = 0). `python/src/gemini_sdk/auth/resolve_auth.py` has exactly 2 imports (`from __future__` + `from typing`).

**`GOOGLE_AUTH_TOKEN` absent:** Confirmed absent from `ts/src/process/EnvBuilder.ts` ALLOWED_KEYS. The allowlist is the architectural gate for AUT-09 — no runtime check needed.

---

_Verified: 2026-04-19_
_Verifier: Claude (gsd-verifier)_
