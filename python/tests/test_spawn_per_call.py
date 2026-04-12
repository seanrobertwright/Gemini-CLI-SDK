"""Tests for SpawnPerCallStrategy — matches TS SpawnPerCallStrategy.spec.ts for PAR-03 parity."""

from __future__ import annotations

import subprocess
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from gemini_sdk.process.process_strategy import ProcessStrategy
from gemini_sdk.process.spawn_per_call import SpawnPerCallStrategy


class TestSpawnPerCallStrategy:
    """Tests for SpawnPerCallStrategy — mirrors TS describe('SpawnPerCallStrategy')."""

    def test_implements_process_strategy_protocol(self) -> None:
        """satisfies the ProcessStrategy interface (type check)"""
        strategy = SpawnPerCallStrategy()
        # Protocol structural check: must have an async spawn method
        assert hasattr(strategy, "spawn")
        assert callable(strategy.spawn)

    @pytest.mark.anyio
    async def test_sets_create_no_window_on_windows(self) -> None:
        """sets windowsHide:true on Windows (FDN-05)"""
        captured_kwargs: dict = {}

        async def mock_open_process(command, **kwargs):  # type: ignore[no-untyped-def]
            captured_kwargs.update(kwargs)
            proc = MagicMock()
            proc.__aenter__ = AsyncMock(return_value=proc)
            proc.__aexit__ = AsyncMock(return_value=False)
            return proc

        with patch("gemini_sdk.process.spawn_per_call.sys") as mock_sys, \
             patch("gemini_sdk.process.spawn_per_call.anyio.open_process", side_effect=mock_open_process):
            mock_sys.platform = "win32"
            strategy = SpawnPerCallStrategy()
            await strategy.spawn(["gemini", "--version"], {"PATH": "/usr/bin"})

        assert captured_kwargs.get("creationflags") == subprocess.CREATE_NO_WINDOW

    @pytest.mark.anyio
    async def test_uses_shell_on_windows_with_pre_built_command_string(self) -> None:
        """uses shell:true with a pre-built command string on Windows"""
        captured_command = None

        async def mock_open_process(command, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal captured_command
            captured_command = command
            proc = MagicMock()
            proc.__aenter__ = AsyncMock(return_value=proc)
            proc.__aexit__ = AsyncMock(return_value=False)
            return proc

        with patch("gemini_sdk.process.spawn_per_call.sys") as mock_sys, \
             patch("gemini_sdk.process.spawn_per_call.anyio.open_process", side_effect=mock_open_process):
            mock_sys.platform = "win32"
            strategy = SpawnPerCallStrategy()
            await strategy.spawn(["gemini", "--version"], {"PATH": "/usr/bin"})

        # On Windows: pre-built command string (not a list)
        assert isinstance(captured_command, str)
        assert "gemini" in captured_command
        assert "--version" in captured_command

    @pytest.mark.anyio
    async def test_uses_direct_exec_on_non_windows(self) -> None:
        """uses shell:false with array args on non-Windows"""
        captured_command = None

        async def mock_open_process(command, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal captured_command
            captured_command = command
            proc = MagicMock()
            proc.__aenter__ = AsyncMock(return_value=proc)
            proc.__aexit__ = AsyncMock(return_value=False)
            return proc

        with patch("gemini_sdk.process.spawn_per_call.sys") as mock_sys, \
             patch("gemini_sdk.process.spawn_per_call.anyio.open_process", side_effect=mock_open_process):
            mock_sys.platform = "linux"
            strategy = SpawnPerCallStrategy()
            await strategy.spawn(["gemini", "--version", "--flag"], {"PATH": "/usr/bin"})

        # On Unix: pass list directly (no shell)
        assert isinstance(captured_command, list)
        assert captured_command == ["gemini", "--version", "--flag"]

    @pytest.mark.anyio
    async def test_returns_an_anyio_process(self) -> None:
        """returns a ChildProcess that emits a close event (integration)"""
        # Use real anyio.open_process to spawn a short-lived process
        strategy = SpawnPerCallStrategy()
        env = {"PATH": "/usr/bin:/bin"}
        if sys.platform == "win32":
            env["PATH"] = "C:\\Windows\\System32;C:\\Windows"

        # Spawn python --version which exits quickly
        import os
        real_env = dict(os.environ)
        proc = await strategy.spawn(
            [sys.executable, "--version"],
            real_env,
        )
        # Verify it's a Process (has returncode attribute and aclose)
        assert hasattr(proc, "returncode")
        assert hasattr(proc, "wait")
        await proc.wait()
        await proc.aclose()
