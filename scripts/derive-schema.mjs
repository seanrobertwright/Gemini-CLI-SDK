#!/usr/bin/env node
// Derives spec/events.schema.json empirically from spec/fixtures/*.ndjson.
// Run: node scripts/derive-schema.mjs > spec/events.schema.json
// Re-run whenever fixtures change. The committed schema is the source of truth.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const FIXTURE_DIR = 'spec/fixtures';
const PIN_FILE = '.gemini-cli-compat';

// Per RESEARCH.md §upstream docs, these are the baseline types gemini-cli emits.
// Derivation MUST find at least this many distinct types across fixtures.
const MIN_EXPECTED_TYPES = 6;
const BASELINE_TYPES = ['init', 'message', 'tool_use', 'tool_result', 'error', 'result'];

function pascalCase(snake) {
  return snake.split(/[_-]/).filter(Boolean)
    .map(p => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join('') + 'Event';
}

function inferType(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array' };
  const t = typeof value;
  if (t === 'string') return { type: 'string' };
  if (t === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  if (t === 'object') return { type: 'object', additionalProperties: true };
  return {};
}

function mergeFieldShape(existing, nextValue) {
  const next = inferType(nextValue);
  if (!existing) return { shape: next, count: 1, nullable: nextValue === null };
  const shape = existing.shape;
  const nullable = existing.nullable || nextValue === null;
  if (shape.type && next.type && shape.type !== next.type) {
    if (shape.oneOf) {
      if (!shape.oneOf.some(o => o.type === next.type)) {
        shape.oneOf.push({ type: next.type });
      }
    } else {
      existing.shape = { oneOf: [{ type: shape.type }, { type: next.type }] };
    }
  }
  existing.count += 1;
  existing.nullable = nullable;
  return existing;
}

/**
 * Returns true if this fixture contains artificially-mutated event types
 * that should NOT be derived into the schema (e.g., cosmic_ray_hit in event-unknown.ndjson).
 *
 * Fixtures marked synthetic:true because the error condition couldn't be triggered
 * naturally (e.g., error-auth.ndjson, error-rate-limit.ndjson) still contain
 * REAL-SHAPED events (`init`, `error`) derived from documented gemini-cli formats.
 * We include those for schema derivation. Only fixtures with `derived_from` that
 * indicates a type-mutation are truly excluded.
 */
function isTypeMutationFixture(ndjsonPath) {
  const expectedPath = ndjsonPath.replace(/\.ndjson$/, '.expected.json');
  if (!existsSync(expectedPath)) return false;
  try {
    const meta = JSON.parse(readFileSync(expectedPath, 'utf8'));
    // Only skip fixtures that are type-mutation experiments (cosmic_ray_hit, etc.)
    // These are identified by having both synthetic:true AND description/derived_from that
    // describes a "type mutation" pattern (the type field itself was mutated to an invented value).
    if (meta.synthetic !== true) return false;
    const derivedFrom = (meta.derived_from || '').toLowerCase();
    const description = (meta.description || '').toLowerCase();
    return derivedFrom.includes('type-mutation') || derivedFrom.includes('type mutation') ||
           derivedFrom.includes('mutated') || derivedFrom.includes('replacing type') ||
           description.includes('type field mutated') || description.includes('replacing type') ||
           description.includes('type mutated');
  } catch {
    return false;
  }
}

function deriveSchema() {
  const typeGroups = Object.create(null);

  const fixtures = readdirSync(FIXTURE_DIR)
    .filter(f => f.endsWith('.ndjson'))
    .map(f => path.join(FIXTURE_DIR, f));

  let scannedFiles = 0;
  let scannedEvents = 0;

  for (const fixturePath of fixtures) {
    if (isTypeMutationFixture(fixturePath)) {
      console.error(`SKIP: ${fixturePath} (type-mutation synthetic — artificial type, not a real event shape)`);
      continue;
    }
    scannedFiles += 1;
    const text = readFileSync(fixturePath, 'utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    for (const line of lines) {
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (!ev || typeof ev !== 'object' || !ev.type || typeof ev.type !== 'string') continue;
      const t = ev.type;
      // Skip redaction artifacts — a type that looks like a placeholder is not a real event type
      if (t.startsWith('<REDACTED') || t.startsWith('[REDACTED')) {
        console.error(`WARN: skipping redacted-type event in ${fixturePath}: type=${JSON.stringify(t)}`);
        continue;
      }
      if (!typeGroups[t]) typeGroups[t] = { fields: Object.create(null), totalCount: 0 };
      typeGroups[t].totalCount += 1;
      scannedEvents += 1;
      for (const [k, v] of Object.entries(ev)) {
        if (k === 'type') continue;
        typeGroups[t].fields[k] = mergeFieldShape(typeGroups[t].fields[k], v);
      }
    }
  }

  const observedTypes = Object.keys(typeGroups).sort();
  console.error(`INFO: scanned ${scannedFiles} non-synthetic fixtures, ${scannedEvents} events, ${observedTypes.length} distinct types: ${observedTypes.join(', ')}`);

  if (observedTypes.length < MIN_EXPECTED_TYPES) {
    console.error(`FAIL: found only ${observedTypes.length} types but expected >= ${MIN_EXPECTED_TYPES}`);
    console.error(`       baseline types per RESEARCH.md: ${BASELINE_TYPES.join(', ')}`);
    console.error(`       missing from fixtures: ${BASELINE_TYPES.filter(t => !observedTypes.includes(t)).join(', ')}`);
    process.exit(3);
  }

  const $defs = Object.create(null);
  const oneOf = [];
  for (const t of observedTypes) {
    const defName = pascalCase(t);
    const grp = typeGroups[t];
    const properties = { type: { const: t } };
    const required = ['type'];
    for (const [fname, info] of Object.entries(grp.fields)) {
      let propSchema = { ...info.shape };
      if (info.nullable && propSchema.type && propSchema.type !== 'null') {
        propSchema = { oneOf: [propSchema, { type: 'null' }] };
      }
      properties[fname] = propSchema;
      if (info.count === grp.totalCount) required.push(fname);
    }
    $defs[defName] = {
      type: 'object',
      required,
      properties,
      additionalProperties: true
    };
    oneOf.push({ $ref: `#/$defs/${defName}` });
  }

  const pinnedVersion = existsSync(PIN_FILE) ? readFileSync(PIN_FILE, 'utf8').trim() : 'unknown';

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://gemini-sdk.dev/spec/events.schema.json',
    title: 'Gemini CLI stream-json event',
    description: `Discriminated union of all event types observed in spec/fixtures/ captured against gemini-cli@${pinnedVersion}. Each $defs entry represents ONE observed event type. Every entry sets additionalProperties:true so the parser tolerates upstream field additions. The schema is a FLOOR of known fields, not a ceiling. Unknown types are handled by the parser\'s lenient fallback (PRS-03), not by this schema.`,
    oneOf,
    $defs
  };
}

const schema = deriveSchema();
process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
