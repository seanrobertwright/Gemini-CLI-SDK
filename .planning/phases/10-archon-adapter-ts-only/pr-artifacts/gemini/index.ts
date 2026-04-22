// packages/providers/src/community/gemini/index.ts — Gemini community provider barrel.
//
// Registered via registerGeminiProvider() from ../../registry.ts in
// registerCommunityProviders(). Mirrors the Pi community provider layout.

export { GeminiProvider } from './provider.js';
export { registerGeminiProvider } from './registration.js';
export { GEMINI_CAPABILITIES } from './capabilities.js';
