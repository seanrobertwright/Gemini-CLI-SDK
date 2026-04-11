#!/usr/bin/env node
/**
 * capture-fixtures.mjs — Capture engine scaffold for the Gemini CLI SDK fixture pipeline.
 *
 * Wave 0: Provides CLI parser, scenario registry, and stubbed subcommands.
 * W1 fills in: `feasibility` handler + `simple-text` spawn logic.
 * W2 fills in: three smoke test scenarios.
 * W3 fills in: remaining fixture scenarios.
 *
 * Usage:
 *   node scripts/capture-fixtures.mjs --help
 *   node scripts/capture-fixtures.mjs feasibility
 *   node scripts/capture-fixtures.mjs all
 *   node scripts/capture-fixtures.mjs <slug>
 *
 * Exit codes:
 *   0  -- --help: printed usage
 *   1  -- unknown argument (not a slug, not a subcommand)
 *   2  -- NOT_IMPLEMENTED: stubbed subcommand or scenario
 *   3  -- manifest/scenario drift detected (scenario registry out of sync with fixtures.manifest.json)
 *   99 -- uncaught runtime error
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { redact, redactJsonValue } from './_redactor.mjs';

// Re-export redact utilities so tree-shakers see these imports as used.
// W1/W3 implementation modules can also import them from here as a facade.
export { redact, redactJsonValue };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(REPO_ROOT);

// ---------------------------------------------------------------------------
// Scenario registry
//
// All entries are marked `stubbed: true` at end of Wave 0.
// W1 removes `stubbed` from simple-text and adds spawn logic in runScenario().
// W3 removes `stubbed` from the remaining scenarios and fills in spawn logic.
//
// Key fields:
//   slug          — must match exactly the slug in spec/fixtures.manifest.json
//   description   — human-readable label printed in --help
//   args          — argv array forwarded to gemini-cli (filled in by W1/W3)
//   cwd           — optional working directory for the spawn (default: REPO_ROOT)
//   env           — optional env overrides merged with process.env
//   timeoutMs     — optional spawn timeout in milliseconds (default: 60000)
//   captureStderr — if true, capture stderr alongside stdout
//   expectNonZeroExit — if true, non-zero exit from gemini-cli is not an error
//   synthetic     — if true, this scenario is not captured from gemini-cli but
//                   is constructed synthetically; skipped by `all` subcommand
//   pairWith      — slug of the paired scenario (resume session pair)
//   abortAtMs     — if set, SIGTERM the child process after this many ms
//   stubbed       — true until W1/W3 fills in spawn logic
// ---------------------------------------------------------------------------

/**
 * Scenario registry — all 12 fixture slugs from spec/fixtures.manifest.json.
 *
 * @type {Record<string, object>}
 */
export const SCENARIOS = {
  'simple-text': {
    slug: 'simple-text',
    description: 'Single-turn text prompt, no tool use. Baseline.',
    args: ['-p', 'Say "hello" in one word.', '--output-format', 'stream-json'],
    stubbed: true
  },
  'tool-use-builtin': {
    slug: 'tool-use-builtin',
    description: 'Built-in tool call (read_file) on a fixture workspace file.',
    args: [
      '-p', 'Read the file test.txt in the current directory and show its contents.',
      '--output-format', 'stream-json',
      '--approval-mode', 'yolo'
    ],
    cwd: 'spec/fixtures/_assets/workspace',
    stubbed: true
  },
  'resume-session-turn1': {
    slug: 'resume-session-turn1',
    description: 'Turn 1 of resume pair: establish session, capture session_id from init event.',
    args: ['-p', 'My favorite number is 47. Remember it.', '--output-format', 'stream-json'],
    pairWith: 'resume-session-turn2',
    stubbed: true
  },
  'resume-session-turn2': {
    slug: 'resume-session-turn2',
    description: 'Turn 2 of resume pair: --resume <id> from turn1, reference prior context.',
    args: ['--resume', '<SESSION_ID_FROM_TURN1>', '-p', 'What number did I say?', '--output-format', 'stream-json'],
    pairWith: 'resume-session-turn1',
    stubbed: true
  },
  'error-rate-limit': {
    slug: 'error-rate-limit',
    description: 'Rate-limit failure; capture stream-json error event + stderr + non-zero exit.',
    args: ['-p', 'trigger quota', '--output-format', 'stream-json'],
    captureStderr: true,
    expectNonZeroExit: true,
    stubbed: true
  },
  'error-auth': {
    slug: 'error-auth',
    description: 'Invalid API key; capture error event + stderr + non-zero exit.',
    args: ['-p', 'hello', '--output-format', 'stream-json'],
    env: { GEMINI_API_KEY: 'invalid-key-12345' },
    captureStderr: true,
    expectNonZeroExit: true,
    stubbed: true
  },
  'event-unknown': {
    slug: 'event-unknown',
    description: 'SYNTHETIC: copy simple-text init line, mutate type to an invented value.',
    synthetic: true,
    basedOn: 'simple-text',
    mutation: { field: 'type', value: 'cosmic_ray_hit' },
    stubbed: true
  },
  'thinking': {
    slug: 'thinking',
    description: 'gemini-2.5-pro extended reasoning; may or may not expose thinking events in headless mode.',
    args: ['--model', 'gemini-2.5-pro', '-p', 'What is 23*17? Think step by step.', '--output-format', 'stream-json'],
    stubbed: true
  },
  'multimodal-image': {
    slug: 'multimodal-image',
    description: 'Prompt with @-reference to a small committed PNG.',
    args: ['-p', 'Describe @spec/fixtures/_assets/sample-image.png in one sentence.', '--output-format', 'stream-json'],
    stubbed: true
  },
  'multimodal-pdf': {
    slug: 'multimodal-pdf',
    description: 'Prompt with @-reference to a small committed PDF.',
    args: ['-p', 'Summarize @spec/fixtures/_assets/sample-document.pdf in one sentence.', '--output-format', 'stream-json'],
    stubbed: true
  },
  'large-output': {
    slug: 'large-output',
    description: 'Long output (>128 KB) to exceed Node pipe buffer and expose block-buffering.',
    args: ['-p', 'List 200 distinct facts about octopuses, one per line, numbered.', '--output-format', 'stream-json'],
    timeoutMs: 180000,
    stubbed: true
  },
  'abort-midstream': {
    slug: 'abort-midstream',
    description: 'Start a long prompt but SIGTERM the child at ~2s; truncated NDJSON expected.',
    args: ['-p', 'List 200 distinct facts about octopuses, one per line, numbered.', '--output-format', 'stream-json'],
    abortAtMs: 2000,
    stubbed: true
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Print usage table to stdout.
 */
function printUsage() {
  console.log(`Usage: node scripts/capture-fixtures.mjs <subcommand>

Subcommands:
  --help, -h      Print this message and exit 0
  feasibility     Run the 3 smoke tests (W2; currently stubbed)
  all             Capture every non-synthetic fixture (W3; currently stubbed)
  <slug>          Capture a single fixture by slug

Available slugs (12):`);
  for (const slug of Object.keys(SCENARIOS)) {
    console.log(`  ${slug.padEnd(24)} ${SCENARIOS[slug].description}`);
  }
}

/**
 * Load spec/fixtures.manifest.json and verify that every manifest slug has a
 * corresponding entry in SCENARIOS and vice versa. Exits 3 if any drift is found.
 *
 * This cross-check proves that the scenario registry is in sync with the
 * canonical slug list established in plan 01-01. Any drift means a developer
 * added or renamed a slug in one place but not the other.
 */
function verifyManifestParity() {
  const manifestPath = path.join(REPO_ROOT, 'spec', 'fixtures.manifest.json');
  let m;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`FAIL: could not read spec/fixtures.manifest.json — ${err.message}`);
    process.exit(3);
  }

  const manifestSlugs = new Set(m.slugs);
  const scenarioSlugs = new Set(Object.keys(SCENARIOS));

  const missing = [...manifestSlugs].filter(s => !scenarioSlugs.has(s));
  const extra = [...scenarioSlugs].filter(s => !manifestSlugs.has(s));

  if (missing.length || extra.length) {
    console.error(
      `FAIL: scenario/manifest drift. missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`
    );
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

async function main() {
  const arg = process.argv[2];

  // --help or no arg: print usage and exit 0
  if (!arg || arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  }

  // Verify manifest parity before any subcommand that requires scenario execution.
  // This check is skipped for --help so the help page always renders even if
  // the manifest is missing (e.g., during a fresh clone before npm install).
  verifyManifestParity();

  // feasibility: 3 smoke tests — stubbed until W2
  if (arg === 'feasibility') {
    console.error('NOT_IMPLEMENTED: feasibility smoke tests stubbed until W2');
    process.exit(2);
  }

  // all: capture every non-synthetic scenario — stubbed until W3
  if (arg === 'all') {
    for (const slug of Object.keys(SCENARIOS)) {
      const scenario = SCENARIOS[slug];
      if (scenario.synthetic) continue;
      console.error(`NOT_IMPLEMENTED: scenario ${slug}`);
    }
    process.exit(2);
  }

  // individual slug
  if (SCENARIOS[arg]) {
    console.error(`NOT_IMPLEMENTED: scenario ${arg} stubbed until W3`);
    process.exit(2);
  }

  // unknown argument
  console.error(`UNKNOWN: ${arg}`);
  printUsage();
  process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(99);
});
