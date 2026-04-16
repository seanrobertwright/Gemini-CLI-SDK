# Phase 6: Auth Environment - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire all four `gemini-cli` auth modes into the SDK via a new pure-function `resolveAuth()` composed before `buildEnv()`: `GEMINI_API_KEY` (canonical default), Vertex AI service-account JSON (`GOOGLE_APPLICATION_CREDENTIALS`), Vertex Google Cloud API key (`GOOGLE_API_KEY`), and ADC / Sign-in-with-Google fallback (transparent — never automate `auth login`). Pass through `GOOGLE_CLOUD_PROJECT` / `_PROJECT_ID` / `_LOCATION` for Vertex scoping. Emit a runtime warning when multiple modes are configured, naming the precedence winner: `GEMINI_API_KEY` > `GOOGLE_APPLICATION_CREDENTIALS` > `GOOGLE_API_KEY` > ADC. Surface auth failures via the typed `AuthError` subtypes already generated in Phase 5 (`NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation`). Add a CI grep linter that fails merge if `auth login` appears anywhere in `ts/src` or `python/src`.

Requirements: AUT-01, AUT-02, AUT-03, AUT-04, AUT-05, AUT-06, AUT-07, AUT-08, AUT-09.

Out of scope: session resume (Phase 7), tool/approval auth concerns (Phase 8), MCP auth (Phase 9), Archon adapter wiring (Phase 10).

</domain>

<decisions>
## Implementation Decisions

### Auth-mode selection & resolution

- **Implicit env-var detection — no new `QueryOptions.auth` field.** "Explicitly selected" means the user set the relevant env vars. `resolveAuth()` inspects `process.env` / `os.environ`, applies the documented precedence chain, and reports the resolved mode. Zero new public API surface. Matches gemini-cli's own behavior; consistent with the SDK's "transparent wrapper" ethos.
- **New `resolveAuth()` pure function in a new `auth/` module.** Signature: `resolveAuth(processEnv, options) -> { mode: 'api-key' | 'vertex-sa' | 'vertex-key' | 'adc' | 'none', envOverrides: Record<string, string>, warnings: string[] }`. `buildEnv()` stays an allowlist filter — does NOT absorb auth logic. Composer (`query()` / `ProcessManager`) is responsible for emitting warnings returned from `resolveAuth()`.
- **`AuthError.NotConfigured` thrown before subprocess spawn when NO auth mode resolves.** If `process.env` contains none of the four mode signals AND no ADC credentials are detectable by gemini-cli's own probe, `resolveAuth()` returns `mode: 'none'` and `query()` throws `AuthError.NotConfigured` before spawning. Saves a subprocess round-trip and surfaces a clear typed error instead of a generic CLI failure. (NOTE: with implicit detection, "missing required vars" only occurs when the user has nothing configured at all — there's no "I picked vertex-sa but forgot creds" failure mode.)
- **`GOOGLE_CLOUD_PROJECT` / `_PROJECT_ID` / `_LOCATION` are always passed through when set** (AUT-04). No mode-gating. They're already in the EnvBuilder allowlist; `resolveAuth()` does not strip them. gemini-cli ignores them outside Vertex contexts. Defense-in-depth gating would couple buildEnv to mode resolution and surprise users who rely on gemini-cli's own behavior.

### Precedence-warning surface

- **`console.warn` (TS) / `warnings.warn` or stderr (Python).** No injectable logger, no MessageChunk event, no throw. Standard mechanisms exist for users to redirect or silence. Zero new API surface; matches typical Node/Python library behavior.
- **Fires once per `query()` call** when multiple modes are configured. Stateless, deterministic, easy to test. A caller making 100 misconfigured queries sees 100 warnings — that is the desired feedback signal.
- **Warning copy: name winner + losers + precedence doc link.** Template (TS):
  ```
  [gemini-sdk] Multiple auth modes configured: GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS.
  Using GEMINI_API_KEY per documented precedence:
    GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC.
  See docs/auth.md.
  ```
  SC-2 test asserts the warning text contains both the winner name and the documented precedence chain (regex match on chain ordering).
- **No info-level warning when ADC is the only resolved mode.** ADC is valid, expected, and explicitly "transparent" per roadmap. Warning only fires on conflict (a higher-precedence env var ALSO set alongside ADC). Keeps signal-to-noise high.

### Integration-test strategy (SC-1 + SC-3)

- **SC-1 — Pure unit tests on `resolveAuth()` + `buildEnv()`.** Four scenarios (api-key only, vertex-sa, vertex-key, ADC), each test stubs `process.env` / `os.environ`, calls `resolveAuth()` then `buildEnv(resolveAuth().envOverrides)`, snapshot-diffs the resulting env dict. No subprocess, no live API. Mirrors the existing `EnvBuilder.spec.ts` pattern; runs in milliseconds.
- **SC-3 — Recorded fixture + replay for the invalid-API-key path.** Capture the failure once via `scripts/capture-fixtures.*` against a real gemini-cli host with an intentionally invalid key; commit `spec/fixtures/error-auth-invalid-key.{ndjson,stderr.txt,expected.json}`. Unit test pipes the fixture through `ErrorMapper` and asserts the resulting class is `AuthError` (or the expected subtype, depending on stderr content), `.retryable === false`, Archon bucket `auth`. Mirrors Phase 5's contract-test shape; no live calls in CI.
- **One new fixture: `error-auth-invalid-key`.** Phase 5 already re-captures `error-auth.*` (the "no key configured" / generic auth failure). Phase 6 adds exactly one targeted capture for "key present but invalid" so SC-3's invalid-key requirement has dedicated evidence. Avoids the operational pain of capturing 403/Expired/ToSViolation (which need privileged accounts).
- **Tests live in a new `auth/` module** (`ts/src/auth/resolveAuth.spec.ts` + `python/tests/auth/test_resolve_auth.py`). Co-located with the new logic, parity-friendly, mirrors how Phase 5 introduced `errors/` as its own module. Existing `EnvBuilder.spec.ts` stays focused on allowlist filtering.

### ADC pickup + AUT-09 + CI linter

- **ADC pickup is do-nothing fallback.** `resolveAuth()` returns `mode: 'adc'` with no env overrides when no API-key / SA-JSON / Google API key env vars are set. Gemini-cli detects ADC itself via its own logic. SDK never reads `~/.config/gcloud`, never runs `gcloud config get-value`, never invokes `auth login`. Resolved mode is reported back to the caller via the `init` event's existing fields (no new event variant).
- **AUT-09 (no `GOOGLE_AUTH_TOKEN` passthrough): doc-only + allowlist exclusion.** `GOOGLE_AUTH_TOKEN` is simply absent from the `EnvBuilder` allowlist — that exclusion IS the enforcement. Document the rationale in `docs/auth.md` referencing gemini-cli discussion #22970 and the Google FAQ ToS warning. No runtime check, no special-case warning, no throw on `options.env` overrides (`buildEnv`'s `overrides` parameter can technically forward anything; the doc explains why this won't help).
- **`scripts/lint-auth-login.sh` — new standalone bash script** plugged into the existing CI parity job (next to `scripts/lint-errors.sh` from Phase 5). Single-purpose, easy to debug, matches the established pattern. Runs `grep -rn 'auth login' ts/src python/src` and fails on any match.
- **Lint scope: source only (`ts/src` + `python/src`).** Tests and docs may legitimately mention `auth login` in prohibition language ("SDK never calls `auth login`"). SC-4 is a runtime-source guarantee — false positives in tests/docs would be self-defeating. No allowlist-comment escape hatch needed at this scope.

### Claude's Discretion

- Exact `resolveAuth()` return-value field names (`envOverrides` vs `env_overrides` vs `extras` etc.); the shape and contract are locked, naming details are not.
- Whether `mode: 'none'` is its own enum member or `null` / absent.
- Where exactly the warning string is built (inline in `resolveAuth()` returning warnings, or a small `formatPrecedenceWarning()` helper).
- Exact `init`-event field used to expose the resolved mode (or whether it's a Phase-6-internal-only diagnostic that surfaces in error messages but not the public stream).
- Python-side warning emission style (`warnings.warn(UserWarning)` vs `print(file=sys.stderr)`); SC-2 test should accept either if both surface the required text.
- Capture script extensions for the invalid-key fixture (probably a `--scenario invalid-key` flag added to `scripts/capture-fixtures.*`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 6 requirements & roadmap
- `.planning/REQUIREMENTS.md` §"Auth Environment" — AUT-01 through AUT-09 (full requirement text)
- `.planning/ROADMAP.md` §"Phase 6: Auth Environment" — Goal statement, dependencies, 4 success criteria

### Error taxonomy (Phase 5 outputs consumed here)
- `spec/errors.yaml` — `AuthError` + `NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation` entries; codegen-source-of-truth
- `spec/errors.md` §3, §4 — Auth-failure observed patterns, classifier logic, stderr regex catalog (`API key not valid`, `UNAUTHENTICATED`, `403`, `PERMISSION_DENIED`, `token expired`, `Terms of Service`)
- `ts/src/errors/ErrorMapper.ts` — Stream + stderr classification entry points; Phase 6 SC-3 test feeds fixture through this
- `python/src/gemini_sdk/errors/error_mapper.py` — Python counterpart
- `ts/src/errors/index.ts` + `python/src/gemini_sdk/errors/__init__.py` — Barrel exports for `AuthError` subtypes

### Process / env infrastructure (Phase 2/4 outputs extended here)
- `ts/src/process/EnvBuilder.ts` — Existing allowlist filter; all 6 auth env vars already present. `resolveAuth()` will compose with this, NOT replace it.
- `python/src/gemini_sdk/process/env_builder.py` — Python counterpart
- `ts/src/process/EnvBuilder.spec.ts` — Existing test pattern to mirror in new `auth/` tests
- `ts/src/process/ProcessManager.ts` — Subprocess spawn; warnings emit at this layer (or in `query()`)
- `ts/src/query/query.ts` + `python/src/gemini_sdk/query/query.py` — Composer; calls `resolveAuth()` before spawn, throws `AuthError.NotConfigured` if `mode === 'none'`

### Fixture infrastructure
- `spec/fixtures/error-auth.{ndjson,stderr.txt,expected.json}` — SYNTHETIC; being re-captured by Phase 5 (no-key / generic auth failure)
- `scripts/capture-fixtures.*` — Reproducible capture script (Phase 1); will gain a new scenario for `error-auth-invalid-key`
- `spec/fixtures.manifest.json` — Fixture corpus manifest; Phase 6 adds the new invalid-key entry

### Prior phase context
- `.planning/phases/01-feasibility-spike-fixture-capture/01-CONTEXT.md` — Synthetic-fixture caveat, OAuth vs API-key distinction, secrets-redactor design (relevant for new fixture capture)
- `.planning/phases/04-public-query-argvbuilder-systemprompt-workspace-model-selection/04-CONTEXT.md` — `query()` composition; `QueryOptions.env` overrides flow through `buildEnv`
- `.planning/phases/05-error-taxonomy-archon-5-bucket-mapping/05-CONTEXT.md` — `AuthError` subtype design, stderr matcher conventions, `ErrorMapper` dual-path contract, `lint-errors.sh` pattern

### Upstream references
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md` — Canonical auth env var documentation; confirms `GEMINI_API_KEY` precedence and `GOOGLE_AUTH_TOKEN` non-existence (cited in AUT-08, AUT-09)
- `https://github.com/google-gemini/gemini-cli/discussions/22970` — March 2026 Google routing change; rationale for API-key-canonical default (AUT-08)
- gemini-cli ToS / FAQ — Background for `ToSViolation` subtype messaging (AUT-08)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildEnv(overrides)` — Allowlist filter already includes all 6 Phase-6-relevant env vars. `resolveAuth().envOverrides` flows in via the existing `overrides` parameter; no signature change needed.
- `AuthError`, `NotConfigured`, `Forbidden403`, `Expired`, `ToSViolation` — All four subtypes generated by Phase 5's `scripts/gen-errors.{mjs,py}` from `spec/errors.yaml`. Already exported via `errors/` barrels. Phase 6 consumes them; does not add new error classes.
- `ErrorMapper.fromStreamEvent()` + `.fromExit()` — Dual-path classifier from Phase 5; SC-3 fixture replay uses both paths.
- `ProcessManager.getStderrTail()` (Phase 5) — Phase 6's invalid-key integration error path uses this when surfacing AuthError on non-zero exit.
- `scripts/capture-fixtures.*` — Reproducible capture script with redactor + manual-review discipline; extends with `--scenario invalid-key` for SC-3 fixture.
- `scripts/lint-errors.sh` — Pattern for the new `scripts/lint-auth-login.sh` (single-purpose, parity-CI-job-plugged).

### Established Patterns
- **Pure-function compose chain:** `buildArgv` (Phase 4), `buildEnv` (Phase 2), `ErrorMapper` (Phase 5) — all pure functions composed inside `query()`. `resolveAuth()` follows the same shape.
- **New module = new directory:** Phase 5 introduced `errors/`; Phase 6 introduces `auth/` with `resolveAuth.{ts,py}` + `resolveAuth.spec.ts` / `test_resolve_auth.py`.
- **Snapshot-diff env tests:** `EnvBuilder.spec.ts` already snapshot-diffs filtered env dicts; SC-1 tests adopt the same idiom in `auth/`.
- **Fixture-corpus parity:** Phase 3/5 parametrize tests over `spec/fixtures/*`; Phase 6's SC-3 test slots into this pattern by adding the new fixture filename to the parametrize input.
- **Standalone CI lint scripts:** `scripts/lint-errors.sh` is the template for `scripts/lint-auth-login.sh`. Both run in the existing parity CI job in `.github/workflows/ci.yml`.
- **AUTO-GENERATED header convention** (Phase 5) — Not directly relevant for Phase 6 (no new codegen), but `docs/auth.md` should reference codegen sources by name when discussing AuthError subtypes.

### Integration Points
- `query()` (TS + Python) — Insert `const resolved = resolveAuth(process.env, options)` BEFORE `ProcessManager.spawn`. If `resolved.mode === 'none'`, throw `AuthError.NotConfigured` immediately. Otherwise, emit each `resolved.warnings[i]` via `console.warn` / `warnings.warn`, and pass `resolved.envOverrides` (merged with `options.env`) into `ProcessManager.spawn({ env })`.
- `ProcessManager.spawn` — No changes; `env` arg already accepts arbitrary overrides.
- `EnvBuilder.ts` / `env_builder.py` — No changes. Allowlist already correct.
- `.github/workflows/ci.yml` parity job — Add one step: `bash scripts/lint-auth-login.sh`.
- `docs/auth.md` — NEW file. Documents precedence chain, AUT-08 (#22970 + ToS rationale), AUT-09 (`GOOGLE_AUTH_TOKEN` non-existence), and how `query()` resolves auth.
- `spec/fixtures.manifest.json` — Add `error-auth-invalid-key` entry alongside existing fixtures.
- `scripts/capture-fixtures.*` — Add `--scenario invalid-key` branch (deliberately bad key, triggers `AuthError`-classifying stderr).

</code_context>

<specifics>
## Specific Ideas

- "Implicit env detection" mirrors how `gemini-cli` itself behaves — the SDK is a transparent wrapper, not a config layer with its own opinions.
- The precedence chain `GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC` is locked by the roadmap goal text; the warning copy must surface this chain verbatim so SC-2's regex assertion can pin it.
- Warning emits via `console.warn` deliberately mimics how npm libraries (e.g. Node's deprecation warnings) signal — users already know how to handle this channel.
- Doc-only enforcement of `GOOGLE_AUTH_TOKEN` is sufficient because the allowlist is the actual gate; documenting "we never added this to the allowlist" is more honest than adding a runtime check that pretends to enforce a policy the architecture already enforces.
- SC-1 being pure-unit-test (no subprocess) means the four-scenario coverage runs in CI in milliseconds and never depends on a working gemini-cli — which is essential since Phase 6 also has to verify behavior on Windows runners where gemini-cli is the most fragile.
- The single new fixture (`error-auth-invalid-key`) is the minimum capture needed to discriminate Phase 5's "no key" path from Phase 6's "invalid key" path; further AuthError subtype captures (403/Expired/ToS) can be added opportunistically when test accounts become available.

</specifics>

<deferred>
## Deferred Ideas

- **Per-call auth override via `QueryOptions.auth`** — Hybrid mode (implicit default + explicit override) is documented as a future option. If user feedback indicates implicit detection is too magical, add the discriminator field in a later phase without breaking existing call sites.
- **403-Forbidden / Expired / ToSViolation captures** — Capturing each AuthError subtype with real upstream evidence requires privileged accounts (a key without model access, an expired OAuth session, a ToS-suspended account). Defer until those accounts are available; Phase 6 ships with one targeted invalid-key capture and relies on Phase 5's stderr regex matchers for subtype discrimination.
- **Live-CI nightly auth integration test** — Real gemini-cli call against an intentionally bad key, gated to a manual or nightly job with a CI secret. Catches upstream stderr drift but adds infrastructure cost. Reconsider after a few weeks of stable Phase 6 fixture-based tests.
- **`gcloud` ADC probe** — Not in scope; would couple SDK to the gcloud CLI. Revisit only if user reports show "ADC silently fails" complaints.
- **Auth telemetry / per-mode usage metrics** — Out of SDK scope per PROJECT.md.
- **Auth message i18n** — Not in v1 scope.

</deferred>

---

*Phase: 06-auth-environment*
*Context gathered: 2026-04-15*
