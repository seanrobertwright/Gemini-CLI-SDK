#!/usr/bin/env node
/**
 * capture-fixtures.mjs — Capture engine scaffold for the Gemini CLI SDK fixture pipeline.
 *
 * Wave 0: Provides CLI parser, scenario registry, and stubbed subcommands.
 * W1 fills in: `simple-text` spawn logic (this file).
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
 *   4  -- GEMINI_API_KEY not set for a live scenario
 *   10 -- redactor leaked the real API key; fixture write aborted
 *   99 -- uncaught runtime error
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import readline from 'node:readline';
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
    args: ['-p', 'Say "hello" in one word.', '--output-format', 'stream-json']
    // stubbed removed: W1 implements this scenario
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

// Scenarios implemented in W1; W2/W3 add more entries here.
const IMPLEMENTED = new Set(['simple-text']);

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
// Scenario runner (W1 implementation)
// ---------------------------------------------------------------------------

/**
 * Derive a normalized MessageChunk sequence from captured NDJSON lines.
 * This is a best-effort seed; human refines the .expected.json before commit.
 *
 * @param {string[]} lines  Redacted NDJSON lines
 * @returns {object[]}
 */
function deriveChunks(lines) {
  const chunks = [];
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'init') {
      chunks.push({ type: 'system', subtype: 'init', sessionId: ev.session_id || '<REDACTED_SESSION_ID>', model: ev.model });
    } else if (ev.type === 'message') {
      // role may be 'user' or 'assistant'
      chunks.push({ type: ev.role || 'assistant', content: ev.content || '' });
    } else if (ev.type === 'result') {
      chunks.push({ type: 'result', sessionId: ev.session_id || '<REDACTED_SESSION_ID>', stopReason: ev.stop_reason || 'end_turn' });
    } else {
      chunks.push({ type: 'unknown', raw: ev });
    }
  }
  return chunks;
}

/**
 * Spawn gemini-cli, capture stdout line-by-line through both redaction layers,
 * drain stderr in parallel (Pitfall 2), write NDJSON + expected.json sidecar.
 *
 * @param {string} slug  Scenario slug key from SCENARIOS
 */
async function runScenario(slug) {
  const scenario = SCENARIOS[slug];
  if (!scenario) {
    console.error(`UNKNOWN scenario: ${slug}`);
    process.exit(1);
  }
  if (scenario.synthetic) {
    console.error(`NOT_IMPLEMENTED: synthetic scenario ${slug} handled by plan 01-06`);
    process.exit(2);
  }

  // Build env for child: process.env + scenario overrides
  const envForChild = { ...process.env, ...(scenario.env || {}) };

  // Safety: pre-flight check — require either GEMINI_API_KEY or OAuth credentials.
  // OAuth credentials live at ~/.gemini/oauth_creds.json and are used by gemini-cli
  // automatically; we don't need to pass them explicitly.
  // error-auth intentionally overrides with a bad key, so the env override satisfies this check.
  const hasApiKey = Boolean(envForChild.GEMINI_API_KEY);
  const oauthPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.gemini', 'oauth_creds.json'
  );
  const { existsSync } = await import('node:fs');
  const hasOAuth = existsSync(oauthPath);
  if (!hasApiKey && !hasOAuth) {
    console.error('FAIL: no auth found — set GEMINI_API_KEY or run `gemini auth login` first');
    process.exit(4);
  }

  // Capture key prefix for post-capture leak check (never written to disk).
  // In OAuth mode, GEMINI_API_KEY may not be set; the prefix check is skipped in that case.
  const realKey = envForChild.GEMINI_API_KEY || '';
  const realKeyPrefix = realKey.slice(0, 10);

  mkdirSync('spec/fixtures', { recursive: true });
  const ndjsonPath = path.join('spec', 'fixtures', `${slug}.ndjson`);
  const stderrPath = path.join('spec', 'fixtures', `${slug}.stderr.txt`);

  console.error(`INFO: spawning gemini ${scenario.args.join(' ')}`);

  // Spawn gemini-cli per RESEARCH.md §"Pattern 3":
  //   shell: false  — prevents CVE-2024-27980 on POSIX (Pitfall 6)
  //   windowsHide: true — suppresses console window on Windows
  //   stdio: ['ignore','pipe','pipe'] — parallel drain prevents deadlock (Pitfall 2)
  //
  // Windows note: npm installs gemini as `gemini.cmd` (a batch wrapper). On Windows,
  // .cmd files must be launched via cmd.exe (shell:true). Passing args as an array
  // when shell:true causes cmd.exe to concatenate them improperly (especially args
  // containing quotes or spaces). The safe pattern is to build a single command string
  // and use shell:true with an empty args array, quoting each argument with cmd-safe
  // double-quote escaping. The args here are static registry values (not user input),
  // so the CVE-2024-27980 injection risk does not apply.
  const isWindows = process.platform === 'win32';

  const spawnCwd = scenario.cwd
    ? path.resolve(REPO_ROOT, scenario.cwd)
    : REPO_ROOT;

  let spawnCmd, spawnArgs, spawnShell;
  if (isWindows) {
    // Build a single command string; quote each arg with cmd.exe-safe double quotes.
    // We double any existing double-quote chars inside args with `"`.
    const quotedArgs = scenario.args.map(a => `"${a.replace(/"/g, '""')}"`).join(' ');
    spawnCmd = `gemini.cmd ${quotedArgs}`;
    spawnArgs = [];
    spawnShell = true;
  } else {
    spawnCmd = 'gemini';
    spawnArgs = scenario.args;
    spawnShell = false;
  }

  const proc = spawn(spawnCmd, spawnArgs, {
    cwd: spawnCwd,
    env: envForChild,
    shell: spawnShell,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Parallel drain both streams (Pitfall 2 in PITFALLS.md)
  const stdoutLines = [];
  const stderrChunks = [];

  const stdoutRl = readline.createInterface({
    input: proc.stdout,
    crlfDelay: Infinity
  });

  stdoutRl.on('line', (rawLine) => {
    // Two-layer redaction: parse → structural walk → serialize → regex pass.
    //
    // gemini-cli may prefix a JSON event line with a non-JSON warning string
    // (e.g. "MCP issues detected. Run /mcp list for status.{...}"). Strip any
    // leading non-JSON prefix by finding the first '{' and discarding everything before.
    let processedLine = rawLine;
    const braceIdx = rawLine.indexOf('{');
    if (braceIdx > 0) {
      const prefix = rawLine.slice(0, braceIdx);
      const maybeJson = rawLine.slice(braceIdx);
      try {
        JSON.parse(maybeJson);
        // It's valid JSON after stripping the prefix — log the prefix as stderr warning
        if (prefix.trim()) {
          console.error(`WARN: gemini-cli stdout prefix stripped: ${prefix.trim()}`);
        }
        processedLine = maybeJson;
      } catch {
        // Not valid JSON even after stripping — keep original line
        processedLine = rawLine;
      }
    }

    let redacted;
    try {
      const obj = JSON.parse(processedLine);
      const structWalked = redactJsonValue(obj);
      redacted = redact(JSON.stringify(structWalked));
    } catch {
      // Non-JSON line (cli_log or other); apply regex layer only
      redacted = redact(processedLine);
    }
    stdoutLines.push(redacted);
  });

  proc.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk.toString('utf8'));
  });

  // Optional abort timer (abort-midstream scenario)
  let abortTimer;
  if (scenario.abortAtMs) {
    abortTimer = setTimeout(() => {
      console.error(`INFO: sending SIGTERM to child after ${scenario.abortAtMs}ms`);
      proc.kill('SIGTERM');
    }, scenario.abortAtMs);
  }

  const exitCode = await new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (abortTimer) clearTimeout(abortTimer);
      resolve(code ?? -1);
    });
  });

  if (exitCode !== 0 && !scenario.expectNonZeroExit && !scenario.abortAtMs) {
    console.error(`WARN: gemini exited with code ${exitCode} (unexpected for scenario ${slug})`);
  }

  // Post-capture leak check: assert none of the captured content contains the real key prefix
  const combined = stdoutLines.join('\n') + '\n' + stderrChunks.join('');
  if (realKeyPrefix && realKeyPrefix.length >= 8 && combined.includes(realKeyPrefix)) {
    console.error('FAIL: redactor leaked the real API key prefix; aborting write');
    process.exit(10);
  }

  // Write the NDJSON fixture
  writeFileSync(ndjsonPath, stdoutLines.join('\n') + '\n', 'utf8');

  if (scenario.captureStderr || stderrChunks.length > 0) {
    writeFileSync(stderrPath, redact(stderrChunks.join('')), 'utf8');
  }

  // Write the expected.json sidecar (best-effort skeleton; human refines)
  const expectedPath = path.join('spec', 'fixtures', `${slug}.expected.json`);
  const pinnedVersion = readFileSync('.gemini-cli-compat', 'utf8').trim();
  const expected = {
    fixture: `${slug}.ndjson`,
    captured_against: `gemini-cli@${pinnedVersion}`,
    captured_at: new Date().toISOString(),
    description: scenario.description,
    chunks: deriveChunks(stdoutLines),
    exit_code: exitCode,
    stderr_patterns: []
  };
  writeFileSync(expectedPath, JSON.stringify(expected, null, 2) + '\n', 'utf8');

  console.error(`PASS: captured ${slug} (${stdoutLines.length} events, exit=${exitCode})`);
  console.error(`INFO: wrote ${ndjsonPath}`);
  console.error(`INFO: wrote ${expectedPath}`);
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

  // individual slug dispatch
  if (SCENARIOS[arg]) {
    if (!IMPLEMENTED.has(arg)) {
      console.error(`NOT_IMPLEMENTED: scenario ${arg} (pending later wave)`);
      process.exit(2);
    }
    await runScenario(arg);
    process.exit(0);
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
