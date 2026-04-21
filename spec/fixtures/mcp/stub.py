#!/usr/bin/env python3
"""
spec/fixtures/mcp/stub.py

Phase 9 stub MCP server (stdio transport, one `echo` tool).
Python mirror of stub.mjs. Used if a future Python live suite is added;
for v1 only the TS live suite runs per STATE decision [Phase 08-07].

Diagnostics MUST go to stderr only -- stdout is JSON-RPC framing.

Library: mcp (official PyPI; added to dev deps by Plan 04).
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("gemini-sdk-test-stub")


@mcp.tool()
def echo(message: str) -> str:
    """Echo the input message back with an 'echo: ' prefix."""
    return f"echo: {message}"


if __name__ == "__main__":
    mcp.run(transport="stdio")
