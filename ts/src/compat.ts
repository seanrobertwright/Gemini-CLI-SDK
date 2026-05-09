/**
 * ts/src/compat.ts
 *
 * Runtime gemini-cli version compat probe (REL-05, REL-06).
 *
 * Ships as a once-per-process check: the first call to `checkCompatOnce()`
 * runs `gemini --version`, compares against the pinned version in
 * `.gemini-cli-compat`, and either warns (default), throws (strict), or
 * stays silent (silent mode). Subsequent calls are no-ops (cached).
 *
 * Environment variable: `GEMINI_SDK_COMPAT`
 *   - unset / any other value → default: warn to stderr
 *   - `strict`               → throw Error with the warning message
 *   - `silent`               → suppress warning entirely
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

let _checked = false;

export function _resetCompatCacheForTesting(): void {
  _checked = false;
}

export interface CompatProbeOptions {
  /** Absolute path to the resolved gemini binary. */
  cliPath: string;
  /** Override compat-file path (tests). Default: `<repo>/.gemini-cli-compat`. */
  compatFilePath?: string;
}

export function checkCompatOnce(opts: CompatProbeOptions): void {
  if (_checked) return;
  _checked = true;

  const mode = process.env.GEMINI_SDK_COMPAT ?? 'warn';
  if (mode === 'silent') return;

  // Resolve pinned version file. __dirname is not defined in ESM; derive it.
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultCompatFile = resolve(here, '../../.gemini-cli-compat');
  const compatFile = opts.compatFilePath ?? defaultCompatFile;

  let pinned: string;
  try {
    pinned = readFileSync(compatFile, 'utf-8').trim();
  } catch (err) {
    if (mode === 'strict') throw err;
    return; // warn mode: silent on compat-file missing
  }

  const pinnedSemver = semver.coerce(pinned)?.version;
  if (!pinnedSemver) return; // malformed compat file — silent

  const range = `~${pinnedSemver}`; // ~0.37.1 === 0.37.x
  const displayRange = `${semver.major(pinnedSemver)}.${semver.minor(pinnedSemver)}.x`;

  let detectedRaw: string;
  try {
    detectedRaw = execFileSync(opts.cliPath, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch (err) {
    if (mode === 'strict') throw err;
    return; // warn mode: silent on probe failure
  }

  const detected = semver.coerce(detectedRaw)?.version;
  if (!detected) return; // unparseable — silent

  if (!semver.satisfies(detected, range)) {
    const msg = `[gemini-cli-sdk] tested against gemini-cli ${displayRange}, detected ${detected} — proceeding`;
    if (mode === 'strict') throw new Error(msg);
    console.warn(msg);
  }
}
