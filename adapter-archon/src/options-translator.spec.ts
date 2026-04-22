/**
 * adapter-archon/src/options-translator.spec.ts
 *
 * Unit tests for options-translator.ts (plan 10-03 Task 2) + drift guard on
 * OPTION_MAPPING. Drift test pins 25 distinct prefixed keys and buckets
 * 7/5/4/9 per spec/archon/mapping.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OPTION_MAPPING,
  translateOptions,
  translateChunk,
  warnIgnoredOptions,
  _resetWarnedForTesting,
} from './options-translator.js';
import type { MessageChunk as SdkMessageChunk } from '@gemini-sdk/core';

// ─────────────────────────────────────────────────────────────────────────────
describe('translateOptions', () => {
  it('honored passthrough: model forwarded to QueryOptions.model', () => {
    const out = translateOptions('p', '/w', undefined, { model: 'gemini-3-pro' });
    expect(out.model).toBe('gemini-3-pro');
    expect(out.prompt).toBe('p');
    expect(out.cwd).toBe('/w');
  });

  it('resume wiring: resumeSessionId -> session', () => {
    const out = translateOptions('p', '/w', 'SID', {});
    expect(out.session).toBe('SID');
  });

  it('systemPrompt fallback: nodeConfig.systemPrompt used when top-level absent', () => {
    const out = translateOptions('p', '/w', undefined, {
      nodeConfig: { systemPrompt: 'from-node' },
    });
    expect(out.systemPrompt).toBe('from-node');

    const out2 = translateOptions('p', '/w', undefined, {
      systemPrompt: 'top',
      nodeConfig: { systemPrompt: 'from-node' },
    });
    expect(out2.systemPrompt).toBe('top');
  });

  it('outputSchema extraction: json_schema -> outputSchema', () => {
    const schema = { type: 'object', properties: { x: { type: 'string' } } };
    const out = translateOptions('p', '/w', undefined, {
      outputFormat: { type: 'json_schema', schema },
    });
    expect(out.outputSchema).toEqual(schema);

    // Fallback via nodeConfig.output_format
    const out2 = translateOptions('p', '/w', undefined, {
      nodeConfig: { output_format: { type: 'json_schema', schema } as Record<string, unknown> },
    });
    expect(out2.outputSchema).toEqual(schema);
  });

  it('allowedTools wiring: nodeConfig.allowed_tools -> allowedTools', () => {
    const out = translateOptions('p', '/w', undefined, {
      nodeConfig: { allowed_tools: ['read', 'write'] },
    });
    expect(out.allowedTools).toEqual(['read', 'write']);
  });

  it("approvalMode default: 'yolo'", () => {
    const out = translateOptions('p', '/w', undefined, undefined);
    expect(out.approvalMode).toBe('yolo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('translateChunk', () => {
  it('assistant passes through unchanged', () => {
    const chunk: SdkMessageChunk = { type: 'assistant', content: 'hi' };
    expect(translateChunk(chunk)).toEqual(chunk);
  });

  it('thinking passes through unchanged', () => {
    const chunk: SdkMessageChunk = { type: 'thinking', content: 'mm' };
    expect(translateChunk(chunk)).toEqual(chunk);
  });

  it('result passes through unchanged', () => {
    const chunk: SdkMessageChunk = {
      type: 'result',
      sessionId: 'S',
      stopReason: 'end_turn',
    };
    expect(translateChunk(chunk)).toEqual(chunk);
  });

  it('workflow_dispatch passes through unchanged', () => {
    const chunk: SdkMessageChunk = {
      type: 'workflow_dispatch',
      workerConversationId: 'W',
      workflowName: 'wf',
    } as unknown as SdkMessageChunk;
    expect(translateChunk(chunk)).toEqual(chunk);
  });

  it('system: subtype drops, content normalised to empty string when missing', () => {
    const out1 = translateChunk({
      type: 'system',
      subtype: 'init',
      content: 'hi',
    } as SdkMessageChunk);
    expect(out1).toEqual({ type: 'system', content: 'hi' });

    const out2 = translateChunk({ type: 'system', subtype: 'init' } as SdkMessageChunk);
    expect(out2).toEqual({ type: 'system', content: '' });
  });

  it('tool: renames toolId -> toolCallId, parameters -> toolInput', () => {
    const out = translateChunk({
      type: 'tool',
      toolName: 'x',
      toolId: 'T1',
      parameters: { a: 1 },
    });
    expect(out).toEqual({
      type: 'tool',
      toolName: 'x',
      toolCallId: 'T1',
      toolInput: { a: 1 },
    });
  });

  it('tool_result: renames toolId -> toolCallId, output -> toolOutput, toolName empty', () => {
    const out = translateChunk({
      type: 'tool_result',
      toolId: 'T1',
      output: 'ok',
      status: 'success',
    });
    expect(out).toEqual({
      type: 'tool_result',
      toolName: '',
      toolCallId: 'T1',
      toolOutput: 'ok',
    });
  });

  it('rate_limit: wraps code/message/status into rateLimitInfo', () => {
    const out = translateChunk({
      type: 'rate_limit',
      code: 429,
      message: 'slow',
      status: 'RESOURCE_EXHAUSTED',
    });
    expect(out).toEqual({
      type: 'rate_limit',
      rateLimitInfo: { code: 429, message: 'slow', status: 'RESOURCE_EXHAUSTED' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('warnIgnoredOptions', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWarnedForTesting();
    vi.unstubAllEnvs();
    // Ensure both gates off by default; tests flip them explicitly.
    vi.stubEnv('NODE_ENV', '');
    vi.stubEnv('DEBUG', '');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('silent when NODE_ENV unset and DEBUG unset', () => {
    warnIgnoredOptions({ maxBudgetUsd: 10, nodeConfig: { thinking: {} } });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns once per distinct field when NODE_ENV=development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    warnIgnoredOptions({ maxBudgetUsd: 10 });
    warnIgnoredOptions({ maxBudgetUsd: 20 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('maxBudgetUsd');
    expect(warnSpy.mock.calls[0][0]).toContain('ignored');
  });

  it("warns when DEBUG contains 'gemini-sdk'", () => {
    vi.stubEnv('DEBUG', 'gemini-sdk:foo');
    warnIgnoredOptions({ nodeConfig: { thinking: {} } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('nodeConfig.thinking');
  });

  it('uses prefixed form for NodeConfig fields', () => {
    vi.stubEnv('NODE_ENV', 'development');
    warnIgnoredOptions({ nodeConfig: { denied_tools: ['rm'] } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('nodeConfig.denied_tools');
    expect(warnSpy.mock.calls[0][0]).toContain('partial');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drift guard: OPTION_MAPPING must match spec/archon/mapping.md row-by-row.
// 25 prefixed keys; buckets 7 honored / 5 partial / 4 deferred / 9 ignored.
// ─────────────────────────────────────────────────────────────────────────────
describe('OPTION_MAPPING drift guard', () => {
  const EXPECTED_KEYS = [
    // Top-level SendQueryOptions / AgentRequestOptions (11)
    'model',
    'abortSignal',
    'systemPrompt',
    'outputFormat',
    'env',
    'maxBudgetUsd',
    'fallbackModel',
    'forkSession',
    'persistSession',
    'nodeConfig',
    'assistantConfig',
    // NodeConfig prefixed (14)
    'nodeConfig.allowed_tools',
    'nodeConfig.denied_tools',
    'nodeConfig.effort',
    'nodeConfig.thinking',
    'nodeConfig.betas',
    'nodeConfig.sandbox',
    'nodeConfig.mcp',
    'nodeConfig.hooks',
    'nodeConfig.skills',
    'nodeConfig.agents',
    'nodeConfig.output_format',
    'nodeConfig.systemPrompt',
    'nodeConfig.maxBudgetUsd',
    'nodeConfig.idle_timeout',
  ] as const;

  it('has exactly 25 keys matching EXPECTED_KEYS (set equality, no drift)', () => {
    expect(EXPECTED_KEYS.length).toBe(25);
    expect(Object.keys(OPTION_MAPPING).length).toBe(25);

    const actualKeys = new Set(Object.keys(OPTION_MAPPING));
    const expectedSet = new Set<string>(EXPECTED_KEYS);
    for (const k of EXPECTED_KEYS) {
      expect(actualKeys.has(k), `missing OPTION_MAPPING key: ${k}`).toBe(true);
    }
    for (const k of actualKeys) {
      expect(expectedSet.has(k), `unknown OPTION_MAPPING key: ${k}`).toBe(true);
    }

    // Every value is one of the 4 triage buckets.
    for (const v of Object.values(OPTION_MAPPING)) {
      expect(['honored', 'partial', 'deferred', 'ignored']).toContain(v);
    }
  });

  it('bucket counts match mapping.md Counts Audit (7/5/4/9)', () => {
    const counts = Object.values(OPTION_MAPPING).reduce(
      (acc, v) => {
        acc[v] = (acc[v] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(counts.honored, 'honored bucket drift').toBe(7);
    expect(counts.partial, 'partial bucket drift').toBe(5);
    expect(counts.deferred, 'deferred bucket drift').toBe(4);
    expect(counts.ignored, 'ignored bucket drift').toBe(9);
  });
});
