# Gemini CLI Error Patterns — Draft Taxonomy

**Status:** Normative draft, Phase 1  
**Captured against:** gemini-cli 0.37.1 (see `.gemini-cli-compat`)  
**Capture date:** 2026-04-11 – 2026-04-12  

---

## 1. Preamble

This document catalogs observed error shapes derived from Phase 1 error fixture captures. Its
purpose is to serve as the pre-implementation contract for Phase 5's error taxonomy. Phase 5
will translate this table into `spec/errors.yaml` (single source of truth), which generates
both `ts/src/errors.ts` and `python/src/gemini_sdk/errors.py` per REQUIREMENTS.md §"Error
Taxonomy" (ERR-01 through ERR-07).

**Capture baseline:** gemini-cli 0.37.1, pinned in `.gemini-cli-compat`.

**Synthetic fixture caveat:** The Phase 1 capture host uses OAuth authentication
(`selectedType: oauth-personal`). The `GEMINI_API_KEY` override does not disable the OAuth
path in gemini-cli 0.37.1. As a result, real auth-failure and rate-limit errors could not be
triggered. The corresponding fixtures (`error-auth`, `error-rate-limit`) are SYNTHETIC — their
event shapes are derived from the known gemini-cli error format. Phase 5 will validate real
shapes against an API-key-only host.

---

## 2. Classification Dimensions

Error signals arrive through two independent code paths. Both MUST produce the same typed
error for the same underlying condition (ERR-05):

| Signal source          | When present                                           | How to classify |
|------------------------|--------------------------------------------------------|-----------------|
| Stream-json `error` event | `type: "error"` appears in the NDJSON stream        | Match `error.code` (HTTP status) + `error.status` (Google API status name) |
| Exit code + stderr tail   | Child process exits non-zero; stderr may contain fingerprint text | Match exit code + stderr substring patterns |

**ERR-05 contract:** An `ErrorMapper` MUST pattern-match `(exit_code, stderr_tail, last_stream_events)`
into the same typed error class regardless of which signal arrived first. The two paths are
alternative evidence for the same condition, not separate taxonomies.

---

## 3. Observed Error Patterns

| Pattern label | Fixture evidence | Exit code | Stream-json signal | Stderr fingerprint | Proposed typed error | Archon retry bucket | Retryable |
|---|---|---|---|---|---|---|---|
| Auth failure (401) | `spec/fixtures/error-auth.ndjson` + `spec/fixtures/error-auth.stderr.txt` | 1 | `error` event with `code: 401`, `status: "UNAUTHENTICATED"` | `"API key not valid. Please pass a valid API key. [HTTP 401]"` / `"Status: UNAUTHENTICATED"` (SYNTHETIC — see §1) | `AuthError` subtype `NotConfigured` or `Forbidden403` | `auth` | `false` |
| Rate limit (429) | `spec/fixtures/error-rate-limit.ndjson` + `spec/fixtures/error-rate-limit.stderr.txt` | 1 | `error` event with `code: 429`, `status: "RESOURCE_EXHAUSTED"` | `"You have exceeded your quota. Please try again later. [HTTP 429]"` / `"Status: RESOURCE_EXHAUSTED"` (SYNTHETIC — see §1) | `RateLimitError` | `rate_limit` | `true` |
| Subprocess crash / mid-stream abort | `spec/fixtures/abort-midstream.ndjson` | 1 | No terminal `result` event (stream ends at EOF with zero events) | Empty — child terminated before stderr output was produced | `ProcessError` | `crash` | `false` |

---

## 4. Pattern Detail

### 4.1 Auth Failure (401 UNAUTHENTICATED)

**Fixture:** `spec/fixtures/error-auth.ndjson` + `spec/fixtures/error-auth.stderr.txt`

**SYNTHETIC NOTE:** This fixture is synthetic. The capture host uses OAuth auth and the
`GEMINI_API_KEY` override does not disable the OAuth path in gemini-cli 0.37.1. Phase 5 will
validate the real stderr format on an API-key-only host.

**Stream-json signal** (`spec/fixtures/error-auth.ndjson`, line 2):
```json
{"type":"error","timestamp":"2026-04-12T00:00:01.234Z","error":{"message":"API key not valid. Please pass a valid API key.","code":401,"status":"UNAUTHENTICATED"}}
```

**Stderr fingerprint** (from `spec/fixtures/error-auth.stderr.txt`, speculative):
```
Error: API key not valid. Please pass a valid API key. [HTTP 401]
Status: UNAUTHENTICATED
```

**Exit code:** 1 (from `spec/fixtures/error-auth.expected.json`: `"exit_code": 1`)

**Classifier logic:**
- Stream path: `error.code === 401` AND `error.status === "UNAUTHENTICATED"` → `AuthError`
- Stderr path: stderr contains `"API key not valid"` OR `"UNAUTHENTICATED"` OR `"401"` → `AuthError`

**`AuthError` subtypes (AUT-07):**
- `NotConfigured` — no API key set in environment
- `Forbidden403` — key present but lacks model-access permission
- `Expired` — OAuth token expired (ADC path)
- `ToSViolation` — account suspended for ToS

**Archon bucket:** `auth`  
**Retryable:** `false` — caller must fix credentials, not retry.  
**`retryAfterMs`:** `undefined`

---

### 4.2 Rate Limit (429 RESOURCE_EXHAUSTED)

**Fixture:** `spec/fixtures/error-rate-limit.ndjson` + `spec/fixtures/error-rate-limit.stderr.txt`

**SYNTHETIC NOTE:** This fixture is synthetic. The OAuth quota on this host absorbed 10+
rapid-fire requests without triggering a 429. Phase 5 will validate the real format against a
free-tier API key with quota limits.

**Stream-json signal** (`spec/fixtures/error-rate-limit.ndjson`, line 2):
```json
{"type":"error","timestamp":"2026-04-12T00:01:01.456Z","error":{"message":"You have exceeded your quota. Please try again later.","code":429,"status":"RESOURCE_EXHAUSTED"}}
```

**Stderr fingerprint** (from `spec/fixtures/error-rate-limit.stderr.txt`, speculative):
```
Error: You have exceeded your quota. Please try again later. [HTTP 429]
Status: RESOURCE_EXHAUSTED
```

**Exit code:** 1 (from `spec/fixtures/error-rate-limit.expected.json`: `"exit_code": 1`)

**Classifier logic:**
- Stream path: `error.code === 429` OR `error.status === "RESOURCE_EXHAUSTED"` → `RateLimitError`
- Stderr path: stderr contains `"quota"` OR `"RESOURCE_EXHAUSTED"` OR `"429"` OR `"Too Many Requests"` → `RateLimitError`

**`Retry-After` hint:** The synthetic fixture `spec/fixtures/error-rate-limit.ndjson` does
NOT include a `retryAfter` field in the `error` object. Whether real 429 responses surface a
`Retry-After` delay hint is unconfirmed — Phase 5 must check. If present, it should be
surfaced as `retryAfterMs` on the `RateLimitError` instance (ERR-02).

**Archon bucket:** `rate_limit`  
**Retryable:** `true`  
**`retryAfterMs`:** Unknown — Phase 5 must determine from real captures.

---

### 4.3 Subprocess Crash / Mid-Stream Abort

**Fixture:** `spec/fixtures/abort-midstream.ndjson`

**REAL CAPTURE:** This fixture was captured by spawning a long prompt and sending SIGTERM at
~2 seconds on Windows with OAuth auth. The process terminated before any JSON event was
written to stdout.

**Stream-json signal:** None — `spec/fixtures/abort-midstream.ndjson` is effectively empty
(1 byte). There is no terminal `result` event. Stream ends with EOF.

**Exit code:** 1 (from `spec/fixtures/abort-midstream.expected.json`: `"exit_code": 1`,
`"aborted": true`)

**Stderr fingerprint:** Empty — the child was terminated before producing stderr output on
this capture. On other platforms or longer-running aborts, stderr may contain a partial stack
trace or signal message.

**Classifier logic (ERR-06):**
- Primary signal: stream ends at EOF without a `result` event → `ProcessError`
- Secondary signal: exit code non-zero without matching other patterns → `ProcessError`
- If the SDK itself initiated the abort (via `AbortSignal` or `SIGTERM`): raise `AbortError`
  (a subtype of `ProcessError`) so callers can distinguish SDK-initiated cancellation from
  unexpected crashes.

**Archon bucket:** `crash`  
**Retryable:** `false` — caller decides retry policy; the SDK surfaces the error and lets the
caller decide. On SDK-initiated abort (`AbortError`), retrying is usually wrong.  
**`retryAfterMs`:** `undefined`

---

## 5. Gaps and Open Questions

The following error scenarios were NOT captured in Phase 1. Phase 5 must address them:

| Gap | Reason not captured | Phase 5 action |
|-----|---------------------|----------------|
| **Model access error** (e.g., model deprecated or not enabled for this account) | Not triggered on Phase 1 host | Synthesize from docs OR capture against restricted account. Proposed type: `ModelAccessError`, Archon bucket: `model_access`. |
| **Content policy violation / InvalidPromptError** | Deliberate omission — Phase 1 prompts were benign | Capture using known policy-violating prompt on API-key host. Proposed type: `InvalidPromptError`, Archon bucket: `unknown`. |
| **Unsupported feature error** (e.g., model does not support multimodal input type) | Not triggered | Phase 5 synthesizes from docs only. Proposed type: `UnsupportedFeatureError`, Archon bucket: `unknown`. |
| **Real auth / rate-limit stderr format** | Capture host uses OAuth, GEMINI_API_KEY override ineffective | Phase 5 must re-capture `spec/fixtures/error-auth.*` and `spec/fixtures/error-rate-limit.*` on API-key-only host. |
| **`Retry-After` header in 429 response** | Not present in synthetic fixture `spec/fixtures/error-rate-limit.ndjson` | Phase 5 checks real rate-limit response for `retryAfter` or `retry_after` field in `error` object. |
| **Model deprecation errors** (post-2026-06-17 for 2.5 series) | Models still active at capture time | Phase 5 must capture when model is actively deprecated. Proposed type: `ModelAccessError` subtype `Deprecated`. |

---

## 6. Phase 5 Handoff

Phase 5 will:

1. **Validate synthetic fixtures** — Re-capture `spec/fixtures/error-auth.*` and
   `spec/fixtures/error-rate-limit.*` on an API-key-only host and update the `.ndjson`,
   `.stderr.txt`, and `.expected.json` files. Remove `"synthetic": true` from sidecars.

2. **Translate this table into `spec/errors.yaml`** — Single source of truth for the error
   taxonomy. Each row above becomes a YAML entry with: `pattern_label`, `exit_codes`,
   `stream_json_matcher`, `stderr_patterns`, `typed_error`, `archon_bucket`, `retryable`.

3. **Generate typed error classes** from `spec/errors.yaml`:
   - TypeScript: `ts/src/errors.ts` — class hierarchy rooted at `GeminiError`
   - Python: `python/src/gemini_sdk/errors.py` — exception hierarchy rooted at `GeminiError`

4. **Implement `ErrorMapper`** — Pattern-matches `(exit_code, stderr_tail, last_stream_events)`
   into typed errors. Honors ERR-05: both stream-json and exit-code+stderr paths resolve to
   the same typed error class.

5. **Map to Archon's 5 retry buckets** — Every typed error maps to exactly one of:
   `rate_limit`, `auth`, `model_access`, `crash`, `unknown`.

6. **CI linter (ERR-07)** — Cross-checks `spec/errors.md` (this file) and `spec/errors.yaml`
   against both TS and Python implementations to prevent drift.
