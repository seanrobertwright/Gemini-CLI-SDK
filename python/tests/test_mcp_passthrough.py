"""Phase 9 MCP-02 invariant: user's real ~/.gemini/settings.json mtime unchanged."""
from __future__ import annotations

import os
import pathlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from gemini_sdk import query_full
from gemini_sdk.process.process_manager import SpawnResult


# ── helpers ────────────────────────────────────────────────────────────────────


class _EmptyStdout:
    """Async-iterable stdout mock that yields no bytes (empty stream)."""

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes:
        raise StopAsyncIteration


def _make_noop_spawn_result() -> SpawnResult:
    """Return a mock SpawnResult with empty stdout — no real subprocess.

    queryFull will raise ERR-06 (ProcessError: no result event). That is
    expected — the mtime invariant doesn't depend on the query succeeding.
    """
    proc = MagicMock()
    proc.pid = None
    proc.returncode = 0
    proc.stdout = _EmptyStdout()
    return SpawnResult(process=proc, pid=None, get_stderr_tail=lambda: "")


# ── tests ──────────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_query_with_mcpservers_does_not_mutate_the_real_gemini_settings_json_mtime():
    """query with mcpServers does not mutate the real ~/.gemini/settings.json mtime"""
    settings = pathlib.Path.home() / ".gemini" / "settings.json"
    if not settings.exists():
        pytest.skip("~/.gemini/settings.json does not exist on this machine")
    before = settings.stat().st_mtime_ns

    with (
        patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
        patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
    ):
        mock_pm = MagicMock()
        mock_pm.spawn = AsyncMock(return_value=_make_noop_spawn_result())
        mock_pm_cls.return_value = mock_pm

        try:
            await query_full({
                "prompt": "noop",
                "mcp_servers": {"s": {"command": "node"}},
                "allowed_mcp_server_names": ["s"],
            })
        except Exception:
            # ERR-06 may fire with mock spawn producing no result chunk — mtime is the invariant
            pass

    after = settings.stat().st_mtime_ns
    assert before == after
