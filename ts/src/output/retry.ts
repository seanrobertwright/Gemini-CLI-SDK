/**
 * ts/src/output/retry.ts
 *
 * Pure function: buildRetryPrompt.
 * Constructs the retry prompt given the caller's original prompt, the
 * validator's error message, and the raw (invalid) assistant response.
 *
 * Requirement: OUT-03.
 */

export function buildRetryPrompt(
  originalPrompt: string,
  validatorError: string,
  rawResponse: string,
): string {
  return [
    originalPrompt,
    '',
    'Your previous response was invalid JSON for the required schema.',
    `Validator error: ${validatorError}`,
    'Your previous response was:',
    '```',
    rawResponse,
    '```',
    '',
    'Return ONLY valid JSON matching the schema.',
  ].join('\n');
}
