/**
 * ts/src/query/buildArgv.ts
 *
 * Pure function that maps QueryOptions to a string[] argv for gemini-cli.
 * No I/O, no side effects — 100% unit-testable.
 */

import type { QueryOptions } from './types.js';

/**
 * Build the argv array to pass to gemini-cli for a given QueryOptions.
 *
 * Rules:
 *   - Always starts with ['--output-format', 'stream-json', '-p', prompt]
 *   - model 'auto' or undefined → omits --model flag (MDL-03)
 *   - Any other model value → ['--model', value] (MDL-01, MDL-02)
 *   - additionalDirectories → one '--include-directories <dir>' per entry (CWD-02)
 *   - Empty additionalDirectories array → omits --include-directories flag
 */
export function buildArgv(options: QueryOptions): string[] {
  const argv: string[] = [
    '--output-format', 'stream-json',
    '-p', options.prompt,
  ];

  // MDL-03: omit --model when undefined or 'auto'
  if (options.model !== undefined && options.model !== 'auto') {
    argv.push('--model', options.model as string);
  }

  // CWD-02: one --include-directories flag per directory
  if (options.additionalDirectories?.length) {
    for (const dir of options.additionalDirectories) {
      argv.push('--include-directories', dir);
    }
  }

  return argv;
}
