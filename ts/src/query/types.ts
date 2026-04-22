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
import type { Session } from '../session/index.js';
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
// ApprovalMode — gemini-cli --approval-mode values (TOL-02)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Known --approval-mode values for gemini-cli.
 * Mirrors the Phase 4 Model const-object + union pattern.
 */
export const ApprovalMode = {
  DEFAULT: 'default',
  AUTO_EDIT: 'auto_edit',
  YOLO: 'yolo',
  PLAN: 'plan',
} as const;

/** Approval mode value. Accepts raw strings as forward-compat escape hatch. */
export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode] | string;

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
   * Each entry maps to one `--include-directories {dir}` flag (CWD-02).
   */
  additionalDirectories?: string[];

  /** AbortSignal that cancels the in-flight query when aborted. */
  abortSignal?: AbortSignal;

  /** Explicit path to the gemini-cli binary (overrides PATH resolution). */
  cliPath?: string;

  /** Extra environment variables merged into the subprocess environment. */
  env?: Record<string, string>;

  /**
   * Resume an existing session (SES-01, SES-02).
   * Accepts a Session value object or a bare session id string (restored from storage).
   */
  session?: Session | string;

  /**
   * Tool names to whitelist via `--allowed-tools` (TOL-01).
   * CSV-joined at argv boundary. Empty array or undefined → flag omitted.
   * Unknown names pass through unchallenged (subprocess is source of truth).
   */
  allowedTools?: string[];

  /**
   * Approval mode passed as `--approval-mode {mode}` (TOL-02).
   * Undefined → no flag → gemini-cli's own default applies.
   */
  approvalMode?: ApprovalMode;

  /**
   * @experimental Best-effort JSON schema for structured output (OUT-01..04).
   *
   * WARNING: This is experimental. Only works with queryFull() — calling
   * query()/queryRaw() with this option throws UnsupportedFeatureError.
   * Subject to change; see docs/structured-output.md Known Limitations and
   * gemini-cli upstream issue #13388.
   *
   * Accepts a plain JSON Schema object. SDK injects schema guidance into the
   * system prompt, validates output with Zod, retries ONCE on validation
   * failure with feedback, then throws SchemaValidationError.
   */
  outputSchema?: Record<string, unknown>;

  /**
   * @experimental MCP server map (MCP-01). Written verbatim into a temp
   * settings.json inside an isolated GEMINI_CONFIG_DIR per query.
   * Empty/undefined -> no temp dir created.
   *
   * When set and non-empty, `allowedMcpServerNames` MUST also be provided
   * (else query() throws InvalidPromptError pre-spawn). Cannot be combined
   * with `env.GEMINI_CONFIG_DIR` (also throws InvalidPromptError).
   *
   * See docs/mcp.md Known Limitations (#2654, #3406, #20694, #13604, #17787).
   */
  mcpServers?: Record<string, Record<string, unknown>>;

  /**
   * @experimental Whitelist of MCP server names passed via
   * --allowed-mcp-server-names (MCP-03). CSV-joined at argv boundary.
   * Empty/undefined -> flag omitted. REQUIRED when mcpServers is set
   * (else pre-spawn InvalidPromptError). See docs/mcp.md.
   */
  allowedMcpServerNames?: string[];
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

  /** Session value object (Phase 7, SES-03). Constructed from init event. */
  session: Session;

  /** All MessageChunks yielded during the query. */
  chunks: MessageChunk[];

  /**
   * @experimental Parsed + validated output when `outputSchema` was set
   * on the queryFull() call. Undefined when outputSchema was not set
   * or when validation succeeded but the option was absent.
   */
  structured?: unknown;
}

// AbortError is now re-exported from errors/index.js (see top of file).
// It extends ProcessError (bucket: crash, retryable: false) per Phase 5 taxonomy.
