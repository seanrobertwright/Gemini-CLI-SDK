import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { resolveBinary } from './BinaryResolver.js';
import { GeminiNotFoundError } from '../errors/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveBinary()', () => {
  it('returns cliPath directly when provided, without checking PATH', () => {
    // Stub PATH to empty so if it fell through to PATH lookup it would fail
    vi.stubEnv('PATH', '');
    vi.stubEnv('GEMINI_BIN_PATH', '');

    const result = resolveBinary('/custom/path/to/gemini');
    expect(result).toBe('/custom/path/to/gemini');
  });

  it('returns GEMINI_BIN_PATH when no cliPath is given', () => {
    vi.stubEnv('GEMINI_BIN_PATH', '/env/path/gemini');
    vi.stubEnv('PATH', '');

    const result = resolveBinary();
    expect(result).toBe('/env/path/gemini');
  });

  it('finds gemini on PATH when no cliPath and no GEMINI_BIN_PATH', () => {
    // Create a temp directory with a fake gemini binary
    const tmpDir = mkdtempSync(join(tmpdir(), 'gemini-test-'));
    const isWin = platform() === 'win32';
    const binaryName = isWin ? 'gemini.cmd' : 'gemini';
    const fakeBinary = join(tmpDir, binaryName);

    writeFileSync(fakeBinary, isWin ? '@echo off\n' : '#!/bin/sh\n');
    if (!isWin) {
      chmodSync(fakeBinary, 0o755);
    }

    vi.stubEnv('GEMINI_BIN_PATH', '');
    vi.stubEnv('PATH', tmpDir);

    const result = resolveBinary();
    expect(result).toBe(fakeBinary);
  });

  it('throws GeminiNotFoundError with helpful install message when binary not found', () => {
    vi.stubEnv('GEMINI_BIN_PATH', '');
    vi.stubEnv('PATH', '/nonexistent/path/that/does/not/exist');

    expect(() => resolveBinary()).toThrow(GeminiNotFoundError);
    expect(() => resolveBinary()).toThrow('gemini-cli not found');
    expect(() => resolveBinary()).toThrow('npm install -g @google/gemini-cli');
  });

  it('respects precedence: cliPath > GEMINI_BIN_PATH > PATH', () => {
    // Create a temp dir with fake binary for PATH
    const tmpDir = mkdtempSync(join(tmpdir(), 'gemini-test-'));
    const isWin = platform() === 'win32';
    const binaryName = isWin ? 'gemini.cmd' : 'gemini';
    const fakeBinary = join(tmpDir, binaryName);
    writeFileSync(fakeBinary, isWin ? '@echo off\n' : '#!/bin/sh\n');
    if (!isWin) {
      chmodSync(fakeBinary, 0o755);
    }

    vi.stubEnv('GEMINI_BIN_PATH', '/env-path/gemini');
    vi.stubEnv('PATH', tmpDir);

    // cliPath wins over GEMINI_BIN_PATH and PATH
    expect(resolveBinary('/explicit/gemini')).toBe('/explicit/gemini');

    // GEMINI_BIN_PATH wins over PATH (no cliPath)
    expect(resolveBinary()).toBe('/env-path/gemini');

    // Clear GEMINI_BIN_PATH — PATH should now be used
    vi.stubEnv('GEMINI_BIN_PATH', '');
    expect(resolveBinary()).toBe(fakeBinary);
  });
});
