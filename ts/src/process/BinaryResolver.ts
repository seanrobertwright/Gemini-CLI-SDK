import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { GeminiNotFoundError } from '../errors/index.js';

/**
 * Resolves the path to the gemini-cli binary.
 * Resolution order: cliPath argument > GEMINI_BIN_PATH env var > PATH lookup.
 *
 * On Windows, searches for `gemini.cmd` on PATH (not `gemini`).
 * Throws `GeminiNotFoundError` if not found.
 */
export function resolveBinary(cliPath?: string): string {
  // 1. Explicit cliPath takes highest priority
  if (cliPath) {
    return cliPath;
  }

  // 2. GEMINI_BIN_PATH env var
  const envBinPath = process.env['GEMINI_BIN_PATH'];
  if (envBinPath) {
    return envBinPath;
  }

  // 3. PATH lookup
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'gemini.cmd' : 'gemini';

  const pathEnv = process.env['PATH'] ?? '';
  const pathDirs = pathEnv.split(delimiter);

  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new GeminiNotFoundError();
}
