# Phase 10: Archon Adapter (TS only) - Research

**Researched:** 2026-04-21
**Domain:** TypeScript adapter implementing `IAgentProvider` against Archon's `packages/providers` registry
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Contract test strategy (ARC-07)**
- CI clones `coleam00/Archon` at a pinned SHA recorded in `.archon-compat`. Adapter is symlinked into the clone's `node_modules` before tests run. No git submodule.
- Run Archon's own existing e2e workflow-dispatch suite unchanged with `DEFAULT_AI_ASSISTANT=gemini`. Passing Archon's suite is the proof.
- One gated CI job uses `GEMINI_API_KEY` against a cheap prompt; gated on main-branch + manual trigger. PR CI runs fixture-backed variant.
- Weekly scheduled CI re-pulls Archon's latest `main`, runs contract suite, opens issue if it breaks.

**Options mapping triage (ARC-05)**
- `spec/archon/mapping.md` is the canonical table. Adapter comments cite it; no duplicate inline table.
- Mirror Claude provider's mapping as starting point; diverge only when gemini-cli forces it.
- Generated drift test imports Archon's `SendQueryOptions`/`NodeConfig` type keys and asserts every key has an entry in `OPTION_MAPPING`. Unmapped → failing test.
- Silently dropped in prod; `console.warn` per field when `NODE_ENV=development` or `DEBUG=gemini-sdk:*`.

**PR packaging & timing (ARC-08)**
- Single PR on branch `gemini-sdk-integration` against `coleam00/Archon`.
- Files: `packages/providers/src/community/gemini/` directory, one-line edit in `registerCommunityProviders()`, `.env.example` entries.
- Open as draft during Phase 10. Flip to ready-for-review in Phase 11 after npm publish.
- GitHub tarball dep during draft; swap to `"^1.0.0"` before ready-for-review.

**Session & workflow_dispatch handover**
- Adapter is stateless. Positional `resumeSessionId` → `options.session` in `query()`.
- Session ID pulled from SDK's `init` event and stamped onto `result` chunk (Archon reads it from `result.sessionId`).
- Emit one `workflow_dispatch` MessageChunk per tool call the SDK surfaces.
- Adapter throws `GeminiError` subclasses unchanged; Archon's retry classifier reads `.bucket`.

**Env-var namespace linter (ARC-09)**
- Scope: `adapter-archon/src/**` only.
- Allowlist: `GEMINI_*`, `GEMINI_SDK_*`, `PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`, `NODE_ENV`, `DEBUG`.
- Hard CI failure. Shell script `scripts/lint-env-namespace.sh`, ~20 lines of bash.

### Claude's Discretion
- LOC budget enforcement mechanism (line-count CI check vs. review-time check; what counts as LOC).
- Exact pin SHA choice (latest `dev` branch at phase start or last-tagged release).
- Structure of `spec/archon/mapping.md` (single table vs. per-bucket sections).
- Exact shape of the drift-test assertion (snapshot vs. runtime reflection over Archon types).
- Fixture-vs-live CI job split details (matrix layout, caching).

### Deferred Ideas (OUT OF SCOPE)
- LOC budget enforcement (automated line-count gate, what counts) — Claude's discretion.
- Archon pin SHA selection — Claude's discretion at plan time.
- Importing `IAssistantClient` type directly from a published `@archon/core` npm package — depends on Archon publishing decisions; revisit Phase 11.
- Any v2 adapter enhancements (honoring the 4 deferred option fields) — out of scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ARC-01 | `adapter-archon/` subpackage implements Archon's `IAgentProvider` interface | Interface shape fully documented; stub already scaffolded in Phase 2 |
| ARC-02 | `GeminiProvider.sendQuery(prompt, cwd, resumeSessionId?, options?)` matches Archon's signature exactly | Confirmed signature from `packages/providers/src/types.ts` and all provider implementations |
| ARC-03 | `GeminiProvider.getType()` returns `'gemini'` | Confirmed pattern from `claude.ts` (returns `'claude'`), `codex.ts` (returns `'codex'`), `pi` (returns `'pi'`) |
| ARC-04 | Subpackage source-publishes `.ts` (Bun-based monorepo convention) | `adapter-archon/package.json` already has `exports` pointing to `./src/index.ts`; matches `@archon/providers` export pattern |
| ARC-05 | Translate `SendQueryOptions`/`NodeConfig` fields (11 honored, 4 partial, 4 deferred, 5 ignored) | `NodeConfig` fields catalogued; Pi provider's `options-translator.ts` provides reference pattern |
| ARC-06 | Adapter ≤ 200 LOC target (250 hard cap), business logic in SDK | SDK already provides all needed entry points; adapter is pure translation + delegation |
| ARC-07 | Contract tests prove `DEFAULT_AI_ASSISTANT=gemini` works in real Archon checkout | e2e workflow YAML pattern confirmed from `e2e-claude-smoke.yaml`; CI job structure understood |
| ARC-08 | PR against `coleam00/Archon` adding files | Repository structure confirmed; community provider PR pattern from Pi provider |
| ARC-09 | Grep-based CI linter fails merge on non-namespaced env vars | Allowlist defined; ~20-line bash script pattern confirmed from existing `scripts/lint-auth-login.sh` |
</phase_requirements>

---

## Summary

**Critical discovery: Archon's architecture changed.** The CONTEXT.md references (`packages/core/src/clients/claude.ts`, `packages/core/src/factory.ts`) are outdated. The live `dev` branch restructured providers into `packages/providers/` with a community-provider seam. The interface is now `IAgentProvider` (not `IAssistantClient`), the options type is `SendQueryOptions` (not `AssistantRequestOptions`), and the PR target is `packages/providers/src/community/gemini/` (not `packages/core/src/clients/gemini.ts`). The CONTEXT.md's "3-line factory.ts edit" becomes a 1-line addition to `registerCommunityProviders()` in `packages/providers/src/registry.ts`.

The good news: the community provider seam (introduced via the Pi provider) makes adding Gemini much cleaner than the CONTEXT.md envisioned. The Pi provider (`packages/providers/src/community/pi/`) is the definitive reference implementation — not `claude.ts`. Pi demonstrates multi-file community provider structure, `registerPiProvider()` registration pattern, and `options-translator.ts` separation. Our adapter follows this pattern.

The SDK surface is fully built. `query()` accepts `session` (for resume), `env`, `model`, `systemPrompt`, `cwd`, `allowedTools`, `approvalMode`, `outputSchema`, `mcpServers`, and `abortSignal` — covering all non-deferred `SendQueryOptions` fields. `GeminiError` subclasses already carry `.bucket` matching Archon's 5-bucket taxonomy with no translation needed.

**Primary recommendation:** Model the Gemini community provider on Pi's structure. Use `packages/providers/src/community/gemini/` as the PR target directory. The 1-line registry edit goes in `registerCommunityProviders()`. The adapter itself is straightforward delegation to `query()` from `@gemini-sdk/gemini`.

---

## Standard Stack

### Core (verified from Archon repo + existing SDK)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@gemini-sdk/gemini` | workspace (Phase 2 stub already in `adapter-archon/package.json`) | SDK entry point — `query()` generator | Only entry point into the SDK; adapter is a thin shim |
| `typescript` | `^5.6.3` (already in `adapter-archon/devDependencies`) | Type-checking adapter source | Source-published `.ts` requires tsc to work |
| `vitest` | `^3.2` (from `ts/package.json`) | Unit tests for adapter | Already pinned to avoid Vitest 4 / Node 18 breakage |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun` | Archon's runtime (1.3.11 in Archon CI) | Runs Archon's e2e suite in contract tests | Contract test job only — not a dependency of the adapter itself |
| `@archon/providers` types | source reference only (no npm dep during draft) | Drift-test imports `SendQueryOptions` / `NodeConfig` from Archon source during contract test | Drift test imports from cloned Archon source, not npm |

### Installation

```bash
# adapter-archon/package.json additions needed:
# "@gemini-sdk/gemini": "workspace:*"   (or file: dep for local dev)
# No new npm installs needed — everything else is already in the monorepo
```

---

## Architecture Patterns

### Actual Archon Provider Structure (verified from live `dev` branch)

```
packages/providers/src/
├── types.ts                     # IAgentProvider, SendQueryOptions, NodeConfig, MessageChunk
├── registry.ts                  # registerBuiltinProviders(), registerCommunityProviders()
├── index.ts                     # barrel: re-exports all providers + types
├── claude/
│   ├── provider.ts              # ClaudeProvider implements IAgentProvider
│   └── capabilities.ts         # CLAUDE_CAPABILITIES (all 13 flags = true)
├── codex/
│   ├── provider.ts              # CodexProvider implements IAgentProvider
│   └── capabilities.ts         # CODEX_CAPABILITIES (sessionResume, structuredOutput, envInjection = true; rest false)
└── community/
    └── pi/                      # Reference community provider
        ├── provider.ts
        ├── capabilities.ts
        ├── registration.ts      # registerPiProvider() → registerProvider()
        ├── options-translator.ts
        ├── event-bridge.ts
        └── index.ts
```

### Target PR Directory Structure

```
packages/providers/src/community/gemini/
├── provider.ts           # GeminiProvider implements IAgentProvider  (~150 LOC)
├── capabilities.ts       # GEMINI_CAPABILITIES
├── registration.ts       # registerGeminiProvider()
└── index.ts              # barrel export
```

The 1-line registry edit in `packages/providers/src/registry.ts`:

```typescript
// In registerCommunityProviders():
export function registerCommunityProviders(): void {
  registerPiProvider();
  registerGeminiProvider();   // ← add this line
}
```

### Pattern 1: IAgentProvider Interface (HIGH confidence — verified from types.ts)

```typescript
// Source: https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/types.ts
export interface IAgentProvider {
  sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: SendQueryOptions
  ): AsyncGenerator<MessageChunk>;
  getType(): string;
  getCapabilities(): ProviderCapabilities;
}
```

### Pattern 2: SendQueryOptions → SDK QueryOptions Translation

```typescript
// Source: verified from Archon types.ts + SDK QueryOptions (ts/src/query/types.ts)

// Archon's top-level options (AgentRequestOptions + SendQueryOptions):
interface AgentRequestOptions {
  model?: string;
  abortSignal?: AbortSignal;
  systemPrompt?: string;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  env?: Record<string, string>;
  maxBudgetUsd?: number;       // IGNORED — gemini-cli has no budget cap
  fallbackModel?: string;      // IGNORED — gemini-cli has no fallback
  forkSession?: boolean;       // IGNORED — gemini-cli has no fork
  persistSession?: boolean;    // IGNORED — gemini-cli has no persist
}
interface SendQueryOptions extends AgentRequestOptions {
  nodeConfig?: NodeConfig;
  assistantConfig?: Record<string, unknown>;  // IGNORED — Gemini uses env-based config
}

// NodeConfig fields relevant to Gemini:
interface NodeConfig {
  allowed_tools?: string[];    // → QueryOptions.allowedTools
  denied_tools?: string[];     // PARTIAL — no gemini-cli denied-tools flag; dev-warn
  effort?: string;             // DEFERRED — gemini-cli has no effort flag in v1
  thinking?: unknown;          // IGNORED — Claude-only per Archon Codex precedent
  betas?: string[];            // IGNORED — Claude-only
  sandbox?: unknown;           // IGNORED — Claude-only
  mcp?: string;                // PARTIAL — gemini-cli MCP via env, not node mcp path
  hooks?: unknown;             // DEFERRED — v2 only
  skills?: string[];           // DEFERRED — v2 only
  agents?: Record<string, ...>;// DEFERRED — v2 only
  output_format?: Record<...>; // → QueryOptions.outputSchema (partial: json_schema only)
  maxBudgetUsd?: number;       // IGNORED — same as top-level
  systemPrompt?: string;       // → QueryOptions.systemPrompt
  fallbackModel?: string;      // IGNORED
  idle_timeout?: number;       // PARTIAL — no direct SDK equivalent; dev-warn
}
```

### Pattern 3: GeminiProvider sendQuery Skeleton

```typescript
// Source: synthesized from ClaudeProvider.sendQuery pattern + SDK query() API
export class GeminiProvider implements IAgentProvider {
  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    const sdkOptions = translateOptions(prompt, cwd, resumeSessionId, requestOptions);
    // Dev-warn for each ignored/partial field (once per field, when NODE_ENV=development or DEBUG=gemini-sdk:*)
    warnIgnoredOptions(requestOptions);

    for await (const chunk of query(sdkOptions)) {
      // workflow_dispatch: emit one per tool chunk (mirroring claude.ts cadence)
      if (chunk.type === 'tool') {
        yield { type: 'workflow_dispatch', workerConversationId: '', workflowName: chunk.toolName };
      }
      yield chunk;
    }
  }

  getType(): string { return 'gemini'; }
  getCapabilities(): ProviderCapabilities { return GEMINI_CAPABILITIES; }
}
```

### Pattern 4: GEMINI_CAPABILITIES Declaration

```typescript
// Source: synthesized from CLAUDE_CAPABILITIES + CODEX_CAPABILITIES + gemini-cli feature set
export const GEMINI_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,         // Phase 7 --resume works
  mcp: true,                   // Phase 9 MCP passthrough
  hooks: false,                // v2 only
  skills: false,               // v2 only
  agents: false,               // v2 only
  toolRestrictions: true,      // --allowed-tools (partial: no denied_tools)
  structuredOutput: true,      // Phase 8 best-effort outputSchema
  envInjection: true,          // env override supported
  costControl: false,          // no gemini-cli budget cap
  effortControl: false,        // no gemini-cli effort flag in v1
  thinkingControl: false,      // headless mode, no thinking events
  fallbackModel: false,        // no gemini-cli fallback
  sandbox: false,              // Claude-only
};
```

### Pattern 5: Community Provider Registration

```typescript
// Source: packages/providers/src/community/pi/registration.ts
export function registerGeminiProvider(): void {
  if (isRegisteredProvider('gemini')) return;
  registerProvider({
    id: 'gemini',
    displayName: 'Gemini (Google)',
    factory: () => new GeminiProvider(),
    capabilities: GEMINI_CAPABILITIES,
    isModelCompatible: (model: string): boolean => {
      // Accept known gemini model names + raw strings; reject claude/codex aliases
      const claudeAliases = ['sonnet', 'opus', 'haiku'];
      return !claudeAliases.includes(model) && !model.startsWith('claude-');
    },
    builtIn: false,
  });
}
```

### Pattern 6: MessageChunk Alignment — SDK vs Archon

The SDK's `MessageChunk` (from `ts/src/parser/types.ts`) is structurally compatible with Archon's `MessageChunk` (from `packages/providers/src/types.ts`) for 7 of 8 variants. The adapter passes SDK chunks through **unmodified** except for two translations:

| SDK Chunk | Archon Chunk | Adapter Action |
|-----------|-------------|----------------|
| `{ type: 'assistant', content }` | `{ type: 'assistant', content }` | Pass through unchanged |
| `{ type: 'system', subtype, sessionId?, ... }` | `{ type: 'system', content }` | Map: emit `{ type: 'system', content: ... }` |
| `{ type: 'thinking', content }` | `{ type: 'thinking', content }` | Pass through unchanged |
| `{ type: 'result', sessionId, stopReason }` | `{ type: 'result', sessionId?, ... }` | Pass through (sessionId already present) |
| `{ type: 'rate_limit', ... }` | `{ type: 'rate_limit', rateLimitInfo }` | Map: wrap into `{ rateLimitInfo: chunk }` |
| `{ type: 'tool', toolName, toolId, parameters }` | `{ type: 'tool', toolName, toolInput, toolCallId }` | Map field names + emit `workflow_dispatch` |
| `{ type: 'tool_result', toolId, ... }` | `{ type: 'tool_result', toolName, toolOutput, toolCallId }` | Map field names |
| Never emitted by SDK | `{ type: 'workflow_dispatch', workerConversationId, workflowName }` | Adapter emits one per `tool` chunk |

**Key finding on `workflow_dispatch`:** Archon's `MessageChunk` requires `{ workerConversationId: string; workflowName: string }`. The `workerConversationId` is a Archon-internal conversation routing field. For the Gemini adapter, `workerConversationId` should be set to `''` (empty string) — the adapter does not have access to a worker conversation ID, and Claude's equivalent is also empty for direct tool calls (not sub-agent dispatch). The `workflowName` = `chunk.toolName`.

### Anti-Patterns to Avoid

- **Do not import from `@archon/providers` npm.** During draft PR, import the interface types via a local type-only import from the Archon source clone, or define them locally. Archon publishes `.ts` source, not a compiled npm package.
- **Do not add business logic to the adapter.** If translating an option requires more than 5 lines, push the logic into the SDK as a new `QueryOptions` field.
- **Do not emit `workflow_dispatch` for `tool_result` chunks.** Claude's pattern emits one `workflow_dispatch` per tool call initiation, not per result.
- **Do not construct a `Session` value object in the adapter.** Pass `resumeSessionId` directly as `options.session` (a string).
- **Do not reference `DEFAULT_AI_ASSISTANT` in the adapter source.** That env var is Archon's own routing; the adapter never reads it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session resume | Custom session ID tracking | `query({ session: resumeSessionId })` | SDK Phase 7 already handles `--resume` |
| Auth | Custom env-var injection for GEMINI_API_KEY | SDK's `resolveAuth()` inside `query()` | Phase 6 auth already wires GEMINI_API_KEY |
| Error classification | Re-classify Archon buckets | `GeminiError.bucket` already set by Phase 5 | Pass GeminiError through unchanged |
| Subprocess lifecycle | Managing gemini-cli process | `query()` owns the subprocess | Phase 4 query() handles spawn, kill, cleanup |
| System prompt | Temp file management | `query({ systemPrompt })` | Phase 4 SYS-01/SYS-02 already does this |
| MCP passthrough | Writing settings.json | `query({ mcpServers, allowedMcpServerNames })` | Phase 9 MCP-01..04 already built |
| Structured output | Schema injection + retry | `query({ outputSchema })` | Phase 8 OUT-01..04 already built |
| Binary discovery | Locating gemini binary | `GEMINI_BIN_PATH` → SDK's `BinaryResolver` | Phase 2 FDN-01 handles this |

**Key insight:** Every capability the adapter declares was already built in Phases 2–9. The adapter is pure translation — `SendQueryOptions → QueryOptions` — with no novel logic.

---

## Common Pitfalls

### Pitfall 1: Stale CONTEXT.md Interface References
**What goes wrong:** CONTEXT.md references `IAssistantClient`, `AssistantRequestOptions`, `packages/core/src/clients/`, and `factory.ts`. These are stale. The live Archon `dev` branch uses `IAgentProvider`, `SendQueryOptions`/`NodeConfig`, `packages/providers/src/community/`, and `registerCommunityProviders()`.
**Why it happens:** Archon refactored from a monolithic provider structure to a community provider registry (Phase 2 of Archon's own roadmap) after the CONTEXT.md was written.
**How to avoid:** Use the live Archon `dev` branch as the source of truth. All interface references in this RESEARCH are verified from `https://raw.githubusercontent.com/coleam00/Archon/dev/...`.
**Warning signs:** If you see `IAssistantClient` or `AssistantRequestOptions` in Archon source, you are on the wrong branch or file.

### Pitfall 2: MessageChunk Field Name Mismatches
**What goes wrong:** SDK's `ToolChunk` uses `toolId` and `parameters`; Archon's `MessageChunk.tool` uses `toolCallId` and `toolInput`. Passing SDK chunks through unchanged fails type checks.
**Why it happens:** The SDK was built before Phase 10 with Archon-shaped types but slight field name differences in the tool variants.
**How to avoid:** Write explicit mapping in the adapter for `tool` and `tool_result` chunks. See the chunk-alignment table above.
**Warning signs:** TypeScript errors on `toolId` vs `toolCallId`, `parameters` vs `toolInput`, `toolOutput` vs `output`.

### Pitfall 3: rate_limit Chunk Shape
**What goes wrong:** SDK's `RateLimitChunk` is `{ type: 'rate_limit', code, message, status? }`. Archon's is `{ type: 'rate_limit', rateLimitInfo: Record<string, unknown> }`.
**Why it happens:** Field naming differs. The SDK throws `RateLimitError` before emitting a chunk; rate_limit chunks are rarely seen in practice, but the type must be correct.
**How to avoid:** Wrap SDK chunk: `{ type: 'rate_limit', rateLimitInfo: { code, message, status } }`.

### Pitfall 4: workflow_dispatch workerConversationId
**What goes wrong:** Archon's `workflow_dispatch` type requires `workerConversationId: string`. This field is Archon-internal (the conversation ID of a sub-agent worker). The Gemini adapter has no sub-agent routing.
**How to avoid:** Emit `workerConversationId: ''` (empty string) for direct tool calls. Document in `spec/archon/mapping.md` that Gemini emits workflow_dispatch with empty workerConversationId, matching Archon's retry classifier expectations for non-subagent tool calls.

### Pitfall 5: Contract Test Clone Strategy
**What goes wrong:** Symlinking adapter into Archon's `node_modules/@archon/providers/community/gemini` may fail on Windows due to symlink permission requirements.
**Why it happens:** Windows requires admin or Developer Mode for symlink creation.
**How to avoid:** Use `npm link` or copy-based approach in CI (Linux only). Contract tests run on ubuntu-latest; Windows is not required for this job (unlike the SDK matrix). Note in CI YAML: `runs-on: ubuntu-latest`.

### Pitfall 6: LOC Bloat from Chunk Mapping
**What goes wrong:** Mapping all 8 MessageChunk variants with field renaming can add 40–60 lines. Combined with `OPTION_MAPPING` constant and dev-warn logic, the adapter risks exceeding 250 LOC.
**Why it happens:** TypeScript type guards are verbose.
**How to avoid:** Use a single `translateChunk()` function with type-narrowed switch. Keep OPTION_MAPPING as a plain `Record<string, 'honored'|'partial'|'deferred'|'ignored'>` constant (one line per field). Keep dev-warn in a single `warnIgnoredOptions()` function with a loop.

### Pitfall 7: Contract Test Archon Clone Auth
**What goes wrong:** Archon's e2e suite requires `DEFAULT_AI_ASSISTANT=gemini` to be set, which requires the adapter to be importable by Archon. Archon's Bun runtime needs to resolve `@archon/providers/community/gemini`.
**Why it happens:** Archon's community providers are workspace-local, not npm-published.
**How to avoid:** In contract test CI: clone Archon, copy `packages/providers/src/community/gemini/` into the clone's source tree, and run `bun install` in the clone before running the e2e suite. No symlink needed.

---

## Code Examples

### GeminiProvider skeleton (verified pattern from ClaudeProvider + PiProvider)

```typescript
// Source: synthesized from
//   https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/claude/provider.ts
//   https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/community/pi/provider.ts
//   D:/repos/Gemini-SDK/ts/src/query/query.ts

import { query } from '@gemini-sdk/gemini';
import type { QueryOptions } from '@gemini-sdk/gemini';
// Types imported from Archon source (local copy in contract tests; no npm dep during draft):
import type { IAgentProvider, SendQueryOptions, MessageChunk, ProviderCapabilities } from '../types.js';
import { GEMINI_CAPABILITIES } from './capabilities.js';
import { translateOptions, warnIgnoredOptions, translateChunk } from './options-translator.js';

export class GeminiProvider implements IAgentProvider {
  getType(): string { return 'gemini'; }

  getCapabilities(): ProviderCapabilities { return GEMINI_CAPABILITIES; }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    warnIgnoredOptions(requestOptions);
    const sdkOptions = translateOptions(prompt, cwd, resumeSessionId, requestOptions);

    for await (const sdkChunk of query(sdkOptions)) {
      // Emit workflow_dispatch for each tool invocation (mirrors claude.ts cadence)
      if (sdkChunk.type === 'tool') {
        yield {
          type: 'workflow_dispatch',
          workerConversationId: '',
          workflowName: sdkChunk.toolName,
        };
      }
      // Translate and yield the SDK chunk in Archon's shape
      yield translateChunk(sdkChunk);
    }
  }
}
```

### options-translator.ts core (verified option set)

```typescript
// Source: SDK QueryOptions (D:/repos/Gemini-SDK/ts/src/query/types.ts)
//         Archon SendQueryOptions + NodeConfig (packages/providers/src/types.ts)

// OPTION_MAPPING — consumed by drift test (must cover every SendQueryOptions + NodeConfig key)
// See spec/archon/mapping.md for full table with rationale.
export const OPTION_MAPPING = {
  // AgentRequestOptions (top-level)
  model:           'honored',
  abortSignal:     'honored',
  systemPrompt:    'honored',
  outputFormat:    'partial',    // json_schema only, best-effort
  env:             'honored',
  maxBudgetUsd:    'ignored',    // gemini-cli has no budget cap
  fallbackModel:   'ignored',    // gemini-cli has no fallback
  forkSession:     'ignored',    // gemini-cli has no fork
  persistSession:  'ignored',    // gemini-cli has no persist
  // SendQueryOptions extras
  nodeConfig:      'honored',    // honored at field level (individual fields vary)
  assistantConfig: 'ignored',    // Gemini is env-based, not config-based
  // NodeConfig fields
  allowed_tools:   'honored',
  denied_tools:    'partial',    // no gemini-cli denied-tools; dev-warn
  effort:          'deferred',   // no gemini-cli effort flag in v1
  thinking:        'ignored',    // Claude-only per Archon Codex precedent
  betas:           'ignored',    // Claude-only
  sandbox:         'ignored',    // Claude-only
  output_format:   'partial',    // json_schema only
  maxBudgetUsd_nc: 'ignored',    // same as top-level
  systemPrompt_nc: 'honored',    // nodeConfig.systemPrompt → sdkOptions.systemPrompt
  fallbackModel_nc:'ignored',
  idle_timeout:    'partial',    // no SDK equivalent; dev-warn
  mcp:             'partial',    // MCP supported but via SDK not Archon mcp string ref
  hooks:           'deferred',   // v2 only
  skills:          'deferred',   // v2 only
  agents:          'deferred',   // v2 only
} as const;

export function translateOptions(
  prompt: string,
  cwd: string,
  resumeSessionId?: string,
  opts?: SendQueryOptions
): QueryOptions {
  const nc = opts?.nodeConfig;
  return {
    prompt,
    cwd,
    session: resumeSessionId,                        // SES-02: --resume <id>
    model: opts?.model,                              // MDL-01/02
    abortSignal: opts?.abortSignal,                  // API-04
    systemPrompt: opts?.systemPrompt ?? nc?.systemPrompt,  // SYS-01
    env: opts?.env,                                  // FDN-07
    allowedTools: nc?.allowed_tools,                 // TOL-01
    approvalMode: 'yolo',                            // ARC-06: headless = yolo by default
    // outputSchema: extract from outputFormat or nodeConfig.output_format
    outputSchema: extractOutputSchema(opts),
  };
}
```

### e2e-gemini-smoke.yaml (contract test workflow, matches Archon pattern)

```yaml
# Source: modeled on https://raw.githubusercontent.com/coleam00/Archon/dev/.archon/workflows/e2e-claude-smoke.yaml
name: e2e-gemini-smoke
description: "Smoke test for Gemini provider. Verifies prompt response."
provider: gemini
model: auto

nodes:
  - id: simple
    prompt: "What is 2+2? Answer with just the number, nothing else."
    allowed_tools: []
    idle_timeout: 30000

  - id: assert
    bash: |
      output="$simple.output"
      if [ -z "$output" ]; then
        echo "FAIL: simple node returned empty output"
        exit 1
      fi
      echo "PASS: simple=$output"
    depends_on: [simple]
```

### registerCommunityProviders() edit (1-line change)

```typescript
// Source: https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/registry.ts
// BEFORE:
export function registerCommunityProviders(): void {
  registerPiProvider();
}

// AFTER:
export function registerCommunityProviders(): void {
  registerPiProvider();
  registerGeminiProvider();  // ← sole cross-cutting change
}
```

### scripts/lint-env-namespace.sh skeleton (matches existing scripts pattern)

```bash
#!/usr/bin/env bash
# lint-env-namespace.sh — Fail CI if adapter source uses env vars outside GEMINI_* / GEMINI_SDK_* namespaces
# Scope: adapter-archon/src/**
set -euo pipefail
ADAPTER_SRC="$(git rev-parse --show-toplevel)/adapter-archon/src"
ALLOWLIST="GEMINI_|PATH|HOME|USERPROFILE|TMPDIR|TEMP|TMP|NODE_ENV|DEBUG"
BAD=$(grep -rE 'process\.env\.([A-Z_]+)|env\[["'"'"']([A-Z_]+)["'"'"']\]' \
  "$ADAPTER_SRC" \
  --include="*.ts" -oh \
  | grep -oE '[A-Z_]{3,}' \
  | sort -u \
  | grep -vE "^($ALLOWLIST)" || true)
if [ -n "$BAD" ]; then
  echo "ERROR: adapter source uses non-namespaced env vars: $BAD"
  exit 1
fi
echo "OK: env-namespace check passed"
```

---

## State of the Art

| Old Approach (CONTEXT.md) | Current Approach (live dev branch) | When Changed | Impact |
|---------------------------|-----------------------------------|--------------|--------|
| `packages/core/src/clients/claude.ts` | `packages/providers/src/claude/provider.ts` | Archon's own Phase 2 refactor | PR target dir changes |
| `IAssistantClient` interface | `IAgentProvider` interface | Same refactor | All interface references updated |
| `AssistantRequestOptions` | `SendQueryOptions` + `NodeConfig` | Same refactor | Options mapping is now 2-level |
| 3-line `factory.ts` edit | 1-line `registerCommunityProviders()` edit | Community provider seam addition (Pi) | Simpler change, lower merge conflict risk |
| `packages/core/src/clients/gemini.ts` | `packages/providers/src/community/gemini/` (directory) | Pi community provider precedent | PR adds a directory, not a single file |

**Key current arch facts:**
- Archon `packages/providers@0.3.6` — ES module, Bun runtime, TypeScript source-published
- Provider capability flags: 13 total (sessionResume, mcp, hooks, skills, agents, toolRestrictions, structuredOutput, envInjection, costControl, effortControl, thinkingControl, fallbackModel, sandbox)
- Current dev branch SHA (2026-04-21): `7ea321419f0cd48e71e9ebf12968f539bc4166bc`
- Pi provider is the Phase 2 Archon community seam validation — it's the definitive reference for community providers

---

## Open Questions

1. **`workflow_dispatch` workerConversationId semantics**
   - What we know: Archon's `workflow_dispatch` chunk requires `workerConversationId: string`. Pi's event-bridge does not emit `workflow_dispatch`. Claude emits it in sub-agent scenarios.
   - What's unclear: Whether Archon's retry classifier and e2e workflow tests care about `workerConversationId` being non-empty.
   - Recommendation: Use `''` for direct tool calls. Run `e2e-gemini-smoke.yaml` contract test and check if Archon's workflow-dispatch tests pass. If `workerConversationId: ''` causes test failures, escalate to planner — this would require inspecting Archon's workflow executor source.

2. **`SystemChunk` `subtype` field compatibility**
   - What we know: SDK `SystemChunk` has `{ type: 'system', subtype: 'init' | 'message', sessionId?, model?, content? }`. Archon's `MessageChunk.system` is `{ type: 'system', content: string }`.
   - What's unclear: Whether Archon's platform adapter reads `subtype` or `sessionId` from system chunks (CONTEXT.md says claude.ts stamps session ID on first system chunk — but Pi doesn't do this).
   - Recommendation: In `translateChunk()`, map system chunks to `{ type: 'system', content: chunk.content ?? '' }`. The `result` chunk already carries `sessionId` for Archon's orchestrator. The system-chunk session-ID-stamping from CONTEXT.md appears to be a legacy claude.ts behavior not required by the current `IAgentProvider` interface.

3. **Exact Archon SHA to pin in `.archon-compat`**
   - What we know: Current dev branch is `7ea321419f0cd48e71e9ebf12968f539bc4166bc` (2026-04-21). No tagged release visible in the tree query.
   - Recommendation (Claude's discretion): Pin to `7ea321419f` (current `dev` tip at phase start). Archon appears to use `dev` as its primary branch without semver releases for the providers package. The weekly drift job will catch if Archon moves.

4. **Adapter package's dependency on Archon types during dev**
   - What we know: The adapter PR lives in Archon's own monorepo. For our standalone `adapter-archon/` subpackage, we need `IAgentProvider` type during development.
   - Recommendation: Define a local `IAgentProvider`-compatible interface in `adapter-archon/src/types.ts` that matches the contract exactly. Validated by the contract test (which imports from the real Archon source). No npm dep on `@archon/providers` during draft.

---

## Validation Architecture

> `nyquist_validation: true` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2 (pinned in ts/package.json) |
| Config file | `ts/vitest.config.ts` (include: `src/**/*.{test,spec}.ts`) |
| Quick run command | `cd ts && pnpm test` |
| Full suite command | `cd ts && pnpm test:live` (live gate: `RUN_LIVE_E2E=1 && GEMINI_API_KEY`) |

Note: The adapter itself lives in `adapter-archon/` and has its own `typecheck` script. Its unit tests run under the SDK's vitest config (adapter-archon is not in pnpm-workspace vitest scope yet; need Wave 0 addition or co-locate tests in `adapter-archon/src/*.spec.ts`).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARC-01 | `adapter-archon/` implements `IAgentProvider` | unit (typecheck) | `cd adapter-archon && pnpm typecheck` | ❌ Wave 0: fill `src/index.ts` |
| ARC-02 | `sendQuery(prompt, cwd, resumeSessionId?, options?)` matches exact signature | unit (typecheck) | same as ARC-01 | ❌ Wave 0 |
| ARC-03 | `getType()` returns `'gemini'` | unit | `adapter-archon/src/provider.spec.ts` | ❌ Wave 0 |
| ARC-04 | Package source-publishes `.ts`, no build artifacts | structural check | `node -e "require('@gemini-sdk/adapter-archon')"` check in Wave 0 | ❌ Wave 0 |
| ARC-05 | All `SendQueryOptions`/`NodeConfig` keys covered in `OPTION_MAPPING` | unit (drift test) | `adapter-archon/src/options-translator.spec.ts` drift assertion | ❌ Wave 0 |
| ARC-06 | `provider.ts` ≤ 250 LOC | LOC check | `wc -l adapter-archon/src/provider.ts` (reviewer or CI script) | ❌ Wave 0 |
| ARC-07 | Contract test: `DEFAULT_AI_ASSISTANT=gemini` passes Archon's e2e suite | integration (fixture-backed) | `adapter-archon/tests-contract/contract.spec.ts` | ❌ Wave 0 |
| ARC-07 (live) | Same test with real `GEMINI_API_KEY` | integration (live, gated) | Gated CI job on main + manual trigger | ❌ Wave 0 |
| ARC-08 | PR open on `gemini-sdk-integration` branch | manual verification | `gh pr list --repo coleam00/Archon --head gemini-sdk-integration` | N/A |
| ARC-09 | Env-var namespace linter catches violations | CI lint | `bash scripts/lint-env-namespace.sh` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd adapter-archon && pnpm typecheck`
- **Per wave merge:** `bash scripts/lint-env-namespace.sh && cd adapter-archon && pnpm test`
- **Phase gate:** Contract test (fixture-backed) green + `gh pr list` shows open PR before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `adapter-archon/src/provider.ts` — main class (ARC-01, ARC-02, ARC-03, ARC-06)
- [ ] `adapter-archon/src/capabilities.ts` — `GEMINI_CAPABILITIES` (ARC-01)
- [ ] `adapter-archon/src/options-translator.ts` — `OPTION_MAPPING`, `translateOptions()`, `warnIgnoredOptions()`, `translateChunk()` (ARC-05)
- [ ] `adapter-archon/src/registration.ts` — `registerGeminiProvider()` (ARC-01)
- [ ] `adapter-archon/src/types.ts` — local `IAgentProvider` mirror for standalone dev
- [ ] `adapter-archon/src/index.ts` — fill barrel export (currently `export {}`)
- [ ] `adapter-archon/src/provider.spec.ts` — unit tests (ARC-03, ARC-05)
- [ ] `adapter-archon/tests-contract/` — contract test harness (ARC-07)
- [ ] `spec/archon/mapping.md` — canonical triage table (ARC-05)
- [ ] `.archon-compat` — pinned SHA (ARC-07)
- [ ] `scripts/lint-env-namespace.sh` — env-var linter (ARC-09)
- [ ] `adapter-archon/vitest.config.ts` — or add adapter-archon to workspace vitest config
- [ ] CI YAML additions: contract-test job + env-namespace-lint job + weekly drift guard

---

## Sources

### Primary (HIGH confidence)
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/types.ts` — `IAgentProvider`, `SendQueryOptions`, `AgentRequestOptions`, `NodeConfig`, `MessageChunk`, `ProviderCapabilities` — all types verified verbatim
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/claude/provider.ts` — `ClaudeProvider.sendQuery` pattern + retry logic
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/registry.ts` — `registerBuiltinProviders()` + `registerCommunityProviders()` bodies
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/community/pi/registration.ts` — `registerPiProvider()` pattern
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/claude/capabilities.ts` — `CLAUDE_CAPABILITIES` (all 13 fields = true)
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/codex/capabilities.ts` — `CODEX_CAPABILITIES` (subset true)
- `https://raw.githubusercontent.com/coleam00/Archon/dev/.archon/workflows/e2e-claude-smoke.yaml` — e2e contract test YAML pattern
- `D:/repos/Gemini-SDK/ts/src/query/types.ts` — `QueryOptions` full field set (local, verified)
- `D:/repos/Gemini-SDK/ts/src/parser/types.ts` — `MessageChunk` SDK variants (local, verified)
- `D:/repos/Gemini-SDK/adapter-archon/package.json` — Phase 2 stub structure (local, verified)
- GitHub API: `7ea321419f0cd48e71e9ebf12968f539bc4166bc` = Archon `dev` branch HEAD at 2026-04-21T11:52:56Z

### Secondary (MEDIUM confidence)
- `https://raw.githubusercontent.com/coleam00/Archon/dev/.env.example` — GEMINI_API_KEY already present in Pi section; GEMINI_BIN_PATH is a new entry in the AI Assistants section
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/docs-web/src/content/docs/contributing/adding-a-community-provider.md` — community provider guide (confirms 1-line registry edit + `packages/providers/src/community/<id>/` directory convention)
- `https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/package.json` — `@archon/providers@0.3.6`, Bun source-publish pattern verified
- WebFetch of Pi `options-translator.ts` + `event-bridge.ts` — option translation pattern (paraphrased by model, not verbatim; HIGH trust on pattern, MEDIUM on exact API)

### Tertiary (LOW confidence — note for validation)
- Pi `event-bridge.ts` `workflow_dispatch` behavior: Model stated Pi does NOT emit `workflow_dispatch` — this is plausible given Pi is a newer/different provider, but exact behavior was not verified from raw source. Validate by reading `packages/providers/src/community/pi/event-bridge.ts` during implementation.
- `workerConversationId: ''` for non-sub-agent tool dispatch — inferred from Archon type shape. Validate by running contract test.

---

## Metadata

**Confidence breakdown:**
- Interface shape (IAgentProvider, SendQueryOptions, NodeConfig, MessageChunk): HIGH — all verified verbatim from raw GitHub source
- Architecture (community provider pattern, registry, capabilities): HIGH — verified from registry.ts and Pi registration.ts
- Options mapping (11/4/4/5 triage): MEDIUM — NodeConfig fields catalogued, but exact gemini-cli behavior for each needs verification during impl
- workflow_dispatch shape: MEDIUM — type verified; semantics of workerConversationId need contract test validation
- MessageChunk field name mismatches: HIGH — verified from both SDK and Archon source verbatim
- Contract test strategy: HIGH — CI YAML structure verified from e2e-claude-smoke.yaml

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 for stable parts (interface shape). Archon's community provider registration is actively developed — re-verify `registerCommunityProviders()` before finalizing PR if more than 2 weeks pass.
