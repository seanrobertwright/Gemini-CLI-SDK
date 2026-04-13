/**
 * ts/src/parser/types.ts
 *
 * RawEvent — discriminated union mirroring spec/events.schema.json's 6 event types
 *            plus two lenient fallbacks (UnknownEvent, CliLogEvent).
 *
 * MessageChunk — 8-variant discriminated union per the Archon MessageChunk contract.
 *                This is the output type of the EventDispatcher (Phase 3 Plan 2).
 */

// ────────────────────────────────────────────────────────────────────────────
// RawEvent — wire-protocol events emitted by gemini-cli
// ────────────────────────────────────────────────────────────────────────────

export interface InitEvent {
  type: 'init';
  timestamp: string;
  session_id: string;
  model: string;
  _synthetic?: boolean;
  _note?: string;
  [key: string]: unknown;
}

export interface MessageEvent {
  type: 'message';
  timestamp: string;
  role: string;
  content: string;
  delta?: boolean;
  thought?: boolean;
  [key: string]: unknown;
}

export interface ResultEvent {
  type: 'result';
  timestamp: string;
  status: string;
  stats: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolUseEvent {
  type: 'tool_use';
  timestamp: string;
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  timestamp: string;
  tool_id: string;
  status: string;
  output: string;
  error?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ErrorEvent {
  type: 'error';
  timestamp: string;
  error: Record<string, unknown>;
  [key: string]: unknown;
}

/** Lenient fallback for unknown event types (PRS-03). */
export interface UnknownEvent {
  type: 'unknown';
  raw: Record<string, unknown>;
}

/** Non-JSON lines from gemini-cli stdout (e.g. policy warnings). */
export interface CliLogEvent {
  type: 'cli_log';
  line: string;
}

export type RawEvent =
  | InitEvent
  | MessageEvent
  | ResultEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | UnknownEvent
  | CliLogEvent;

/** All event type strings that parseNdjson recognises as structured events. */
export const KNOWN_RAW_TYPES = [
  'init',
  'message',
  'result',
  'tool_use',
  'tool_result',
  'error',
] as const;

// ────────────────────────────────────────────────────────────────────────────
// MessageChunk — EventDispatcher output variants (Archon contract)
// ────────────────────────────────────────────────────────────────────────────

export interface AssistantChunk {
  type: 'assistant';
  content: string;
}

export interface SystemChunk {
  type: 'system';
  subtype: 'init' | 'message';
  sessionId?: string;
  model?: string;
  role?: string;
  content?: string;
}

export interface ThinkingChunk {
  type: 'thinking';
  content: string;
}

export interface ResultChunk {
  type: 'result';
  sessionId: string;
  stopReason: string;
}

export interface RateLimitChunk {
  type: 'rate_limit';
  code: number;
  message: string;
  status?: string;
}

export interface ToolChunk {
  type: 'tool';
  toolName: string;
  toolId: string;
  parameters: Record<string, unknown>;
  incomplete?: boolean;
}

export interface ToolResultChunk {
  type: 'tool_result';
  toolId: string;
  status: string;
  output: string;
  error?: Record<string, unknown>;
}

/** Reserved for Phase 10 Archon adapter; Phase 3 EventDispatcher never emits this. */
export interface WorkflowDispatchChunk {
  type: 'workflow_dispatch';
  [key: string]: unknown;
}

export type MessageChunk =
  | AssistantChunk
  | SystemChunk
  | ThinkingChunk
  | ResultChunk
  | RateLimitChunk
  | ToolChunk
  | ToolResultChunk
  | WorkflowDispatchChunk;
