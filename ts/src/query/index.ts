/**
 * ts/src/query/index.ts
 *
 * Barrel export for the query module.
 * Exports Plan 01 artifacts: buildArgv, Model, AbortError, and type-only exports.
 *
 * NOTE: query, queryRaw, queryFull — added in plan 04-02
 */

export { buildArgv } from './buildArgv.js';
export { Model, AbortError } from './types.js';
export type { QueryOptions, QueryResult } from './types.js';
