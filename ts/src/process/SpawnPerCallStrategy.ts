import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { platform } from 'node:os';
import type { ProcessStrategy } from './ProcessStrategy.js';

/**
 * Default `ProcessStrategy` implementation that spawns a new process per call.
 *
 * Windows .cmd handling (CVE-2024-27980 mitigation):
 * - Uses `shell: true` with a pre-built command string for Windows `.cmd` shims.
 * - Never uses `shell: false` with `.cmd` files (cmd.exe concatenates args incorrectly).
 * - Sets `windowsHide: true` to suppress console windows (FDN-05).
 * - Does NOT combine `detached: true` with `windowsHide: true` (Node issue #21825).
 *
 * Unix: Uses `shell: false` with array args for clean argument handling.
 */
export class SpawnPerCallStrategy implements ProcessStrategy {
  spawn(
    argv: string[],
    env: Record<string, string>,
    options: Partial<SpawnOptions> = {}
  ): ChildProcess {
    const [cmd, ...args] = argv;
    const isWin = platform() === 'win32';

    if (isWin) {
      // Phase 1 confirmed: Windows .cmd shims require shell:true
      // CVE-2024-27980: pre-build command string, never shell:false with .cmd
      // DO NOT combine detached:true with windowsHide:true (Node issue #21825)
      const cmdStr = [cmd, ...args.map(a => `"${a}"`)].join(' ');
      return spawn(cmdStr, [], {
        shell: true,
        windowsHide: true,
        env,
        stdio: 'pipe',
        ...options,
      });
    }

    return spawn(cmd!, args, {
      shell: false,
      env,
      stdio: 'pipe',
      ...options,
    });
  }
}
