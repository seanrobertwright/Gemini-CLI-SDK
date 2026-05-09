/**
 * ts/src/compat.spec.ts
 *
 * Vitest suite for checkCompatOnce (REL-06 compat probe).
 * Uses vi.mock() to intercept execFileSync; creates a real temp compat file
 * via tmp_path so file resolution logic is exercised without reading the actual
 * .gemini-cli-compat from disk.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Hoist mock variable so the factory closure can access it.
const { mockedExecFileSync } = vi.hoisted(() => ({
  mockedExecFileSync: vi.fn<(...args: unknown[]) => string>(),
}));

// Mock node:child_process so execFileSync is interceptable.
vi.mock('node:child_process', () => ({
  execFileSync: mockedExecFileSync,
}));

// Import after mock is set up.
import { checkCompatOnce, _resetCompatCacheForTesting } from './compat.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;
let compatFilePath: string;

function writeCompatFile(version: string) {
  writeFileSync(compatFilePath, `${version}\n`, 'utf-8');
}

// ────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetCompatCacheForTesting();
  vi.resetAllMocks();
  vi.unstubAllEnvs();

  // Create a fresh temp dir + compat file for each test.
  tmpDir = mkdtempSync(join(tmpdir(), 'gemini-sdk-compat-test-'));
  compatFilePath = join(tmpDir, '.gemini-cli-compat');
  writeCompatFile('0.37.1');
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('checkCompatOnce', () => {
  it('warn default in-range: no warning emitted when detected version is within ~0.37.1', () => {
    mockedExecFileSync.mockReturnValueOnce('gemini 0.37.5\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('warn default out-of-range: writes exact warning string to stderr when detected outside ~0.37.1', () => {
    mockedExecFileSync.mockReturnValueOnce('gemini 0.39.2\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[gemini-cli-sdk] tested against gemini-cli 0.37.x, detected 0.39.2 — proceeding'
    );
  });

  it('strict mode out-of-range: throws Error with exact warning message', () => {
    vi.stubEnv('GEMINI_SDK_COMPAT', 'strict');
    mockedExecFileSync.mockReturnValueOnce('gemini 0.39.2\n');

    expect(() => checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath })).toThrowError(
      '[gemini-cli-sdk] tested against gemini-cli 0.37.x, detected 0.39.2 — proceeding'
    );
  });

  it('silent mode out-of-range: no warning emitted and no throw', () => {
    vi.stubEnv('GEMINI_SDK_COMPAT', 'silent');
    mockedExecFileSync.mockReturnValueOnce('gemini 0.39.2\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath })).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
    // execFileSync never called because silent returns early
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('cache hit: execFileSync invoked exactly once across two calls', () => {
    // Use in-range version so no warning is emitted — isolates cache behavior.
    mockedExecFileSync.mockReturnValue('0.37.3');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath });
    checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath });

    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('binary not found in warn mode: silent (does not re-throw)', () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => checkCompatOnce({ cliPath: '/bad/path/gemini', compatFilePath })).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('binary not found in strict mode: re-throws the probe error', () => {
    vi.stubEnv('GEMINI_SDK_COMPAT', 'strict');
    const probeError = new Error('ENOENT: no such file or directory');
    mockedExecFileSync.mockImplementationOnce(() => {
      throw probeError;
    });

    expect(() => checkCompatOnce({ cliPath: '/bad/path/gemini', compatFilePath })).toThrow(probeError);
  });

  it('_resetCompatCacheForTesting clears cache enabling subsequent calls to re-probe', () => {
    mockedExecFileSync.mockReturnValue('gemini 0.37.1\n');

    checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath });
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);

    _resetCompatCacheForTesting();

    checkCompatOnce({ cliPath: '/usr/bin/gemini', compatFilePath });
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
  });
});
