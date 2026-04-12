import type { ChildProcess, SpawnOptions } from 'node:child_process';

/**
 * Advanced/escape-hatch interface for customizing how gemini-cli processes are spawned.
 * The default implementation is `SpawnPerCallStrategy`.
 * Most users should not need to implement this interface directly.
 */
export interface ProcessStrategy {
  spawn(
    argv: string[],
    env: Record<string, string>,
    options?: Partial<SpawnOptions>
  ): ChildProcess;
}
