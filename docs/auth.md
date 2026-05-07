# Authentication

This SDK is a transparent wrapper around `gemini-cli` — it does not implement its own auth layer. Instead, `resolveAuth()` inspects your environment, applies a documented precedence chain, and passes the result through to `gemini-cli` via `EnvBuilder`'s allowlist.

## Precedence Chain

When multiple auth modes are configured simultaneously, the SDK resolves the winner using this fixed order:

1. ADC / CLI Auth — takes precedence if `~/.gemini/credentials.json` or `application_default_credentials.json` is detected (AUT-05)
2. `GEMINI_API_KEY` — canonical API key fallback (AUT-01)
3. `GOOGLE_APPLICATION_CREDENTIALS` — Vertex AI via service account JSON (AUT-02)
4. `GOOGLE_API_KEY` — alternative Vertex path (AUT-03)

If more than one is set, `resolveAuth()` emits a single `console.warn` (TypeScript) or `warnings.warn(UserWarning)` (Python) per `query()` call, naming the winner and reprinting the full chain. Single-mode configurations emit no warnings.

The chain constant is exported as `AUTH_PRECEDENCE` from `ts/src/auth/index.ts` and `python/src/gemini_sdk/auth/__init__.py`, so tests and downstream callers can reference it without hardcoding.

## Why API Key Is the Default

Google's recommended default for headless/SDK contexts is `GEMINI_API_KEY`. See:

- [gemini-cli discussion #22970](https://github.com/google-gemini/gemini-cli/discussions/22970) — March 2026 Google routing change and the rationale for API-key-canonical behavior.
- Google Gemini CLI FAQ ToS note — OAuth flows carry Terms of Service risk for automated/SDK usage; API keys do not. (AUT-08)

The SDK **never** invokes `gemini auth login` or any interactive OAuth entrypoint. This is enforced by `scripts/lint-auth-login.sh` in CI — if the string `auth login` ever appears in `ts/src` or `python/src`, the parity job fails merge. (AUT-05)

## Vertex AI

To use Vertex AI, set either:

- `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` — recommended for production.
- `GOOGLE_API_KEY=<your-vertex-key>` — alternative path.

For Vertex project/region scoping, the SDK passes through the following env vars unconditionally (regardless of auth mode):

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_CLOUD_LOCATION`

These flow through `EnvBuilder`'s allowlist; `resolveAuth()` does not strip them. (AUT-04)

## ADC (Application Default Credentials) & CLI Auth

If you have authenticated via `gemini auth login` or `gcloud auth application-default login`, the SDK will dynamically detect the existence of your credentials file (`~/.gemini/credentials.json` or `application_default_credentials.json`).

When detected, **CLI Auth takes absolute precedence over all environment variables**. The SDK will safely strip `GEMINI_API_KEY` from the environment it passes to the underlying `gemini-cli` to ensure your existing CLI session is utilized. (AUT-05)

## No `GOOGLE_AUTH_TOKEN` Passthrough

There is **no** env-var path for supplying a pre-obtained short-lived OAuth access token. `GOOGLE_AUTH_TOKEN` is deliberately absent from the `EnvBuilder` `ALLOWED_KEYS` allowlist — its absence IS the enforcement.

If you have a bearer token and no other credential, substitute one of:

- Service account JSON (`GOOGLE_APPLICATION_CREDENTIALS`)
- Google Cloud API key (`GOOGLE_API_KEY`)
- ADC (run `gcloud auth application-default login` once on the host)

Attempting to forward `GOOGLE_AUTH_TOKEN` through `options.env` will not help — `gemini-cli` does not read this variable. This is documented here rather than enforced via runtime check because the allowlist is the architectural gate. (AUT-09)

## Typed Auth Errors

Auth failures surface through the typed `AuthError` hierarchy generated from `spec/errors.yaml` (Phase 5):

- `AuthError.NotConfigured` — no credentials detected
- `AuthError.Forbidden403` — authenticated but forbidden (e.g. model not accessible to the project)
- `AuthError.Expired` — credential expired mid-session
- `AuthError.ToSViolation` — ToS-suspended account

All four are non-retryable (`.retryable === false`) and map to Archon's `auth` retry bucket. The classifier lives in `ts/src/errors/ErrorMapper.ts` / `python/src/gemini_sdk/errors/error_mapper.py`. (AUT-07)

## References

- Requirements: [AUT-01 through AUT-09](../.planning/REQUIREMENTS.md#authentication)
- Implementation: `ts/src/auth/resolveAuth.ts`, `python/src/gemini_sdk/auth/resolve_auth.py`
- Enforcement: `scripts/lint-auth-login.sh` (AUT-05), `EnvBuilder` allowlist (AUT-09)
- Upstream: https://github.com/google-gemini/gemini-cli/discussions/22970
- Upstream: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md
