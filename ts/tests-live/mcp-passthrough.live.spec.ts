/**
 * Phase 9 live E2E suite -- MCP passthrough + isolated config dir.
 *
 * Gate: RUN_LIVE_E2E=1 AND GEMINI_API_KEY present (mirrors e2e.live.spec.ts).
 *
 * Covers:
 *   SC-1  -- mcpServers + allowedMcpServerNames: tool-call round-trips through
 *            the event stream (stub echo tool invoked; tool + tool_result chunks visible)
 *   SC-2  -- real ~/.gemini/settings.json mtime unchanged across a full live query
 *            (live complement to the mock-spawn invariant in ts/src/mcp/mcpPassthrough.spec.ts)
 *   SC-3a -- success path: temp GEMINI_CONFIG_DIR removed after queryFull resolves
 *   SC-3b -- abort path: abort mid-stream still cleans the temp dir
 *   SC-3c -- error path: when spawn fails, temp dir is still cleaned
 *
 * SC-4 (cross-platform) is inherited from the CI Windows matrix running
 * this suite on all three OSes via Phase 2 FDN-06.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { queryFull, query, ApprovalMode } from '../src/index.js';
import type { MessageChunk } from '../src/parser/types.js';

const LIVE_ENABLED =
  process.env.RUN_LIVE_E2E === '1' && !!process.env.GEMINI_API_KEY;

const STUB_PATH = resolve(process.cwd(), 'spec/fixtures/mcp/stub.mjs');

describe.skipIf(!LIVE_ENABLED)('Phase 9 live E2E: MCP passthrough + isolated config dir', () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'gemini-sdk-live-mcp-'));
  });
  afterAll(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  // SC-1: tool-call round-trip
  it('SC-1 MCP passthrough echo tool round-trips through the event stream', async () => {
    const result = await queryFull({
      prompt: 'Call the echo tool from the test-stub MCP server with the message "hello from live test".',
      mcpServers: {
        'test-stub': { command: 'node', args: [STUB_PATH] },
      },
      allowedMcpServerNames: ['test-stub'],
      approvalMode: ApprovalMode.YOLO,
      cwd: sandbox,
    });
    const toolChunks = result.chunks.filter((c: MessageChunk) => c.type === 'tool');
    const toolResultChunks = result.chunks.filter((c: MessageChunk) => c.type === 'tool_result');
    expect(toolChunks.length).toBeGreaterThan(0);
    expect(toolResultChunks.length).toBeGreaterThan(0);
    expect(result.text.toLowerCase()).toContain('echo:');
  });

  // SC-2: real settings.json mtime invariant (live)
  it('SC-2 real home gemini settings json mtime unchanged across live query with mcpServers', async () => {
    const real = join(homedir(), '.gemini', 'settings.json');
    if (!existsSync(real)) {
      // Skip when the user has no ~/.gemini/settings.json (CI runners)
      return;
    }
    const before = statSync(real).mtimeMs;
    await queryFull({
      prompt: 'Say "ok".',
      mcpServers: { 'test-stub': { command: 'node', args: [STUB_PATH] } },
      allowedMcpServerNames: ['test-stub'],
      approvalMode: ApprovalMode.YOLO,
      cwd: sandbox,
    });
    const after = statSync(real).mtimeMs;
    expect(after).toBe(before);
  });

  // SC-3a: success path cleanup
  it('SC-3a temp config dir removed from disk after successful live query', async () => {
    // Snapshot the tmpdir entries with our prefix before + after; after should not contain any new gemini-cli-sdk-mcp- dirs left over.
    const beforeDirs = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('gemini-cli-sdk-mcp-')));
    await queryFull({
      prompt: 'Say "ok".',
      mcpServers: { 'test-stub': { command: 'node', args: [STUB_PATH] } },
      allowedMcpServerNames: ['test-stub'],
      approvalMode: ApprovalMode.YOLO,
      cwd: sandbox,
    });
    const afterDirs = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('gemini-cli-sdk-mcp-')));
    // Any new dirs that appeared should NOT remain -- symmetric difference must be empty
    const leaked = [...afterDirs].filter(n => !beforeDirs.has(n));
    expect(leaked).toEqual([]);
  });

  // SC-3b: abort path cleanup
  it('SC-3b temp config dir removed from disk when query is aborted mid-stream', async () => {
    const beforeDirs = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('gemini-cli-sdk-mcp-')));
    const ac = new AbortController();
    const iter = query({
      prompt: 'Say "ok".',
      mcpServers: { 'test-stub': { command: 'node', args: [STUB_PATH] } },
      allowedMcpServerNames: ['test-stub'],
      approvalMode: ApprovalMode.YOLO,
      cwd: sandbox,
      abortSignal: ac.signal,
    });
    // Consume first chunk then abort; swallow AbortError to reach finally block
    try {
      let seen = 0;
      for await (const _chunk of iter) {
        seen++;
        if (seen === 1) ac.abort();
      }
    } catch {
      // Expected AbortError after abort
    }
    // Give the OS a moment for async cleanup to complete -- use a short poll loop rather than a long sleep.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const d = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('gemini-cli-sdk-mcp-')));
      const leaked = [...d].filter(n => !beforeDirs.has(n));
      if (leaked.length === 0) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const afterDirs = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('gemini-cli-sdk-mcp-')));
    const leaked = [...afterDirs].filter(n => !beforeDirs.has(n));
    expect(leaked).toEqual([]);
  });

  // SC-3c: error path cleanup -- bad stub path produces a spawn error, temp dir still cleaned
  it('SC-3c temp config dir removed from disk when spawn fails due to bad stub path', async () => {
    const beforeDirs = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('gemini-cli-sdk-mcp-')));
    try {
      await queryFull({
        prompt: 'Say "ok".',
        mcpServers: {
          'test-stub': { command: 'node', args: ['/this/path/does/not/exist/stub.mjs'] },
        },
        allowedMcpServerNames: ['test-stub'],
        approvalMode: ApprovalMode.YOLO,
        cwd: sandbox,
      });
    } catch {
      // Any error is expected -- could be ProcessError, AuthError (if API key bad), etc.
    }
    const afterDirs = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('gemini-cli-sdk-mcp-')));
    const leaked = [...afterDirs].filter(n => !beforeDirs.has(n));
    expect(leaked).toEqual([]);
  });
});
