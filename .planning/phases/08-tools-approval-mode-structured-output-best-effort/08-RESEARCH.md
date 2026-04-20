# Phase 8: Tools + Approval Mode + Structured Output (Best-Effort) - Research

**Researched:** 2026-04-19
**Domain:** argv extension (TOL-01..04), Zod/Pydantic schema validation (OUT-01..04), error taxonomy extension (SchemaValidationError)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `allowedTools?: string[]` — plain array, CSV-joined at argv boundary as `--allowed-tools <csv>`. Empty/undefined array omits flag entirely.
- No validation against known tool enum; unknown names pass through.
- `approvalMode` as const-object + union type mirroring Phase 4 `Model` pattern. Python: `str` Enum. Values: `default | auto_edit | yolo | plan`. Omit when undefined.
- No SDK-side warning when caller picks `'default'` in headless context. Docs-only caveat.
- No plan-mode branching in `query()`. No `SchemaValidationError` intercept for plan mode.
- `outputSchema?: Record<string, unknown>` (TS) / `output_schema: dict | None` (Python). JSON Schema plain object.
- Schema guidance appended AFTER caller's `systemPrompt` in temp file (SYS-01/02 pipeline).
- `outputSchema` only works with `queryFull()`. `query()`/`queryRaw()` throw `UnsupportedFeatureError` at pre-spawn guard.
- No `queryStructured<T>()` third public entry point. `QueryResult.structured?: unknown` optional field.
- Retry spawns a fresh subprocess (SpawnPerCallStrategy). Retry prompt appends validation feedback to original prompt. Retry reuses first call's session id via `--resume`. One retry only; second failure throws `SchemaValidationError`.
- `SchemaValidationError` added to `spec/errors.yaml` with new `source: 'sdk'` marker, `retryable: false`, `bucket: unknown`. Codegen + `lint-errors.sh` updated.
- `@experimental` JSDoc/docstring tag only; no runtime warning; no env-var gating.
- TOL-03 satisfied by Phase 11 compat probe (REL-06), not a Phase 8 runtime check.
- Emit `--allowed-tools` unconditionally (version-pinned assumption to .gemini-cli-compat range).
- No `outputSchemaTemplate` option in v1. Fixed template is implementation-internal.
- New module directories: `ts/src/output/` + `python/src/gemini_sdk/output/`.
- Tooling/ApprovalMode const may live inside `query/` or in a new `tools/` dir — planner's call.

### Claude's Discretion

- Exact file layout under `ts/src/tools/` / `ts/src/output/` (or combined `experimental/`).
- Whether `approvalMode` and `allowedTools` share a `tools/` directory or extend `buildArgv` in-place.
- Exact validator library wiring (Zod version, Pydantic TypeAdapter vs RootModel choice).
- Precise wording of schema-injection template and retry-feedback prompt.
- Whether retry second `query()` call passes `approvalMode: 'yolo'` internally.
- Whether `UnsupportedFeatureError` guard is pre-spawn (strongly preferred) or post-spawn.
- CLI fence-stripping heuristic (strip leading ` ```json ` + trailing ` ``` `) before validation.
- Whether `plan` + `outputSchema` combination raises `UnsupportedFeatureError` (empirically decide).

### Deferred Ideas (OUT OF SCOPE)

- Caller-defined custom tools via stub MCP (CTL-01..03, v2).
- `outputSchemaTemplate` option.
- Hard JSON-schema enforcement (blocked upstream #13388).
- Env-var gated experimental features.
- `queryStructured<T>()` third entry point.
- Multi-retry with progressive prompts.
- Runtime Policy-Engine probe (`--help` one-shot cache).
- Structured output for plan-mode (leave as caller beware unless empirical test fails).
- `ResultChunk.toolsRequested` / `.approvalDecisions` telemetry.
- Warning on `'default'` approvalMode in non-TTY at runtime.
- Typed tool-name enum for `allowedTools`.
- Schema injection at user-prompt level.
- SDK-internal crash retry loops.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TOL-01 | SDK passes `options.allowedTools` to `--allowed-tools` / Policy Engine | `--allowed-tools` confirmed in gemini-cli 0.37.1 (project pin); deprecated since 0.30.0 — still accepted. TOL-03 decision: emit unconditionally in v1; Phase 11 compat probe handles drift. |
| TOL-02 | SDK passes `options.approvalMode` to `--approval-mode` (`default`/`auto_edit`/`yolo`/`plan`) | `--approval-mode` confirmed current and non-deprecated. Four modes match upstream exactly. |
| TOL-03 | `--allowed-tools` → Policy Engine migration handled gracefully | CONTEXT locked: Phase 11 REL-06 compat probe is the declared bulwark; no Phase 8 runtime check. Research confirms `--allowed-tools` deprecated since 0.30.0, still accepted at 0.37.1. |
| TOL-04 | Document caller-defined custom tool definitions NOT supported in v1 | `docs/tools.md` prose only; no code change. |
| OUT-01 | `options.outputSchema` / `responseFormat` enables best-effort JSON schema mode | JSON Schema plain object is the wire format. Injection into temp system-prompt file via `writeTempSystemPrompt`. |
| OUT-02 | Best-effort mode injects schema guidance into system prompt + runtime-validates with Zod/Pydantic | Zod v4 (subpath `zod/v4`) + `zod-from-json-schema` 0.5.2 (TS); Pydantic v2.13.2 `TypeAdapter` (Python). |
| OUT-03 | Best-effort mode retries ONCE with feedback on failure, then raises `SchemaValidationError` | Fresh subprocess retry via SpawnPerCallStrategy. Session reused via Phase 7 `--resume`. SchemaValidationError new YAML entry. |
| OUT-04 | Structured output marked `@experimental` in types and docs; limitations documented (upstream #13388) | JSDoc `@experimental` tag + `docs/structured-output.md` Known Limitations section. No runtime warning. |
</phase_requirements>

---

## Summary

Phase 8 adds three new `QueryOptions` fields (`allowedTools`, `approvalMode`, `outputSchema`) and one new `QueryResult` field (`structured`). The tools/approvalMode work is essentially pure argv plumbing — two small branches added to `buildArgv` following the established Phase 4 pattern. The structured output work is the non-trivial part: a new `output/` module containing schema injection, Zod/Pydantic validation, and a one-shot retry loop inside `queryFull()`.

**Critical upstream finding:** `--allowed-tools` was deprecated in gemini-cli v0.30.0 (2026-02-25) in favor of a Policy Engine with a `--policy` flag. The project is pinned to 0.37.1, which is past the deprecation point. The CONTEXT.md locked decision is to emit `--allowed-tools` unconditionally under the version-pinned assumption — this is the correct choice for Phase 8. The flag still works at the pinned version, and there is a known regression bug (issue #16012) where `--allowed-tools` may fail with "denied by policy" in non-interactive headless mode (`-p`) on newer versions. Phase 11's compat probe (REL-06) is the declared bulwark for post-deprecation drift.

**Zod version situation:** The current npm `zod` package is at v4.3.6. Zod 4 is now the default export of `import 'zod'`. For the SDK to remain on Zod v3 semantics (as assumed in CONTEXT.md, since `zod-from-json-schema` originally required `^3`), the project should import from `zod/v3` subpath. However, `zod-from-json-schema` v0.5.2 supports both v3 and v4. The recommendation is to use Zod v4 directly (simpler install, current API) since the peer dependency constraint was a v3-only concern in older versions. See Standard Stack section.

**Primary recommendation:** Follow the CONTEXT.md implementation decisions exactly. The two small `buildArgv` branches are low-risk. Focus implementation effort on the `output/` module (schema injection + validation + retry); that is where complexity and test coverage matter most.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | `^4.3.6` (current) or `zod/v3` subpath | JSON Schema → Zod validator for TS side | Industry standard for TS schema validation; v4 is current default |
| `zod-from-json-schema` | `^0.5.2` | Convert incoming `Record<string, unknown>` JSON Schema to a Zod schema at runtime | Supports Zod v3 and v4; official CONTEXT.md choice |
| `pydantic` | `^2.13.2` (latest v2) | Python-side schema validation via `TypeAdapter` | Already project dependency declared in pyproject.toml; v2 has `TypeAdapter` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `crypto.randomBytes` | built-in | Unique temp file suffix | Already used in `writeTempSystemPrompt`; no new dependency |
| `anyio.Path` | existing | Python async file I/O | Already used throughout Python SDK |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `zod-from-json-schema` | `ajv` (JSON Schema validator only) | ajv validates but doesn't give you a typed Zod schema; CONTEXT.md chose Zod for type cohesion |
| Pydantic `TypeAdapter` | `jsonschema` library | jsonschema validates but doesn't give Pydantic structured output; Pydantic already in project |
| Zod v4 | Zod v3 subpath (`zod/v3`) | v3 subpath is available inside the `zod` package; use if `zod-from-json-schema` 0.5.2 has issues with v4 API |

**Installation (TS):**
```bash
# In ts/ directory, using pnpm:
pnpm add zod zod-from-json-schema
```

**Installation (Python):**
```bash
# pydantic must be added as a runtime dependency (currently only in the project UV environment)
# pyproject.toml [project].dependencies must include pydantic>=2.0
cd python && uv add pydantic
```

**NOTE:** Pydantic is NOT currently in `pyproject.toml`'s `[project].dependencies` — it was only added to the UV dev environment during research. It must be added as a runtime dependency for the output module to work in production.

---

## Architecture Patterns

### Recommended Project Structure

```
ts/src/
├── query/
│   ├── types.ts          # ADD: allowedTools, approvalMode, outputSchema to QueryOptions; structured to QueryResult; ApprovalMode const+type
│   ├── buildArgv.ts      # ADD: allowedTools CSV branch + approvalMode flag branch
│   └── query.ts          # ADD: pre-spawn UnsupportedFeatureError guard; extend writeTempSystemPrompt; queryFull validate+retry loop
├── output/               # NEW module directory (mirrors Phase 6 auth/, Phase 7 session/ pattern)
│   ├── injectSchema.ts   # Pure function: takes outputSchema + existing systemPrompt, returns combined string
│   ├── schemaValidator.ts # Pure function: takes Zod schema + raw string, returns parsed value or ValidationError
│   ├── retry.ts          # Pure function: builds retry-prompt string from original prompt + validator error + raw response
│   ├── injectSchema.spec.ts
│   ├── schemaValidator.spec.ts
│   └── retry.spec.ts
└── errors/
    └── errors.ts         # REGENERATED: gains SchemaValidationError class from updated YAML

python/src/gemini_sdk/
├── query/
│   ├── types.py          # ADD: allowed_tools, approval_mode, output_schema to QueryOptions; structured to QueryResult; ApprovalMode enum
│   ├── build_argv.py     # ADD: allowed_tools CSV branch + approval_mode flag branch
│   └── query.py          # ADD: pre-spawn UnsupportedFeatureError guard; extend _write_temp_system_prompt; query_full validate+retry
└── output/               # NEW module directory
    ├── __init__.py
    ├── inject_schema.py
    ├── schema_validator.py
    └── retry.py

spec/
└── errors.yaml           # ADD: SchemaValidationError with source: sdk

scripts/
├── gen-errors.mjs        # EXTEND: read source field, pass to codegen
├── gen-errors.py         # EXTEND: read source field, pass to codegen
└── lint-errors.sh        # EXTEND: tolerate source:sdk entries (no stderr regex required)

docs/
├── tools.md              # NEW: allowedTools + approvalMode guide; policy-engine migration note; --allowed-tools deprecation note
└── structured-output.md  # NEW: schema injection + retry + @experimental callout + Known Limitations #13388
```

### Pattern 1: ApprovalMode Const-Object + Union (mirrors Phase 4 Model)

**What:** A `const` object of known string values plus a union type that also accepts raw strings.
**When to use:** Any new enum-shaped option field in QueryOptions.
**Example (TS):**
```typescript
// Source: mirrors ts/src/query/types.ts Model pattern (Phase 4)
export const ApprovalMode = {
  DEFAULT: 'default',
  AUTO_EDIT: 'auto_edit',
  YOLO: 'yolo',
  PLAN: 'plan',
} as const;

export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode] | string;
```

**Example (Python):**
```python
# Source: mirrors python/src/gemini_sdk/query/types.py Model pattern
import enum

class ApprovalMode(str, enum.Enum):
    DEFAULT = 'default'
    AUTO_EDIT = 'auto_edit'
    YOLO = 'yolo'
    PLAN = 'plan'
```

### Pattern 2: buildArgv Additive Branches

**What:** Two new pure-function branches appended to `buildArgv`. Both skip their flag when their option is absent/empty.
**When to use:** Every new CLI flag option follows this pattern (Phase 4/7 precedent).
**Example (TS):**
```typescript
// After existing branches in buildArgv (ts/src/query/buildArgv.ts)

// TOL-01: --allowed-tools (skip when undefined or empty array)
if (options.allowedTools?.length) {
  argv.push('--allowed-tools', options.allowedTools.join(','));
}

// TOL-02: --approval-mode (skip when undefined)
if (options.approvalMode !== undefined) {
  argv.push('--approval-mode', options.approvalMode as string);
}
```

**Example (Python):**
```python
# After existing branches in build_argv (python/src/gemini_sdk/query/build_argv.py)

# TOL-01: --allowed-tools (skip when None or empty list)
allowed_tools = options.get("allowed_tools")
if allowed_tools:
    argv.extend(["--allowed-tools", ",".join(allowed_tools)])

# TOL-02: --approval-mode (skip when None)
approval_mode = options.get("approval_mode")
if approval_mode is not None:
    import enum as _enum
    mode_str = approval_mode.value if isinstance(approval_mode, _enum.Enum) else str(approval_mode)
    argv.extend(["--approval-mode", mode_str])
```

### Pattern 3: Pre-Spawn UnsupportedFeatureError Guard (mirrors Phase 7 InvalidPromptError guard)

**What:** Client-side guard that throws before any subprocess is spawned.
**When to use:** Cheap option-combination validation — invalid states that don't need subprocess input.
**Example (TS):**
```typescript
// In query() and queryRaw() — BEFORE resolveAuth (lowest cost, Phase 7 pattern)
if (options.outputSchema !== undefined) {
  throw new UnsupportedFeatureError(
    'outputSchema requires queryFull() — not supported on query()/queryRaw()'
  );
}
```

### Pattern 4: writeTempSystemPrompt Extension for Schema Injection

**What:** The existing `writeTempSystemPrompt` helper is extended to accept an optional `outputSchema` argument and append the schema-guidance block after the caller's systemPrompt.
**When to use:** When `outputSchema` is set on a `queryFull()` call.
**Example (TS):**
```typescript
// Extended signature (ts/src/query/query.ts)
async function writeTempSystemPrompt(
  systemPrompt: string | undefined,
  outputSchema?: Record<string, unknown>
): Promise<string | undefined> {
  if (!systemPrompt && !outputSchema) return undefined;
  const base = systemPrompt ?? '';
  let content = base;
  if (outputSchema) {
    const schemaBlock = buildSchemaInjectionBlock(outputSchema); // from output/injectSchema.ts
    content = base ? `${base}\n\n${schemaBlock}` : schemaBlock;
  }
  const suffix = randomBytes(8).toString('hex');
  const tempPath = join(tmpdir(), 'gemini-sdk-system-' + suffix + '.md');
  await writeFile(tempPath, content, 'utf-8');
  return tempPath;
}
```

### Pattern 5: queryFull() Validate + Retry Loop

**What:** After accumulating the full text, if `outputSchema` is set: strip markdown fences, validate with Zod/Pydantic, on success populate `result.structured`, on failure spawn a second `query()` with retry-feedback prompt + reused session, validate again, on second failure throw `SchemaValidationError`.
**When to use:** `queryFull()` only — streaming functions are excluded.
**Example (TS, post-accumulation):**
```typescript
// After the existing accumulation loop in queryFull()
if (options.outputSchema) {
  const stripped = stripMarkdownFences(text);  // from output/schemaValidator.ts
  const zodSchema = convertJsonSchemaToZod(options.outputSchema); // from zod-from-json-schema
  const firstResult = safeValidate(zodSchema, stripped);
  if (firstResult.success) {
    return { text, sessionId, session, stopReason, chunks, structured: firstResult.data };
  }
  // Retry: abortSignal propagated; second call gets retry-feedback prompt
  if (options.abortSignal?.aborted) throw new AbortError();
  const retryOptions = buildRetryOptions(options, text, firstResult.error, session);
  const retryResult = await queryFull(retryOptions);  // NB: recurse with modified options
  const stripped2 = stripMarkdownFences(retryResult.text);
  const secondResult = safeValidate(zodSchema, stripped2);
  if (secondResult.success) {
    return { ...retryResult, structured: secondResult.data };
  }
  throw new SchemaValidationError(secondResult.error.message);
}
return { text, sessionId, session, stopReason, chunks };
```

### Pattern 6: errors.yaml source Discriminator

**What:** New `source: 'sdk'` field on `SchemaValidationError` entry. Codegen passes it through; `lint-errors.sh` tolerates missing stderr regex for `source: 'sdk'` entries.
**When to use:** Any error class thrown directly by SDK code (not from subprocess stderr/exit classification).
**Example (YAML):**
```yaml
- name: SchemaValidationError
  base: GeminiError
  source: sdk          # New field: 'stderr' (default) | 'sdk'
  bucket: unknown
  retryable: false
  description: >
    SDK could not coerce queryFull() output into the caller's outputSchema
    after one retry. See OUT-04 and docs/structured-output.md for limitations
    (linked to upstream issue #13388).
```

### Anti-Patterns to Avoid

- **Calling `query()` with `outputSchema`:** Must throw `UnsupportedFeatureError` pre-spawn. Never silently ignore the option.
- **Modifying `ErrorMapper` for `SchemaValidationError`:** It is thrown directly by `queryFull()`; `ErrorMapper` classifies subprocess exit+stderr only.
- **Importing from `zod` root when you need v3 behavior:** If `zod-from-json-schema` 0.5.2 requires v3 API, import from `zod/v3` subpath. Check at implementation time.
- **Recursing into `queryFull()` for retry without stripping `outputSchema`:** The recursive call for retry must NOT pass `outputSchema` — it would re-inject the schema and create an infinite loop if validation fails again. The retry appends schema guidance via the retry-feedback prompt directly; `outputSchema` should be omitted on the second call.
- **CSV-joining tool names with spaces or quotes:** gemini-cli tool names are `snake_case` or `mcp__server__tool` identifiers. No quoting needed in v1. Don't add shell-quoting.
- **Emitting `--allowed-tools` as multiple flags:** The CLI expects `--allowed-tools tool1,tool2` (single CSV value), not `--allowed-tools tool1 --allowed-tools tool2`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON Schema → runtime validator (TS) | Custom recursive schema interpreter | `zod-from-json-schema` | Handles all JSON Schema keywords including `$ref`, `allOf`, `anyOf`, enum, format; hand-rolled misses dozens of edge cases |
| JSON Schema → runtime validator (Python) | Custom recursive schema interpreter | Pydantic v2 `TypeAdapter` + `model_validate_json` | Pydantic handles type coercion, required fields, nested objects; hand-rolled breaks on null, additional properties, etc. |
| Zod validation error message extraction | Custom error walk | `error.message` (Zod ZodError) / `str(e)` (Pydantic ValidationError) | Both provide human-readable messages suitable for the retry prompt |

**Key insight:** Schema validation has N=∞ edge cases in JSON Schema spec compliance. Both Zod and Pydantic have invested years of work in spec compliance. The retry prompt feeds the validator's error message directly to the model — rich, specific messages improve retry success rates.

---

## Common Pitfalls

### Pitfall 1: Zod v4 API Differences from v3

**What goes wrong:** `convertJsonSchemaToZod` (from `zod-from-json-schema`) may return a Zod v4 schema when `zod@4` is installed; calling `.parse()` works the same way in v4, but `.safeParse()` error structure changed (`error.errors` is now `error.issues` in v4).
**Why it happens:** Zod v4 is now the default when you `import 'zod'`. The package at npm is v4.3.6.
**How to avoid:** At implementation time, verify the installed `zod-from-json-schema` version returns a v4-compatible schema. Use `zodSchema.safeParse(data)` — the return shape `{ success, data, error }` is unchanged; only `error.issues` vs `error.errors` naming differs for error access.
**Warning signs:** `TypeError: zodSchema.safeParse is not a function` or `error.errors is undefined` in tests.

### Pitfall 2: --allowed-tools Deprecated + Bug in Non-Interactive Mode

**What goes wrong:** On gemini-cli versions >= 0.30.0 (which includes the pinned 0.37.1), `--allowed-tools` is deprecated. More critically, issue #16012 reports it fails with "denied by policy" in non-interactive headless mode (`-p` flag), which is exactly how the SDK operates.
**Why it happens:** Policy engine enforcement was added in 0.30.0; a regression caused `--allowed-tools` to be denied by the policy engine itself in non-interactive mode.
**How to avoid:** This is documented in `docs/tools.md` Known Issues. SDK emits the flag; if it fails at runtime, the user gets an error from the subprocess (classified by ErrorMapper). The CONTEXT.md decision is to NOT add runtime probing — this is working as designed per the pinned-version contract.
**Warning signs:** Test fixtures that test `--allowed-tools` behavior may need to be marked as `synthetic_blocked` if they can't be captured on the current host.

### Pitfall 3: Pydantic Not in pyproject.toml Runtime Dependencies

**What goes wrong:** `import pydantic` fails at runtime on a fresh `pip install gemini-sdk` because pydantic is not listed in `[project].dependencies`.
**Why it happens:** During development, pydantic was added to the UV dev environment but not to the published package metadata.
**How to avoid:** The `output/` module implementation task MUST update `python/pyproject.toml` to add `pydantic>=2.0` to `[project].dependencies`.
**Warning signs:** `ModuleNotFoundError: No module named 'pydantic'` on fresh install.

### Pitfall 4: Recursive queryFull() Retry Includes outputSchema Again

**What goes wrong:** Retry call passes the full original `options` including `outputSchema`, causing the retry's `writeTempSystemPrompt` to inject the schema block again, and potentially triggering another retry loop.
**Why it happens:** Copying `options` for the retry without stripping `outputSchema`.
**How to avoid:** Build retry options explicitly: start from original `options`, replace `prompt` with the retry feedback prompt, replace `session` with the first call's session, and explicitly set `outputSchema: undefined` (or omit it). The schema guidance is already embedded in the retry prompt text directly.
**Warning signs:** `Maximum call stack size exceeded` or retry calling itself in tests.

### Pitfall 5: Markdown Fence Stripping Missing Edge Cases

**What goes wrong:** LLM wraps JSON in ` ```json\n{...}\n``` ` or ` ```\n{...}\n``` ` or adds trailing whitespace. Feeding fenced text to JSON.parse / model_validate_json throws SyntaxError before the validator even runs.
**Why it happens:** The model often defaults to markdown-formatted output even when told not to.
**How to avoid:** Strip ` ```json ` (with or without `json` tag) + trailing ` ``` ` using a conservative regex BEFORE attempting parse/validation. Do it in `schemaValidator.ts` / `schema_validator.py` before calling the validator. Example: `/^```(?:json)?\n?([\s\S]*?)\n?```$/s`.
**Warning signs:** `SyntaxError: Unexpected token in JSON` in tests when the mock returns fenced JSON.

### Pitfall 6: ApprovalMode Python str Enum .value vs str()

**What goes wrong:** `str(ApprovalMode.YOLO)` returns `'ApprovalMode.YOLO'`, not `'yolo'`. The Phase 4 Model enum has this exact same pitfall documented in project STATE.md.
**Why it happens:** Python `str(enum_member)` uses the enum class name prefix.
**How to avoid:** Use `approval_mode.value` when inserting into argv, not `str(approval_mode)`. This pattern is already in `build_argv.py` for the `model` field — copy it exactly.
**Warning signs:** `--approval-mode ApprovalMode.YOLO` appearing in argv during tests.

---

## Code Examples

### Schema Injection Block Template (injectSchema.ts)

```typescript
// Source: CONTEXT.md §outputSchema input shape + injection
export function buildSchemaInjectionBlock(schema: Record<string, unknown>): string {
  return [
    '## Required Output Format',
    'Your response MUST be valid JSON matching this JSON Schema:',
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    '',
    'Return ONLY the JSON object. No prose, no markdown fences in the output.',
  ].join('\n');
}
```

### Markdown Fence Stripping (schemaValidator.ts)

```typescript
// Source: CONTEXT.md Claude's Discretion + Pitfall 5 above
const FENCE_RE = /^```(?:json)?\r?\n?([\s\S]*?)\r?\n?```$/s;

export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const match = FENCE_RE.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}
```

### Zod Validation from JSON Schema (schemaValidator.ts)

```typescript
// Source: zod-from-json-schema 0.5.2 API
import { convertJsonSchemaToZod } from 'zod-from-json-schema';

export function validateWithSchema(
  schema: Record<string, unknown>,
  text: string,
): { success: true; data: unknown } | { success: false; error: Error } {
  const stripped = stripMarkdownFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    return { success: false, error: new Error(`JSON parse failed: ${(e as Error).message}`) };
  }
  const zodSchema = convertJsonSchemaToZod(schema);
  const result = zodSchema.safeParse(parsed);
  if (result.success) return { success: true, data: result.data };
  // Zod v4: result.error.issues; Zod v3: result.error.errors — both have .message on the error object
  return { success: false, error: new Error(result.error.message) };
}
```

### Pydantic TypeAdapter Validation (schema_validator.py)

```python
# Source: CONTEXT.md §outputSchema + Pydantic v2 TypeAdapter
import json
from typing import Any
from pydantic import TypeAdapter, ValidationError

def validate_with_schema(schema: dict, text: str) -> tuple[bool, Any, str]:
    """
    Returns (success, data, error_message).
    """
    stripped = strip_markdown_fences(text)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as e:
        return False, None, f"JSON parse failed: {e}"
    # TypeAdapter(Any) + model_json_schema roundtrip is complex;
    # simpler approach: use pydantic's model_validate with a RootModel
    # wrapping the JSON schema as a dict type (Python side validates dict shape).
    # For v1 best-effort, validate that output is valid JSON + matches structure.
    # Full Pydantic JSON Schema validation: use TypeAdapter with json_schema constraints.
    try:
        # Best-effort: validate that the parsed value is a dict (for object schemas)
        # TypeAdapter(dict) validates the outer type only; full JSON Schema via pydantic
        # requires a generated model, which is overkill for v1 best-effort.
        adapter = TypeAdapter(Any)
        validated = adapter.validate_python(parsed)
        return True, validated, ""
    except ValidationError as e:
        return False, None, str(e)
```

**NOTE:** The Python validation approach requires a design decision at implementation time. Full JSON Schema → Pydantic model conversion is non-trivial without a library equivalent to `zod-from-json-schema`. The CONTEXT.md says "Pydantic v2 `TypeAdapter`/`RootModel` for validation" but does not name a JSON-Schema-to-Pydantic-model adapter. See Open Questions below.

### Retry Options Builder (retry.ts)

```typescript
// Source: CONTEXT.md §Retry mechanism
export function buildRetryPrompt(
  originalPrompt: string,
  validatorError: string,
  rawResponse: string,
): string {
  return [
    originalPrompt,
    '',
    'Your previous response was invalid JSON for the required schema.',
    `Validator error: ${validatorError}`,
    'Your previous response was:',
    '```',
    rawResponse,
    '```',
    '',
    'Return ONLY valid JSON matching the schema.',
  ].join('\n');
}
```

### errors.yaml SchemaValidationError Entry

```yaml
# Source: CONTEXT.md §SchemaValidationError classification
- name: SchemaValidationError
  base: GeminiError
  source: sdk          # new field — codegen + lint-errors.sh must handle this
  bucket: unknown
  retryable: false
  description: >
    SDK could not coerce queryFull() output into the caller's outputSchema
    after one retry. See docs/structured-output.md Known Limitations.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--allowed-tools` flag | Policy Engine (TOML rules files, `--policy` flag) | gemini-cli 0.30.0 (2026-02-25) | SDK still emits `--allowed-tools` for pinned range; works at 0.37.1 but flag is deprecated |
| Zod v3 only | Zod v4 is default npm package; v3 accessible via `zod/v3` subpath | Zod 3.25.0+ (2025) | Install `zod` gets v4.3.6; subpath `zod/v3` gets v3; `zod-from-json-schema` supports both |
| `@yolo` flag for headless | `--approval-mode yolo` | Early gemini-cli versions | `--yolo` deprecated in favor of `--approval-mode yolo`; SDK uses the current flag |

**Deprecated/outdated:**
- `--allowed-tools`: deprecated since 0.30.0; still functional at 0.37.1 but has known regression in headless non-interactive mode (issue #16012)
- `--yolo` flag: deprecated; use `--approval-mode yolo` instead (SDK uses `--approval-mode`, correct)

---

## Open Questions

1. **Python JSON Schema validation library depth**
   - What we know: CONTEXT.md says "Pydantic v2 TypeAdapter or RootModel"; Pydantic's `TypeAdapter` validates Python types, not arbitrary JSON Schema objects directly. For full JSON Schema validation in Python, a library like `jsonschema` or a Pydantic model generator is needed.
   - What's unclear: Should Python v1 best-effort simply validate that output is valid JSON (structural check only), with Pydantic TypeAdapter validating that it matches a `dict` type? Or should we use `python-jsonschema` as an additional dependency?
   - Recommendation: Use `jsonschema` library for Python-side JSON Schema validation (it is `pip install jsonschema`, widely used, maps directly to the JSON Schema spec). Pydantic TypeAdapter for the structured Python object. If `jsonschema` adds too much overhead, fall back to `isinstance(parsed, dict)` as a minimal best-effort check and document it as such. Decide at implementation time based on dependency cost tolerance.

2. **zod-from-json-schema v0.5.2 + Zod v4 compatibility**
   - What we know: The npm package `zod` is now at v4.3.6 as default. `zod-from-json-schema` v0.5.2 "supports both Zod v3 and v4" per search results.
   - What's unclear: The exact import incantation — does it auto-detect which zod version to use, or does it need the `zod/v4` subpath to be passed?
   - Recommendation: At implementation time, install `zod@^4` + `zod-from-json-schema@^0.5.2`, verify with a quick unit test that `convertJsonSchemaToZod({ type: 'object', properties: { x: { type: 'string' } }, required: ['x'] })` returns a callable `.safeParse`. If Zod v4 API has issues, add `"zod": "zod/v3"` as an npm alias.

3. **--allowed-tools headless regression (issue #16012)**
   - What we know: Issue #16012 reports `--allowed-tools` fails with "denied by policy" in `-p` headless mode at some gemini-cli versions.
   - What's unclear: Whether this is fixed in 0.37.1 (the pinned version) or still present.
   - Recommendation: Capture a real fixture if possible during Phase 8 (scenario: `--allowed-tools` with a known built-in tool in headless mode). If the bug is present at 0.37.1, mark the fixture `synthetic_blocked` and add a note in `docs/tools.md`. The SDK should NOT work around it in code — that would be papering over a contract issue.

4. **Retry: should it pass `approvalMode: 'yolo'` internally?**
   - What we know: CONTEXT.md marks this as Claude's Discretion.
   - What's unclear: If the caller passes `approvalMode: 'default'` and the first queryFull() result fails validation, the retry will also use `approvalMode: 'default'`, which may block on approval prompts in headless contexts.
   - Recommendation: Pass the original `approvalMode` unchanged. If the caller set `'default'` and it blocks, that is consistent with the documented caveat about `'default'` in non-TTY contexts. Injecting `'yolo'` silently would be a surprising side-effect. Planner should make the final call.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | vitest ^3.2 |
| Framework (Python) | pytest ^8.0 + hypothesis ^6.0 |
| Config file (TS) | ts/vitest.config.ts |
| Config file (Python) | python/pyproject.toml `[tool.pytest.ini_options]` |
| Quick run command (TS) | `cd ts && pnpm test` |
| Quick run command (Python) | `cd python && uv run pytest tests/ -x` |
| Full suite command (TS) | `cd ts && pnpm test` |
| Full suite command (Python) | `cd python && uv run pytest tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TOL-01 | `allowedTools` CSV branch in buildArgv; empty/undefined omits flag | unit | `cd ts && pnpm test -- buildArgv` | ❌ Wave 0 |
| TOL-01 (Py) | `allowed_tools` CSV branch in build_argv | unit | `cd python && uv run pytest tests/test_build_argv.py -x` | ❌ Wave 0 |
| TOL-02 | `approvalMode` flag branch in buildArgv; undefined omits flag | unit | `cd ts && pnpm test -- buildArgv` | ❌ Wave 0 |
| TOL-02 (Py) | `approval_mode` flag branch in build_argv | unit | `cd python && uv run pytest tests/test_build_argv.py -x` | ❌ Wave 0 |
| TOL-03 | `--allowed-tools` emitted unconditionally (no runtime probe) | unit (negative test — assert no probe subprocess) | `cd ts && pnpm test -- buildArgv` | ❌ Wave 0 |
| TOL-04 | No `customTools` or CTL-style option accepted | doc-only + type check | `cd ts && pnpm typecheck` | N/A (type-level) |
| OUT-01 | `outputSchema` set → schema block appended to temp system prompt | unit (injectSchema) | `cd ts && pnpm test -- injectSchema` | ❌ Wave 0 |
| OUT-01 (Py) | `output_schema` set → schema block appended to temp prompt | unit | `cd python && uv run pytest tests/output/ -x` | ❌ Wave 0 |
| OUT-02 | Valid JSON response → validated → `QueryResult.structured` populated | unit (schemaValidator + queryFull mock) | `cd ts && pnpm test -- schemaValidator` | ❌ Wave 0 |
| OUT-02 (Py) | Python validator produces structured output | unit | `cd python && uv run pytest tests/output/ -x` | ❌ Wave 0 |
| OUT-03 | Invalid → retry once with feedback → second success → structured | unit (queryFull with mock double-spawn) | `cd ts && pnpm test -- query.spec` | ❌ Wave 0 |
| OUT-03 | Invalid → retry once → still invalid → SchemaValidationError | unit | `cd ts && pnpm test -- query.spec` | ❌ Wave 0 |
| OUT-03 (Py) | Python retry loop | unit | `cd python && uv run pytest tests/test_query.py -x` | ❌ Wave 0 |
| OUT-04 | `@experimental` tag present on outputSchema, QueryResult.structured, SchemaValidationError | type-check (tsc --noEmit) | `cd ts && pnpm typecheck` | N/A |
| SchemaValidationError | Class exists in both TS and Python; lint-errors.sh passes | integration | `bash scripts/lint-errors.sh` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd ts && pnpm test` + `cd python && uv run pytest tests/ -x`
- **Per wave merge:** `bash scripts/lint-errors.sh && cd ts && pnpm test && cd python && uv run pytest tests/`
- **Phase gate:** Full suite green + `diff-test-names.sh` parity passing before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `ts/src/output/injectSchema.spec.ts` — covers OUT-01 schema injection template
- [ ] `ts/src/output/schemaValidator.spec.ts` — covers OUT-02 validation + fence-stripping
- [ ] `ts/src/output/retry.spec.ts` — covers OUT-03 retry prompt construction
- [ ] `python/tests/output/__init__.py` + `python/tests/output/test_inject_schema.py` — Python mirrors
- [ ] `python/tests/output/test_schema_validator.py`
- [ ] `python/tests/output/test_retry.py`
- [ ] New test cases in `ts/src/query/buildArgv.spec.ts` — TOL-01/02 allowedTools + approvalMode branches
- [ ] New test cases in `python/tests/test_build_argv.py` — same
- [ ] New test cases in `ts/src/query/query.spec.ts` — OUT-03 double-spawn retry scenario + UnsupportedFeatureError guard
- [ ] New test cases in `python/tests/test_query.py` — same
- [ ] Framework install: `pydantic>=2.0` must be added to `python/pyproject.toml [project].dependencies`
- [ ] TS runtime dependency: `zod` + `zod-from-json-schema` must be added to `ts/package.json dependencies` (not devDependencies)

---

## Sources

### Primary (HIGH confidence)

- `.planning/phases/08-tools-approval-mode-structured-output-best-effort/08-CONTEXT.md` — All locked decisions; canonical reference
- `ts/src/query/types.ts`, `buildArgv.ts`, `query.ts` — Actual Phase 4/7 code verified directly
- `python/src/gemini_sdk/query/types.py`, `build_argv.py`, `query.py` — Python mirrors verified
- `spec/errors.yaml` — Current error taxonomy structure verified
- `scripts/gen-errors.mjs`, `scripts/gen-errors.py`, `scripts/lint-errors.sh` — Codegen pipeline verified
- `python/pyproject.toml`, `ts/package.json` — Current dependency declarations verified

### Secondary (MEDIUM confidence)

- [gemini-cli CLI reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md) — `--approval-mode` values confirmed current; `--allowed-tools` confirmed deprecated (verified via WebFetch)
- [gemini-cli changelog](https://geminicli.com/docs/changelogs/) — Policy Engine introduced v0.30.0; `--allowed-tools` deprecated same version (verified via WebFetch; 2026-02-25 date)
- [gemini-cli Policy Engine](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md) — Policy Engine mechanics; `--policy` flag as replacement (verified via WebFetch)
- [Zod v4 release notes](https://zod.dev/v4) — v4 is now default npm package; v3 subpath available; `zod/v4` subpath works forever
- [Pydantic TypeAdapter docs](https://docs.pydantic.dev/latest/concepts/type_adapter/) — TypeAdapter API confirmed for v2; `validate_python()` method

### Tertiary (LOW confidence)

- [gemini-cli issue #16012](https://github.com/google-gemini/gemini-cli/issues/16012) — `--allowed-tools` "denied by policy" regression in headless mode (WebSearch; single issue thread)
- [zod-from-json-schema npm](https://www.npmjs.com/package/zod-from-json-schema) — v0.5.2 supports both Zod v3 and v4 (WebSearch; needs verification at install time)

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — Zod/Pydantic choices match CONTEXT.md; versions verified via pnpm/uv; existing patterns in codebase confirmed
- Architecture: HIGH — All patterns derived from actual existing code in Phase 4/6/7; new `output/` module follows established `auth/`/`session/` precedent
- Pitfalls: MEDIUM-HIGH — Zod v4 API differences verified via WebSearch + zod.dev; `--allowed-tools` deprecation verified via upstream changelog; Python pydantic missing from pyproject verified empirically
- Upstream CLI flags: MEDIUM — `--approval-mode` confirmed; `--allowed-tools` deprecated status confirmed; exact Policy Engine replacement flag (`--policy`) confirmed; issue #16012 regression LOW confidence (WebSearch only)

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (30 days for stable stack; upstream gemini-cli moves fast — re-verify if compat pin changes)
