/**
 * ts/src/output/schemaValidator.ts
 *
 * Pure functions: stripMarkdownFences + validateWithSchema.
 * Used by queryFull() to coerce LLM text → validated structured output.
 *
 * Requirements: OUT-02 (validation) + OUT-03 (used inside retry loop).
 */

import { convertJsonSchemaToZod } from 'zod-from-json-schema';

/**
 * Regex for stripping ```json ... ``` or ``` ... ``` wrappers from LLM responses.
 * Handles optional 'json' language tag and CRLF line endings.
 */
const FENCE_RE = /^```(?:json)?\r?\n?([\s\S]*?)\r?\n?```$/s;

export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const match = FENCE_RE.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export type ValidationResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * Strip fences → JSON.parse → Zod validate against JSON Schema.
 *
 * Returns:
 *   { success: true, data } on valid JSON matching the schema.
 *   { success: false, error } on JSON parse failure OR schema mismatch.
 *     error is a non-empty string suitable for feeding to buildRetryPrompt.
 */
export function validateWithSchema(
  schema: Record<string, unknown>,
  text: string,
): ValidationResult {
  const stripped = stripMarkdownFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `JSON parse failed: ${msg}` };
  }
  const zodSchema = convertJsonSchemaToZod(schema);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (zodSchema as any).safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Zod v4 exposes .issues on the error; .message is the human-readable summary.
  const errMsg = result.error?.message ?? 'schema validation failed';
  return { success: false, error: errMsg };
}
