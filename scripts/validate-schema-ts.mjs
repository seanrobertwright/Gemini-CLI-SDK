#!/usr/bin/env node
/**
 * scripts/validate-schema-ts.mjs
 *
 * Smoke test: compile spec/events.schema.json with json-schema-to-typescript@15.0.4
 * and verify the generated TypeScript passes `tsc --noEmit --strict`.
 *
 * Usage: node scripts/validate-schema-ts.mjs
 *
 * Exit 0 = codegen + tsc both passed.
 * Exit 1 = any failure (underlying error printed to stderr).
 *
 * Requires: npm install (json-schema-to-typescript@15.0.4, typescript@^5.6.3 in devDependencies)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';

// ── Repo root ──────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
process.chdir(repoRoot);

const SCHEMA_PATH = 'spec/events.schema.json';

async function main() {
  // 1. Verify schema file exists
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`FAIL: ${SCHEMA_PATH} not found`);
    process.exit(1);
  }

  // 2. Import json-schema-to-typescript (installed via package.json devDependencies)
  let compileFromFile;
  try {
    const mod = await import('json-schema-to-typescript');
    compileFromFile = mod.compileFromFile;
  } catch (err) {
    console.error(
      `FAIL: could not import json-schema-to-typescript — run npm install first: ${err.message}`
    );
    process.exit(1);
  }

  // 3. Generate TypeScript from JSON Schema
  let tsSource;
  try {
    tsSource = await compileFromFile(SCHEMA_PATH, {
      bannerComment: '',
      additionalProperties: true,
      strictIndexSignatures: false,
    });
  } catch (err) {
    console.error(`FAIL: json-schema-to-typescript failed: ${err.message}`);
    process.exit(1);
  }

  // 4. Write generated TS to a temp file
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `events-${Date.now()}.d.ts`);

  try {
    fs.writeFileSync(tmpFile, tsSource, 'utf8');

    // 5. Run tsc --noEmit --strict against the generated .d.ts
    const exitCode = await new Promise((resolve, reject) => {
      // Use npx to locate the pinned typescript installed in node_modules
      const tscArgs = [
        '-y',
        `typescript@5`,
        'tsc',
        '--noEmit',
        '--strict',
        '--target',
        'es2022',
        '--lib',
        'es2022',
        '--module',
        'esnext',
        '--moduleResolution',
        'bundler',
        '--skipLibCheck',
        tmpFile,
      ];

      const proc = spawn('npx', tscArgs, {
        shell: false,
        windowsHide: true,
        stdio: 'inherit',
      });

      proc.on('error', reject);
      proc.on('close', resolve);
    });

    if (exitCode !== 0) {
      console.error(`FAIL: tsc rejected generated .d.ts (${tmpFile})`);
      process.exit(1);
    }

    console.log(`PASS: validate-schema-ts (${tmpFile})`);
  } finally {
    // 6. Clean up temp file (swallow ENOENT)
    try {
      fs.unlinkSync(tmpFile);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Non-fatal — log but don't fail
        console.error(`WARN: could not clean up temp file ${tmpFile}: ${err.message}`);
      }
    }
  }
}

// Only run when invoked directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`FAIL: unhandled error: ${err.message}`);
    process.exit(1);
  });
}

export default { main };
