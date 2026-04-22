// @gemini-sdk/adapter-archon — Archon IAgentProvider implementation (Phase 10)
//
// Source-published .ts barrel (ARC-04). Archon resolves this via the
// package.json "exports" field; no build step runs.

export { GeminiProvider } from './provider.js';
export { registerGeminiProvider } from './registration.js';
export type { ProviderRegistryLike } from './registration.js';
export { GEMINI_CAPABILITIES } from './capabilities.js';
export type {
  IAgentProvider,
  SendQueryOptions,
  MessageChunk,
  ProviderCapabilities,
} from './types.js';
