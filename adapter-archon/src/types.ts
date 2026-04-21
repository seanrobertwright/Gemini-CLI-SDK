/**
 * adapter-archon/src/types.ts
 *
 * Local mirror of Archon's IAgentProvider surface. Maintained manually to
 * avoid an @archon/providers npm dep during draft PR (Archon publishes
 * source .ts, not a compiled npm package).
 *
 * Source of truth (verified 2026-04-21):
 *   https://raw.githubusercontent.com/coleam00/Archon/dev/packages/providers/src/types.ts
 *   pinned SHA: 7ea321419f0cd48e71e9ebf12968f539bc4166bc (see .archon-compat)
 *
 * If you edit this file, update .archon-compat and spec/archon/mapping.md.
 * The contract test in plan 10-05 imports real types from the cloned
 * Archon source and asserts structural compatibility.
 */

export interface AgentRequestOptions {
  model?: string;
  abortSignal?: AbortSignal;
  systemPrompt?: string;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  env?: Record<string, string>;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  forkSession?: boolean;
  persistSession?: boolean;
}

export interface NodeConfig {
  allowed_tools?: string[];
  denied_tools?: string[];
  effort?: string;
  thinking?: unknown;
  betas?: string[];
  sandbox?: unknown;
  mcp?: string;
  hooks?: unknown;
  skills?: string[];
  agents?: Record<string, unknown>;
  output_format?: Record<string, unknown>;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  fallbackModel?: string;
  idle_timeout?: number;
}

export interface SendQueryOptions extends AgentRequestOptions {
  nodeConfig?: NodeConfig;
  assistantConfig?: Record<string, unknown>;
}

export interface ProviderCapabilities {
  sessionResume: boolean;
  mcp: boolean;
  hooks: boolean;
  skills: boolean;
  agents: boolean;
  toolRestrictions: boolean;
  structuredOutput: boolean;
  envInjection: boolean;
  costControl: boolean;
  effortControl: boolean;
  thinkingControl: boolean;
  fallbackModel: boolean;
  sandbox: boolean;
}

// Archon MessageChunk — 8-variant discriminated union.
// Field names differ from SDK ts/src/parser/types.ts MessageChunk in two
// variants; translateChunk() (plan 10-03) maps between them:
//   tool:        SDK { toolId, parameters }   → Archon { toolCallId, toolInput }
//   tool_result: SDK { toolId, output, error} → Archon { toolCallId, toolOutput }
//   rate_limit:  SDK { code, message, status }→ Archon { rateLimitInfo: {...} }
//   system:      SDK { subtype, sessionId?, model?, content? } → Archon { content: string }
export type MessageChunk =
  | { type: 'assistant'; content: string }
  | { type: 'system'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'result'; sessionId?: string; stopReason?: string; [key: string]: unknown }
  | { type: 'rate_limit'; rateLimitInfo: Record<string, unknown> }
  | { type: 'tool'; toolName: string; toolInput: Record<string, unknown>; toolCallId: string }
  | { type: 'tool_result'; toolName: string; toolOutput: string; toolCallId: string }
  | { type: 'workflow_dispatch'; workerConversationId: string; workflowName: string };

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
