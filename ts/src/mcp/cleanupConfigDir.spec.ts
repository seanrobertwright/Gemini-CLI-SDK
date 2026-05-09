/**
 * ts/src/mcp/cleanupConfigDir.spec.ts
 *
 * Unit tests for cleanupConfigDir (Phase 9 MCP-04).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ── vi.mock hoisting ─────────────────────────────────────────────────────────
// We need to mock fs.rm so test 3 can stub it to reject persistently.
// We capture the actual rm from importOriginal so that other tests
// delegate to the real implementation (no infinite recursion).

const { mockRm, realRmHolder } = vi.hoisted(() => ({
  mockRm: vi.fn(),
  realRmHolder: { rm: null as ((path: string, opts?: object) => Promise<void>) | null },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  // Store the real rm so beforeEach can restore delegation without recursion
  realRmHolder.rm = actual.rm as (path: string, opts?: object) => Promise<void>;
  return {
    ...actual,
    rm: mockRm,
  };
});

// ── imports (after mock declarations) ────────────────────────────────────────
import { cleanupConfigDir } from './cleanupConfigDir.js';
import { writeConfigDir } from './writeConfigDir.js';

describe('cleanupConfigDir', () => {
  beforeEach(() => {
    // Default: delegate to real rm so tests 1 and 2 exercise real filesystem
    mockRm.mockImplementation(
      (p: string, opts?: object) => realRmHolder.rm!(p, opts),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('removes an existing temp dir created by writeConfigDir', async () => {
    // Use writeConfigDir to make a real dir
    const tempDir = await writeConfigDir({ srv: { command: 'node' } });

    // Verify it exists first
    expect(fs.existsSync(tempDir)).toBe(true);

    await cleanupConfigDir(tempDir);

    // Assert dir no longer exists after await
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('returns normally when path does not exist', async () => {
    const nonExistent = path.join(os.tmpdir(), 'gemini-cli-sdk-mcp-nonexistent-' + Date.now());
    // Should resolve without throwing
    await expect(cleanupConfigDir(nonExistent)).resolves.toBeUndefined();
  });

  it('warns and does not throw when rm fails persistently', async () => {
    const stubbedError = new Error('EBUSY: resource busy or locked');
    mockRm.mockRejectedValue(stubbedError);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const targetPath = 'some/path';
    await expect(cleanupConfigDir(targetPath)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = warnSpy.mock.calls[0][0] as string;
    expect(warnArg).toContain(targetPath);
    expect(warnArg).toContain('stranded path');

    warnSpy.mockRestore();
  });

  it('uses fs.rm with maxRetries 3 and retryDelay 200', () => {
    // Static assertion: the source file must contain the exact options literal.
    // This is a compile-time-ish guard that the native Windows EBUSY retry knob is present.
    const srcPath = path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
      'cleanupConfigDir.ts',
    );
    const src = fs.readFileSync(srcPath, 'utf-8');
    expect(src).toContain('maxRetries: 3');
    expect(src).toContain('retryDelay: 200');
  });
});
