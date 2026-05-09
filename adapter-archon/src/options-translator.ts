/**
 * adapter-archon/src/options-translator.ts — Phase 10 plan 10-03.
 * Pure-function core: OPTION_MAPPING + translateOptions + translateChunk + warnIgnoredOptions.
 * Triage source of truth: spec/archon/mapping.md (25 prefixed keys, buckets 7/5/4/9).
 */

import type { SendQueryOptions, MessageChunk as ArchonMessageChunk } from './types.js';
import type { QueryOptions, MessageChunk as SdkMessageChunk } from '@lrilai/gemini-cli-sdk';

// OPTION_MAPPING — 25 prefixed keys, bucketed 7/5/4/9 per spec/archon/mapping.md.

export const OPTION_MAPPING = {
  // Top-level SendQueryOptions / AgentRequestOptions (11)
  model: 'honored',
  abortSignal: 'honored',
  systemPrompt: 'honored',
  outputFormat: 'partial',
  env: 'honored',
  maxBudgetUsd: 'ignored',
  fallbackModel: 'ignored',
  forkSession: 'ignored',
  persistSession: 'ignored',
  nodeConfig: 'honored',
  assistantConfig: 'ignored',
  // NodeConfig prefixed (14)
  'nodeConfig.allowed_tools': 'honored',
  'nodeConfig.denied_tools': 'partial',
  'nodeConfig.effort': 'deferred',
  'nodeConfig.thinking': 'ignored',
  'nodeConfig.betas': 'ignored',
  'nodeConfig.sandbox': 'ignored',
  'nodeConfig.mcp': 'partial',
  'nodeConfig.hooks': 'deferred',
  'nodeConfig.skills': 'deferred',
  'nodeConfig.agents': 'deferred',
  'nodeConfig.output_format': 'partial',
  'nodeConfig.systemPrompt': 'honored',
  'nodeConfig.maxBudgetUsd': 'ignored',
  'nodeConfig.idle_timeout': 'partial',
} as const satisfies Record<string, 'honored' | 'partial' | 'deferred' | 'ignored'>;

function extractOutputSchema(
  opts: SendQueryOptions | undefined,
): Record<string, unknown> | undefined {
  if (!opts) return undefined;
  if (opts.outputFormat && opts.outputFormat.type === 'json_schema') {
    return opts.outputFormat.schema;
  }
  const nodeFmt = opts.nodeConfig?.output_format;
  if (nodeFmt && (nodeFmt as Record<string, unknown>).type === 'json_schema') {
    const schema = (nodeFmt as Record<string, unknown>).schema;
    if (schema && typeof schema === 'object') {
      return schema as Record<string, unknown>;
    }
  }
  return undefined;
}

export function translateOptions(
  prompt: string,
  cwd: string,
  resumeSessionId: string | undefined,
  opts: SendQueryOptions | undefined,
): QueryOptions {
  const out: QueryOptions = {
    prompt,
    cwd,
    // headless-only SDK; mirrors mapping.md approvalMode decision
    approvalMode: 'yolo',
  };

  if (resumeSessionId !== undefined) out.session = resumeSessionId;
  if (!opts) return out;

  if (opts.model !== undefined) out.model = opts.model;
  if (opts.abortSignal !== undefined) out.abortSignal = opts.abortSignal;

  const sysPrompt = opts.systemPrompt ?? opts.nodeConfig?.systemPrompt;
  if (sysPrompt !== undefined) out.systemPrompt = sysPrompt;

  if (opts.env !== undefined) out.env = opts.env;

  if (opts.nodeConfig?.allowed_tools !== undefined) {
    out.allowedTools = opts.nodeConfig.allowed_tools;
  }

  const schema = extractOutputSchema(opts);
  if (schema !== undefined) out.outputSchema = schema;

  return out;
}

export function translateChunk(sdk: SdkMessageChunk): ArchonMessageChunk {
  switch (sdk.type) {
    case 'system':
      return { type: 'system', content: sdk.content ?? '' };
    case 'tool':
      return {
        type: 'tool',
        toolName: sdk.toolName,
        toolCallId: sdk.toolId,
        toolInput: sdk.parameters,
      };
    case 'tool_result':
      // SDK ToolResultChunk lacks toolName; Archon requires it — emit '' and document.
      return {
        type: 'tool_result',
        toolName: '',
        toolCallId: sdk.toolId,
        toolOutput: sdk.output,
      };
    case 'rate_limit':
      return {
        type: 'rate_limit',
        rateLimitInfo: {
          code: sdk.code,
          message: sdk.message,
          status: sdk.status,
        },
      };
    default:
      // assistant / thinking / result / workflow_dispatch pass through.
      return sdk as unknown as ArchonMessageChunk;
  }
}

const WARNED = new Set<string>();

/** Test-only escape hatch. Keeps the spec hermetic across describe blocks. */
export function _resetWarnedForTesting(): void {
  WARNED.clear();
}

export function warnIgnoredOptions(opts?: SendQueryOptions): void {
  if (!opts) return;
  const enabled =
    process.env.NODE_ENV === 'development' ||
    (process.env.DEBUG || '').includes('gemini-sdk');
  if (!enabled) return;

  // Top-level keys present on opts.
  for (const key of Object.keys(opts)) {
    const status = (OPTION_MAPPING as Record<string, string>)[key];
    if ((status === 'ignored' || status === 'partial') && !WARNED.has(key)) {
      console.warn(
        '[gemini-sdk/adapter-archon] field ' + key + ' is ' + status + ' - see spec/archon/mapping.md',
      );
      WARNED.add(key);
    }
  }

  // NodeConfig prefixed keys.
  const nc = opts.nodeConfig;
  if (nc) {
    for (const key of Object.keys(nc)) {
      const prefixed = 'nodeConfig.' + key;
      const status = (OPTION_MAPPING as Record<string, string>)[prefixed];
      if ((status === 'ignored' || status === 'partial') && !WARNED.has(prefixed)) {
        console.warn(
          '[gemini-sdk/adapter-archon] field ' + prefixed + ' is ' + status + ' - see spec/archon/mapping.md',
        );
        WARNED.add(prefixed);
      }
    }
  }
}
