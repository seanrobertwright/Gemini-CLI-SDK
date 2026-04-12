import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { platform } from 'node:os';
import type { ProcessStrategy } from './ProcessStrategy.js';
import { SpawnPerCallStrategy } from './SpawnPerCallStrategy.js';
import { resolveBinary } from './BinaryResolver.js';
import { buildEnv } from './EnvBuilder.js';

export interface SpawnOptions2 {
  argv?: string[];
  cliPath?: string;
  env?: Record<string, string>;
  spawnOptions?: Partial<SpawnOptions>;
}

/**
 * Orchestrates the full lifecycle of gemini-cli subprocesses:
 * binary resolution, env building, spawning, and process tree cleanup.
 *
 * Accepts a pluggable `ProcessStrategy` for advanced use cases (FDN-08).
 */
export class ProcessManager {
  constructor(private strategy: ProcessStrategy = new SpawnPerCallStrategy()) {}

  spawn(options: SpawnOptions2 = {}): ChildProcess {
    const binary = resolveBinary(options.cliPath);
    const env = buildEnv(options.env);
    const argv = [binary, ...(options.argv ?? [])];
    return this.strategy.spawn(argv, env, options.spawnOptions);
  }
}

/**
 * Terminates a process tree rooted at `pid`.
 *
 * - Windows: uses `taskkill /T /F /PID <pid>` (immediate tree-kill)
 * - Unix: sends SIGTERM, waits `gracePeriodMs`, then sends SIGKILL if still alive
 *
 * Silently ignores ESRCH (process already dead).
 */
export async function killTree(pid: number, gracePeriodMs = 5000): Promise<void> {
  if (platform() === 'win32') {
    // Windows: taskkill /T /F kills the process and its children immediately
    await new Promise<void>((resolve) => {
      const tk = nodeSpawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
        stdio: 'ignore',
      });
      tk.on('close', () => resolve());
      tk.on('error', () => resolve()); // Ignore errors (process may already be dead)
    });
    return;
  }

  // Unix: SIGTERM → grace period → SIGKILL
  const sendSignal = (sig: NodeJS.Signals) => {
    try {
      process.kill(pid, sig);
    } catch (err) {
      // ESRCH = no such process — already dead, that's fine
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw err;
      }
    }
  };

  sendSignal('SIGTERM');

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      sendSignal('SIGKILL');
      resolve();
    }, gracePeriodMs);

    // Poll to check if process is still alive
    const checkInterval = setInterval(() => {
      try {
        // Signal 0 = check if process exists without sending a real signal
        process.kill(pid, 0);
      } catch {
        // Process is dead — clean up and resolve early
        clearTimeout(timer);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);

    // Also resolve after SIGKILL is sent
    setTimeout(() => {
      clearInterval(checkInterval);
    }, gracePeriodMs + 100);
  });
}
