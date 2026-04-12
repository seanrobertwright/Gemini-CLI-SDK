import { describe, it, expect, vi, afterEach } from 'vitest';
import { GeminiNotFoundError } from '../errors/GeminiNotFoundError.js';
import type { ProcessStrategy } from './ProcessStrategy.js';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ESM mocks — hoisted by Vitest automatically
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    platform: vi.fn(() => actual.platform()),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('ProcessManager', () => {
  it('accepts a custom ProcessStrategy (FDN-08 pluggability)', async () => {
    const { ProcessManager } = await import('./ProcessManager.js');
    const mockChild = new EventEmitter() as ChildProcess;
    const mockStrategy: ProcessStrategy = {
      spawn: vi.fn().mockReturnValue(mockChild),
    };

    const manager = new ProcessManager(mockStrategy);
    // Use an explicit cliPath so BinaryResolver doesn't fail
    const result = manager.spawn({ cliPath: '/fake/gemini', argv: ['--version'] });

    expect(mockStrategy.spawn).toHaveBeenCalledOnce();
    expect(result).toBe(mockChild);

    // Verify the strategy was called with the binary as first element
    const [argv, env] = (mockStrategy.spawn as ReturnType<typeof vi.fn>).mock.calls[0] as [string[], Record<string, string>, Partial<SpawnOptions>];
    expect(argv[0]).toBe('/fake/gemini');
    expect(argv[1]).toBe('--version');
    expect(typeof env).toBe('object');
  });

  it('spawn() calls resolveBinary and buildEnv before invoking strategy', async () => {
    const { ProcessManager } = await import('./ProcessManager.js');
    const mockChild = new EventEmitter() as ChildProcess;
    const mockStrategy: ProcessStrategy = {
      spawn: vi.fn().mockReturnValue(mockChild),
    };

    const manager = new ProcessManager(mockStrategy);
    manager.spawn({ cliPath: '/my/gemini', argv: ['--debug'], env: { MY_VAR: 'test' } });

    const [argv, env] = (mockStrategy.spawn as ReturnType<typeof vi.fn>).mock.calls[0] as [string[], Record<string, string>];
    expect(argv[0]).toBe('/my/gemini');
    expect(argv[1]).toBe('--debug');
    expect(env['MY_VAR']).toBe('test');
  });

  it('throws GeminiNotFoundError when gemini not on PATH and no cliPath', async () => {
    const { ProcessManager } = await import('./ProcessManager.js');
    vi.stubEnv('GEMINI_BIN_PATH', '');
    vi.stubEnv('PATH', '/nonexistent/path/that/does/not/exist');

    const manager = new ProcessManager();
    expect(() => manager.spawn({ argv: ['--version'] })).toThrow(GeminiNotFoundError);
  });

  it('spawn gemini --version and capture non-empty stdout (integration)', async () => {
    const { ProcessManager } = await import('./ProcessManager.js');
    const { resolveBinary } = await import('./BinaryResolver.js');

    // Skip if gemini not on PATH
    try {
      resolveBinary();
    } catch (err) {
      if (err instanceof GeminiNotFoundError) {
        console.log('Skipping integration test: gemini not found on PATH');
        return;
      }
      throw err;
    }

    const manager = new ProcessManager();
    const child = manager.spawn({ argv: ['--version'] });
    let output = '';

    await new Promise<void>((resolve, reject) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on('close', () => resolve());
      child.on('error', reject);
      setTimeout(() => reject(new Error('Timeout: gemini --version did not complete')), 15000);
    });

    expect(output.trim().length).toBeGreaterThan(0);
  }, 20000);
});

describe('killTree()', () => {
  it('terminates a long-running subprocess within grace period (integration)', async () => {
    // Use actual spawn for this integration test
    const cpMod = await import('node:child_process');
    vi.mocked(cpMod.spawn).mockRestore();

    const { killTree } = await import('./ProcessManager.js');
    const { buildEnv } = await import('./EnvBuilder.js');

    const env = buildEnv();
    const child = cpMod.spawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      env,
    });

    const pid = child.pid!;
    expect(pid).toBeGreaterThan(0);

    let exited = false;
    child.on('close', () => { exited = true; });

    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 200));

    const killStart = Date.now();
    await killTree(pid, 5000);

    // Wait for the process to actually exit (up to 6s)
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (exited) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 6000);
    });

    const killDuration = Date.now() - killStart;
    expect(exited).toBe(true);
    expect(killDuration).toBeLessThan(7000);
  }, 15000);

  it('uses taskkill /T /F on Windows (mock)', async () => {
    const osMod = await import('node:os');
    const cpMod = await import('node:child_process');

    vi.mocked(osMod.platform).mockReturnValue('win32');

    // Create a fake taskkill ChildProcess that auto-closes
    const mockTaskkill = new EventEmitter() as ChildProcess;
    vi.mocked(cpMod.spawn).mockImplementation(() => {
      setImmediate(() => mockTaskkill.emit('close', 0));
      return mockTaskkill;
    });

    const { killTree } = await import('./ProcessManager.js');
    await killTree(12345);

    expect(cpMod.spawn).toHaveBeenCalledWith(
      'taskkill',
      ['/T', '/F', '/PID', '12345'],
      expect.objectContaining({ stdio: 'ignore' })
    );
  });

  it('sends SIGTERM on Unix (mock)', async () => {
    const osMod = await import('node:os');
    vi.mocked(osMod.platform).mockReturnValue('linux');

    const signals: string[] = [];
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number | NodeJS.Signals) => {
      if (signal && signal !== 0) {
        signals.push(String(signal));
      }
      if (signal === 0) {
        // After SIGTERM sent, simulate process dying
        if (signals.includes('SIGTERM')) {
          throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        }
      }
      return true;
    });

    const { killTree } = await import('./ProcessManager.js');
    await killTree(99999, 500);

    expect(signals).toContain('SIGTERM');
    killSpy.mockRestore();
  }, 10000);
});
