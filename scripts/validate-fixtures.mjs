#!/usr/bin/env node
/**
 * scripts/validate-fixtures.mjs
 *
 * Node ESM validation script for Phase 1 spec documents, JSON Schema, and
 * NDJSON fixture corpus. No transpilation required — Node 18+ ESM.
 *
 * Usage:
 *   node scripts/validate-fixtures.mjs              # runs parse + schema + pairs + manifest
 *   node scripts/validate-fixtures.mjs <subcommand> # runs only the named subcommand
 *
 * Subcommands: parse, schema, pairs, manifest, pin, feasibility, citations
 *
 * Exit codes: 0 = all checked subcommands passed, 1 = any failure
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// ── Repo root ──────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
process.chdir(repoRoot);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Return all *.ndjson files under spec/fixtures/ */
function listFixtures() {
  const dir = 'spec/fixtures';
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ndjson'))
    .map((f) => path.join(dir, f));
}

/** Parse NDJSON file. Returns array of { lineNo, obj } or throws on error. */
function parseNdjson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      results.push({ lineNo: i + 1, obj: JSON.parse(line) });
    } catch (err) {
      throw new Error(`${filePath}:${i + 1}: ${err.message}`);
    }
  }
  return results;
}

/** Pretty-print subcommand result */
function printResult(name, result) {
  for (const msg of result.messages) {
    if (msg.startsWith('FAIL:') || msg.startsWith('WARN:') || msg.startsWith('INFO:')) {
      console.log(msg);
    } else {
      console.log(msg);
    }
  }
  if (result.ok) {
    // summary already in messages
  }
}

// ── Subcommands ────────────────────────────────────────────────────────────

/**
 * parse — Verify every spec/fixtures/*.ndjson file is well-formed NDJSON.
 */
async function cmdParse() {
  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    return { ok: true, messages: ['INFO: 0 fixtures found, nothing to parse'] };
  }

  const messages = [];
  let failed = 0;
  for (const f of fixtures) {
    try {
      const rows = parseNdjson(f);
      messages.push(`  parse: ${f} (${rows.length} lines ok)`);
    } catch (err) {
      messages.push(`FAIL: ${err.message}`);
      failed++;
    }
  }

  if (failed === 0) {
    messages.push(`PASS: parse (${fixtures.length} fixtures ok)`);
    return { ok: true, messages };
  }
  messages.push(`FAIL: parse (${failed} fixture(s) have parse errors)`);
  return { ok: false, messages };
}

/**
 * Returns true if this fixture's sibling .expected.json has synthetic:true.
 * Synthetic fixtures contain artificially-constructed events (type-mutations,
 * hand-crafted error shapes) that may not match the schema by design.
 */
function isSyntheticFixture(ndjsonPath) {
  const stem = ndjsonPath.replace(/\.ndjson$/, '');
  const expectedPath = stem + '.expected.json';
  if (!fs.existsSync(expectedPath)) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    return meta.synthetic === true;
  } catch {
    return false;
  }
}

/**
 * schema — Validate every event in every fixture against spec/events.schema.json via Ajv 2020.
 * Fixtures marked synthetic:true in their .expected.json sidecar are skipped.
 * Individual events with REDACTED-type placeholders are skipped with a warning.
 */
async function cmdSchema() {
  const schemaPath = 'spec/events.schema.json';
  if (!fs.existsSync(schemaPath)) {
    return { ok: false, messages: [`FAIL: ${schemaPath} not found`] };
  }

  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    return { ok: false, messages: [`FAIL: ${schemaPath} is not valid JSON: ${err.message}`] };
  }

  // If oneOf is empty, skip per-event validation
  if (Array.isArray(schema.oneOf) && schema.oneOf.length === 0) {
    return {
      ok: true,
      messages: [
        'WARN: schema oneOf is empty, skipping per-event validation (plan 09 populates it)',
        'PASS: schema (oneOf empty — seed state)',
      ],
    };
  }

  // Dynamically import Ajv 2020
  let Ajv2020, addFormats;
  try {
    const ajvMod = await import('ajv/dist/2020.js');
    Ajv2020 = ajvMod.default;
    const formatsMod = await import('ajv-formats');
    addFormats = formatsMod.default;
  } catch (err) {
    return {
      ok: false,
      messages: [
        `FAIL: could not import ajv/ajv-formats — run npm install first: ${err.message}`,
      ],
    };
  }

  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    return { ok: false, messages: [`FAIL: Ajv could not compile schema: ${err.message}`] };
  }

  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    return { ok: true, messages: ['INFO: 0 fixtures found, nothing to validate against schema', 'PASS: schema'] };
  }

  const messages = [];
  let failed = 0;
  let skippedFiles = 0;
  let skippedEvents = 0;
  let validatedFiles = 0;

  for (const f of fixtures) {
    // Skip synthetic fixtures — they contain artificial event types (e.g., cosmic_ray_hit)
    // or hand-crafted error shapes that may not match the schema by design.
    if (isSyntheticFixture(f)) {
      messages.push(`INFO: SKIP ${f} (synthetic — skipping schema validation)`);
      skippedFiles++;
      continue;
    }

    let rows;
    try {
      rows = parseNdjson(f);
    } catch (err) {
      messages.push(`FAIL: ${err.message}`);
      failed++;
      continue;
    }

    validatedFiles++;
    for (const { lineNo, obj } of rows) {
      // Skip events with REDACTED-type placeholders (redaction artifacts in captured fixtures)
      if (
        obj &&
        typeof obj.type === 'string' &&
        (obj.type.startsWith('<REDACTED') || obj.type.startsWith('[REDACTED'))
      ) {
        messages.push(`INFO: SKIP ${f}:${lineNo} (redacted type=${JSON.stringify(obj.type)} — redaction artifact)`);
        skippedEvents++;
        continue;
      }

      const valid = validate(obj);
      if (!valid) {
        const errs = validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ');
        messages.push(`FAIL: ${f}:${lineNo}: schema validation error: ${errs}`);
        failed++;
      }
    }
  }

  if (failed === 0) {
    const summary = [
      `PASS: schema (${validatedFiles} fixtures validated`,
      skippedFiles > 0 ? `, ${skippedFiles} synthetic skipped` : '',
      skippedEvents > 0 ? `, ${skippedEvents} redacted events skipped` : '',
      ')',
    ].join('');
    messages.push(summary);
    return { ok: true, messages };
  }
  messages.push(`FAIL: schema (${failed} validation error(s))`);
  return { ok: false, messages };
}

/**
 * pairs — Verify every *.ndjson file has a sibling *.expected.json of the same stem.
 */
async function cmdPairs() {
  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    return { ok: true, messages: ['INFO: 0 fixtures found, pairs check skipped', 'PASS: pairs'] };
  }

  const messages = [];
  let failed = 0;
  for (const f of fixtures) {
    const stem = path.basename(f, '.ndjson');
    const expectedPath = path.join('spec/fixtures', `${stem}.expected.json`);
    if (!fs.existsSync(expectedPath)) {
      messages.push(`FAIL: missing sidecar for ${f}: expected ${expectedPath}`);
      failed++;
    }
  }

  if (failed === 0) {
    messages.push(`PASS: pairs (${fixtures.length} fixtures all have .expected.json sidecars)`);
    return { ok: true, messages };
  }
  messages.push(`FAIL: pairs (${failed} fixture(s) missing .expected.json sidecar)`);
  return { ok: false, messages };
}

/**
 * manifest — Verify spec/fixtures.manifest.json exists and check slug presence.
 * Exits 0 even if fixtures are missing (W3 populates them incrementally).
 */
async function cmdManifest() {
  const manifestPath = 'spec/fixtures.manifest.json';
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, messages: [`FAIL: ${manifestPath} not found`] };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { ok: false, messages: [`FAIL: ${manifestPath} is not valid JSON: ${err.message}`] };
  }

  if (!Array.isArray(manifest.slugs)) {
    return { ok: false, messages: [`FAIL: ${manifestPath} missing "slugs" array`] };
  }

  const totalSlugs = manifest.slugs.length;
  if (totalSlugs !== 12) {
    return {
      ok: false,
      messages: [
        `FAIL: ${manifestPath} has ${totalSlugs} slugs, expected 12`,
      ],
    };
  }

  const messages = [];
  const missing = [];
  const present = [];

  for (const slug of manifest.slugs) {
    const ndjson = `spec/fixtures/${slug}.ndjson`;
    const expected = `spec/fixtures/${slug}.expected.json`;
    if (fs.existsSync(ndjson) && fs.existsSync(expected)) {
      present.push(slug);
    } else {
      missing.push(slug);
    }
  }

  const presentCount = present.length;
  if (missing.length === totalSlugs) {
    messages.push(
      `INFO: 0/${totalSlugs} fixtures present (${manifest.slugs.join(', ')} all missing)`
    );
  } else if (missing.length > 0) {
    messages.push(
      `INFO: ${presentCount}/${totalSlugs} fixtures present. Missing: ${missing.join(', ')}`
    );
  } else {
    messages.push(`INFO: ${presentCount}/${totalSlugs} fixtures present (all slugs populated)`);
  }
  messages.push(`PASS: manifest (${totalSlugs} slugs listed, ${presentCount} fixtures present)`);
  return { ok: true, messages };
}

/**
 * pin — Verify .gemini-cli-compat exists and contains a valid semver string (or is empty seed).
 */
async function cmdPin() {
  const pinPath = '.gemini-cli-compat';
  if (!fs.existsSync(pinPath)) {
    return { ok: false, messages: [`FAIL: ${pinPath} not found — W1 must create it`] };
  }

  const content = fs.readFileSync(pinPath, 'utf8');
  const trimmed = content.trim();

  if (trimmed === '') {
    return {
      ok: true,
      messages: [
        `INFO: .gemini-cli-compat is empty (W1 writes pinned version)`,
        'PASS: pin (seed state)',
      ],
    };
  }

  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return {
      ok: true,
      messages: [`PASS: pin (pinned version: ${trimmed})`],
    };
  }

  return {
    ok: false,
    messages: [
      `FAIL: .gemini-cli-compat content does not match semver pattern ^\\d+\\.\\d+\\.\\d+$: "${trimmed}"`,
    ],
  };
}

/**
 * feasibility — Verify spec/feasibility.md exists with the three required verdict keys
 * and exactly three "Verdict:" lines in the body.
 */
async function cmdFeasibility() {
  const feasPath = 'spec/feasibility.md';
  if (!fs.existsSync(feasPath)) {
    return { ok: false, messages: [`FAIL: ${feasPath} not found`] };
  }

  const raw = fs.readFileSync(feasPath, 'utf8');

  // Parse YAML frontmatter between first two --- delimiters
  const lines = raw.split(/\r?\n/);
  let fmStart = -1;
  let fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (fmStart === -1) {
        fmStart = i;
      } else {
        fmEnd = i;
        break;
      }
    }
  }

  if (fmStart === -1 || fmEnd === -1) {
    return { ok: false, messages: [`FAIL: ${feasPath} has no valid YAML frontmatter (missing --- delimiters)`] };
  }

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const frontmatter = {};
  for (const fl of fmLines) {
    const m = fl.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      frontmatter[m[1].trim()] = m[2].trim();
    }
  }

  const requiredKeys = ['resume_verdict', 'config_dir_verdict', 'flush_verdict'];
  const allowedValues = ['pending', 'pass', 'fail', 'partial'];
  const messages = [];
  let failed = false;

  for (const key of requiredKeys) {
    if (!(key in frontmatter)) {
      messages.push(`FAIL: ${feasPath} frontmatter missing key: ${key}`);
      failed = true;
    } else if (!allowedValues.includes(frontmatter[key])) {
      messages.push(
        `FAIL: ${feasPath} frontmatter key "${key}" has invalid value "${frontmatter[key]}" (allowed: ${allowedValues.join(', ')})`
      );
      failed = true;
    } else if (frontmatter[key] === 'pending') {
      messages.push(`INFO: verdict ${key} is still pending`);
    }
  }

  if (failed) {
    return { ok: false, messages };
  }

  // Count "Verdict:" lines in the body (after frontmatter)
  const body = lines.slice(fmEnd + 1).join('\n');
  const verdictMatches = body.match(/Verdict: /g);
  const verdictCount = verdictMatches ? verdictMatches.length : 0;

  // Skip body checks if all verdicts are still pending (W0 seed state)
  const allPending = requiredKeys.every((k) => frontmatter[k] === 'pending');

  if (!allPending && verdictCount < 3) {
    messages.push(
      `FAIL: ${feasPath} has ${verdictCount} "Verdict: " line(s) in body, expected exactly 3`
    );
    return { ok: false, messages };
  }

  // Matrix table assertion: skip if all three verdicts are still pending
  if (!allPending) {
    const tableRows = body.split(/\r?\n/).filter((l) => l.startsWith('|')).length;
    if (tableRows < 10) {
      messages.push(
        `FAIL: feasibility.md missing 9-cell resume matrix (found ${tableRows} table rows, expected >= 10)`
      );
      return { ok: false, messages };
    }
  }

  messages.push(`PASS: feasibility (all three verdict keys present, ${verdictCount} Verdict: lines)`);
  return { ok: true, messages };
}

/**
 * citations — Verify spec/protocol.md and spec/errors.md cite fixture filenames,
 * unless they're still placeholder seed files.
 */
async function cmdCitations() {
  const specFiles = ['spec/protocol.md', 'spec/errors.md'];
  const PLACEHOLDER_PHRASES = [
    '(Drafted in Phase 1 from captured',
    '(Drafted in Phase 1',
  ];

  const messages = [];
  let failed = false;

  for (const specFile of specFiles) {
    if (!fs.existsSync(specFile)) {
      messages.push(`FAIL: ${specFile} not found`);
      failed = true;
      continue;
    }

    const content = fs.readFileSync(specFile, 'utf8');

    // Check if still a placeholder
    const isPlaceholder = PLACEHOLDER_PHRASES.some((phrase) => content.includes(phrase));
    if (isPlaceholder) {
      messages.push(`INFO: ${specFile} is still a placeholder, skipping citation check`);
      continue;
    }

    // Count fixture citations
    const citationCount = (content.match(/spec\/fixtures\//g) || []).length;
    if (citationCount === 0) {
      messages.push(`FAIL: ${specFile} has no fixture citations`);
      failed = true;
    } else {
      messages.push(`  citations: ${specFile} (${citationCount} fixture citation(s))`);
    }
  }

  if (!failed) {
    messages.push('PASS: citations');
    return { ok: true, messages };
  }
  messages.push('FAIL: citations (one or more spec docs have no fixture citations)');
  return { ok: false, messages };
}

// ── Main dispatch ──────────────────────────────────────────────────────────

const SUBCOMMANDS = {
  parse: cmdParse,
  schema: cmdSchema,
  pairs: cmdPairs,
  manifest: cmdManifest,
  pin: cmdPin,
  feasibility: cmdFeasibility,
  citations: cmdCitations,
};

const DEFAULT_SUBCOMMANDS = ['parse', 'schema', 'pairs', 'manifest'];

async function main() {
  const arg = process.argv[2];

  let toRun;
  if (!arg) {
    toRun = DEFAULT_SUBCOMMANDS;
  } else if (SUBCOMMANDS[arg]) {
    toRun = [arg];
  } else {
    console.error(`FAIL: unknown subcommand "${arg}". Valid: ${Object.keys(SUBCOMMANDS).join(', ')}`);
    process.exit(1);
  }

  let allOk = true;

  for (const name of toRun) {
    const fn = SUBCOMMANDS[name];
    let result;
    try {
      result = await fn();
    } catch (err) {
      result = { ok: false, messages: [`FAIL: ${name} threw unexpected error: ${err.message}`] };
    }

    printResult(name, result);

    if (!result.ok) {
      allOk = false;
    }
  }

  process.exit(allOk ? 0 : 1);
}

// Only run when invoked directly (not when imported by tests or other scripts)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`FAIL: unhandled error: ${err.message}`);
    process.exit(1);
  });
}

export default { SUBCOMMANDS, main };
