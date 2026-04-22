# Archon Options → Gemini SDK Options — Canonical Triage (ARC-05)

**Scope:** Phase 10 adapter-archon. Mirror status: Archon `dev` @ SHA in `.archon-compat`.
**Totals:** 7 honored / 5 partial / 4 deferred / 9 ignored = 25 keys (distinct prefixed NodeConfig entries).

Every key in `SendQueryOptions` (including inherited `AgentRequestOptions`)
and `NodeConfig` MUST appear in this table. The drift test in
`adapter-archon/src/options-translator.spec.ts` (plan 10-03) reflects over
`OPTION_MAPPING` and fails merge on any `uncategorized:` entry.

NodeConfig fields are registered in `OPTION_MAPPING` under their PREFIXED
key `nodeConfig.<field>` — NodeConfig duplicates of `systemPrompt`,
`maxBudgetUsd`, and `fallbackModel` are distinct rows and distinct
`OPTION_MAPPING` keys from their top-level counterparts.

## Triage Table

| Archon key                          | Layer              | Triage    | SDK target / behavior                                              |
|-------------------------------------|--------------------|-----------|---------------------------------------------------------------------|
| `model`                             | AgentRequestOptions| honored   | `QueryOptions.model`                                                |
| `abortSignal`                       | AgentRequestOptions| honored   | `QueryOptions.abortSignal`                                          |
| `systemPrompt`                      | AgentRequestOptions| honored   | `QueryOptions.systemPrompt`                                         |
| `outputFormat`                      | AgentRequestOptions| partial   | `QueryOptions.outputSchema` — json_schema.schema only, best-effort  |
| `env`                               | AgentRequestOptions| honored   | `QueryOptions.env`                                                  |
| `maxBudgetUsd`                      | AgentRequestOptions| ignored   | gemini-cli has no budget cap                                        |
| `fallbackModel`                     | AgentRequestOptions| ignored   | gemini-cli has no fallback                                          |
| `forkSession`                       | AgentRequestOptions| ignored   | gemini-cli has no fork                                              |
| `persistSession`                    | AgentRequestOptions| ignored   | gemini-cli has no persist                                           |
| `nodeConfig`                        | SendQueryOptions   | honored   | container — individual fields triaged below                         |
| `assistantConfig`                   | SendQueryOptions   | ignored   | Gemini is env-based, not config-based                               |
| `nodeConfig.allowed_tools`          | NodeConfig         | honored   | `QueryOptions.allowedTools`                                         |
| `nodeConfig.denied_tools`           | NodeConfig         | partial   | no gemini-cli denied-tools flag; dev-warn once per field            |
| `nodeConfig.effort`                 | NodeConfig         | deferred  | no gemini-cli effort flag in v1                                     |
| `nodeConfig.thinking`               | NodeConfig         | ignored   | Claude-only per Archon Codex precedent                              |
| `nodeConfig.betas`                  | NodeConfig         | ignored   | Claude-only                                                         |
| `nodeConfig.sandbox`                | NodeConfig         | ignored   | Claude-only                                                         |
| `nodeConfig.mcp`                    | NodeConfig         | partial   | MCP supported via SDK `mcpServers`, not via Archon `mcp` string ref |
| `nodeConfig.hooks`                  | NodeConfig         | deferred  | v2 only                                                             |
| `nodeConfig.skills`                 | NodeConfig         | deferred  | v2 only                                                             |
| `nodeConfig.agents`                 | NodeConfig         | deferred  | v2 only                                                             |
| `nodeConfig.output_format`          | NodeConfig         | partial   | `QueryOptions.outputSchema` fallback (same as top-level outputFormat)|
| `nodeConfig.systemPrompt`           | NodeConfig         | honored   | `QueryOptions.systemPrompt` fallback (used when top-level absent)   |
| `nodeConfig.maxBudgetUsd`           | NodeConfig         | ignored   | no SDK equivalent; distinct from top-level `maxBudgetUsd`           |
| `nodeConfig.idle_timeout`           | NodeConfig         | partial   | no SDK equivalent; dev-warn once per field                          |

## Counts Audit

25 distinct `OPTION_MAPPING` keys, bucketed as follows (drift test pins these):
- honored: 7 — model, abortSignal, systemPrompt, env, nodeConfig, nodeConfig.allowed_tools, nodeConfig.systemPrompt
- partial: 5 — outputFormat, nodeConfig.denied_tools, nodeConfig.mcp, nodeConfig.output_format, nodeConfig.idle_timeout
- deferred: 4 — nodeConfig.effort, nodeConfig.hooks, nodeConfig.skills, nodeConfig.agents
- ignored: 9 — maxBudgetUsd, fallbackModel, forkSession, persistSession, assistantConfig, nodeConfig.thinking, nodeConfig.betas, nodeConfig.sandbox, nodeConfig.maxBudgetUsd

The triage table above is the row-by-row source of truth; these bucket counts are derived from it.

NodeConfig prefixed keys are DISTINCT from top-level keys of the same short
name. The drift test in plan 10-03 asserts
`Object.keys(OPTION_MAPPING).length === 25` and set-equality with an
EXPECTED_KEYS list enumerated in prefixed form.

## Ignored-field Runtime Behavior

Silent in production. When `NODE_ENV=development` OR `DEBUG=gemini-sdk:*`
is set, emit a single `console.warn` per distinct ignored/partial field
observed (see `warnIgnoredOptions()` in plan 10-03). Never throws, never
surfaces an error chunk.

## Drift Guard

`adapter-archon/src/options-translator.spec.ts` reflects over
`OPTION_MAPPING` and asserts:
  - exactly 25 distinct keys (set equality with the prefixed EXPECTED_KEYS)
  - every mapping value is one of the 4 triage buckets
  - bucket counts match this document (7/5/4/9)
Failing test message names the uncategorized key or the diverging bucket.
