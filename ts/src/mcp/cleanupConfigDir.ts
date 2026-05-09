/**
 * ts/src/mcp/cleanupConfigDir.ts
 *
 * Phase 9 (MCP-04): retry-resilient cleanup of an isolated GEMINI_CONFIG_DIR.
 * Uses Node's native fs.rm retry options (maxRetries:3, retryDelay:200) as the
 * antidote to Windows EBUSY when MCP grandchild processes linger on file
 * handles (gemini-cli issue #13604). On persistent failure, emits a single
 * console.warn and returns normally — NEVER re-throws, because masking the
 * original error the caller is handling in a finally block is worse than
 * leaking a temp dir.
 */

import { rm } from 'node:fs/promises';

/**
 * Remove the temp GEMINI_CONFIG_DIR created by writeConfigDir.
 * Safe to call on non-existent paths (force:true). Never throws.
 */
export async function cleanupConfigDir(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    // Warn but never re-throw — a leaked temp dir is recoverable; masking
    // the original error the caller is handling is not. (#13604 fallback)
    console.warn(
      `[gemini-cli-sdk] MCP config dir cleanup failed, stranded path: ${tempDir}`,
      err,
    );
  }
}
