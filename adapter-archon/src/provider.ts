// ARC-06: keep this file under 250 LOC (stretch 200)
/**
 * adapter-archon/src/provider.ts — Phase 10 plan 10-04.
 *
 * GeminiProvider: thin IAgentProvider shim. All translation lives in
 * options-translator.ts (plan 10-03); this file's only job is to delegate
 * to @gemini-sdk/core.query(), translate each emitted chunk, and emit a
 * workflow_dispatch sentinel before every tool chunk (matching the Claude
 * and Codex provider cadence).
 *
 * Errors from query() propagate unchanged — GeminiError subclasses already
 * carry a .bucket field mapped to Archon's 5 retry buckets (Phase 5).
 */

import { query } from '@gemini-sdk/core';
import type { IAgentProvider, MessageChunk, ProviderCapabilities, SendQueryOptions } from './types.js';
import { GEMINI_CAPABILITIES } from './capabilities.js';
import { translateChunk, translateOptions, warnIgnoredOptions } from './options-translator.js';

export class GeminiProvider implements IAgentProvider {
  getType(): string {
    return 'gemini';
  }

  getCapabilities(): ProviderCapabilities {
    return GEMINI_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: SendQueryOptions,
  ): AsyncGenerator<MessageChunk> {
    warnIgnoredOptions(options);
    const sdkOptions = translateOptions(prompt, cwd, resumeSessionId, options);

    for await (const sdkChunk of query(sdkOptions)) {
      if (sdkChunk.type === 'tool') {
        yield {
          type: 'workflow_dispatch',
          workerConversationId: '',
          workflowName: sdkChunk.toolName,
        };
      }
      yield translateChunk(sdkChunk);
    }
  }
}
