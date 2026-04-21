#!/usr/bin/env node
/**
 * spec/fixtures/mcp/stub.mjs
 *
 * Phase 9 stub MCP server (stdio transport, one `echo` tool).
 * Used by ts/tests-live/mcp-passthrough.live.spec.ts for SC-1 round-trip.
 *
 * Diagnostics MUST go to stderr only — stdout is JSON-RPC framing and
 * any non-protocol bytes corrupt the transport (see 09-RESEARCH.md Pitfall 5).
 *
 * Library: @modelcontextprotocol/sdk (official; added to devDependencies by Plan 04).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'gemini-sdk-test-stub', version: '0.0.1' });

server.tool(
  'echo',
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: 'text', text: `echo: ${message}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
// server.connect() returns once transport is bound; process stays alive reading stdin.
