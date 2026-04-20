/**
 * ts/src/output/index.ts
 * Barrel export for the output module (Phase 8 structured output — experimental).
 */

export { buildSchemaInjectionBlock } from './injectSchema.js';
export { stripMarkdownFences, validateWithSchema } from './schemaValidator.js';
export type { ValidationResult } from './schemaValidator.js';
export { buildRetryPrompt } from './retry.js';
