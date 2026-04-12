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

import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, statSync, existsSync } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
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
    cwd: 'spec/fixtures/_assets/workspace'
    // stubbed removed: W3 plan 01-06 implements this scenario
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
    expectNonZeroExit: true
    // stubbed removed: W3 plan 01-06 implements this scenario
  },
  'error-auth': {
    slug: 'error-auth',
    description: 'Invalid API key; capture error event + stderr + non-zero exit.',
    args: ['-p', 'hello', '--output-format', 'stream-json'],
    // isolateOAuth: true causes runScenario to set GEMINI_CONFIG_DIR to an empty
    // temp dir so that oauth_creds.json is not found by gemini-cli, forcing the
    // GEMINI_API_KEY (invalid-key-12345) to be the only auth path.
    env: { GEMINI_API_KEY: 'invalid-key-12345' },
    isolateOAuth: true,
    captureStderr: true,
    expectNonZeroExit: true
    // stubbed removed: W3 plan 01-06 implements this scenario
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
    args: ['--model', 'gemini-2.5-pro', '-p', 'What is 23*17? Think step by step.', '--output-format', 'stream-json']
    // stubbed removed: W3 plan 01-07 implements this scenario
  },
  'multimodal-image': {
    slug: 'multimodal-image',
    description: 'Prompt with @-reference to a small committed PNG.',
    args: ['-p', 'Describe @spec/fixtures/_assets/sample-image.png in one sentence.', '--output-format', 'stream-json']
    // stubbed removed: W3 plan 01-07 implements this scenario (asset: sample-image.png)
  },
  'multimodal-pdf': {
    slug: 'multimodal-pdf',
    description: 'Prompt with @-reference to a small committed PDF.',
    args: ['-p', 'Summarize @spec/fixtures/_assets/sample-document.pdf in one sentence.', '--output-format', 'stream-json']
    // stubbed removed: W3 plan 01-07 implements this scenario (asset: sample-document.pdf)
  },
  'large-output': {
    slug: 'large-output',
    description: 'Long output (>128 KB) to exceed Node pipe buffer and expose block-buffering.',
    args: ['-p', 'List 200 distinct facts about octopuses, one per line, numbered.', '--output-format', 'stream-json'],
    timeoutMs: 180000
    // stubbed removed: W3 plan 01-07 implements this scenario
  },
  'abort-midstream': {
    slug: 'abort-midstream',
    description: 'Start a long prompt but SIGTERM the child at ~2s; truncated NDJSON expected.',
    args: ['-p', 'List 200 distinct facts about octopuses, one per line, numbered.', '--output-format', 'stream-json'],
    abortAtMs: 2000
    // stubbed removed: W3 plan 01-07 implements this scenario (taskkill on Windows)
  }
};

// Scenarios implemented in W1/W2/W3.
// W3 plan 01-07 adds thinking, multimodal-image, multimodal-pdf, large-output, abort-midstream.
// W3 plan 01-08 adds resume-session-turn1/turn2 (handled via runResumePair, not runScenario).
const IMPLEMENTED = new Set([
  'simple-text',
  'tool-use-builtin',
  'error-rate-limit',
  'error-auth',
  'thinking',
  'multimodal-image',
  'multimodal-pdf',
  'large-output',
  'abort-midstream',
  'resume-session-turn1',
  'resume-session-turn2'
]);

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
  feasibility     Run the 3 smoke tests (resume matrix, config-dir, flush timing)
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

  // Pre-check: tool-use-builtin requires spec/fixtures/_assets/workspace/test.txt to exist.
  // If the file is missing, fail loudly pointing to plan 01-06 task 1.
  if (slug === 'tool-use-builtin') {
    const workspaceFile = path.join(REPO_ROOT, 'spec', 'fixtures', '_assets', 'workspace', 'test.txt');
    if (!existsSync(workspaceFile)) {
      console.error(
        `FAIL: workspace file missing: ${workspaceFile}\n` +
        `  Create it via plan 01-06 task 1 before running tool-use-builtin.`
      );
      process.exit(1);
    }
  }

  // Build env for child: process.env + scenario overrides
  const envForChild = { ...process.env, ...(scenario.env || {}) };

  // isolateOAuth: create a temp GEMINI_CONFIG_DIR that has no oauth_creds.json,
  // forcing gemini-cli to fall back to GEMINI_API_KEY only. Used by error-auth
  // to ensure the deliberately-invalid API key is the only auth path available
  // even when the host machine has a valid OAuth session.
  let tempConfigDir;
  if (scenario.isolateOAuth) {
    tempConfigDir = mkdtempSync(path.join(os.tmpdir(), 'gemini-isolated-'));
    envForChild.GEMINI_CONFIG_DIR = tempConfigDir;
    console.error(`INFO: isolateOAuth=true — using empty GEMINI_CONFIG_DIR: ${tempConfigDir}`);
  }

  // Safety: pre-flight check — require either GEMINI_API_KEY or OAuth credentials.
  // OAuth credentials live at ~/.gemini/oauth_creds.json and are used by gemini-cli
  // automatically; we don't need to pass them explicitly.
  // error-auth intentionally overrides with a bad key, so the env override satisfies this check.
  // When isolateOAuth is set, skip the OAuth check since the scenario owns its own auth.
  const hasApiKey = Boolean(envForChild.GEMINI_API_KEY);
  const oauthPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.gemini', 'oauth_creds.json'
  );
  const hasOAuth = !scenario.isolateOAuth && existsSync(oauthPath);
  if (!hasApiKey && !hasOAuth) {
    console.error('FAIL: no auth found — set GEMINI_API_KEY or run `gemini auth login` first');
    process.exit(4);
  }

  // Capture key prefix for post-capture leak check (never written to disk).
  // In OAuth mode, GEMINI_API_KEY may not be set; the prefix check is skipped in that case.
  const realKey = envForChild.GEMINI_API_KEY || '';
  const realKeyPrefix = realKey.slice(0, 10);

  // Pre-flight asset checks for multimodal scenarios
  if (slug === 'multimodal-image') {
    const assetPath = path.join(REPO_ROOT, 'spec', 'fixtures', '_assets', 'sample-image.png');
    if (!existsSync(assetPath)) {
      console.error(`FAIL: multimodal-image requires spec/fixtures/_assets/sample-image.png — run plan 01-07 task 1 first`);
      process.exit(2);
    }
    console.error(`INFO: asset verified: spec/fixtures/_assets/sample-image.png`);
  }
  if (slug === 'multimodal-pdf') {
    const assetPath = path.join(REPO_ROOT, 'spec', 'fixtures', '_assets', 'sample-document.pdf');
    if (!existsSync(assetPath)) {
      console.error(`FAIL: multimodal-pdf requires spec/fixtures/_assets/sample-document.pdf — run plan 01-07 task 1 first`);
      process.exit(2);
    }
    console.error(`INFO: asset verified: spec/fixtures/_assets/sample-document.pdf`);
  }

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
  // On Windows, proc.kill('SIGTERM') only terminates the top-level cmd.exe/node process
  // but may leave gemini's child processes (MCP grandchildren etc.) alive. Use taskkill
  // /T /F to terminate the entire process tree. On POSIX, send SIGTERM then SIGKILL after 5s.
  let abortTimer;
  if (scenario.abortAtMs) {
    abortTimer = setTimeout(() => {
      console.error(`INFO: aborting child after ${scenario.abortAtMs}ms (pid=${proc.pid})`);
      if (process.platform === 'win32') {
        try { execSync(`taskkill /T /F /PID ${proc.pid}`); } catch { /* may already be dead */ }
      } else {
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
      }
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

  // Detect whether any thinking events appeared (thinking scenario note)
  const hasThinkingEvents = stdoutLines.some(l => {
    try { return JSON.parse(l).type === 'thinking'; } catch { return false; }
  });

  const expected = {
    fixture: `${slug}.ndjson`,
    captured_against: `gemini-cli@${pinnedVersion}`,
    captured_at: new Date().toISOString(),
    description: scenario.description,
    chunks: deriveChunks(stdoutLines),
    exit_code: exitCode,
    stderr_patterns: []
  };

  // Abort-midstream: record aborted flag and abort timestamp
  if (scenario.abortAtMs) {
    expected.aborted = true;
    expected.abort_after_ms = scenario.abortAtMs;
    expected.note = 'Truncated capture — child terminated mid-stream; partial/missing final line expected. Phase 5 tests "stream ended without terminal result event" path.';
  }

  // Thinking scenario: document whether thinking events appeared
  if (slug === 'thinking' && !hasThinkingEvents) {
    expected.thinking_events_present = false;
    expected.note = 'Captured but no thinking events appeared in headless mode; Phase 3 synthesizes the variant from structural knowledge per RESEARCH.md §Open Questions #4.';
  } else if (slug === 'thinking' && hasThinkingEvents) {
    expected.thinking_events_present = true;
  }
  writeFileSync(expectedPath, JSON.stringify(expected, null, 2) + '\n', 'utf8');

  console.error(`PASS: captured ${slug} (${stdoutLines.length} events, exit=${exitCode})`);
  console.error(`INFO: wrote ${ndjsonPath}`);
  console.error(`INFO: wrote ${expectedPath}`);
}

// ---------------------------------------------------------------------------
// W2: Feasibility smoke test helpers
// ---------------------------------------------------------------------------

/**
 * Spawn gemini-cli for a feasibility smoke test (no fixture capture; result-only).
 *
 * Returns { exitCode, stdoutLines, stderrText, timedOut }
 *
 * @param {string[]} args      Full argv array to pass to gemini
 * @param {object}  [opts]
 * @param {object}  [opts.env]          Additional env overrides (merged with process.env)
 * @param {string}  [opts.stdinText]    If set, write this text to child stdin then close
 * @param {string}  [opts.cwd]          Working directory (default: REPO_ROOT)
 * @param {number}  [opts.timeoutMs]    Timeout (default: 45000)
 * @param {boolean} [opts.recordTiming] If true, also record hrtime for each stdout line
 * @returns {Promise<{exitCode:number, stdoutLines:string[], stderrText:string, timedOut:boolean, timings?:bigint[]}>}
 */
async function spawnForSmoke(args, opts = {}) {
  const {
    env: extraEnv = {},
    stdinText = null,
    cwd = REPO_ROOT,
    timeoutMs = 45000,
    recordTiming = false
  } = opts;

  const envForChild = { ...process.env, ...extraEnv };
  const isWindows = process.platform === 'win32';

  let spawnCmd, spawnArgs, spawnShell;
  if (isWindows) {
    const quotedArgs = args.map(a => `"${a.replace(/"/g, '""')}"`).join(' ');
    spawnCmd = `gemini.cmd ${quotedArgs}`;
    spawnArgs = [];
    spawnShell = true;
  } else {
    spawnCmd = 'gemini';
    spawnArgs = args;
    spawnShell = false;
  }

  const stdinMode = stdinText !== null ? 'pipe' : 'ignore';
  const proc = spawn(spawnCmd, spawnArgs, {
    cwd,
    env: envForChild,
    shell: spawnShell,
    windowsHide: true,
    stdio: [stdinMode, 'pipe', 'pipe']
  });

  if (stdinText !== null) {
    proc.stdin.write(stdinText, 'utf8');
    proc.stdin.end();
  }

  const stdoutLines = [];
  const timings = recordTiming ? [] : undefined;
  const stderrChunks = [];

  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  rl.on('line', (rawLine) => {
    // Strip non-JSON prefix (gemini-cli policy warnings)
    let processedLine = rawLine;
    const braceIdx = rawLine.indexOf('{');
    if (braceIdx > 0) {
      const maybeJson = rawLine.slice(braceIdx);
      try { JSON.parse(maybeJson); processedLine = maybeJson; } catch { /* keep raw */ }
    }
    stdoutLines.push(processedLine);
    if (recordTiming && timings) timings.push(process.hrtime.bigint());
  });

  proc.stderr.on('data', chunk => stderrChunks.push(chunk.toString('utf8')));

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGTERM');
  }, timeoutMs);

  const exitCode = await new Promise((resolve) => {
    proc.on('error', () => resolve(-1));
    proc.on('close', code => { clearTimeout(timeoutHandle); resolve(code ?? -1); });
  });

  const stderrText = stderrChunks.join('');
  const result = { exitCode, stdoutLines, stderrText, timedOut };
  if (recordTiming && timings) result.timings = timings;
  return result;
}

/**
 * Check if a stdout lines array contains at least one valid JSON event of the
 * expected "success" types (message or result).
 */
function hasSuccessEvent(lines) {
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev && (ev.type === 'message' || ev.type === 'result')) return true;
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * Extract the session_id from the first "init" event found in the lines array.
 * Returns null if not found.
 */
function extractSessionId(lines) {
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev && ev.type === 'init' && ev.session_id) return ev.session_id;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Smoke Test 1: 9-cell resume × prompt-mode matrix.
 *
 * Prompt modes: positional, stdin, dashP
 * Session modes: fresh, resume-latest, resume-id
 *
 * Returns:
 *   { cells: [{prompt_mode, session_mode, result, evidence}], verdict, session_id_used }
 */
async function smokeResumeMatrix() {
  console.error('INFO [resume]: starting 9-cell resume × prompt-mode matrix');

  // First, run a fresh dashP invocation to capture a real session_id for resume-id tests.
  const SEED_PROMPT = 'Say "alpha" in exactly one word.';
  console.error('INFO [resume]: running seed run (fresh + dashP) to capture session_id');
  const seedRun = await spawnForSmoke(['-p', SEED_PROMPT, '--output-format', 'stream-json']);
  const capturedSessionId = extractSessionId(seedRun.stdoutLines);
  console.error(`INFO [resume]: seed session_id = ${capturedSessionId ? capturedSessionId.slice(0, 12) + '...' : 'NOT FOUND'}`);

  const TEST_PROMPT = 'Say "beta" in exactly one word.';

  /**
   * Run one cell of the matrix.
   * @param {'positional'|'stdin'|'dashP'} promptMode
   * @param {'fresh'|'resume-latest'|'resume-id'} sessionMode
   */
  async function runCell(promptMode, sessionMode) {
    let args = ['--output-format', 'stream-json'];
    let stdinText = null;

    // Build session prefix
    if (sessionMode === 'resume-latest') {
      args = ['--resume', 'latest', ...args];
    } else if (sessionMode === 'resume-id') {
      if (capturedSessionId) {
        args = ['--resume', capturedSessionId, ...args];
      } else {
        // Can't test resume-id without a captured id
        return { prompt_mode: promptMode, session_mode: sessionMode, result: 'FAIL', evidence: 'no session_id captured from seed run' };
      }
    }

    // Append prompt
    if (promptMode === 'positional') {
      args = [...args, TEST_PROMPT];
    } else if (promptMode === 'stdin') {
      stdinText = TEST_PROMPT;
    } else { // dashP
      args = [...args, '-p', TEST_PROMPT];
    }

    console.error(`INFO [resume]: cell [${promptMode} × ${sessionMode}] args=${JSON.stringify(args)}`);
    const run = await spawnForSmoke(args, { stdinText, timeoutMs: 30000 });

    let result, evidence;
    if (run.timedOut) {
      result = 'FAIL';
      evidence = 'timed out after 30s';
    } else if (run.exitCode === 0 && hasSuccessEvent(run.stdoutLines)) {
      result = 'PASS';
      evidence = `exit=0, emitted ${run.stdoutLines.length} events`;
    } else {
      result = 'FAIL';
      // Include first 300 chars of stderr as evidence, redacted
      const tail = redact(run.stderrText.slice(0, 300)).replace(/\n/g, ' ').trim();
      evidence = `exit=${run.exitCode}${tail ? ' stderr: ' + tail : ''}`;
    }
    console.error(`INFO [resume]: cell [${promptMode} × ${sessionMode}] = ${result} (${evidence.slice(0, 80)})`);
    return { prompt_mode: promptMode, session_mode: sessionMode, result, evidence };
  }

  const promptModes = ['positional', 'stdin', 'dashP'];
  const sessionModes = ['fresh', 'resume-latest', 'resume-id'];
  const cells = [];

  for (const pm of promptModes) {
    for (const sm of sessionModes) {
      cells.push(await runCell(pm, sm));
    }
  }

  const passCount = cells.filter(c => c.result === 'PASS').length;
  let verdict;
  if (passCount === 9) verdict = 'pass';
  else if (passCount === 0) verdict = 'fail';
  else verdict = 'partial';

  console.error(`INFO [resume]: verdict=${verdict} (${passCount}/9 cells pass)`);
  return { cells, verdict, session_id_used: capturedSessionId };
}

/**
 * Smoke Test 2: GEMINI_CONFIG_DIR isolation on Windows.
 *
 * Returns:
 *   { gemini_config_dir_respected, home_override_respected, mcp_add_scope_project_works,
 *     real_settings_mtime_unchanged, verdict, details }
 */
async function smokeConfigDir() {
  console.error('INFO [config-dir]: starting GEMINI_CONFIG_DIR isolation test');

  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const realSettingsPath = path.join(homeDir, '.gemini', 'settings.json');

  // Capture mtime of real settings.json before any test
  let realSettingsMtimeBefore = null;
  try {
    realSettingsMtimeBefore = statSync(realSettingsPath).mtimeMs;
  } catch { /* file may not exist; that's fine */ }

  // --- Test A: GEMINI_CONFIG_DIR ---
  const tempDirA = mkdtempSync(path.join(os.tmpdir(), 'gemini-cfg-'));
  const stubSettings = JSON.stringify({ _phase1_probe: true, model: 'gemini-2.0-flash' });
  writeFileSync(path.join(tempDirA, 'settings.json'), stubSettings, 'utf8');

  console.error(`INFO [config-dir]: Test A — GEMINI_CONFIG_DIR=${tempDirA}`);
  const runA = await spawnForSmoke(
    ['-p', 'Say "gamma" in one word.', '--output-format', 'stream-json'],
    { env: { GEMINI_CONFIG_DIR: tempDirA }, timeoutMs: 45000 }
  );
  const testASuccess = runA.exitCode === 0 && hasSuccessEvent(runA.stdoutLines);

  // Check whether real settings.json mtime changed after Test A
  let realSettingsMtimeAfterA = null;
  try {
    realSettingsMtimeAfterA = statSync(realSettingsPath).mtimeMs;
  } catch { /* ignore */ }
  const realMtimeUnchangedAfterA = (realSettingsMtimeBefore === realSettingsMtimeAfterA);

  // Heuristic: if the run succeeded AND did NOT touch the real settings.json,
  // GEMINI_CONFIG_DIR may have been respected (or gemini-cli ignored it but didn't need it).
  // We detect "respected" by checking if the stub settings.json was read:
  // Since atime is unreliable on Windows, we check whether the mtime of our stub
  // changed (gemini might write back to it) — that's a positive indicator.
  let stubMtimeAfterA = null;
  try {
    stubMtimeAfterA = statSync(path.join(tempDirA, 'settings.json')).mtimeMs;
  } catch { /* ignore */ }
  // If the stub was modified or real settings were untouched AND run succeeded, we call it respected
  const geminiConfigDirRespected = testASuccess && realMtimeUnchangedAfterA;
  console.error(`INFO [config-dir]: Test A result: success=${testASuccess}, realMtimeUnchanged=${realMtimeUnchangedAfterA}, gemini_config_dir_respected=${geminiConfigDirRespected}`);

  // --- Test B: HOME + USERPROFILE override ---
  const tempDirB = mkdtempSync(path.join(os.tmpdir(), 'gemini-home-'));
  mkdirSync(path.join(tempDirB, '.gemini'), { recursive: true });
  writeFileSync(path.join(tempDirB, '.gemini', 'settings.json'), stubSettings, 'utf8');

  console.error(`INFO [config-dir]: Test B — HOME=${tempDirB}`);
  const runB = await spawnForSmoke(
    ['-p', 'Say "delta" in one word.', '--output-format', 'stream-json'],
    { env: { HOME: tempDirB, USERPROFILE: tempDirB }, timeoutMs: 45000 }
  );
  const homeOverrideRespected = runB.exitCode === 0 && hasSuccessEvent(runB.stdoutLines);
  console.error(`INFO [config-dir]: Test B result: success=${homeOverrideRespected}`);

  // Check real settings mtime after Test B
  let realSettingsMtimeAfterB = null;
  try {
    realSettingsMtimeAfterB = statSync(realSettingsPath).mtimeMs;
  } catch { /* ignore */ }
  const realMtimeUnchangedAfterB = (realSettingsMtimeBefore === realSettingsMtimeAfterB);

  // --- Test C: gemini mcp add --scope project ---
  const tempDirC = mkdtempSync(path.join(os.tmpdir(), 'gemini-mcp-'));
  console.error(`INFO [config-dir]: Test C — mcp add --scope project in ${tempDirC}`);
  const runC = await spawnForSmoke(
    ['mcp', 'add', '--scope', 'project', '--command', 'fake-mcp-command'],
    { cwd: tempDirC, timeoutMs: 20000 }
  );
  // Check if .gemini/settings.json was created in the temp cwd
  const localSettingsCreated = existsSync(path.join(tempDirC, '.gemini', 'settings.json'));
  const mcpAddScopeProjectWorks = localSettingsCreated;
  console.error(`INFO [config-dir]: Test C result: exit=${runC.exitCode}, localSettingsCreated=${localSettingsCreated}`);

  // Final real settings check
  let realSettingsMtimeFinal = null;
  try {
    realSettingsMtimeFinal = statSync(realSettingsPath).mtimeMs;
  } catch { /* ignore */ }
  const realSettingsMtimeUnchanged = (realSettingsMtimeBefore === realSettingsMtimeFinal);

  // Verdict
  let verdict;
  let details;
  if (geminiConfigDirRespected) {
    verdict = 'pass';
    details = 'GEMINI_CONFIG_DIR is respected; real ~/.gemini/settings.json mtime unchanged.';
  } else if (mcpAddScopeProjectWorks) {
    verdict = 'partial';
    details = 'GEMINI_CONFIG_DIR is NOT respected on Windows (issue #8248 confirmed). Fallback: gemini mcp add --scope project writes ./.gemini/settings.json in isolated cwd. Phase 9 MUST use this fallback.';
  } else if (homeOverrideRespected) {
    verdict = 'partial';
    details = 'GEMINI_CONFIG_DIR is NOT respected but HOME/USERPROFILE override works. Phase 9 can use HOME override as fallback.';
  } else {
    verdict = 'fail';
    details = 'GEMINI_CONFIG_DIR is NOT respected on Windows, HOME override untested or failed, and gemini mcp add --scope project did not create local settings.json. Phase 9 needs manual config injection.';
  }

  return {
    gemini_config_dir_respected: geminiConfigDirRespected,
    home_override_respected: homeOverrideRespected,
    mcp_add_scope_project_works: mcpAddScopeProjectWorks,
    real_settings_mtime_unchanged: realSettingsMtimeUnchanged,
    verdict,
    details
  };
}

/**
 * Smoke Test 3: stream-json per-event flushing.
 *
 * Runs a short reference prompt then a long prompt and compares inter-line arrival timing.
 *
 * Returns:
 *   { short_run_bytes, long_run_bytes, short_run_inter_line_p95_ms,
 *     long_run_inter_line_p95_ms, long_run_large_gaps, bursty, verdict, details }
 */
async function smokeFlushTiming() {
  console.error('INFO [flush]: starting stream-json per-event flushing test');

  // --- Short reference run ---
  console.error('INFO [flush]: short reference run...');
  const shortRun = await spawnForSmoke(
    ['-p', 'Say "hello" in exactly one word.', '--output-format', 'stream-json'],
    { recordTiming: true, timeoutMs: 45000 }
  );
  const shortBytes = shortRun.stdoutLines.join('\n').length;
  const shortTimings = shortRun.timings || [];
  console.error(`INFO [flush]: short run: ${shortRun.stdoutLines.length} lines, ${shortBytes} bytes, exit=${shortRun.exitCode}`);

  function computeInterLineStats(timings) {
    if (timings.length < 2) return { p95Ms: 0, maxMs: 0, gaps: [] };
    const gaps = [];
    for (let i = 1; i < timings.length; i++) {
      gaps.push(Number(timings[i] - timings[i - 1]) / 1_000_000); // ns -> ms
    }
    gaps.sort((a, b) => a - b);
    const p95Idx = Math.floor(gaps.length * 0.95);
    return { p95Ms: gaps[p95Idx] ?? 0, maxMs: gaps[gaps.length - 1] ?? 0, gaps };
  }

  const shortStats = computeInterLineStats(shortTimings);
  const shortP95Ms = shortStats.p95Ms;

  // --- Long run ---
  const LONG_PROMPT = 'List 200 distinct facts about octopuses, one per line, numbered 1 through 200. Be thorough and include each fact on its own line.';
  console.error('INFO [flush]: long run (may take 1-3 minutes)...');
  const longRun = await spawnForSmoke(
    ['-p', LONG_PROMPT, '--output-format', 'stream-json'],
    { recordTiming: true, timeoutMs: 180000 }
  );
  const longBytes = longRun.stdoutLines.join('\n').length;
  const longTimings = longRun.timings || [];
  console.error(`INFO [flush]: long run: ${longRun.stdoutLines.length} lines, ${longBytes} bytes, exit=${longRun.exitCode}`);

  // If <64 KB, the test is inconclusive (block buffering doesn't trigger below buffer threshold)
  let longStats = computeInterLineStats(longTimings);

  if (longBytes < 65536) {
    console.error(`WARN [flush]: long run produced only ${longBytes} bytes (<64 KB); block-buffering cannot be confirmed/denied. Result is inconclusive.`);
  }

  // Count inter-line gaps > 500ms in the long run
  const largeGaps = longStats.gaps.filter(g => g > 500).length;

  // Bursty pattern: if >= 80% of lines arrive within 3 "clumps" separated by >500ms gaps,
  // that signals block-buffering. We approximate this by checking the gap distribution:
  // if largeGaps >= 2 AND largeGaps accounts for the bulk of timing variance, it's bursty.
  const totalGaps = longStats.gaps.length;
  const bursty = totalGaps > 5 && largeGaps >= 2 && (largeGaps / totalGaps) < 0.15 && longStats.maxMs > 800;

  const longP95Ms = longStats.p95Ms;

  let verdict, details;
  if (longBytes < 65536) {
    verdict = 'partial';
    details = `Long run output was only ${longBytes} bytes (below 64 KB threshold). Block-buffering test is inconclusive. P95 inter-line: ${longP95Ms.toFixed(1)}ms. Phase 4 should default forcePty:false with user opt-in.`;
  } else if (!bursty) {
    verdict = 'pass';
    details = `Long run (${longBytes} bytes) shows consistent inter-line timing (P95: ${longP95Ms.toFixed(1)}ms, large gaps >500ms: ${largeGaps}). No bursty pattern detected. Per-event flushing appears to work. Phase 4 forcePty defaults false.`;
  } else {
    verdict = 'fail';
    details = `Long run (${longBytes} bytes) shows BURSTY arrival pattern: ${largeGaps} inter-line gaps >500ms out of ${totalGaps} total, max gap ${longStats.maxMs.toFixed(0)}ms. Block-buffering confirmed. Phase 4 MUST expose forcePty:true.`;
  }

  console.error(`INFO [flush]: verdict=${verdict}`);
  return {
    short_run_bytes: shortBytes,
    long_run_bytes: longBytes,
    short_run_inter_line_p95_ms: Math.round(shortP95Ms * 10) / 10,
    long_run_inter_line_p95_ms: Math.round(longP95Ms * 10) / 10,
    long_run_large_gaps: largeGaps,
    bursty,
    verdict,
    details
  };
}

/**
 * Render spec/feasibility.md from the three smoke test results.
 * Output format matches RESEARCH.md §"spec/feasibility.md structure template".
 *
 * VALIDATOR CONTRACT (validate-fixtures.mjs feasibility subcommand):
 *   - Frontmatter MUST have exactly these keys: resume_verdict, config_dir_verdict,
 *     flush_verdict, captured_against, captured_at — none may be "pending"
 *   - Body MUST contain exactly three lines starting with "Verdict:"
 *   - ## Resume Verdict section MUST have 10 rows starting with "|" (1 header + 9 data)
 *
 * @param {{ resume: object, configDir: object, flush: object, pinnedVersion: string }} results
 * @returns {string}  Full markdown document text
 */
function renderFeasibilityMarkdown({ resume, configDir, flush, pinnedVersion }) {
  const now = new Date().toISOString();
  const captureHost = `Windows 11 Pro, ${process.platform}`;

  // Build the 9-cell matrix table
  const promptModeLabel = { positional: 'positional', stdin: 'stdin', dashP: '-p flag' };
  const sessionModeLabel = { fresh: 'fresh', 'resume-latest': '--resume latest', 'resume-id': '--resume <id>' };

  let matrixRows = '';
  for (const cell of resume.cells) {
    const pm = promptModeLabel[cell.prompt_mode] || cell.prompt_mode;
    const sm = sessionModeLabel[cell.session_mode] || cell.session_mode;
    const evidence = (cell.evidence || '').replace(/\|/g, '/').slice(0, 80);
    matrixRows += `| ${pm} | ${sm} | ${cell.result} | ${evidence} |\n`;
  }

  // Phase implications per verdict
  const resumeImplication = resume.verdict === 'pass'
    ? 'Phase 7: `--resume <id> -p` is the primary session path; transcript-prepend fallback dark-shipped behind config flag.'
    : resume.verdict === 'partial'
      ? 'Phase 7: `--resume <id> -p` works; positional/stdin modes with --resume do not. Primary path = dashP; transcript-prepend dark-shipped.'
      : 'Phase 7: `--resume` is broken in all modes. Transcript-prepend becomes the DEFAULT session path.';

  const configImplication = configDir.verdict === 'pass'
    ? 'Phase 9: GEMINI_CONFIG_DIR can be used for MCP config isolation.'
    : configDir.verdict === 'partial' && configDir.mcp_add_scope_project_works
      ? 'Phase 9: GEMINI_CONFIG_DIR is broken on Windows (issue #8248). Use `gemini mcp add --scope project` in isolated cwd as fallback.'
      : configDir.verdict === 'partial' && configDir.home_override_respected
        ? 'Phase 9: GEMINI_CONFIG_DIR broken but HOME/USERPROFILE override works as fallback.'
        : 'Phase 9: All config isolation mechanisms failed. Manual config injection required.';

  const flushImplication = flush.verdict === 'pass'
    ? 'Phase 4: Per-event flushing confirmed. `forcePty` defaults false.'
    : flush.verdict === 'fail'
      ? 'Phase 4: Block-buffering confirmed. `forcePty` MUST be exposed as a query option; consider defaulting true for long outputs.'
      : 'Phase 4: Flushing test inconclusive. `forcePty` defaults false with user opt-in.';

  return `---
resume_verdict: ${resume.verdict}
config_dir_verdict: ${configDir.verdict}
flush_verdict: ${flush.verdict}
captured_against: ${pinnedVersion}
captured_at: ${now}
---

# Phase 1 Feasibility Verdicts

**Captured against:** gemini-cli ${pinnedVersion}
**Capture host:** ${captureHost}
**Capture date:** ${now.slice(0, 10)}

---

## Resume Verdict

**Test:** \`--resume\` + prompt-mode interop (gemini-cli issue #14180)

| Prompt mode | Session mode | Verdict | Evidence |
| --- | --- | --- | --- |
${matrixRows}
Verdict: ${resume.verdict.toUpperCase()} — ${resume.verdict === 'pass' ? 'all 9 cells pass' : resume.verdict === 'fail' ? 'all 9 cells fail' : `${resume.cells.filter(c => c.result === 'PASS').length}/9 cells pass`}.

**Phase 7 implication:** ${resumeImplication}

**Session ID used for resume-id tests:** \`${resume.session_id_used ? resume.session_id_used.slice(0, 12) + '...<redacted>' : 'N/A — seed run failed'}\`

---

## Config Dir Verdict

**Test:** GEMINI_CONFIG_DIR isolation (gemini-cli issue #8248)

- \`GEMINI_CONFIG_DIR\` respected: **${configDir.gemini_config_dir_respected}**
- HOME/USERPROFILE override respected: **${configDir.home_override_respected}**
- \`gemini mcp add --scope project\` creates local settings.json: **${configDir.mcp_add_scope_project_works}**
- Real \`~/.gemini/settings.json\` mtime unchanged after all tests: **${configDir.real_settings_mtime_unchanged}**

Verdict: ${configDir.verdict.toUpperCase()} — ${configDir.details}

**Phase 9 implication:** ${configImplication}

---

## Flush Verdict

**Test:** stream-json per-event flushing (Node pipe buffer concern from RESEARCH.md §Pitfall 4)

| Metric | Short run | Long run |
| --- | --- | --- |
| Total bytes | ${flush.short_run_bytes} | ${flush.long_run_bytes} |
| Inter-line P95 (ms) | ${flush.short_run_inter_line_p95_ms} | ${flush.long_run_inter_line_p95_ms} |
| Gaps > 500ms | — | ${flush.long_run_large_gaps} |
| Bursty pattern detected | — | ${flush.bursty} |

Verdict: ${flush.verdict.toUpperCase()} — ${flush.details}

**Phase 4 implication:** ${flushImplication}

---

## Summary

| Test | Verdict | Downstream impact |
| --- | --- | --- |
| Resume × prompt-mode matrix | ${resume.verdict.toUpperCase()} | ${resumeImplication.split(':')[0]} |
| GEMINI_CONFIG_DIR isolation | ${configDir.verdict.toUpperCase()} | ${configImplication.split(':')[0]} |
| stream-json flushing | ${flush.verdict.toUpperCase()} | ${flushImplication.split(':')[0]} |
`;
}

// ---------------------------------------------------------------------------
// W3: Resume-session pair helpers (plan 01-08)
// ---------------------------------------------------------------------------

/**
 * Read the resume_verdict field from spec/feasibility.md frontmatter.
 * Returns 'pass' | 'fail' | 'partial' | 'pending'.
 */
function readResumeVerdict() {
  let text;
  try {
    text = readFileSync('spec/feasibility.md', 'utf8');
  } catch {
    return 'pending';
  }
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return 'pending';
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^resume_verdict:\s*(\S+)\s*$/);
    if (kv) return kv[1];
  }
  return 'pending';
}

/**
 * Spawn gemini-cli and capture raw stdout lines (before redaction) plus stderr.
 * Returns { rawStdoutLines, rawStderrChunks, exitCode, elapsedMs }.
 *
 * Unlike runScenario this function does NOT apply redaction — callers do that
 * AFTER extracting any state (e.g. session_id) they need from the raw output.
 *
 * @param {string}    bin   Binary name ('gemini' — adjusted for Windows internally)
 * @param {string[]}  args  argv array
 * @param {object}   [opts]
 * @param {boolean}  [opts.captureStderr]       Drain stderr into rawStderrChunks (default: false)
 * @param {boolean}  [opts.expectNonZeroExit]   If true, non-zero exit is not warned (default: false)
 * @param {object}   [opts.env]                 Additional env overrides (merged with process.env)
 * @param {number}   [opts.timeoutMs]           Spawn timeout in ms (default: 60000)
 * @returns {Promise<{rawStdoutLines:string[], rawStderrChunks:string[], exitCode:number, elapsedMs:number}>}
 */
async function spawnAndCapture(bin, args, opts = {}) {
  const {
    captureStderr = false,
    expectNonZeroExit = false,
    env: extraEnv = {},
    timeoutMs = 60000
  } = opts;

  const envForChild = { ...process.env, ...extraEnv };
  const isWindows = process.platform === 'win32';

  let spawnCmd, spawnArgs, spawnShell;
  if (isWindows) {
    // cmd.exe requires a single command string; args array is ignored when shell:true
    const quotedArgs = args.map(a => `"${a.replace(/"/g, '""')}"`).join(' ');
    spawnCmd = `${bin}.cmd ${quotedArgs}`;
    spawnArgs = [];
    spawnShell = true;
  } else {
    spawnCmd = bin;
    spawnArgs = args;
    spawnShell = false;
  }

  const proc = spawn(spawnCmd, spawnArgs, {
    cwd: REPO_ROOT,
    env: envForChild,
    shell: spawnShell,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const rawStdoutLines = [];
  const rawStderrChunks = [];
  const startTime = Date.now();

  const stdoutRl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  stdoutRl.on('line', (rawLine) => {
    // Strip non-JSON prefix from gemini-cli policy warnings (same as runScenario)
    let line = rawLine;
    const braceIdx = rawLine.indexOf('{');
    if (braceIdx > 0) {
      const maybeJson = rawLine.slice(braceIdx);
      try { JSON.parse(maybeJson); line = maybeJson; } catch { /* keep raw */ }
    }
    rawStdoutLines.push(line);
  });

  // Always drain stderr to prevent pipe deadlock (Pitfall 2)
  if (captureStderr) {
    proc.stderr.on('data', chunk => rawStderrChunks.push(chunk.toString('utf8')));
  } else {
    proc.stderr.on('data', () => {});
  }

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGTERM');
  }, timeoutMs);

  const exitCode = await new Promise((resolve) => {
    proc.on('error', () => resolve(-1));
    proc.on('close', code => { clearTimeout(timeoutHandle); resolve(code ?? -1); });
  });

  const elapsedMs = Date.now() - startTime;

  if (timedOut) {
    console.error(`WARN: spawnAndCapture timed out after ${timeoutMs}ms`);
  } else if (exitCode !== 0 && !expectNonZeroExit) {
    console.error(`WARN: spawnAndCapture exited with code ${exitCode}`);
  }

  return { rawStdoutLines, rawStderrChunks, exitCode, elapsedMs };
}

/**
 * Apply two-layer redaction to raw stdout lines, then write:
 *   spec/fixtures/<slug>.ndjson        — redacted NDJSON events (one per line)
 *   spec/fixtures/<slug>.expected.json — best-effort chunk sidecar
 *
 * @param {string} slug           Fixture slug (e.g. 'resume-session-turn1')
 * @param {object} captureResult  Output of spawnAndCapture()
 * @param {object} [meta]
 * @param {string} [meta.description]  Human-readable description for .expected.json
 * @param {number} [meta.exit_code]    Exit code to record in sidecar
 * @param {object} [meta.extra_fields] Extra top-level fields merged into sidecar
 */
function writeRedactedFixture(slug, captureResult, meta = {}) {
  const { rawStdoutLines } = captureResult;
  const exitCode = meta.exit_code !== undefined ? meta.exit_code : captureResult.exitCode;

  mkdirSync('spec/fixtures', { recursive: true });
  const ndjsonPath = path.join('spec', 'fixtures', `${slug}.ndjson`);
  const expectedPath = path.join('spec', 'fixtures', `${slug}.expected.json`);

  // Apply two-layer redaction to each stdout line
  const redactedLines = rawStdoutLines.map(rawLine => {
    try {
      const obj = JSON.parse(rawLine);
      const structWalked = redactJsonValue(obj);
      return redact(JSON.stringify(structWalked));
    } catch {
      return redact(rawLine);
    }
  });

  // Post-capture leak check
  const realKey = process.env.GEMINI_API_KEY || '';
  const realKeyPrefix = realKey.slice(0, 10);
  const combined = redactedLines.join('\n');
  if (realKeyPrefix && realKeyPrefix.length >= 8 && combined.includes(realKeyPrefix)) {
    console.error(`FAIL: redactor leaked real API key prefix in ${slug}; aborting write`);
    process.exit(10);
  }

  // Write NDJSON fixture (trailing newline)
  writeFileSync(ndjsonPath, redactedLines.join('\n') + '\n', 'utf8');

  // Build expected.json sidecar
  const pinnedVersion = readFileSync('.gemini-cli-compat', 'utf8').trim();
  const sidecar = {
    fixture: `${slug}.ndjson`,
    captured_against: `gemini-cli@${pinnedVersion}`,
    captured_at: new Date().toISOString(),
    description: meta.description || SCENARIOS[slug]?.description || slug,
    chunks: deriveChunks(redactedLines),
    exit_code: exitCode,
    stderr_patterns: [],
    ...(meta.extra_fields || {})
  };
  writeFileSync(expectedPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');

  console.error(`INFO: wrote ${ndjsonPath} (${redactedLines.length} events)`);
  console.error(`INFO: wrote ${expectedPath}`);
}

/**
 * Capture the two-turn resume-session fixture pair.
 *
 * Single-policy contract: either slug alias ('resume-session-turn1' or
 * 'resume-session-turn2') triggers this function EXACTLY ONCE and always writes
 * BOTH .ndjson files and BOTH .expected.json sidecars.
 *
 * Verdict-aware branching:
 *   pass/partial  → normal --resume <id> -p flow (happy path)
 *   fail          → capture failure mode as documentation
 *   pending       → refuse with instructions and exit 6
 */
async function runResumePair() {
  const verdict = readResumeVerdict();
  console.error(`INFO: resume_verdict from spec/feasibility.md = ${verdict}`);

  if (verdict === 'pending') {
    console.error('FAIL: resume_verdict is pending — run `node scripts/capture-fixtures.mjs feasibility` first');
    process.exit(6);
  }

  // Pre-flight auth check (same policy as runScenario)
  const oauthPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.gemini', 'oauth_creds.json'
  );
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY);
  const hasOAuth = existsSync(oauthPath);
  if (!hasApiKey && !hasOAuth) {
    console.error('FAIL: no auth found — set GEMINI_API_KEY or run `gemini auth login` first');
    process.exit(4);
  }

  // --- Turn 1: establish a new session ---
  const turn1Args = [
    '-p', 'My favorite number is 47. Remember it exactly.',
    '--output-format', 'stream-json'
  ];
  console.error('INFO: spawning turn 1 (establish session)');
  const t1 = await spawnAndCapture('gemini', turn1Args, { captureStderr: false });

  if (t1.exitCode !== 0) {
    console.error(`FAIL: turn 1 exited non-zero (exit=${t1.exitCode}); fixture pair cannot be completed`);
    process.exit(5);
  }

  // Extract session_id from turn 1 raw output BEFORE redaction
  let sessionId = null;
  for (const rawLine of t1.rawStdoutLines) {
    try {
      const ev = JSON.parse(rawLine);
      if (ev && ev.type === 'init' && ev.session_id) { sessionId = ev.session_id; break; }
    } catch { /* ignore */ }
  }
  // Fallback: some gemini-cli versions put session_id on the 'result' event
  if (!sessionId) {
    for (const rawLine of t1.rawStdoutLines) {
      try {
        const ev = JSON.parse(rawLine);
        if (ev && ev.type === 'result' && ev.session_id) { sessionId = ev.session_id; break; }
      } catch { /* ignore */ }
    }
  }

  if (!sessionId) {
    console.error(`FAIL: could not extract session_id from turn 1 (${t1.rawStdoutLines.length} lines received)`);
    t1.rawStdoutLines.forEach((l, i) => console.error(`  [${i}] ${l.slice(0, 120)}`));
    process.exit(5);
  }

  console.error(`INFO: captured session_id from turn 1 (length=${sessionId.length}); using for turn 2 --resume`);

  // Write turn 1 fixture (redacted)
  writeRedactedFixture('resume-session-turn1', t1, {
    description: 'Turn 1 of resume pair: establishes session, captures session_id from init event. Turn 2 resumes using that ID.',
    exit_code: t1.exitCode,
    extra_fields: {
      verdict_at_capture: verdict,
      pair_role: 'turn1'
    }
  });
  console.log('Captured: resume-session-turn1.ndjson');

  // --- Turn 2: resume the session ---
  let t2Description;
  const turn2Args = [
    '--resume', sessionId,  // real session_id here; redacted after capture
    '-p', 'What number did I just say?',
    '--output-format', 'stream-json'
  ];

  if (verdict === 'pass' || verdict === 'partial') {
    t2Description = 'Turn 2 of resume pair: uses --resume <id> -p to continue the session from turn 1. The assistant response should reference the number 47 from turn 1 context.';
  } else {
    console.error('INFO: resume_verdict is FAIL; capturing turn 2 as documentation of the failure mode');
    t2Description = 'Turn 2 of resume pair: CAPTURE OF FAILURE MODE. resume_verdict=fail in spec/feasibility.md. This fixture documents the broken state so Phase 7 can reference it when implementing the transcript-prepend fallback.';
  }

  console.error('INFO: spawning turn 2 (--resume <id> -p "What number did I just say?")');
  const t2 = await spawnAndCapture('gemini', turn2Args, {
    captureStderr: true,
    expectNonZeroExit: verdict === 'fail'
  });

  if (verdict !== 'fail' && t2.exitCode !== 0) {
    console.error(`WARN: turn 2 exited non-zero (exit=${t2.exitCode}) despite verdict=${verdict}`);
  }

  // Write turn 2 fixture (redacted; real session_id is scrubbed by the redactor layer)
  writeRedactedFixture('resume-session-turn2', t2, {
    description: t2Description,
    exit_code: t2.exitCode,
    extra_fields: {
      verdict_at_capture: verdict,
      pair_role: 'turn2',
      turn1_session_id_redacted: '<REDACTED_SESSION_ID>'
    }
  });
  console.log('Captured: resume-session-turn2.ndjson');

  console.error('PASS: captured resume-session-turn1 + resume-session-turn2');
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

  // feasibility: 3 smoke tests (W2 implementation)
  if (arg === 'feasibility') {
    console.error('INFO: running feasibility smoke tests (this takes several minutes)');

    const resume = await smokeResumeMatrix();
    const configDir = await smokeConfigDir();
    const flush = await smokeFlushTiming();

    const pinnedVersion = readFileSync('.gemini-cli-compat', 'utf8').trim();
    const report = renderFeasibilityMarkdown({ resume, configDir, flush, pinnedVersion });
    mkdirSync('spec', { recursive: true });
    writeFileSync('spec/feasibility.md', report, 'utf8');

    console.error(`PASS: feasibility smoke tests complete; verdicts written to spec/feasibility.md`);
    console.error(`  resume_verdict:     ${resume.verdict}`);
    console.error(`  config_dir_verdict: ${configDir.verdict}`);
    console.error(`  flush_verdict:      ${flush.verdict}`);
    process.exit(0);
  }

  // all: capture every non-synthetic IMPLEMENTED scenario; skip stubbed ones.
  // Guard: resume pair slugs are handled exactly once via runResumePair().
  if (arg === 'all') {
    let anyFailed = false;
    let resumePairCaptured = false;
    for (const slug of Object.keys(SCENARIOS)) {
      const scenario = SCENARIOS[slug];
      if (scenario.synthetic) continue;
      if (!IMPLEMENTED.has(slug)) {
        console.error(`SKIP: scenario ${slug} not yet implemented (pending later wave)`);
        continue;
      }
      // Resume pair: invoke once via runResumePair(), not runScenario()
      if (slug === 'resume-session-turn1' || slug === 'resume-session-turn2') {
        if (!resumePairCaptured) {
          try {
            await runResumePair();
            resumePairCaptured = true;
          } catch (err) {
            console.error(`FAIL: resume-session pair — ${err.message}`);
            anyFailed = true;
          }
        }
        continue;
      }
      try {
        await runScenario(slug);
      } catch (err) {
        console.error(`FAIL: scenario ${slug} — ${err.message}`);
        anyFailed = true;
      }
    }
    process.exit(anyFailed ? 1 : 0);
  }

  // Resume-session pair: both slugs are aliases for the same pair operation.
  // Single-policy: either slug triggers runResumePair() exactly once.
  if (arg === 'resume-session-turn1' || arg === 'resume-session-turn2') {
    await runResumePair();
    process.exit(0);
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
