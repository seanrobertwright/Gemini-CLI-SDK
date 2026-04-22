// ARC-06: keep this file under 250 LOC (stretch 200)
/**
 * packages/providers/src/community/gemini/provider.ts — Gemini community provider.
 *
 * GeminiProvider: thin IAgentProvider shim. All translation lives in
 * options-translator.ts; this file's only job is to delegate to
 * @gemini-sdk/gemini.query(), translate each emitted chunk, and emit a
 * workflow_dispatch sentinel before every tool chunk (matching the Claude
 * and Codex provider cadence).
 *
 * Errors from query() propagate unchanged — GeminiError subclasses already
 * carry a .bucket field mapped to Archon's 5 retry buckets.
 */

import { query } from '@gemini-sdk/gemini';
import type { IAgentProvider, MessageChunk, ProviderCapabilities, SendQueryOptions } from '../../types.js';
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
