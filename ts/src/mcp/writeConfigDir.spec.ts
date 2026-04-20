/**
 * ts/src/mcp/writeConfigDir.spec.ts
 *
 * Unit tests for writeConfigDir (Phase 9 MCP-01).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as path from 'node:path';
import { writeConfigDir } from './writeConfigDir.js';

describe('writeConfigDir', () => {
  const createdPaths: string[] = [];

  beforeEach(() => {
    createdPaths.length = 0;
  });

  afterEach(async () => {
    for (const p of createdPaths) {
      await rm(p, { recursive: true, force: true });
    }
  });

  it('writes settings.json containing only mcpServers key at temp dir root', async () => {
    const input = { foo: { command: 'node', args: ['x.js'] } };
    const returned = await writeConfigDir(input);
    createdPaths.push(returned);

    const entries = await readdir(returned);
    expect(entries).toEqual(['settings.json']);

    const raw = await readFile(join(returned, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['mcpServers']);
    expect(parsed['mcpServers']).toEqual(input);
  });

  it('returns an absolute path beginning with gemini-sdk-mcp- prefix', async () => {
    const returned = await writeConfigDir({ server: { command: 'node' } });
    createdPaths.push(returned);

    expect(path.isAbsolute(returned)).toBe(true);
    const base = path.basename(returned);
    expect(base.startsWith('gemini-sdk-mcp-')).toBe(true);
    expect(base.length).toBe('gemini-sdk-mcp-'.length + 16);
  });

  it('produces unique paths for back-to-back invocations', async () => {
    const input = { server: { command: 'node' } };
    const first = await writeConfigDir(input);
    const second = await writeConfigDir(input);
    createdPaths.push(first, second);

    expect(first).not.toBe(second);
  });

  it('accepts an empty mcpServers map and writes mcpServers as empty object', async () => {
    const returned = await writeConfigDir({});
    createdPaths.push(returned);

    const raw = await readFile(join(returned, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['mcpServers']).toEqual({});
  });

  it('passes verbatim nested server config through without modification', async () => {
    const input = { http: { httpUrl: 'http://x', headers: { auth: 'Bearer t' } } };
    const returned = await writeConfigDir(input);
    createdPaths.push(returned);

    const raw = await readFile(join(returned, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { mcpServers: typeof input };
    expect(parsed['mcpServers']).toEqual(input);
  });
});
