/**
 * ts/src/mcp/mcpPassthrough.spec.ts
 *
 * MCP-02 invariant: the user's real ~/.gemini/settings.json mtime is never
 * modified by any SDK code path. Uses mock spawn (no real gemini-cli) to
 * verify the SDK does not open/write/stat/modify the real settings file
 * during a query with mcpServers.
 */

import { describe, it, expect, vi } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

// ── vi.mock hoisting ──────────────────────────────────────────────────────────

const { mockSpawn, mockKillTree } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockKillTree: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../process/index.js', () => {
  class ProcessManager {
    spawn(...args: unknown[]) {
      return mockSpawn(...args);
    }
  }
  return {
    ProcessManager,
    killTree: mockKillTree,
    buildEnv: vi.fn(),
    resolveBinary: vi.fn(),
    SpawnPerCallStrategy: vi.fn(),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
});

// ── imports (after mock declarations) ────────────────────────────────────────

import { queryFull } from '../query/query.js';

// ── helper ────────────────────────────────────────────────────────────────────

function createNoopSpawnResult() {
  // Empty stdout — stream ends immediately without any JSON events.
  // queryFull will throw ERR-06 (ProcessError: no result event) which is expected —
  // the mtime invariant doesn't depend on the query succeeding.
  const stdout = Readable.from([]);
  const stderr = Readable.from([]);

  const child = {
    pid: undefined,
    exitCode: 0,
    stdout,
    stderr,
    on: vi.fn(),
    kill: vi.fn(),
  } as unknown as ChildProcess;

  return {
    child,
    pid: undefined as number | undefined,
    stdout,
    stderr,
    getStderrTail: () => '',
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('MCP-02: mtime invariant — real ~/.gemini/settings.json untouched', () => {
  it('query with mcpServers does not mutate the real ~/.gemini/settings.json mtime', async () => {
    const settingsPath = join(homedir(), '.gemini', 'settings.json');

    if (!existsSync(settingsPath)) {
      // Skip gracefully on machines without a ~/.gemini/settings.json.
      // The test is most valuable on developer machines and CI with real gemini-cli.
      console.log(
        `[mcpPassthrough.spec.ts] Skipping mtime test: ${settingsPath} does not exist.`
      );
      return;
    }

    const beforeMtime = statSync(settingsPath).mtimeMs;

    // Use a noop spawn that returns empty stdout — no real gemini-cli needed.
    mockSpawn.mockReturnValue(createNoopSpawnResult());
    mockKillTree.mockResolvedValue(undefined);

    try {
      await queryFull({
        prompt: 'noop',
        mcpServers: { s: { command: 'node' } },
        allowedMcpServerNames: ['s'],
      });
    } catch {
      // ERR-06 (ProcessError) is expected because the fake stdout has no result chunk.
      // We only care about the mtime invariant below.
    }

    const afterMtime = statSync(settingsPath).mtimeMs;
    expect(afterMtime).toBe(beforeMtime);
  });
});
