# Phase 6: Auth Environment - Research

**Researched:** 2026-04-15
**Domain:** Subprocess environment composition + auth-mode resolution (TS + Python parity)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Auth-mode selection & resolution:**
- **Implicit env-var detection — no new `QueryOptions.auth` field.** "Explicitly selected" means the user set the relevant env vars. `resolveAuth()` inspects `process.env` / `os.environ`, applies the documented precedence chain, and reports the resolved mode. Zero new public API surface.
- **New `resolveAuth()` pure function in a new `auth/` module.** Signature: `resolveAuth(processEnv, options) -> { mode: 'api-key' | 'vertex-sa' | 'vertex-key' | 'adc' | 'none', envOverrides: Record<string, string>, warnings: string[] }`. `buildEnv()` stays an allowlist filter — does NOT absorb auth logic. Composer (`query()` / `ProcessManager`) emits warnings returned from `resolveAuth()`.
- **`AuthError.NotConfigured` thrown before subprocess spawn when NO auth mode resolves.** With implicit detection, "missing required vars" only occurs when the user has nothing configured at all.
- **`GOOGLE_CLOUD_PROJECT` / `_PROJECT_ID` / `_LOCATION` are always passed through when set** (AUT-04). No mode-gating. `resolveAuth()` does not strip them.

**Precedence-warning surface:**
- **`console.warn` (TS) / `warnings.warn` or stderr (Python).** No injectable logger, no MessageChunk event, no throw.
- **Fires once per `query()` call** when multiple modes are configured.
- **Warning copy: name winner + losers + precedence doc link.** TS template:
  ```
  [gemini-sdk] Multiple auth modes configured: GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS.
  Using GEMINI_API_KEY per documented precedence:
    GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC.
  See docs/auth.md.
  ```
  SC-2 test asserts the warning text contains both the winner name and the documented precedence chain (regex match on chain ordering).
- **No info-level warning when ADC is the only resolved mode.**

**Integration-test strategy (SC-1 + SC-3):**
- **SC-1 — Pure unit tests on `resolveAuth()` + `buildEnv()`.** Four scenarios (api-key only, vertex-sa, vertex-key, ADC), each test stubs `process.env` / `os.environ`, calls `resolveAuth()` then `buildEnv(resolveAuth().envOverrides)`, snapshot-diffs the resulting env dict. No subprocess, no live API.
- **SC-3 — Recorded fixture + replay for the invalid-API-key path.** Capture the failure once via `scripts/capture-fixtures.*` against a real gemini-cli host with an intentionally invalid key; commit `spec/fixtures/error-auth-invalid-key.{ndjson,stderr.txt,expected.json}`. Unit test pipes the fixture through `ErrorMapper` and asserts the resulting class is `AuthError` (or the expected subtype), `.retryable === false`, Archon bucket `auth`.
- **One new fixture: `error-auth-invalid-key`.**
- **Tests live in a new `auth/` module** (`ts/src/auth/resolveAuth.spec.ts` + `python/tests/auth/test_resolve_auth.py`).

**ADC pickup + AUT-09 + CI linter:**
- **ADC pickup is do-nothing fallback.** `resolveAuth()` returns `mode: 'adc'` with no env overrides when no API-key / SA-JSON / Google API key env vars are set. SDK never reads `~/.config/gcloud`, never runs `gcloud config get-value`, never invokes `auth login`.
- **AUT-09 (no `GOOGLE_AUTH_TOKEN` passthrough): doc-only + allowlist exclusion.** `GOOGLE_AUTH_TOKEN` is simply absent from the `EnvBuilder` allowlist — that exclusion IS the enforcement.
- **`scripts/lint-auth-login.sh` — new standalone bash script** plugged into the existing CI parity job. Runs `grep -rn 'auth login' ts/src python/src` and fails on any match.
- **Lint scope: source only (`ts/src` + `python/src`).** Tests and docs may legitimately mention `auth login`.

### Claude's Discretion
- Exact `resolveAuth()` return-value field names (`envOverrides` vs `env_overrides` vs `extras` etc.); shape/contract locked, naming not.
- Whether `mode: 'none'` is its own enum member or `null` / absent.
- Where the warning string is built (inline in `resolveAuth()` returning `warnings`, or a small `formatPrecedenceWarning()` helper).
- Exact `init`-event field used to expose the resolved mode (or whether it's Phase-6-internal-only diagnostic).
- Python-side warning emission style (`warnings.warn(UserWarning)` vs `print(file=sys.stderr)`); SC-2 test should accept either if both surface the required text.
- Capture script extensions for the invalid-key fixture (probably `--scenario invalid-key` flag added to `scripts/capture-fixtures.*`).

### Deferred Ideas (OUT OF SCOPE)
- **Per-call auth override via `QueryOptions.auth`** — Hybrid mode deferred until user feedback demands it.
- **403-Forbidden / Expired / ToSViolation captures** — Require privileged accounts; defer.
- **Live-CI nightly auth integration test** — Deferred infrastructure cost.
- **`gcloud` ADC probe** — Couples SDK to gcloud CLI; not in scope.
- **Auth telemetry / per-mode usage metrics** — Out of SDK scope.
- **Auth message i18n** — Not v1 scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUT-01 | `GEMINI_API_KEY` is canonical default | Already in `EnvBuilder` allowlist. `resolveAuth()` detects and reports mode `api-key`. Precedence: position 1/4. |
| AUT-02 | Vertex AI via `GOOGLE_APPLICATION_CREDENTIALS` service account JSON when explicitly selected | Already in allowlist. Implicit selection = env var set. Mode `vertex-sa`. Position 2/4. |
| AUT-03 | Vertex AI via `GOOGLE_API_KEY` alternative path | Already in allowlist. Mode `vertex-key`. Position 3/4. |
| AUT-04 | Pass through `GOOGLE_CLOUD_PROJECT` / `_PROJECT_ID` / `_LOCATION` | All three already in allowlist. Always passthrough — `resolveAuth()` does not strip. |
| AUT-05 | ADC / Sign-in-with-Google transparent fallback; never automates OAuth | Mode `adc` = do-nothing. SDK does not read `~/.config/gcloud`, never invokes `auth login`. |
| AUT-06 | Runtime warning on multiple modes; precedence `GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC` | `resolveAuth()` returns `warnings: string[]`; composer emits via `console.warn` / `warnings.warn`. |
| AUT-07 | Typed `AuthError` subtypes: `NotConfigured` / `Forbidden403` / `Expired` / `ToSViolation` | Phase 5 already generated all four from `spec/errors.yaml`. Phase 6 consumes; does not add. Throw `NotConfigured` pre-spawn when mode is `none`. |
| AUT-08 | Docs link #22970 + ToS warning rationale | New `docs/auth.md` file covers precedence + rationale. |
| AUT-09 | No `GOOGLE_AUTH_TOKEN` passthrough | Enforced by allowlist exclusion (already the case). Documented in `docs/auth.md`. No runtime check. |
</phase_requirements>

## Summary

Phase 6 is a **composition phase**, not a discovery phase. All underlying primitives already exist from Phases 2/4/5:

- `EnvBuilder` already allowlists all six auth env vars + `GEMINI_CONFIG_DIR`.
- `AuthError` + its four subtypes (`NotConfigured`, `Forbidden403`, `Expired`, `ToSViolation`) are already codegen-generated from `spec/errors.yaml`.
- `ErrorMapper.fromStreamEvent()` + `.fromExit()` already route stderr/stream errors through `classifyAuthSubtype()` helpers.
- `query()` already threads `envOverrides` through to `ProcessManager.spawn({env})`.
- `scripts/lint-errors.sh` already establishes the CI-parity-lint pattern; `scripts/lint-auth-login.sh` copies that shape.

The net-new work is a **single pure function** (`resolveAuth()` in TS + Python), one **call-site wiring change** in `query()` (run `resolveAuth` → emit warnings → merge overrides → throw pre-spawn if `mode === 'none'`), one **new fixture** (`error-auth-invalid-key`), one **new bash lint script**, and one **new docs file** (`docs/auth.md`). No codegen changes. No allowlist changes. No public-API changes.

**Primary recommendation:** Ship this as four parallelizable tracks — (1) `resolveAuth` TS + spec, (2) `resolveAuth` Python port, (3) `capture-fixtures.*` invalid-key scenario + SC-3 contract test, (4) `lint-auth-login.sh` + `docs/auth.md`. `query()` wiring happens after (1) lands.

## Standard Stack

### Core (Reused — No New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `EnvBuilder` (existing) | — | Allowlist env filter | Phase 2 output; auth vars already whitelisted |
| `AuthError` subtypes (existing) | — | Typed auth errors | Phase 5 codegen from `spec/errors.yaml` |
| `ErrorMapper` (existing) | — | Classify stderr → typed error | Phase 5; SC-3 replay target |
| `vitest` | ^3.2 | TS test runner | Project standard (pinned for Node 18 CI) |
| `pytest` + `anyio` | existing | Python test runner | Project standard |

### Supporting (Platform stdlib)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node `console.warn` | stdlib | TS warning emission | AUT-06 runtime warning |
| Python `warnings.warn(UserWarning)` | stdlib | Python warning emission | AUT-06 runtime warning; caller can silence via `warnings.filterwarnings` |
| Node `process.env` | stdlib | Read TS env | `resolveAuth(process.env, opts)` |
| Python `os.environ` | stdlib | Read Python env | `resolve_auth(os.environ, opts)` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `console.warn` (TS) | Injectable logger (`options.logger`) | Adds public API surface; deferred per CONTEXT.md |
| `warnings.warn` (Python) | `print(file=sys.stderr)` | Either acceptable per SC-2; `warnings.warn` is more idiomatic for library signaling and is user-silence-able via `warnings.filterwarnings` |
| `mode: 'none'` enum | `null` / absent | Claude's discretion — recommend explicit `'none'` literal for exhaustive switch statements in TS |
| In-allowlist `GOOGLE_AUTH_TOKEN` with runtime block | Absence from allowlist (current design) | Absence is stronger: no code path can accidentally leak it. Doc explains the design choice. |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure
```
ts/src/auth/
├── resolveAuth.ts           # Pure function — no I/O
├── resolveAuth.spec.ts      # Unit tests, 4 scenarios + warning cases
└── index.ts                 # Barrel: re-export resolveAuth + types

python/src/gemini_sdk/auth/
├── __init__.py              # Barrel
├── resolve_auth.py          # Pure function

python/tests/auth/
├── __init__.py
└── test_resolve_auth.py     # Mirror TS scenarios + warning cases

scripts/
├── lint-auth-login.sh       # NEW — mirrors lint-errors.sh shape
└── capture-fixtures.{mjs,sh,cmd}  # Extended with --scenario invalid-key

spec/fixtures/
├── error-auth-invalid-key.ndjson
├── error-auth-invalid-key.stderr.txt
└── error-auth-invalid-key.expected.json

spec/fixtures.manifest.json  # Add slug "error-auth-invalid-key"

docs/
└── auth.md                  # NEW — precedence, AUT-08/AUT-09 rationale
```

### Pattern 1: Pure-Function Compose Chain (established)
**What:** `buildArgv` (Phase 4), `buildEnv` (Phase 2), `ErrorMapper` (Phase 5), now `resolveAuth` (Phase 6) — all pure functions with no I/O, composed inside `query()`.

**When to use:** This is the mandated pattern for this module.

**Example (TS):**
```typescript
// Source: inferred from ts/src/process/EnvBuilder.ts + phase 5 ErrorMapper.ts patterns
export type AuthMode = 'api-key' | 'vertex-sa' | 'vertex-key' | 'adc' | 'none';

export interface ResolvedAuth {
  mode: AuthMode;
  envOverrides: Record<string, string>;  // empty for 'adc' and 'none'
  warnings: string[];                    // non-empty when multiple modes configured
}

export function resolveAuth(
  env: NodeJS.ProcessEnv,
  options?: { /* reserved for future QueryOptions.auth */ }
): ResolvedAuth {
  const hasApiKey = !!env.GEMINI_API_KEY;
  const hasSA     = !!env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasGKey   = !!env.GOOGLE_API_KEY;
  // ADC detection is LAZY — we return 'adc' iff no explicit var is set.
  // We do NOT probe ~/.config/gcloud (per CONTEXT.md).

  const configured: Array<{ mode: AuthMode; name: string }> = [];
  if (hasApiKey) configured.push({ mode: 'api-key',    name: 'GEMINI_API_KEY' });
  if (hasSA)     configured.push({ mode: 'vertex-sa',  name: 'GOOGLE_APPLICATION_CREDENTIALS' });
  if (hasGKey)   configured.push({ mode: 'vertex-key', name: 'GOOGLE_API_KEY' });

  const winner = configured[0]?.mode ?? 'adc';
  const warnings: string[] = [];
  if (configured.length > 1) {
    const names = configured.map(c => c.name).join(', ');
    warnings.push(
      `[gemini-sdk] Multiple auth modes configured: ${names}.\n` +
      `Using ${configured[0].name} per documented precedence:\n` +
      `  GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC.\n` +
      `See docs/auth.md.`
    );
  }
  // mode: 'none' reserved for "nothing set AND no ADC" — but we can't detect ADC,
  // so in practice 'adc' is the no-explicit-var fallback. Callers treat 'adc' as
  // "let gemini-cli decide" and may still get AuthError.NotConfigured from it.
  //
  // DESIGN NOTE: CONTEXT.md says throw NotConfigured pre-spawn when mode === 'none'.
  // With no ADC probe, the only way to return 'none' is via an explicit signal
  // (e.g. caller sets options.auth = 'off'). Without such an option, mode === 'none'
  // is unreachable via current public API. Planner should decide: collapse to 'adc',
  // or keep 'none' reserved for future hybrid-mode. Recommend: keep 'none' in the
  // union but document it as unreachable-today.

  const envOverrides: Record<string, string> = {};
  // No overrides needed: all resolved env vars are already read from process.env
  // and already allowlisted by buildEnv. resolveAuth's job is DIAGNOSIS, not MUTATION.
  // envOverrides is reserved for future per-call auth override (Deferred Ideas).

  return { mode: winner, envOverrides, warnings };
}
```

**Example (Python port, naming per project convention — snake_case):**
```python
# Source: mirror python/src/gemini_sdk/process/env_builder.py + errors module patterns
from typing import Literal, TypedDict

AuthMode = Literal["api-key", "vertex-sa", "vertex-key", "adc", "none"]

class ResolvedAuth(TypedDict):
    mode: AuthMode
    env_overrides: dict[str, str]
    warnings: list[str]

def resolve_auth(env: dict[str, str], options: dict | None = None) -> ResolvedAuth:
    has_api_key = bool(env.get("GEMINI_API_KEY"))
    has_sa      = bool(env.get("GOOGLE_APPLICATION_CREDENTIALS"))
    has_g_key   = bool(env.get("GOOGLE_API_KEY"))

    configured = []
    if has_api_key: configured.append(("api-key",    "GEMINI_API_KEY"))
    if has_sa:      configured.append(("vertex-sa",  "GOOGLE_APPLICATION_CREDENTIALS"))
    if has_g_key:   configured.append(("vertex-key", "GOOGLE_API_KEY"))

    winner: AuthMode = configured[0][0] if configured else "adc"
    warnings_list: list[str] = []
    if len(configured) > 1:
        names = ", ".join(n for _, n in configured)
        warnings_list.append(
            f"[gemini-sdk] Multiple auth modes configured: {names}.\n"
            f"Using {configured[0][1]} per documented precedence:\n"
            f"  GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC.\n"
            f"See docs/auth.md."
        )
    return {"mode": winner, "env_overrides": {}, "warnings": warnings_list}
```

### Pattern 2: Snapshot-Diff Env Tests (established)
**What:** `EnvBuilder.spec.ts` already uses `vi.stubEnv(...)` + snapshot. Phase 6 SC-1 tests adopt the same idiom per scenario.

**Example:**
```typescript
// Source: mirror ts/src/process/EnvBuilder.spec.ts
describe('resolveAuth + buildEnv composition', () => {
  it('api-key only → winner is api-key, no warnings', () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const r = resolveAuth(process.env);
    expect(r.mode).toBe('api-key');
    expect(r.warnings).toEqual([]);
    const env = buildEnv(r.envOverrides);
    expect(env.GEMINI_API_KEY).toBe('test-key');
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  });

  it('api-key + vertex-sa → winner is api-key, one warning naming chain', () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/sa.json');
    const r = resolveAuth(process.env);
    expect(r.mode).toBe('api-key');
    expect(r.warnings).toHaveLength(1);
    // SC-2 regex assertion on chain ordering
    expect(r.warnings[0]).toMatch(
      /GEMINI_API_KEY\s*>\s*GOOGLE_APPLICATION_CREDENTIALS\s*>\s*GOOGLE_API_KEY\s*>\s*ADC/
    );
    expect(r.warnings[0]).toContain('GEMINI_API_KEY');
  });
});
```

### Pattern 3: Standalone CI Lint Script (established)
**What:** Mirror `scripts/lint-errors.sh` shape: bash, `set -euo pipefail`, grep -E only (macOS BSD-compat), parity CI job adds one step.

**Example:**
```bash
#!/usr/bin/env bash
# scripts/lint-auth-login.sh — AUT-05 + SC-4 enforcement.
# Fails if `auth login` appears in ts/src or python/src.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Source-only scope: tests/docs may legitimately mention "auth login"
matches="$(grep -rn 'auth login' ts/src python/src 2>/dev/null || true)"
if [ -n "$matches" ]; then
  echo "[lint-auth-login] FAIL: 'auth login' must not appear in SDK source." >&2
  echo "$matches" >&2
  echo "SDK NEVER automates interactive OAuth (AUT-05 / Phase 6 SC-4)." >&2
  exit 1
fi
echo "[lint-auth-login] OK: no interactive OAuth automation detected in source."
```

CI wiring: add one line to `.github/workflows/ci.yml` parity job around line 97 (next to `bash scripts/lint-errors.sh`):
```yaml
      - name: Lint auth login prohibition
        run: bash scripts/lint-auth-login.sh
```

### Anti-Patterns to Avoid

- **Duplicating auth env vars in `envOverrides`.** The vars are already in `process.env` and already in the `EnvBuilder` allowlist. `resolveAuth().envOverrides` should be empty in the common case — its purpose is FUTURE per-call overrides, not today's passthrough.
- **Probing `~/.config/gcloud` or running `gcloud config get-value`.** Explicitly out of scope per CONTEXT.md; couples SDK to gcloud CLI.
- **Absorbing `resolveAuth` logic into `buildEnv`.** Keep them composable. `buildEnv` stays an opaque allowlist filter.
- **Throwing on `GOOGLE_AUTH_TOKEN` set in `options.env`.** `buildEnv`'s `overrides` parameter can technically forward anything; the doc explains why this won't help. No runtime check.
- **Runtime warning on ADC-only configuration.** Signal-to-noise — ADC is valid and transparent per roadmap.
- **Stateful warning suppression.** Warnings fire per-`query()`-call; 100 misconfigured calls → 100 warnings. That IS the desired feedback signal.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth env var filtering | Custom allowlist in `auth/` | Existing `EnvBuilder.ts` | Allowlist already correct; adding a second filter drifts. |
| Auth error subtypes | Hand-coded `AuthError` classes | Codegen'd classes from `spec/errors.yaml` (Phase 5) | YAML is single source of truth; `lint-errors.sh` enforces sync. |
| Auth error classification | New `classifyAuthError()` helper | Existing `ErrorMapper.classifyAuthSubtype()` (private in `ErrorMapper.ts`) | Phase 5 already does this from stderr patterns. |
| Warning channel | New `options.logger` or event variant | `console.warn` / `warnings.warn` | Adds public API; users already know stdlib warning channels. |
| ADC detection | `gcloud` probe or filesystem check | Do-nothing fallback (`mode: 'adc'`) | Let gemini-cli handle it; coupling to gcloud is out of scope. |
| Fixture capture script | Custom one-off | Extend `scripts/capture-fixtures.*` with `--scenario invalid-key` | Established secrets-redactor + manifest discipline. |
| CI lint framework | JS-based linter | Bash + grep -E (mirror `lint-errors.sh`) | Single-purpose, OS-portable, matches established pattern. |

**Key insight:** Phase 6 is glue-code. Every temptation to "build something smart" is a temptation to duplicate Phase 2/5 infrastructure. Keep `resolveAuth` ~30 LOC, pure, boring.

## Common Pitfalls

### Pitfall 1: Double-detection race (env set AFTER resolveAuth, BEFORE spawn)
**What goes wrong:** Caller sets `process.env.GEMINI_API_KEY = '...'` after `resolveAuth` snapshots env but before `ProcessManager.spawn()` reads env. Mode reports `adc` but subprocess sees the API key.
**Why it happens:** Node `process.env` is live; `os.environ` is live in Python.
**How to avoid:** `resolveAuth(env, ...)` takes env as a parameter — caller passes `{ ...process.env }` (TS) or `dict(os.environ)` (Python) to snapshot. `buildEnv` reads `process.env` directly at spawn time. Document the timing contract.
**Warning signs:** Flaky tests that depend on env mutation order; users reporting "warning fired but different mode used."

### Pitfall 2: `mode: 'none'` unreachable but required by SC-3 contract
**What goes wrong:** CONTEXT.md says throw `AuthError.NotConfigured` before spawn when `mode === 'none'`. But with no ADC probe, no env-var-unset path returns `'none'` — it returns `'adc'`. `NotConfigured` becomes unreachable pre-spawn.
**Why it happens:** Implicit-detection semantics + do-nothing ADC fallback collapse "nothing set" into "try ADC."
**How to avoid:** Two options for planner to pick:
  1. Accept that `NotConfigured` is thrown POST-spawn by `ErrorMapper` (stderr match on "no API key | not configured | GEMINI_API_KEY") — existing Phase 5 path.
  2. Add a minimal "nothing configured AND platform env has no ADC hints" heuristic (e.g. `GOOGLE_APPLICATION_CREDENTIALS` unset AND no `CLOUDSDK_*` vars). Low-confidence; may false-negative.
Recommend Option 1 — keep `'none'` reserved for future explicit opt-out via `options.auth = 'off'`.
**Warning signs:** SC-3 test expects pre-spawn throw but `NotConfigured` only fires post-spawn.

### Pitfall 3: Precedence chain regex fragility in SC-2 test
**What goes wrong:** SC-2 asserts warning text matches precedence chain. A future refactor reorders the template and breaks CI.
**Why it happens:** Regex on human-readable string.
**How to avoid:** Export `AUTH_PRECEDENCE: readonly string[]` from `auth/` module; warning builder uses `.join(' > ')`; test asserts against the exported constant. Single source of truth for chain order.
**Warning signs:** Warning copy tweaks break unrelated tests.

### Pitfall 4: Synthetic-fixture drift on `error-auth-invalid-key`
**What goes wrong:** Phase 5 Plan 01 documented that `error-auth` is synthetic due to Windows host OAuth-isolation gap. Capturing `error-auth-invalid-key` on the same host risks the same "exit 0 via cached OAuth" failure mode.
**Why it happens:** gemini-cli 0.37.1 on Windows ignores `GEMINI_API_KEY=invalid` when OAuth creds are cached.
**How to avoid:** Before capture, verify via `scripts/capture-fixtures.*` diagnostics that `oauth_creds.json` is absent AND `GEMINI_API_KEY=invalid-key-12345` yields non-zero exit. If the host still bypasses, document as synthetic_blocked and defer to `follow-up-auth-isolation-hardening`. Phase 6 should NOT block on a fresh-host acquisition that may require a non-Windows runner.
**Warning signs:** Capture yields exit 0 with a successful response and the fixture expected.json can't assert an AuthError.

### Pitfall 5: Python `warnings.warn` silenced by default filter
**What goes wrong:** Python silences `UserWarning` after the first emission for the same (message, category, module) triple. A caller making 100 misconfigured `query()` calls sees 1 warning, not 100 — contradicting the "fires once per query()" decision.
**Why it happens:** Python's default `__warningregistry__` suppression.
**How to avoid:** Call `warnings.resetwarnings()` before emit, or use `warnings.warn_explicit(...)` with a unique stacklevel, or emit via `print(sys.stderr)` instead. SC-2 test must call `query()` twice and assert both emissions captured. Document Python-specific behavior in `docs/auth.md`.
**Warning signs:** SC-2 Python test passes on first run, fails on second-within-same-process.

### Pitfall 6: `GEMINI_CONFIG_DIR` interaction with SC-3 capture
**What goes wrong:** If the invalid-key capture runs without `GEMINI_CONFIG_DIR` pointing at a temp dir, a cached OAuth token in `~/.gemini/settings.json` short-circuits the API-key path.
**Why it happens:** Same root cause as Phase 5 Plan 01 Option B.
**How to avoid:** `capture-fixtures.*` `--scenario invalid-key` MUST set `GEMINI_CONFIG_DIR` to a fresh temp dir AND unset `GOOGLE_APPLICATION_CREDENTIALS` before spawning gemini-cli. Mirror the `isolateOAuth` flag Phase 5 added.
**Warning signs:** Capture script output shows `exit=0` with a real response.

## Code Examples

### Composition inside `query()` (TS)
```typescript
// Source: modification of ts/src/query/query.ts (Phase 4/5)
import { resolveAuth } from '../auth/index.js';
import { NotConfigured } from '../errors/index.js';

export async function* query(options: QueryOptions): AsyncGenerator<MessageChunk> {
  if (options.abortSignal?.aborted) throw new AbortError();

  // Phase 6 wiring — BEFORE spawn, AFTER abort check
  const resolved = resolveAuth({ ...process.env });
  for (const w of resolved.warnings) console.warn(w);
  // Only throw pre-spawn if planner chooses the explicit-none path:
  //   if (resolved.mode === 'none') throw new NotConfigured('No auth mode configured');

  const tempPath = await writeTempSystemPrompt(options.systemPrompt);
  const envOverrides: Record<string, string> = {
    ...resolved.envOverrides,  // empty today; reserved for future
    ...(options.env ?? {}),    // caller overrides win
  };
  if (tempPath) envOverrides['GEMINI_SYSTEM_MD'] = tempPath;
  // ...rest unchanged
}
```

### Composition inside `query()` (Python)
```python
# Source: modification of python/src/gemini_sdk/query/query.py
import os, warnings
from ..auth import resolve_auth
from ..errors import NotConfigured

async def query(options):
    cancel_scope = options.get("cancel_scope")
    if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
        raise AbortError()

    resolved = resolve_auth(dict(os.environ))
    for w in resolved["warnings"]:
        warnings.warn(w, UserWarning, stacklevel=2)
    # if resolved["mode"] == "none": raise NotConfigured("No auth mode configured")

    temp_path = await _write_temp_system_prompt(options.get("system_prompt"))
    env_overrides = {
        **resolved["env_overrides"],
        **(options.get("env") or {}),
    }
    if temp_path: env_overrides["GEMINI_SYSTEM_MD"] = temp_path
    # ...rest unchanged
```

### SC-3 fixture contract test (TS shape; Python mirrors)
```typescript
// Source: mirror ts/src/errors/errorMapperCorpus.spec.ts pattern
import { readFileSync } from 'node:fs';
import { ErrorMapper, AuthError } from '../errors/index.js';

it('error-auth-invalid-key fixture classifies as AuthError with bucket=auth', () => {
  const stderr  = readFileSync('spec/fixtures/error-auth-invalid-key.stderr.txt', 'utf-8');
  const expected = JSON.parse(readFileSync('spec/fixtures/error-auth-invalid-key.expected.json', 'utf-8'));
  const err = ErrorMapper.fromExit({ exitCode: 1, stderr });
  expect(err).toBeInstanceOf(AuthError);
  expect(err.retryable).toBe(false);
  expect(err.bucket).toBe('auth');
  expect(expected._errorType).toBe('AuthError'); // manifest/expected assertion
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcode `GEMINI_API_KEY` in `query()` | `resolveAuth()` pure function + allowlist passthrough | Phase 6 (this phase) | Supports all 4 modes with zero public API growth |
| Throw generic `GeminiError` on auth failure | Typed `AuthError` subtypes via `ErrorMapper.classifyAuthSubtype` | Phase 5 | Archon-bucket routing works; callers can branch on subtype |
| Runtime check for `GOOGLE_AUTH_TOKEN` | Allowlist exclusion (absence IS enforcement) | This phase | More honest; impossible to accidentally leak |

**Deprecated/outdated:**
- Synthetic `error-auth` fixture from Phase 1 — re-captured in Phase 5 as synthetic_blocked; Phase 6 adds a NEW `error-auth-invalid-key` for the distinct "key present but invalid" path.

## Open Questions

1. **Is `mode: 'none'` reachable through the current public API?**
   - What we know: With no ADC probe and no `options.auth = 'off'` field, every no-explicit-var case returns `'adc'`.
   - What's unclear: CONTEXT.md says throw `NotConfigured` pre-spawn when mode is `'none'`. If unreachable, that code path is dead.
   - Recommendation: Plan for Option 1 (let Phase 5's post-spawn `NotConfigured` classifier handle it). Document `'none'` as reserved for future explicit opt-out. Add a test that verifies zero-env case returns `'adc'` with no warnings.

2. **Does Python `warnings.warn` need explicit de-duplication override?**
   - What we know: Python silences repeat `UserWarning`s for the same location by default.
   - What's unclear: Whether SC-2's "fires once per query() call" requires bypassing this silencing.
   - Recommendation: Planner tests both approaches empirically; if silencing triggers, fall back to `print(sys.stderr)` per Claude's-discretion area in CONTEXT.md.

3. **Will the invalid-key capture succeed on the Windows host?**
   - What we know: Phase 5 Plan 01 hit auth-isolation bypass on the same host; OAuth cache overrode `GEMINI_API_KEY=invalid`.
   - What's unclear: Whether adding `GEMINI_CONFIG_DIR=<temp>` + unset `GOOGLE_APPLICATION_CREDENTIALS` is enough, or whether a non-Windows capture host is required.
   - Recommendation: First task should be a capture-attempt spike. If it fails, mark fixture synthetic_blocked → defer to `follow-up-auth-isolation-hardening` (already tracked in STATE.md Blockers) and ship SC-3 with a synthetic fixture + spec `_throws` marker as Phase 5 did for `error-auth`.

4. **Where does the resolved mode surface to callers?**
   - What we know: CONTEXT.md says "Reported back to the caller via the `init` event's existing fields (no new event variant)."
   - What's unclear: Whether `init` has a field that accepts this, or whether it's a Phase-6-internal diagnostic only.
   - Recommendation: Check `ts/src/parser/types.ts` `SystemInitChunk` during planning; if no slot exists, keep resolved mode internal-only and surface via error `.message` text when `NotConfigured` fires.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.2 (TS); pytest + anyio (Python) |
| Config file | `ts/vitest.config.ts`; `python/pyproject.toml` |
| Quick run command | `cd ts && pnpm exec vitest run src/auth` / `cd python && uv run pytest tests/auth -x` |
| Full suite command | `cd ts && pnpm test` / `cd python && uv run pytest` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| AUT-01 | api-key mode detected; env passthrough | unit | `pnpm exec vitest run src/auth/resolveAuth.spec.ts -t "api-key only"` | ❌ Wave 1 |
| AUT-02 | vertex-sa mode detected; env passthrough | unit | `pnpm exec vitest run src/auth/resolveAuth.spec.ts -t "vertex-sa"` | ❌ Wave 1 |
| AUT-03 | vertex-key mode detected | unit | `pnpm exec vitest run src/auth/resolveAuth.spec.ts -t "vertex-key"` | ❌ Wave 1 |
| AUT-04 | GCP vars pass through in all modes | unit (EnvBuilder existing + auth spec) | `pnpm exec vitest run src/auth src/process/EnvBuilder` | ⚠️ partial — need auth-side assertion |
| AUT-05 | ADC fallback do-nothing; no `auth login` in source | unit + CI lint | `bash scripts/lint-auth-login.sh && pnpm exec vitest run src/auth` | ❌ Wave 1 (script + spec) |
| AUT-06 | Multi-mode warning with chain regex | unit | `pnpm exec vitest run src/auth/resolveAuth.spec.ts -t "multiple modes"` | ❌ Wave 1 |
| AUT-07 | AuthError subtype from invalid-key fixture | unit (fixture replay) | `pnpm exec vitest run src/errors/errorMapperCorpus -t "error-auth-invalid-key"` | ❌ Wave 2 (needs fixture) |
| AUT-08 | Docs link to #22970 | manual-only | Review `docs/auth.md` contents | ❌ Wave 2 |
| AUT-09 | No `GOOGLE_AUTH_TOKEN` in allowlist; doc mentions | unit + manual | `pnpm exec vitest run src/process/EnvBuilder -t "does NOT leak"` + doc review | ⚠️ partial — existing test covers allowlist, need doc entry |

### Sampling Rate
- **Per task commit:** `pnpm exec vitest run src/auth` (TS) + `uv run pytest tests/auth -x` (Python) — both < 5s.
- **Per wave merge:** `pnpm test && uv run pytest && bash scripts/lint-errors.sh && bash scripts/lint-auth-login.sh && bash scripts/diff-test-names.sh`.
- **Phase gate:** Full suite green + parity CI green + `scripts/validate-fixtures.mjs` green (for new invalid-key fixture).

### Wave 0 Gaps
- [ ] `ts/src/auth/resolveAuth.ts` + `ts/src/auth/index.ts` — new module
- [ ] `ts/src/auth/resolveAuth.spec.ts` — covers AUT-01..06
- [ ] `python/src/gemini_sdk/auth/__init__.py` + `resolve_auth.py` — new module
- [ ] `python/tests/auth/__init__.py` + `test_resolve_auth.py` — parity mirror
- [ ] `scripts/lint-auth-login.sh` — CI lint for AUT-05 / SC-4
- [ ] `.github/workflows/ci.yml` parity job — add `bash scripts/lint-auth-login.sh` step
- [ ] `scripts/capture-fixtures.{mjs,sh,cmd}` — add `--scenario invalid-key` branch
- [ ] `spec/fixtures/error-auth-invalid-key.{ndjson,stderr.txt,expected.json}` — new fixture
- [ ] `spec/fixtures.manifest.json` — add slug `error-auth-invalid-key` (may become synthetic_blocked if capture fails; see Open Question #3)
- [ ] `docs/auth.md` — new file covering precedence, AUT-08 #22970 rationale, AUT-09 no-bearer-token note
- [ ] `ts/src/query/query.ts` + `python/src/gemini_sdk/query/query.py` — one-line wiring (resolveAuth call + warning emission)

## Sources

### Primary (HIGH confidence)
- `D:/repos/Gemini-SDK/ts/src/process/EnvBuilder.ts` — allowlist contents verified (all 6 auth vars present + `GEMINI_CONFIG_DIR`)
- `D:/repos/Gemini-SDK/python/src/gemini_sdk/process/env_builder.py` — parity verified
- `D:/repos/Gemini-SDK/spec/errors.yaml` — AuthError subtypes verified (NotConfigured, Forbidden403, Expired, ToSViolation)
- `D:/repos/Gemini-SDK/ts/src/errors/ErrorMapper.ts` — classifyAuthSubtype logic verified (regex patterns already in place)
- `D:/repos/Gemini-SDK/ts/src/query/query.ts` — composition insertion points verified
- `D:/repos/Gemini-SDK/scripts/lint-errors.sh` — bash lint template verified
- `D:/repos/Gemini-SDK/.github/workflows/ci.yml` — parity job structure verified (line 80-97)
- `D:/repos/Gemini-SDK/spec/fixtures.manifest.json` — synthetic_blocked schema verified

### Secondary (MEDIUM confidence)
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md` (fetched 2026-04-15) — env var names verified; `GOOGLE_AUTH_TOKEN` confirmed absent; precedence unclear from upstream docs alone (project-specific chain is project's canonical source per roadmap)
- `.planning/phases/05-error-taxonomy-archon-5-bucket-mapping/05-CONTEXT.md` + STATE.md — Phase 5 decisions on synthetic_blocked + isolateOAuth gap

### Tertiary (LOW confidence)
- None — all claims verified against in-repo source or upstream docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all primitives exist in-repo and are verified by file read
- Architecture: HIGH — pattern locked by CONTEXT.md + established by Phases 2/4/5
- Pitfalls: HIGH (Pitfalls 1, 3, 5, 6) / MEDIUM (Pitfalls 2, 4 — depend on planner choices and host behavior)
- SC-3 fixture capture feasibility: MEDIUM — Phase 5 hit similar bypass; spike needed before committing to real capture vs. synthetic_blocked

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable internal code; re-verify upstream gemini-cli auth docs if #22970 routing change ships new env vars)
