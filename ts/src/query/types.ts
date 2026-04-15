/**
 * ts/src/query/types.ts
 *
 * Public type definitions for the query module.
 *
 * QueryOptions  — options passed to query() / queryRaw() / queryFull()
 * QueryResult   — final accumulated result returned by queryFull()
 * Model         — known Gemini model identifiers (const object + union type)
 * AbortError    — re-exported from errors module (reparented to ProcessError in Phase 5)
 */

import type { MessageChunk } from '../parser/types.js';
export { AbortError } from '../errors/index.js';

// ────────────────────────────────────────────────────────────────────────────
// Model — known Gemini model identifiers
// ────────────────────────────────────────────────────────────────────────────

export const Model = {
  AUTO: 'auto',
  /** @deprecated gemini-cli will phase out 2.5 series 2026-06-17 */
  FLASH_25: 'gemini-2.5-flash',
  /** @deprecated gemini-cli will phase out 2.5 series 2026-06-17 */
  PRO_25: 'gemini-2.5-pro',
  FLASH_20: 'gemini-2.0-flash',
  FLASH_3: 'gemini-3-flash',
  PRO_3: 'gemini-3-pro',
} as const;

export type Model = (typeof Model)[keyof typeof Model];

// ────────────────────────────────────────────────────────────────────────────
// QueryOptions — input to all query functions
// ────────────────────────────────────────────────────────────────────────────

export interface QueryOptions {
  /** The prompt text to send to gemini-cli. Required. */
  prompt: string;

  /**
   * Model to use. Pass `Model.AUTO` or omit to let gemini-cli choose.
   * Raw string model names are accepted for forward-compatibility (MDL-02).
   */
  model?: Model | string;

  /** System prompt injected before the user message. */
  systemPrompt?: string;

  /** Working directory for the gemini-cli subprocess. */
  cwd?: string;

  /**
   * Additional directories for gemini-cli to include.
   * Each entry maps to one `--include-directories <dir>` flag (CWD-02).
   */
  additionalDirectories?: string[];

  /** AbortSignal that cancels the in-flight query when aborted. */
  abortSignal?: AbortSignal;

  /** Explicit path to the gemini-cli binary (overrides PATH resolution). */
  cliPath?: string;

  /** Extra environment variables merged into the subprocess environment. */
  env?: Record<string, string>;
}

// ────────────────────────────────────────────────────────────────────────────
// QueryResult — returned by queryFull() after stream is fully consumed
// ────────────────────────────────────────────────────────────────────────────

export interface QueryResult {
  /** Concatenated assistant text from all AssistantChunks. */
  text: string;

  /** Session ID from the gemini-cli init event. */
  sessionId: string;

  /** Stop reason from the gemini-cli result event. */
  stopReason: string;

  /** All MessageChunks yielded during the query. */
  chunks: MessageChunk[];
}

// AbortError is now re-exported from errors/index.js (see top of file).
// It extends ProcessError (bucket: crash, retryable: false) per Phase 5 taxonomy.
