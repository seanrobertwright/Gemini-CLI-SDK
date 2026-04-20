import { describe, it, expect } from 'vitest';
import { buildRetryPrompt } from './retry.js';

describe('buildRetryPrompt', () => {
  it('starts with the original prompt on its own line', () => {
    const result = buildRetryPrompt('Tell me a joke', 'expected string', '{"x":1}');
    expect(result.startsWith('Tell me a joke\n')).toBe(true);
  });

  it('contains the invalid-JSON notice', () => {
    const result = buildRetryPrompt('p', 'e', 'r');
    expect(result).toContain('Your previous response was invalid JSON for the required schema.');
  });

  it('contains the validator error text prefixed by "Validator error:"', () => {
    const result = buildRetryPrompt('p', 'expected string at .x', 'r');
    expect(result).toContain('Validator error: expected string at .x');
  });

  it('contains the raw response wrapped in a code fence', () => {
    const raw = '{"x":1}';
    const result = buildRetryPrompt('p', 'e', raw);
    expect(result).toContain('```\n' + raw + '\n```');
  });

  it('ends with the "Return ONLY valid JSON" directive', () => {
    const result = buildRetryPrompt('p', 'e', 'r');
    expect(result.endsWith('Return ONLY valid JSON matching the schema.')).toBe(true);
  });

  it('is deterministic', () => {
    const a = buildRetryPrompt('p', 'e', 'r');
    const b = buildRetryPrompt('p', 'e', 'r');
    expect(a).toBe(b);
  });

  it('preserves multiline original prompts', () => {
    const orig = 'line 1\nline 2';
    const result = buildRetryPrompt(orig, 'e', 'r');
    expect(result.indexOf(orig)).toBe(0);
  });
});
