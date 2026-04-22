/**
 * packages/providers/src/community/gemini/registration.ts — Gemini community provider.
 *
 * registerGeminiProvider: wires GeminiProvider into Archon's provider registry.
 * Matches the Pi community provider pattern verbatim (parameterless signature,
 * direct imports from ../../registry.js).
 */

import { registerProvider, isRegisteredProvider } from '../../registry.js';
import { GeminiProvider } from './provider.js';
import { GEMINI_CAPABILITIES } from './capabilities.js';

export function registerGeminiProvider(): void {
  if (isRegisteredProvider('gemini')) return;

  registerProvider({
    id: 'gemini',
    displayName: 'Gemini (Google)',
    factory: () => new GeminiProvider(),
    capabilities: GEMINI_CAPABILITIES,
    isModelCompatible: (m: string) =>
      !m.startsWith('claude-') && !['sonnet', 'opus', 'haiku'].includes(m),
    builtIn: false,
  });
}
