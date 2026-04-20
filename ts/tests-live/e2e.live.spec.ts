/**
 * Phase 8 live E2E suite — opt-in integration tests against real gemini-cli.
 *
 * Gate: RUN_LIVE_E2E=1 AND GEMINI_API_KEY present. Otherwise all tests skip.
 *
 * Covers:
 *   SC-1  — allowedTools: ['read_file'] blocks write_file tool calls in the event stream
 *   SC-2a — approvalMode: 'yolo'  writes a file in the sandbox without prompting
 *   SC-2b — approvalMode: 'plan'  produces no filesystem mutations (fs.stat ENOENT)
 *
 * Gating rationale:
 *   These tests spawn a real `gemini-cli` subprocess and talk to the live Gemini API.
 *   Running them on every push would cost API budget and require secrets that aren't
 *   available to every contributor. The `describe.skipIf` below makes the suite a
 *   no-op unless both env vars are set — so `pnpm test:live` is safe to run locally
 *   or in CI without accidentally racking up a bill.
 *
 * Sandbox behavior:
 *   Each test runs inside an isolated tmpdir created by `mkdtempSync`. The sandbox
 *   is the `cwd` passed to `queryFull`, so any filesystem effect of `gemini-cli`
 *   lands inside the sandbox. `afterAll` recursively removes the sandbox — so even
 *   when the CLI goes yolo and writes files, nothing leaks outside the tmpdir.
 *
 * Parity with Python:
 *   These tests are TS-only by design. The SDK's argv output for `--allowed-tools`
 *   and `--approval-mode` is already proved byte-identical between TS and Python
 *   via `scripts/diff-test-names.sh` (205:205) + the argv unit tests in both
 *   languages. The live suite verifies CLI-level behavior downstream of the argv,
 *   which is language-agnostic — mirroring in Python would spend 3x API budget to
 *   re-verify the same CLI contract. See ts/tests-live/README.md for the full
 *   rationale and a template for adding `python/tests-live/` if future contributors
 *   decide the extra coverage is worth the cost.
 *
 * See ts/tests-live/README.md for run instructions, gating, and CI guidance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryFull, ApprovalMode } from '../src/index.js';
import type { MessageChunk } from '../src/parser/types.js';

const LIVE_ENABLED =
  process.env.RUN_LIVE_E2E === '1' && !!process.env.GEMINI_API_KEY;

describe.skipIf(!LIVE_ENABLED)('Phase 8 live E2E: tools + approval mode', () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'gemini-sdk-live-'));
    // Seed a readable file so read_file has something to act on for SC-1.
    writeFileSync(join(sandbox, 'README.txt'), 'hello from the sandbox\n', 'utf-8');
  });

  afterAll(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // SC-1: allowedTools enforcement
  // ---------------------------------------------------------------------------
  it('SC-1 allowedTools read_file blocks write_file tool calls in event stream', async () => {
    const result = await queryFull({
      prompt:
        'Read the file README.txt in the current directory, then write its uppercase ' +
        'contents to a new file called OUT.txt in the current directory.',
      allowedTools: ['read_file'],
      approvalMode: ApprovalMode.YOLO,
      cwd: sandbox,
    });

    // Inspect the full event stream — no tool chunk with toolName === 'write_file' may appear.
    const toolChunks = result.chunks.filter(
      (c: MessageChunk) => c.type === 'tool',
    );
    const writeFileCalls = toolChunks.filter(
      (c: any) => c.toolName === 'write_file',
    );

    expect(writeFileCalls).toHaveLength(0);

    // Defensive: also verify the filesystem — OUT.txt should NOT exist.
    expect(() => statSync(join(sandbox, 'OUT.txt'))).toThrow(/ENOENT/);
  });

  // ---------------------------------------------------------------------------
  // SC-2a: approvalMode yolo — file write succeeds without prompting
  // ---------------------------------------------------------------------------
  it('SC-2a approvalMode yolo writes a file end to end in sandbox without prompting', async () => {
    const targetPath = join(sandbox, 'yolo-output.txt');

    const result = await queryFull({
      prompt:
        'Write the single word hello to a file called yolo-output.txt in the current directory. ' +
        'Do not ask for confirmation.',
      approvalMode: ApprovalMode.YOLO,
      cwd: sandbox,
    });

    // Post-run fs.stat must succeed — the file exists.
    const stat = statSync(targetPath);
    expect(stat.isFile()).toBe(true);

    // The query must have completed with a terminal result chunk (not stuck on a prompt).
    expect(result.stopReason).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // SC-2b: approvalMode plan — no filesystem mutations
  // ---------------------------------------------------------------------------
  it('SC-2b approvalMode plan produces no filesystem mutations verified via fs stat ENOENT', async () => {
    const targetPath = join(sandbox, 'plan-output.txt');

    const result = await queryFull({
      prompt:
        'Plan how you would write the single word hello to a file called plan-output.txt ' +
        'in the current directory. Describe the plan but do not execute it.',
      approvalMode: ApprovalMode.PLAN,
      cwd: sandbox,
    });

    // Post-run fs.stat MUST throw ENOENT — the file must not exist.
    expect(() => statSync(targetPath)).toThrow(/ENOENT/);

    // The query must have produced some output (the plan text itself).
    expect(result.text.length).toBeGreaterThan(0);
  });
});
