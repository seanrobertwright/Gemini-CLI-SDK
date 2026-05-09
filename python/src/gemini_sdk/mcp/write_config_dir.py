"""
python/src/gemini_sdk/mcp/write_config_dir.py

Phase 9 (MCP-01, MCP-02): create an isolated GEMINI_CONFIG_DIR for one
query invocation. Writes settings.json containing only
{ "mcpServers": <verbatim input> } at the temp dir root (no .gemini/
subdir — Phase 9 research spike confirmed gemini-cli reads
$GEMINI_CONFIG_DIR/settings.json directly).

Mirrors ts/src/mcp/writeConfigDir.ts exactly (PAR-01 lockstep).
"""

from __future__ import annotations

import json
import secrets
import tempfile
from typing import Any, Dict

import anyio


async def write_config_dir(mcp_servers: Dict[str, Dict[str, Any]]) -> str:
    """Create a fresh temp directory and write settings.json containing only
    ``{"mcpServers": <verbatim input>}``. Returns the absolute temp dir path.

    Caller sets ``GEMINI_CONFIG_DIR`` to this path and is responsible for
    cleanup via ``cleanup_config_dir()`` in a finally block.
    """
    suffix = secrets.token_hex(8)
    temp_dir = anyio.Path(tempfile.gettempdir()) / f"gemini-cli-sdk-mcp-{suffix}"
    await temp_dir.mkdir(parents=True, exist_ok=True)
    content = json.dumps({"mcpServers": mcp_servers}, indent=2)
    await (temp_dir / "settings.json").write_text(content, encoding="utf-8")
    return str(temp_dir)
