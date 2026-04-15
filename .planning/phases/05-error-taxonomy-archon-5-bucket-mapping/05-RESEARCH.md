# Phase 5: Error Taxonomy + Archon 5-Bucket Mapping - Research

**Researched:** 2026-04-14
**Domain:** TypeScript + Python error hierarchy design, YAML-driven codegen, pattern-matching classifier, subprocess stderr capture
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**YAML schema design**
- Stderr matchers: Regex strings (e.g. `/UNAUTHENTICATED|API key not valid/i`). TS uses `RegExp`, Python uses `re.compile`. Same source, both languages interpret the subset identically.
- AuthError subtypes: Separate top-level YAML entries per subtype (`NotConfigured`, `Forbidden403`, `Expired`, `ToSViolation`) with `parent: AuthError`. Codegen emits distinct classes — one-to-one with typed class hierarchy. Clearest for the linter; preserves `instanceof` narrowing.
- Exit-code matching: Optional `exit_codes: [1]` field per entry. Omit when exit code isn't discriminating. Matches the shape already used in `spec/errors.md` §3.
- Retryable + retryAfterMs: `retryable: true|false` is a static YAML field per entry. Optional `retry_after_ms_source` names a matcher-captured group (e.g. `error.retryAfter`) so `RateLimitError` can surface real upstream `Retry-After` hints when present (ERR-02). Static default + dynamic extraction.

**ErrorMapper integration**
- Two entry points, one taxonomy (ERR-05):
  - Stream-json `{"type":"error"}` events → `dispatch()` calls `ErrorMapper` and throws the typed error inline.
  - Exit-code + stderr path → `query()` calls `ErrorMapper` in a `finally`/`catch` block when the subprocess exits non-zero, passing `(exitCode, stderrTail, lastEvents)`.
  - Both paths MUST resolve to the identical typed class for the same underlying condition.
- Stderr capture: `ProcessManager` attaches a listener to `child.stderr` and keeps the last 4–8 KiB in a ring buffer. Exposes `.getStderrTail()`. Bounded memory, enough bytes for all fingerprints in `spec/errors.md`.
- AbortError relocation: Move `AbortError` from `ts/src/query/types.ts` into the errors module as a subclass of `ProcessError` (which is itself a `GeminiError`). Defined in `errors.yaml`. `query/types.ts` may re-export for backward-compat within the repo during the migration.
- ERR-06 detection ("stream ended without terminal result"): `query()` tracks a `sawResult` flag. If the generator reaches end-of-stream (or the subprocess exits) without `sawResult === true`, `query()` throws `ProcessError` via `ErrorMapper` — regardless of exit code (even on exit 0, per ERR-06).

**Codegen strategy**
- Script-based codegen: `scripts/gen-errors.mjs` emits `ts/src/errors.ts`; `scripts/gen-errors.py` emits `python/src/gemini_sdk/errors.py`. Generated files carry an `// AUTO-GENERATED` header. Matches the repo's existing script-heavy style.
- Generated files are committed: Developer runs the codegen after editing YAML. CI runs the script and `git diff --exit-code` to fail merge on drift. Mirrors how `spec/events.schema.json` → generated types already works in Phases 1/3.
- Single linter script: `scripts/lint-errors.sh` handles both responsibilities: (1) re-run codegen and diff against committed files; (2) import `errors.ts` and `errors.py`, enumerate classes, cross-check against YAML. One CI job, one failure point. Satisfies ERR-07 and PAR-05 together.

**Synthetic fixture handling**
- Re-capture as a Phase 5 prerequisite: Before `ErrorMapper` implementation, re-capture `spec/fixtures/error-auth.*` and `spec/fixtures/error-rate-limit.*` against a real API-key-only host. Update `.ndjson` + `.stderr.txt` + `.expected.json`, remove `"synthetic": true` sidecars. Real stderr regex patterns derived from what gemini-cli actually emits.
- Unknown-pattern fallback: Any unmatched failure (exit!=0, no stream error, unknown stderr) becomes a generic `GeminiError` with `.bucket = 'unknown'`, `.retryable = false`. Include stderr tail + exit code in `.message` for debugging.
- Contract test shape: A parametrized data-driven test in each language iterates every `spec/fixtures/*.stderr.txt` + its `.ndjson` sibling, runs both the stream-json and exit-code+stderr paths through `ErrorMapper`, and asserts identical typed class + `.retryable` + `.retryAfterMs` + bucket.

### Claude's Discretion
- Exact regex syntax subset that's portable between TS `RegExp` and Python `re` (likely avoid look-around variants beyond the basics)
- Generated file formatting (prettier/ruff config)
- Exact ring buffer implementation in `ProcessManager` (simple byte-capped array vs circular buffer)
- Whether `ProcessError` and `ProcessCrashError` are siblings or parent-child in the hierarchy (spec/errors.md lists both; refine during planning)
- Error message templating (string interpolation vs static strings per class)

### Deferred Ideas (OUT OF SCOPE)
- Model-deprecation captures (post-2026-06-17 for 2.5 series) — defer until models are actively deprecated
- Content-policy-violation capture (`InvalidPromptError`) — synthesize from docs in Phase 5; live capture deferred
- Streaming cost hooks / per-error telemetry — out of SDK scope per PROJECT.md
- Error message i18n — not in v1 scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ERR-01 | Typed error hierarchy: `GeminiError` base + 10 named subtypes (RateLimitError, AuthError with subtypes, ModelAccessError, InvalidPromptError, ProcessError, ProcessCrashError, ParseError, AbortError, UnsupportedFeatureError, GeminiNotFoundError) | Class hierarchy design, existing GeminiNotFoundError + AbortError to reparent |
| ERR-02 | Every error carries `.retryable: boolean` and optional `.retryAfterMs?: number` | YAML `retryable` field + `retry_after_ms_source` dynamic extraction pattern |
| ERR-03 | Error classes map 1:1 to Archon's 5 retry buckets: `rate_limit / auth / model_access / crash / unknown` | Bucket assignment table per class |
| ERR-04 | `ErrorMapper` pattern-matches `(exit code, stderr tail, last events)` into typed errors; pattern table versioned in `spec/errors.md` | Classifier logic, two-path routing |
| ERR-05 | Stream-json `error` events and exit-code+stderr matching both produce the same typed errors | Integration points in dispatch.ts + query.ts |
| ERR-06 | SDK raises `ProcessError` if the stream ends without a terminal `result` event, even on exit code 0 | `sawResult` flag in query.ts + query.py |
| ERR-07 | CI linter cross-checks `spec/errors.md` against both TS and Python implementations | `scripts/lint-errors.sh` design |
| PAR-05 | Error taxonomy generated from one YAML source consumed by both SDKs | `spec/errors.yaml` + `scripts/gen-errors.mjs` + `scripts/gen-errors.py` |
</phase_requirements>

---

## Summary

Phase 5 is a pure internal-consistency phase: no new public API surface, no new CLI flag handling. Its job is to replace the ad-hoc error handling already scattered across `dispatch.ts` (throws generic `Error` for non-rate-limit stream errors), `query.ts`/`query.py` (no exit-code-path error classification exists yet), and the pre-existing `GeminiNotFoundError` + `AbortError` classes (both extend plain `Error`, not a `GeminiError` base). The deliverable is a typed, YAML-driven error taxonomy with a single `ErrorMapper` that is called from exactly two integration points.

The core technical work divides into four wave-shaped steps: (1) fixture re-capture to establish real stderr patterns, (2) YAML schema authoring + codegen scripts, (3) `ErrorMapper` implementation + `ProcessManager` stderr ring buffer + `query()` `sawResult` instrumentation, and (4) CI linter wiring. The pattern-matching logic is deliberately simple — the classifier is an ordered list of predicates (stream event match first, then exit-code + stderr regex match, then unknown fallback). No inference, no heuristics beyond what's in `spec/errors.md`.

The biggest risks are: (a) the synthetic error fixtures don't match real gemini-cli output, which blocks writing accurate regexes — fixture re-capture must happen as Wave 0 or Wave 1 before `ErrorMapper` tests can be written; (b) the `ProcessManager` stderr pipe is not currently attached at all, so there is infrastructure work before the pattern-matching logic can be tested end-to-end.

**Primary recommendation:** Wave the phase as: fixture-capture → YAML + codegen → ErrorMapper + stderr ring buffer + query() instrumentation → dispatch integration → CI linter. Every wave produces a self-consistent, passing test suite before the next wave starts.

---

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|---|---|---|---|
| `js-yaml` (TS) | `^4.1` | Parse `spec/errors.yaml` inside `scripts/gen-errors.mjs` | Already used in similar codegen scripts across the ecosystem; no heavy deps |
| `PyYAML` (Python) | `^6.0` | Parse `spec/errors.yaml` inside `scripts/gen-errors.py` | Standard Python YAML parser; already in the Python ecosystem; comes with `uv` |
| `vitest` | `^3.2` (pinned) | TS test runner for contract + unit tests | Already pinned in `ts/package.json`; Vitest 4 dropped Node 18 (CI requires 18) |
| `pytest` | `>=8.0` | Python test runner | Already declared in `python/pyproject.toml` |

### Supporting
| Library/Tool | Version | Purpose | When to Use |
|---|---|---|---|
| `git diff --exit-code` | built-in | CI drift detection | After re-running codegen, fail if generated files changed |
| Node `fs/promises` | built-in | File writing in codegen scripts | Codegen output to `ts/src/errors.ts` |
| Python `pathlib` | built-in | File writing in codegen scripts | Codegen output to `python/src/gemini_sdk/errors.py` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom codegen scripts | Third-party error-class generator | Project already uses custom codegen; third-party generators add a dep with unclear benefit for a ~15-class hierarchy |
| `js-yaml` | `yaml` (npm package) | Both work; `js-yaml` has simpler API for object parsing and is the de facto standard in the Node ecosystem |
| Ordered regex list in ErrorMapper | Priority queue / weighted classifier | Simple ordered list is auditable, matches spec table order, easy to add entries |

**Installation:**
```bash
# TS codegen dep (devDependency)
cd ts && pnpm add -D js-yaml @types/js-yaml

# Python codegen dep (dev dep; PyYAML likely already present via uv)
cd python && uv add --dev pyyaml
```

---

## Architecture Patterns

### Recommended Project Structure

New files to create in Phase 5:

```
spec/
└── errors.yaml                          # Single source of truth (to be created)

scripts/
├── gen-errors.mjs                       # Emits ts/src/errors.ts from YAML
├── gen-errors.py                        # Emits python/src/gemini_sdk/errors.py from YAML
└── lint-errors.sh                       # CI: re-run codegen + diff + class cross-check

ts/src/errors/
├── index.ts                             # (exists) barrel — extend to export all generated + ErrorMapper
├── GeminiNotFoundError.ts               # (exists) — reparent to extend GeminiError
└── errors.ts                            # AUTO-GENERATED — full class hierarchy

ts/src/
└── process/
    └── ProcessManager.ts                # (exists) — add stderr ring buffer + getStderrTail()

python/src/gemini_sdk/errors/
├── __init__.py                          # (exists) barrel — extend to export all generated
├── not_found.py                         # (exists) — reparent to extend GeminiError
└── errors.py                            # AUTO-GENERATED — full class hierarchy

python/src/gemini_sdk/process/
└── process_manager.py                   # (exists) — add stderr ring buffer + get_stderr_tail()
```

### Pattern 1: YAML Error Entry Schema

Each entry in `spec/errors.yaml` represents one error class. AuthError subtypes use `parent:` to declare their parent class.

```yaml
# spec/errors.yaml (illustrative schema)
errors:
  - name: GeminiError
    base: Error
    bucket: unknown
    retryable: false
    message_template: "Gemini CLI error: {message}"

  - name: RateLimitError
    base: GeminiError
    bucket: rate_limit
    retryable: true
    retry_after_ms_source: "error.retryAfter"   # optional: named capture group
    stream_matchers:
      - code: 429
      - status: "RESOURCE_EXHAUSTED"
    stderr_patterns:
      - "/quota|RESOURCE_EXHAUSTED|429|Too Many Requests/i"
    exit_codes: [1]

  - name: AuthError
    base: GeminiError
    bucket: auth
    retryable: false
    stream_matchers:
      - code: 401
      - status: "UNAUTHENTICATED"
    stderr_patterns:
      - "/API key not valid|UNAUTHENTICATED|401/i"
    exit_codes: [1]

  - name: NotConfigured
    parent: AuthError         # subtype — emits as inner class or separate class
    base: AuthError
    bucket: auth
    retryable: false
    stderr_patterns:
      - "/no API key|not configured|GEMINI_API_KEY/i"

  - name: Forbidden403
    parent: AuthError
    base: AuthError
    bucket: auth
    retryable: false
    stream_matchers:
      - code: 403
    stderr_patterns:
      - "/403|PERMISSION_DENIED|Forbidden/i"

  - name: Expired
    parent: AuthError
    base: AuthError
    bucket: auth
    retryable: false
    stderr_patterns:
      - "/token expired|oauth.*expired/i"

  - name: ToSViolation
    parent: AuthError
    base: AuthError
    bucket: auth
    retryable: false
    stderr_patterns:
      - "/Terms of Service|ToS|account suspended/i"

  - name: ModelAccessError
    base: GeminiError
    bucket: model_access
    retryable: false
    stream_matchers:
      - code: 404
      - status: "NOT_FOUND"
    stderr_patterns:
      - "/model.*not found|deprecated|not available/i"

  - name: InvalidPromptError
    base: GeminiError
    bucket: unknown
    retryable: false
    stream_matchers:
      - code: 400
      - status: "INVALID_ARGUMENT"
    stderr_patterns:
      - "/invalid.*prompt|content policy|safety/i"

  - name: ProcessError
    base: GeminiError
    bucket: crash
    retryable: false

  - name: ProcessCrashError
    base: ProcessError        # child of ProcessError
    bucket: crash
    retryable: false
    exit_codes: [1, 2, 137, 143]  # non-zero exits not matched by other patterns

  - name: AbortError
    base: ProcessError        # relocated from query/types.ts
    bucket: crash
    retryable: false

  - name: ParseError
    base: GeminiError
    bucket: unknown
    retryable: false

  - name: UnsupportedFeatureError
    base: GeminiError
    bucket: unknown
    retryable: false

  - name: GeminiNotFoundError
    base: GeminiError         # reparented from plain Error
    bucket: unknown
    retryable: false
```

### Pattern 2: Generated TypeScript Error Class

`scripts/gen-errors.mjs` reads the YAML and emits a single `ts/src/errors/errors.ts`:

```typescript
// ts/src/errors/errors.ts
// AUTO-GENERATED by scripts/gen-errors.mjs — DO NOT EDIT DIRECTLY
// Source: spec/errors.yaml

export type ArchonBucket = 'rate_limit' | 'auth' | 'model_access' | 'crash' | 'unknown';

export class GeminiError extends Error {
  readonly bucket: ArchonBucket = 'unknown';
  readonly retryable: boolean = false;
  readonly retryAfterMs?: number;

  constructor(message?: string, options?: { retryAfterMs?: number }) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
    if (options?.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

export class RateLimitError extends GeminiError {
  override readonly bucket: ArchonBucket = 'rate_limit';
  override readonly retryable = true as const;
  constructor(message?: string, options?: { retryAfterMs?: number }) {
    super(message ?? 'Rate limit exceeded', options);
  }
}

// ... (all classes follow same pattern, generated from YAML)
```

Key: `Object.setPrototypeOf(this, new.target.prototype)` is required in every constructor for correct `instanceof` checks across TypeScript compilation targets.

### Pattern 3: Generated Python Error Class

```python
# python/src/gemini_sdk/errors/errors.py
# AUTO-GENERATED by scripts/gen-errors.py — DO NOT EDIT DIRECTLY
# Source: spec/errors.yaml

from __future__ import annotations
from typing import Literal, Optional

ArchonBucket = Literal['rate_limit', 'auth', 'model_access', 'crash', 'unknown']

class GeminiError(Exception):
    bucket: ArchonBucket = 'unknown'
    retryable: bool = False
    retry_after_ms: Optional[int] = None

    def __init__(self, message: str = '', *, retry_after_ms: Optional[int] = None) -> None:
        super().__init__(message)
        if retry_after_ms is not None:
            self.retry_after_ms = retry_after_ms

class RateLimitError(GeminiError):
    bucket: ArchonBucket = 'rate_limit'
    retryable: bool = True
    def __init__(self, message: str = 'Rate limit exceeded', **kwargs) -> None:
        super().__init__(message, **kwargs)

# ... (all classes follow same pattern, generated from YAML)
```

Note: Python uses `retry_after_ms` (snake_case) while TS uses `retryAfterMs` (camelCase). The YAML `retry_after_ms_source` field name is snake_case; each codegen script transforms to its language convention.

### Pattern 4: ErrorMapper — Ordered Classifier

The `ErrorMapper` is a simple ordered list of predicates. Stream-event matching happens before exit-code+stderr matching. First match wins.

```typescript
// ts/src/errors/ErrorMapper.ts (hand-written, not generated)
import type { RawEvent } from '../parser/types.js';
import { GeminiError, RateLimitError, AuthError, /* ... */ } from './errors.js';

interface StreamErrorEvent {
  type: 'error';
  error: { code?: number; status?: string; message?: string; retryAfter?: number };
}

export class ErrorMapper {
  /** Stream-json path: called from dispatch() for {"type":"error"} events */
  static fromStreamEvent(event: StreamErrorEvent): GeminiError {
    const { code, status, message, retryAfter } = event.error;
    if (code === 429 || status === 'RESOURCE_EXHAUSTED') {
      return new RateLimitError(message, { retryAfterMs: retryAfter ? retryAfter * 1000 : undefined });
    }
    if (code === 401 || status === 'UNAUTHENTICATED') {
      return classifyAuthSubtype(message ?? '');
    }
    if (code === 403 || status === 'PERMISSION_DENIED') {
      return new AuthError.Forbidden403(message);
    }
    // ... more cases from YAML
    return new GeminiError(message ?? 'Unknown error from stream event');
  }

  /** Exit-code + stderr path: called from query() finally block on non-zero exit */
  static fromExit(exitCode: number, stderrTail: string, _lastEvents: RawEvent[]): GeminiError {
    if (/quota|RESOURCE_EXHAUSTED|429|Too Many Requests/i.test(stderrTail)) {
      return new RateLimitError(extractMessage(stderrTail));
    }
    if (/API key not valid|UNAUTHENTICATED|401/i.test(stderrTail)) {
      return classifyAuthSubtype(stderrTail);
    }
    // ... more cases from YAML
    // Unknown fallback
    return new GeminiError(
      `Process exited with code ${exitCode}. Stderr: ${stderrTail.slice(-200)}`
    );
  }
}
```

The patterns in `ErrorMapper` are derived directly from the YAML `stream_matchers` and `stderr_patterns` fields. The codegen script can optionally emit `ErrorMapper` as well, OR the linter validates that hand-written `ErrorMapper` cases match YAML entries.

**Decision for planning:** Since `ErrorMapper` has runtime logic (ordered matching, conditional branching), it is better hand-written and validated by the linter. The linter ensures every YAML class has a corresponding case in the mapper.

### Pattern 5: Stderr Ring Buffer in ProcessManager

```typescript
// In ProcessManager.spawn(), after calling strategy.spawn():
const RING_LIMIT = 8192; // 8 KiB
let stderrBuf = '';

if (child.stderr) {
  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
    if (stderrBuf.length > RING_LIMIT) {
      stderrBuf = stderrBuf.slice(stderrBuf.length - RING_LIMIT);
    }
  });
}

child.getStderrTail = () => stderrBuf;
```

The `ChildProcess` object does not support arbitrary property addition natively — a thin wrapper or a closure over the spawned child is needed. The cleanest approach: `ProcessManager.spawn()` returns a typed `SpawnResult` wrapper that includes `getStderrTail(): string` alongside the `ChildProcess`.

### Pattern 6: query() sawResult Flag (ERR-06)

```typescript
// In query() generator, inside the try block:
let sawResult = false;

for await (const chunk of chunks) {
  if (chunk.type === 'result') sawResult = true;
  // ... existing logic
  yield chunk;
}

// After the for-await loop (still in try, before finally):
if (!sawResult && !aborted) {
  // Stream ended without a terminal result event — even if exit 0
  const stderrTail = child.getStderrTail();
  throw ErrorMapper.fromExit(child.exitCode ?? 0, stderrTail, []);
}
```

The `child.exitCode` may be `null` when the process hasn't exited cleanly yet. Using `child.exitCode ?? 0` is safe here since we're past the stream-end point.

### Anti-Patterns to Avoid

- **Generating ErrorMapper from YAML:** The mapper has control flow (ordered predicates, conditional branching) that is harder to generate than class declarations. Hand-write the mapper; let the linter validate completeness.
- **Extending native Error without `Object.setPrototypeOf`:** TypeScript compiling to ES5 breaks `instanceof` checks without the prototype fix. The existing `AbortError` and `GeminiNotFoundError` already include this pattern — generated classes must too.
- **Attaching stderr listener after spawn in a separate call:** Race condition — stderr data could arrive before the listener is attached. Attach inside `spawn()` synchronously on the `ChildProcess` stream reference, before returning.
- **Using regex lookahead/lookbehind in YAML patterns:** Python `re` supports these, but the decision is to avoid them for portability simplicity. Basic character classes + alternation only.
- **Two separate `ErrorMapper` implementations (one TS, one Python):** Both languages' mappers should use the same YAML-sourced patterns. Extract pattern constants from the generated file into ErrorMapper at import time.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing in codegen | Custom text parser | `js-yaml` (TS) / `PyYAML` (Python) | YAML has edge cases (multiline strings, special chars in regex) that custom parsers miss |
| Error hierarchy drift detection | Manual checklist | `git diff --exit-code` after re-running codegen in CI | Exact same pattern as `spec/events.schema.json` codegen drift detection already in this repo |
| `instanceof` chain across module boundaries | Structural type checking | `Object.setPrototypeOf` in constructor | Already established pattern in the existing `AbortError` and `GeminiNotFoundError` |

**Key insight:** The codegen complexity here is low (15 classes, simple templates). A 100-line Node.js script is sufficient. Do not reach for a full code generation framework.

---

## Common Pitfalls

### Pitfall 1: Missing `Object.setPrototypeOf` in Generated TS Classes
**What goes wrong:** `error instanceof RateLimitError` returns `false` at runtime when TS is compiled to ES5/CommonJS, because the prototype chain is not set correctly.
**Why it happens:** TypeScript transpiles `class` extends to ES5 constructor functions, which don't automatically fix the prototype.
**How to avoid:** Every generated class constructor MUST call `Object.setPrototypeOf(this, new.target.prototype)`. The existing `AbortError` at line 95 of `ts/src/query/types.ts` shows the correct pattern.
**Warning signs:** `error instanceof GeminiError` is `false` in test assertions.

### Pitfall 2: Stderr Listener Attached Too Late (Race Condition)
**What goes wrong:** First few bytes of stderr arrive before the listener is registered, lost from ring buffer, causing the ErrorMapper to fall back to `unknown` when it should have matched.
**Why it happens:** `ProcessManager.spawn()` currently returns a `ChildProcess` without any stderr attachment. If the caller tries to attach a listener after the return, data events can fire immediately.
**How to avoid:** Attach the stderr listener synchronously inside `spawn()` before returning, using the `data` event on the stream that Node.js buffers until the next tick.
**Warning signs:** Tests that simulate fast-exiting processes (e.g., immediate exit with stderr) show empty stderrTail.

### Pitfall 3: Synthetic Fixtures Don't Match Real Stderr Format
**What goes wrong:** `ErrorMapper` regex patterns are written against the synthetic stderr text in `spec/fixtures/error-auth.stderr.txt`, but real gemini-cli 0.37.1 on an API-key-only host produces different stderr.
**Why it happens:** Phase 1 captures used OAuth auth; synthetic stderr was constructed from documentation.
**How to avoid:** Re-capture `error-auth.*` and `error-rate-limit.*` before writing any regex patterns. Make fixture re-capture Wave 0 of Phase 5.
**Warning signs:** `lint-errors.sh` passes but a live integration test fails to classify a real auth error.

### Pitfall 4: `sawResult` Check Position in query() Generator
**What goes wrong:** `sawResult` check fires after `finally` cleanup runs, meaning `ErrorMapper.fromExit()` is called after the subprocess is already killed and stderr is cleared.
**Why it happens:** Misplacing the `sawResult` check inside `finally` rather than in the try block after the for-await loop.
**How to avoid:** The `sawResult` check + `throw` must be the LAST statement inside the `try` block (after the for-await loop exits normally), before the `finally` block executes.
**Warning signs:** Test for ERR-06 throws `ProcessError` but with empty message/stderrTail.

### Pitfall 5: AbortError Relocation Breaks Existing Imports
**What goes wrong:** Code in `query.ts`, `query.spec.ts`, and tests already imports `AbortError` from `'./types.js'`. Moving it without re-exporting from the old location causes a compile error.
**Why it happens:** TypeScript import paths are resolved at compile time.
**How to avoid:** Add `export { AbortError } from '../errors/index.js'` to `ts/src/query/types.ts` during the transition. Python equivalent: keep `from ..errors import AbortError` re-export in `query/types.py`.
**Warning signs:** `tsc --noEmit` fails with "Module has no exported member 'AbortError'".

### Pitfall 6: CI Linter Script Uses PCRE-only Regex Syntax on macOS
**What goes wrong:** `scripts/lint-errors.sh` uses `grep -P` for pattern matching, which fails on macOS where `grep` is BSD-based (no PCRE support).
**Why it happens:** macOS `grep` does not support `-P`. This is a known issue — `diff-test-names.sh` already uses `-E` (ERE) because of this (Phase 2 decision in STATE.md).
**How to avoid:** Use `grep -E` (ERE) exclusively in `lint-errors.sh`. For complex patterns that need PCRE, delegate to `node -e` or `python3 -c` inline.
**Warning signs:** CI passes on Ubuntu but fails on macOS runner.

### Pitfall 7: Python `retry_after_ms` vs TS `retryAfterMs` Naming Drift
**What goes wrong:** Downstream code (Phase 6 auth errors, Phase 10 Archon adapter) expects consistent property names. If the TS property is `retryAfterMs` and Python is `retryAfterMs` (camelCase), the parity CI diff-test script may mask a real naming inconsistency.
**Why it happens:** YAML uses `retry_after_ms` (snake_case); TS codegen converts to camelCase, Python codegen keeps snake_case by Python convention.
**How to avoid:** Document the naming convention explicitly in `spec/errors.yaml` comments and in both codegen scripts. The linter should verify that both generated files have the property, even if named differently.
**Warning signs:** Archon adapter Phase 10 receives `undefined` for `retryAfterMs` when accessing a Python-originated error dict.

---

## Code Examples

### Existing AbortError Pattern (Baseline for All Generated Classes)
```typescript
// Source: ts/src/query/types.ts:89 (current location — to be relocated to errors/)
export class AbortError extends Error {
  readonly name = 'AbortError' as const;
  readonly retryable = false as const;

  constructor() {
    super('Query aborted by caller');
    // Restore prototype chain for instanceof checks across transpiler targets
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

### Existing GeminiNotFoundError (Baseline — Both Languages)
```typescript
// Source: ts/src/errors/GeminiNotFoundError.ts
export class GeminiNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? 'gemini-cli not found. Install it with: npm install -g @google/gemini-cli\n...');
    this.name = 'GeminiNotFoundError';
  }
}
// Phase 5: reparent to extend GeminiError; add bucket='unknown', retryable=false
```

```python
# Source: python/src/gemini_sdk/errors/not_found.py
class GeminiNotFoundError(Exception):
    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or ("gemini-cli not found..."))
# Phase 5: reparent to extend GeminiError; add bucket='unknown', retryable=False
```

### Existing dispatch.ts Error Handling (Integration Point)
```typescript
// Source: ts/src/parser/dispatch.ts:68-79
case 'error':
  if (isRateLimitError(event)) {
    yield { type: 'rate_limit', code: ..., message: ..., status: ... };
  } else {
    // Phase 5 will replace this with throw new GeminiError(...) from error taxonomy
    throw new Error(`Unhandled error event: ${JSON.stringify(event.error)}`);
  }
  break;
```

Phase 5 replacement:
```typescript
case 'error':
  // Phase 5: dispatch no longer handles rate_limit inline; ErrorMapper handles all error events
  throw ErrorMapper.fromStreamEvent(event as StreamErrorEvent);
```

Note: The existing `rate_limit` MessageChunk type in the dispatch output is currently yielded (not thrown) for 429 events. Phase 5 changes this behavior — both 429 and non-429 stream errors now throw. This is a **breaking change** to the dispatch output contract and must be reflected in updated `.expected.json` files for `error-rate-limit` fixture.

### ProcessManager Spawn Result Wrapper Pattern
```typescript
// ts/src/process/ProcessManager.ts — Phase 5 addition
export interface SpawnResult {
  child: ChildProcess;
  pid: number | undefined;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  getStderrTail(): string;
}
```

Currently `ProcessManager.spawn()` returns `ChildProcess` directly. Phase 5 wraps it in `SpawnResult` to expose `getStderrTail()` without polluting the `ChildProcess` interface.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Per-class manual error files (GeminiNotFoundError.ts, not_found.py) | Single YAML → generated classes for full hierarchy | Phase 5 | Codegen replaces hand-maintaining two files per class |
| `dispatch()` yields `{type:'rate_limit'}` chunk for 429 | `dispatch()` throws `RateLimitError` (via ErrorMapper) for ALL error events | Phase 5 | rate_limit MessageChunk type in Archon contract is replaced by typed exception |
| `AbortError` extends plain `Error` in `query/types.ts` | `AbortError` extends `ProcessError` extends `GeminiError` | Phase 5 | Enables `instanceof GeminiError` check for all error types |
| No stderr capture on subprocess | Ring buffer (8 KiB) in `ProcessManager`/`ProcessStrategy` | Phase 5 | Enables exit-code+stderr pattern matching |

**Note on rate_limit MessageChunk:** The current `dispatch.ts` yields a `{type:'rate_limit'}` MessageChunk for 429 stream errors. Phase 5 changes this to throw `RateLimitError`. This means callers of `query()` will receive `RateLimitError` as a thrown exception rather than as a yielded chunk. The `rate_limit` variant in the `MessageChunk` union (PRS-06) may become vestigial after Phase 5 — downstream phases (especially Phase 10 Archon adapter) need to know that rate_limit errors are now thrown, not yielded. The `.expected.json` for `error-rate-limit.ndjson` currently has `{type:'rate_limit'}` in its chunks array — this will need updating to `_throws: true` with `errorType: 'RateLimitError'`.

---

## Open Questions

1. **Does dispatch still yield rate_limit chunks, or throw RateLimitError?**
   - What we know: Current dispatch yields `{type:'rate_limit'}` for code 429. CONTEXT.md says "dispatch() calls ErrorMapper and throws". The existing `error-rate-limit.expected.json` has `{type:'rate_limit'}` in chunks.
   - What's unclear: Does Archon's adapter (Phase 10) need the yielded chunk for its own retry logic, or does it handle the thrown exception?
   - Recommendation: Throw from dispatch for all error events (including 429). Update `error-rate-limit.expected.json` to use `_throws: true`. Document that `rate_limit` MessageChunk type is no longer produced by the core generator.

2. **`ProcessCrashError` vs `ProcessError` hierarchy: siblings or parent-child?**
   - What we know: `spec/errors.md` lists both. CONTEXT.md marks this as Claude's Discretion.
   - What's unclear: Whether `ProcessCrashError` should be `extends ProcessCrashError` or `extends ProcessError`. For Archon's 5-bucket mapping, both map to `crash` — no functional difference.
   - Recommendation: Make `ProcessCrashError extends ProcessError`. Rationale: a crash IS a process error; `instanceof ProcessError` catches both, which is useful for callers that only care about "something went wrong with the subprocess."

3. **retryAfter field name in real gemini-cli 429 responses**
   - What we know: Synthetic fixture `error-rate-limit.ndjson` has no `retryAfter` field. `spec/errors.md §5` notes this is unknown.
   - What's unclear: The real field name in gemini-cli's JSON error object (could be `retryAfter`, `retry_after`, `retryDelay`, etc.).
   - Recommendation: The re-capture task (Wave 0) must specifically check for any timing hint in the 429 error event. Until confirmed, `retryAfterMs` defaults to `undefined` for `RateLimitError`.

4. **Ring buffer on ProcessManager vs SpawnResult**
   - What we know: `ProcessManager.spawn()` currently returns `ChildProcess` directly. `query.ts` accesses `child.pid`, `child.stdout` directly.
   - What's unclear: Whether to add a `SpawnResult` wrapper type or attach a method to the ChildProcess.
   - Recommendation: Return a `SpawnResult` wrapper. This avoids polluting the `ChildProcess` interface and aligns with a typed API contract. Callers (`query.ts`, `query.py`) need to be updated to use `spawnResult.child` or flatten the interface.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (TS) | Vitest ^3.2 |
| Framework (Python) | pytest >=8.0 |
| Config file (TS) | `ts/vitest.config.mts` |
| Config file (Python) | `python/pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command (TS) | `cd ts && pnpm test` |
| Quick run command (Python) | `cd python && uv run pytest` |
| Full suite command | `cd ts && pnpm test && cd ../python && uv run pytest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERR-01 | All 10 error classes exist and extend GeminiError | unit | `cd ts && pnpm test -- errors` | Wave 0 |
| ERR-02 | `.retryable` correct on each class; `retryAfterMs` populated from 429 stream event | unit | `cd ts && pnpm test -- errors` | Wave 0 |
| ERR-03 | Each class has `.bucket` matching Archon bucket enum | unit | `cd ts && pnpm test -- errors` | Wave 0 |
| ERR-04 | ErrorMapper.fromExit + fromStreamEvent produce correct typed class for each fixture | contract | `cd ts && pnpm test -- errorMapper` | Wave 0 |
| ERR-05 | Same fixture through both paths yields identical class + properties | contract | `cd ts && pnpm test -- errorMapper` | Wave 0 |
| ERR-06 | stream ending without result event → ProcessError (even on exit 0) | integration | `cd ts && pnpm test -- query` | Wave 0 |
| ERR-07 | lint-errors.sh exits 0 with real generated files, exits non-zero with drift | CI script | `bash scripts/lint-errors.sh` | Wave 0 |
| PAR-05 | Python error class names + bucket + retryable match TS 1:1 | parity | `bash scripts/diff-test-names.sh` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd ts && pnpm test -- src/errors`
- **Per wave merge:** `cd ts && pnpm test && cd ../python && uv run pytest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `ts/src/errors/errors.spec.ts` — covers ERR-01, ERR-02, ERR-03 (class declarations + properties)
- [ ] `ts/src/errors/errorMapper.spec.ts` — covers ERR-04, ERR-05 (both paths, per fixture)
- [ ] `python/tests/errors/test_errors.py` — Python counterpart for ERR-01..03
- [ ] `python/tests/errors/test_error_mapper.py` — Python counterpart for ERR-04, ERR-05
- [ ] Updated `ts/src/query/query.spec.ts` — add ERR-06 test case (sawResult flag)
- [ ] Updated `python/tests/query/test_query.py` — Python ERR-06 counterpart

---

## Integration Points Summary

These are the exact lines of existing code that Phase 5 modifies:

| File | Current Behavior | Phase 5 Change |
|------|-----------------|---------------|
| `ts/src/parser/dispatch.ts:68-79` | Yields rate_limit chunk for 429; throws generic Error for others | Replace with `throw ErrorMapper.fromStreamEvent(event)` |
| `ts/src/query/query.ts` (top of try block) | No sawResult flag | Add `let sawResult = false;` + `if (chunk.type === 'result') sawResult = true;` |
| `ts/src/query/query.ts` (after for-await) | Nothing | Add `if (!sawResult && !aborted) throw ErrorMapper.fromExit(...)` |
| `ts/src/query/types.ts:89` | `class AbortError extends Error` | Add re-export from new location; AbortError definition moves to `errors/errors.ts` |
| `ts/src/errors/GeminiNotFoundError.ts` | `extends Error` | `extends GeminiError` (from generated `errors.ts`) |
| `ts/src/errors/index.ts` | Exports only GeminiNotFoundError | Exports all generated classes + ErrorMapper |
| `ts/src/process/ProcessManager.ts:spawn()` | Returns ChildProcess | Returns SpawnResult with `getStderrTail()` |
| Python counterparts | Same pattern in Python files | Same changes in Python |
| `spec/fixtures/error-rate-limit.expected.json` | `{type:'rate_limit'}` chunk | `_throws: true, errorType: 'RateLimitError'` |
| `spec/fixtures/error-auth.expected.json` | `{_throws: true, errorType: 'GeminiError'}` | `errorType: 'AuthError'` (specific subtype after re-capture) |

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of: `ts/src/errors/GeminiNotFoundError.ts`, `ts/src/query/types.ts`, `ts/src/parser/dispatch.ts`, `ts/src/query/query.ts`, `ts/src/process/ProcessManager.ts`, Python counterparts
- `spec/errors.md` — normative draft with classifier logic, observed patterns, gaps
- `spec/fixtures/error-auth.*`, `error-rate-limit.*`, `abort-midstream.*` — fixture evidence
- `.planning/REQUIREMENTS.md` §"Error Taxonomy" and §"Parity" — ERR-01..07, PAR-05
- `.planning/phases/05-error-taxonomy-archon-5-bucket-mapping/05-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- STATE.md decisions log — confirmed patterns for codegen, diff-test-names, Windows grep -E requirement
- ROADMAP.md Phase 5 success criteria — contract test shapes, CI linter requirements

### Tertiary (LOW confidence — to be validated in Wave 0 re-capture)
- Synthetic stderr patterns in `spec/fixtures/error-auth.stderr.txt` and `error-rate-limit.stderr.txt` — SYNTHETIC, not from real CLI run
- `retryAfter` field presence in real 429 responses — unconfirmed per `spec/errors.md §5`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new external libraries; uses already-pinned vitest + pytest + js-yaml/PyYAML
- Architecture: HIGH — all patterns derived from existing code in repo; no speculation
- Integration points: HIGH — all identified from direct code inspection with line numbers
- Regex patterns: MEDIUM — based on synthetic fixtures; must be validated against real captures in Wave 0
- `retryAfterMs` extraction: LOW — field name in real gemini-cli 429 response unconfirmed

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable domain; gemini-cli error format unlikely to change within 30 days)
