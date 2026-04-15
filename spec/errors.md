# Gemini CLI Error Patterns — Draft Taxonomy

**Status:** Normative, Phase 5 complete
**Captured against:** gemini-cli 0.37.1 (see `.gemini-cli-compat`)
**Capture date:** 2026-04-11 – 2026-04-12; Phase 5 update: 2026-04-15
**Changelog:**
- 2026-04-14: re-captured against API-key-only host (Phase 5 Plan 05-01). Auth isolation blocked — synthetic_blocked status retained.
- 2026-04-15: ErrorMapper implemented (plan 05-03); CI linter enforces drift (plan 05-04).

---

## 1. Preamble

This document catalogs observed error shapes derived from Phase 1 error fixture captures. Its
purpose is to serve as the pre-implementation contract for Phase 5's error taxonomy. Phase 5
translated this table into `spec/errors.yaml` (single source of truth), which generates
both `ts/src/errors/errors.ts` and `python/src/gemini_sdk/errors/errors.py` per REQUIREMENTS.md §"Error
Taxonomy" (ERR-01 through ERR-07).

**Capture baseline:** gemini-cli 0.37.1, pinned in `.gemini-cli-compat`.

**Synthetic fixture caveat:** The Phase 1 capture host uses OAuth authentication
(`selectedType: oauth-personal`). The `GEMINI_API_KEY` override does not disable the OAuth
path in gemini-cli 0.37.1. As a result, real auth-failure and rate-limit errors could not be
triggered. The corresponding fixtures (`error-auth`, `error-rate-limit`) are SYNTHETIC — their
event shapes are derived from the known gemini-cli error format.

**Phase 5 outcome:** Real capture was blocked by auth-isolation gap on Windows host.
Fixtures explicitly marked `synthetic_blocked` in `spec/fixtures.manifest.json` v2. Real capture
deferred to follow-up phases (`follow-up-auth-isolation-hardening`, `follow-up-quota-capped-key`).

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

**Implementation:** `ts/src/errors/ErrorMapper.ts` + `python/src/gemini_sdk/errors/error_mapper.py`
(hand-written classifiers, implemented in plan 05-03).

---

## 3. Observed Error Patterns

| Pattern label | Fixture evidence | Exit code | Stream-json signal | Stderr fingerprint | Proposed typed error | Archon retry bucket | Retryable |
|---|---|---|---|---|---|---|---|
| Auth failure (401) | `spec/fixtures/error-auth.ndjson` + `spec/fixtures/error-auth.stderr.txt` | 1 | `error` event with `code: 401`, `status: "UNAUTHENTICATED"` | `"API key not valid. Please pass a valid API key."` / `"Status: UNAUTHENTICATED"` (SYNTHETIC — see §1) | `AuthError` (generic; subtypes: `NotConfigured`, `Forbidden403`, `Expired`, `ToSViolation`) | `auth` | `false` |
| Rate limit (429) | `spec/fixtures/error-rate-limit.ndjson` + `spec/fixtures/error-rate-limit.stderr.txt` | 1 | `error` event with `code: 429`, `status: "RESOURCE_EXHAUSTED"` | `"You have exceeded your quota. Please try again later."` / `"Status: RESOURCE_EXHAUSTED"` (SYNTHETIC — see §1) | `RateLimitError` | `rate_limit` | `true` |
| Subprocess crash / mid-stream abort | `spec/fixtures/abort-midstream.ndjson` | 1 | No terminal `result` event (stream ends at EOF with zero events) | Empty — child terminated before stderr output was produced | `ProcessError` / `ProcessCrashError` | `crash` | `false` |

**Phase 5 note:** Stderr fingerprints above are from the SYNTHETIC fixture documentation.
Real stderr shapes (actual gemini-cli 0.37.1 output) remain unvalidated pending follow-up phases.

---

## 4. Pattern Detail

### 4.1 Auth Failure (401 UNAUTHENTICATED)

**Fixture:** `spec/fixtures/error-auth.ndjson` + `spec/fixtures/error-auth.stderr.txt`

**SYNTHETIC NOTE:** This fixture is synthetic (Phase 5 plan 01, explicitly blocked). The capture
host uses OAuth auth and the `GEMINI_API_KEY` override does not disable the OAuth path in
gemini-cli 0.37.1. Real capture deferred to `follow-up-auth-isolation-hardening`.

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

**Classifier logic (implemented in ErrorMapper — plan 05-03):**
- Stream path: `error.code === 401` AND `error.status === "UNAUTHENTICATED"` → `classifyAuthSubtype(msg)` → `NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation` / `AuthError`
- Stderr path: stderr contains `"API key not valid"` OR `"UNAUTHENTICATED"` OR `"401"` → `AuthError` (generic — mixed tail cannot distinguish subtypes)

**YAML stderr_patterns (from `spec/errors.yaml`):**
- `AuthError`: `"API key not valid|UNAUTHENTICATED|401"`
- `NotConfigured`: `"no API key|not configured|GEMINI_API_KEY"`
- `Forbidden403`: `"403|PERMISSION_DENIED|Forbidden"`
- `Expired`: `"token expired|oauth.*expired"`
- `ToSViolation`: `"Terms of Service|ToS|account suspended"`

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

**SYNTHETIC NOTE:** This fixture is synthetic (Phase 5 plan 01, explicitly blocked). The OAuth
quota on this host absorbed 10+ rapid-fire requests without triggering a 429. Real capture
deferred to `follow-up-quota-capped-key`.

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

**Classifier logic (implemented in ErrorMapper — plan 05-03):**
- Stream path: `error.code === 429` OR `error.status === "RESOURCE_EXHAUSTED"` → `RateLimitError`
- Stderr path: stderr contains `"quota"` OR `"RESOURCE_EXHAUSTED"` OR `"429"` OR `"Too Many Requests"` → `RateLimitError`

**YAML stderr_patterns:** `"quota|RESOURCE_EXHAUSTED|429|Too Many Requests"`

**`Retry-After` hint:** No `retryAfter` field observed in synthetic fixture. Whether real 429
responses include a timing hint is UNRESOLVED (RESEARCH.md Open Question #3). ErrorMapper
currently skips dynamic `retryAfterMs` extraction — field name unconfirmed. If present, it will
be surfaced as `retryAfterMs` on `RateLimitError`. Deferred to `follow-up-quota-capped-key`.

**Archon bucket:** `rate_limit`
**Retryable:** `true`
**`retryAfterMs`:** Unknown — deferred to follow-up phase.

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
this capture.

**Classifier logic (ERR-06, implemented in query.ts/query.py — plan 05-03):**
- Primary signal: stream ends at EOF without a `result` event AND process exits non-zero → `ErrorMapper.fromExit()`
- `ProcessCrashError` for exit codes 1, 2, 137, 143 with no other pattern match
- If the SDK itself initiated the abort (via `AbortSignal` or `SIGTERM`): `AbortError` (a subtype of `ProcessError`)

**YAML stderr_patterns:** None (empty stderr expected)

**Archon bucket:** `crash`
**Retryable:** `false`
**`retryAfterMs`:** `undefined`

---

### 4.4 Additional Error Classes (from YAML taxonomy)

The following classes are defined in `spec/errors.yaml` and generated into both TS and Python.
These are based on the API spec and gemini-cli docs; not yet captured from real runs.

| Class | Base | Bucket | Retryable | Trigger |
|-------|------|--------|-----------|---------|
| `ModelAccessError` | `GeminiError` | `model_access` | `false` | code 404, status NOT_FOUND, model not found/deprecated/unavailable |
| `InvalidPromptError` | `GeminiError` | `unknown` | `false` | code 400, status INVALID_ARGUMENT, content policy/safety |
| `UnsupportedFeatureError` | `GeminiError` | `unknown` | `false` | Unsupported feature (e.g., multimodal type not supported by model) |
| `ParseError` | `GeminiError` | `unknown` | `false` | NDJSON parse error or malformed response |
| `GeminiNotFoundError` | `GeminiError` | `unknown` | `false` | gemini-cli binary not found |

---

## 5. Gaps and Open Questions

The following error scenarios were NOT captured in Phase 1 or Phase 5. Status as of plan 05-04:

| Gap | Status | Resolution |
|-----|--------|-----------|
| **Real auth / rate-limit stderr format** | OPEN — real capture still blocked | Deferred to `follow-up-auth-isolation-hardening` + `follow-up-quota-capped-key` follow-up phases |
| **`Retry-After` field name in 429 response** | OPEN — field name unconfirmed | Deferred to `follow-up-quota-capped-key`. ErrorMapper currently skips dynamic extraction. YAML comment: `retry_after_ms_source: "error.retryAfter"  # field name unconfirmed` |
| **Model deprecation errors** (post-2026-06-17 for 2.5 series) | DEFERRED to future phase | `ModelAccessError` class already in taxonomy; real stderr pattern not validated |
| **Content policy violation / InvalidPromptError** | DEFERRED to future phase | `InvalidPromptError` class already in taxonomy; real stderr pattern not validated |
| **Unsupported feature error** | DEFERRED to future phase | `UnsupportedFeatureError` class already in taxonomy |

---

## 6. Phase 5 Handoff

Phase 5 complete. ErrorMapper implemented (plan 05-03); CI linter enforces drift (plan 05-04). Downstream phases consume `GeminiError` subclasses from `ts/src/errors/index.ts` and `python/src/gemini_sdk/errors/__init__.py`.

**What was built in Phase 5:**

1. **`spec/errors.yaml`** (plan 05-02) — Single source of truth for the error taxonomy (15 classes, 5-bucket enum). Generates both language implementations.

2. **Generated class hierarchies** (plan 05-02):
   - TypeScript: `ts/src/errors/errors.ts` (AUTO-GENERATED, 15 classes)
   - Python: `python/src/gemini_sdk/errors/errors.py` (AUTO-GENERATED, 15 classes)

3. **`ErrorMapper`** (plan 05-03) — Pattern-matches `(exit_code, stderr_tail, last_stream_events)` into typed errors. Honors ERR-05: both stream-json and exit-code+stderr paths resolve to the same typed error class.

4. **Dispatch integration** (plan 05-03) — `dispatch.ts`/`dispatch.py` now throw typed errors instead of yielding `rate_limit` chunks.

5. **CI linter** (plan 05-04) — `scripts/lint-errors.sh` re-runs both codegen scripts, diffs against committed files, and cross-checks class-set equality across YAML, TS, and Python. Wired into the `parity` CI job.

6. **Fixture-corpus contract tests** (plan 05-04) — Parametrized tests in both languages iterate every `spec/fixtures/error-*.ndjson` fixture and prove ERR-04 + ERR-05 at scale.

**Downstream consumption:**
- Import typed errors from `ts/src/errors/index.ts` (TS) or `python/src/gemini_sdk/errors/__init__.py` (Python)
- `GeminiError` is the root type; use `instanceof` / `isinstance` against subclasses for bucket-specific handling
- `err.bucket` gives the Archon retry bucket (one of: `rate_limit`, `auth`, `model_access`, `crash`, `unknown`)
- `err.retryable` is `true` only for `RateLimitError`
- `err.retryAfterMs` / `err.retry_after_ms` is populated when the stream event includes a `retryAfter` hint (currently never — field name unconfirmed)
