/**
 * ts/src/query/index.ts
 *
 * Barrel export for the query module.
 */

export { buildArgv } from './buildArgv.js';
export { query, queryRaw, queryFull } from './query.js';
export { Model, ApprovalMode, AbortError } from './types.js';
export type { QueryOptions, QueryResult } from './types.js';
export { normaliseSessionId } from '../session/index.js';
export type { Session, TranscriptEntry } from '../session/index.js';
