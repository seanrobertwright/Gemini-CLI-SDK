/**
 * adapter-archon/src/registration.ts — Phase 10 plan 10-04.
 *
 * registerGeminiProvider: wires GeminiProvider into an Archon-shaped
 * provider registry. We cannot `import` Archon's registry from this
 * standalone repo (no @archon/providers npm package exists), so the
 * registry API is passed in as a structural parameter.
 *
 * When this file is dropped into the Archon clone during PR packaging
 * (plan 10-05), the parameter form is swapped for direct imports of
 * `../../registry.js` — a one-line header change. See 10-RESEARCH
 * §Pattern 5.
 */

import { GeminiProvider } from './provider.js';
import { GEMINI_CAPABILITIES } from './capabilities.js';

export interface ProviderRegistryLike {
  registerProvider: (cfg: unknown) => void;
  isRegisteredProvider: (id: string) => boolean;
}

export function registerGeminiProvider(registry: ProviderRegistryLike): void {
  if (registry.isRegisteredProvider('gemini')) return;

  registry.registerProvider({
    id: 'gemini',
    displayName: 'Gemini (Google)',
    factory: () => new GeminiProvider(),
    capabilities: GEMINI_CAPABILITIES,
    isModelCompatible: (m: string) =>
      !m.startsWith('claude-') && !['sonnet', 'opus', 'haiku'].includes(m),
    builtIn: false,
  });
}
