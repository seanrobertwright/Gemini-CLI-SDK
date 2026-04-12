import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ProcessStrategy } from './ProcessStrategy.js';

// ESM note: vi.mock() is hoisted by Vitest automatically.
// node:os.platform and node:child_process.spawn are mocked module-wide.
// Integration test uses vi.mocked(spawn).mockImplementation(actual.spawn) to bypass.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    platform: vi.fn(() => actual.platform()),
  };
});

// Fake ChildProcess returned by mock spawn
const makeFakeChild = (): ChildProcess => new EventEmitter() as ChildProcess;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    // Default: return a fake child (no real process launched in unit tests)
    spawn: vi.fn(() => makeFakeChild()),
    // Expose actual for integration test
    _actualSpawn: actual.spawn,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpawnPerCallStrategy', () => {
  it('satisfies the ProcessStrategy interface (type check)', async () => {
    const { SpawnPerCallStrategy } = await import('./SpawnPerCallStrategy.js');
    const strategy: ProcessStrategy = new SpawnPerCallStrategy();
    expect(strategy).toBeDefined();
    expect(typeof strategy.spawn).toBe('function');
  });

  describe('Windows behavior (shell: true)', () => {
    it('uses shell:true with a pre-built command string on Windows', async () => {
      const osMod = await import('node:os');
      const cpMod = await import('node:child_process');

      vi.mocked(osMod.platform).mockReturnValue('win32');

      const { SpawnPerCallStrategy } = await import('./SpawnPerCallStrategy.js');
      const strategy = new SpawnPerCallStrategy();
      strategy.spawn(['gemini', '--version'], { PATH: '/usr/bin' });

      expect(cpMod.spawn).toHaveBeenCalledOnce();
      const [firstArg, secondArg, options] = vi.mocked(cpMod.spawn).mock.calls[0] as [string, string[], Record<string, unknown>];

      // Pre-built command string
      expect(typeof firstArg).toBe('string');
      expect(firstArg).toContain('gemini');
      expect(firstArg).toContain('--version');
      // Args array must be empty (everything baked into cmd string)
      expect(secondArg).toEqual([]);
      // Must use shell:true
      expect(options.shell).toBe(true);
    });

    it('sets windowsHide:true on Windows (FDN-05)', async () => {
      const osMod = await import('node:os');
      const cpMod = await import('node:child_process');

      vi.mocked(osMod.platform).mockReturnValue('win32');

      const { SpawnPerCallStrategy } = await import('./SpawnPerCallStrategy.js');
      const strategy = new SpawnPerCallStrategy();
      strategy.spawn(['gemini', '--version'], { PATH: '/usr/bin' });

      const [, , options] = vi.mocked(cpMod.spawn).mock.calls[0] as [string, string[], Record<string, unknown>];
      expect(options.windowsHide).toBe(true);
    });
  });

  describe('Unix behavior (shell: false)', () => {
    it('uses shell:false with array args on non-Windows', async () => {
      const osMod = await import('node:os');
      const cpMod = await import('node:child_process');

      vi.mocked(osMod.platform).mockReturnValue('linux');

      const { SpawnPerCallStrategy } = await import('./SpawnPerCallStrategy.js');
      const strategy = new SpawnPerCallStrategy();
      strategy.spawn(['gemini', '--version', '--flag'], { PATH: '/usr/bin' });

      expect(cpMod.spawn).toHaveBeenCalledOnce();
      const [cmd, args, options] = vi.mocked(cpMod.spawn).mock.calls[0] as [string, string[], Record<string, unknown>];

      // On Unix: separate command and args
      expect(cmd).toBe('gemini');
      expect(args).toEqual(['--version', '--flag']);
      expect(options.shell).toBe(false);
    });
  });

  it('returns a ChildProcess that emits a close event (integration)', async () => {
    // For this test, use the real spawn by overriding the mock with the actual implementation
    const cpMod = await import('node:child_process') as typeof import('node:child_process') & { _actualSpawn: typeof import('node:child_process').spawn };
    vi.mocked(cpMod.spawn).mockImplementation(cpMod._actualSpawn);

    const { SpawnPerCallStrategy } = await import('./SpawnPerCallStrategy.js');
    const strategy = new SpawnPerCallStrategy();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined)
    ) as Record<string, string>;

    const child = strategy.spawn(['node', '--version'], env);

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        expect(code).toBe(0);
        resolve();
      });
      child.on('error', reject);
      setTimeout(() => reject(new Error('Timeout: process did not close')), 10000);
    });
  });
});
