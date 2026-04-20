import { describe, it, expect } from 'vitest';
import { stripMarkdownFences, validateWithSchema } from './schemaValidator.js';

describe('stripMarkdownFences', () => {
  it('returns input unchanged when there are no fences', () => {
    expect(stripMarkdownFences('{"x": 1}')).toBe('{"x": 1}');
  });

  it('strips ```json ... ``` wrappers', () => {
    expect(stripMarkdownFences('```json\n{"x": 1}\n```')).toBe('{"x": 1}');
  });

  it('strips ``` ... ``` wrappers with no language tag', () => {
    expect(stripMarkdownFences('```\n{"x": 1}\n```')).toBe('{"x": 1}');
  });

  it('tolerates CRLF line endings', () => {
    expect(stripMarkdownFences('```json\r\n{"x": 1}\r\n```')).toBe('{"x": 1}');
  });

  it('trims leading and trailing whitespace on unfenced input', () => {
    expect(stripMarkdownFences('   {"x": 1}   ')).toBe('{"x": 1}');
  });

  it('returns unfenced when only opening fence present (no closing)', () => {
    // Partial fence does not match regex → pass-through after trim
    expect(stripMarkdownFences('```json\n{"x": 1}').trim()).toBe('```json\n{"x": 1}');
  });
});

describe('validateWithSchema', () => {
  const schema = {
    type: 'object',
    properties: { x: { type: 'string' } },
    required: ['x'],
  };

  it('returns success for valid JSON matching the schema', () => {
    const result = validateWithSchema(schema, '{"x": "hello"}');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ x: 'hello' });
  });

  it('returns failure with JSON parse error for unparsable input', () => {
    const result = validateWithSchema(schema, 'not json');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/JSON parse failed/);
  });

  it('returns failure for type mismatch on required field', () => {
    const result = validateWithSchema(schema, '{"x": 123}');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.length).toBeGreaterThan(0);
  });

  it('returns failure when required field missing', () => {
    const result = validateWithSchema(schema, '{}');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.length).toBeGreaterThan(0);
  });

  it('strips markdown fences before parsing', () => {
    const result = validateWithSchema(schema, '```json\n{"x": "hi"}\n```');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ x: 'hi' });
  });

  it('works on plain schema with no required array', () => {
    const result = validateWithSchema({ type: 'object' }, '{"anything": true}');
    expect(result.success).toBe(true);
  });
});
