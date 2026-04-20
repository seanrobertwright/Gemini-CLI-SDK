import { describe, it, expect } from 'vitest';
import { buildSchemaInjectionBlock } from './injectSchema.js';

describe('buildSchemaInjectionBlock: template', () => {
  it('starts with the Required Output Format heading', () => {
    const result = buildSchemaInjectionBlock({ type: 'object' });
    expect(result.startsWith('## Required Output Format\n')).toBe(true);
  });

  it('ends with the Return ONLY directive', () => {
    const result = buildSchemaInjectionBlock({ type: 'object' });
    expect(result.endsWith('Return ONLY the JSON object. No prose, no markdown fences in the output.')).toBe(true);
  });

  it('contains the pretty-printed schema inside a json code fence', () => {
    const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
    const result = buildSchemaInjectionBlock(schema);
    expect(result).toContain('```json\n' + JSON.stringify(schema, null, 2) + '\n```');
  });

  it('contains the MUST be valid JSON instruction', () => {
    const result = buildSchemaInjectionBlock({});
    expect(result).toContain('Your response MUST be valid JSON matching this JSON Schema:');
  });

  it('handles empty schema object', () => {
    const result = buildSchemaInjectionBlock({});
    expect(result).toContain('{}');
  });

  it('is deterministic (same input -> same output)', () => {
    const a = buildSchemaInjectionBlock({ type: 'object' });
    const b = buildSchemaInjectionBlock({ type: 'object' });
    expect(a).toBe(b);
  });
});
