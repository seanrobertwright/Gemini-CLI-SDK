/**
 * packages/providers/src/community/gemini/capabilities.ts — Gemini community provider.
 *
 * GEMINI_CAPABILITIES: the static capability matrix surfaced to Archon's
 * provider registry. Anything that can't be honored faithfully today is
 * reported as false so Archon can route around us rather than us lying
 * to the scheduler.
 */

import type { ProviderCapabilities } from '../../types.js';

export const GEMINI_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: true,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: true,
  structuredOutput: true,
  envInjection: true,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
};
