# Phase 5 Deferred Items

## From Plan 05-01

### DI-01: Existing dispatch.spec.ts fixture-corpus rows fail RED

**Discovered during:** Plan 05-01 Task 1

**Files affected:** `ts/src/parser/dispatch.spec.ts` (fixture corpus describe block)

**Symptom:** After flipping `spec/fixtures/error-rate-limit.expected.json` to
`_throws:true + _errorType:"RateLimitError"` (removing the yielded `rate_limit`
chunk) and `error-auth.expected.json` to `_throws:true + _errorType:"AuthError"`
(removing the in-chunks `_throws` sentinel), two existing tests fail:

- `dispatch > fixture corpus > parses error-auth identically to expected.json`
- `dispatch > fixture corpus > parses error-rate-limit identically to expected.json`

**Root cause:** Existing dispatch implementation yields a `rate_limit` chunk for
code 429 and does not throw a typed GeminiError subclass. The expected.json files
now express the Phase-5 contract (throw RateLimitError / AuthError) that
dispatch does not yet honor. The fixture-corpus test also only detects `_throws`
inside `chunks[]`, not at the top level.

**Resolution:** Plan 05-03 (dispatch integration) will:
  1. Update `dispatch.ts` to throw `RateLimitError` on code 429 (instead of
     yielding a rate_limit chunk) and throw `AuthError` on code 401/403/etc.
  2. Update `dispatch.spec.ts` fixture-corpus helper to read `_throws` from the
     top level of expected.json as well as from inside `chunks[]`.
  3. Replace the `dispatch > error handling > maps code 429 error to rate_limit
     chunk` test with one asserting `rejects.toThrow(RateLimitError)`.

**Scope boundary:** Not fixed in plan 05-01 because it is Phase 5 semantic work
that belongs in 05-03's integration task. Out of scope for plan 05-01 per
executor deviation rules.

**Tracking commit:** ed12d8c (manifest + expected.json re-targeting).

---

### DI-02: Real fixture capture for error-auth + error-rate-limit

**Discovered during:** Plan 05-01 Task 1 (Option B taken)

**Blocker:** gemini-cli 0.37.1 auth isolation ineffective on Windows host;
no free-tier GEMINI_API_KEY for 429 capture.

**Resolution phase:** `follow-up-auth-isolation-hardening` +
`follow-up-quota-capped-key` (tracked in `spec/fixtures.manifest.json`
`synthetic_blocked` map).

**Open question still unresolved:** real retry-after field name in 429 responses
(RESEARCH.md Open Question #3). ErrorMapper must tolerate absence (asserting
undefined/None) until follow-up capture.
