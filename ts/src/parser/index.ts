/**
 * ts/src/parser/index.ts
 *
 * Barrel export for the parser module.
 * Exports both stage-1 (parseNdjson) and stage-2 (dispatch) pipeline functions,
 * plus all RawEvent and MessageChunk types for consumers.
 */

export { parseNdjson } from './parseNdjson.js';
export { dispatch } from './dispatch.js';
export type {
  RawEvent,
  MessageChunk,
  AssistantChunk,
  SystemChunk,
  ThinkingChunk,
  ResultChunk,
  RateLimitChunk,
  ToolChunk,
  ToolResultChunk,
  WorkflowDispatchChunk,
  InitEvent,
  MessageEvent as RawMessageEvent,
  ResultEvent as RawResultEvent,
  ToolUseEvent,
  ToolResultEvent,
  ErrorEvent,
  UnknownEvent,
  CliLogEvent,
} from './types.js';
export { KNOWN_RAW_TYPES } from './types.js';
