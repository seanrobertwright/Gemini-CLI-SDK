/**
 * ts/src/mcp/writeConfigDir.ts
 *
 * Phase 9 (MCP-01, MCP-02): create an isolated GEMINI_CONFIG_DIR for one
 * query invocation. Writes settings.json containing only
 * { mcpServers: <verbatim input> } — no .gemini/ subdir (Phase 9 research
 * spike confirmed gemini-cli reads $GEMINI_CONFIG_DIR/settings.json directly).
 *
 * Mirrors the writeTempSystemPrompt template in query.ts (lines 44-63).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Create a fresh temp directory and write settings.json containing only
 * { mcpServers: <verbatim input> }. Returns the absolute temp dir path.
 * Caller sets GEMINI_CONFIG_DIR to this path and is responsible for cleanup
 * via cleanupConfigDir() in a finally block.
 */
export async function writeConfigDir(
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<string> {
  const suffix = randomBytes(8).toString('hex');
  const tempDir = join(tmpdir(), 'gemini-cli-sdk-mcp-' + suffix);
  await mkdir(tempDir, { recursive: true });
  const content = JSON.stringify({ mcpServers }, null, 2);
  await writeFile(join(tempDir, 'settings.json'), content, 'utf-8');
  return tempDir;
}
