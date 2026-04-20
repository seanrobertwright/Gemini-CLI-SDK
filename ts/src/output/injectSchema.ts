/**
 * ts/src/output/injectSchema.ts
 *
 * Pure function: builds the schema-guidance block appended to the caller's
 * systemPrompt when options.outputSchema is set. Used by queryFull().
 *
 * Requirement: OUT-01.
 */

/**
 * Build the "## Required Output Format" block for injection into a system prompt.
 * Template is deterministic — fixed wording enables parity tests across languages.
 */
export function buildSchemaInjectionBlock(schema: Record<string, unknown>): string {
  return [
    '## Required Output Format',
    'Your response MUST be valid JSON matching this JSON Schema:',
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    '',
    'Return ONLY the JSON object. No prose, no markdown fences in the output.',
  ].join('\n');
}
