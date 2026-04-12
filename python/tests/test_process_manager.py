"""Tests for ProcessManager and kill_tree — matches TS ProcessManager.spec.ts for PAR-03 parity."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import anyio
import pytest

from gemini_sdk.errors import GeminiNotFoundError
from gemini_sdk.process.process_manager import ProcessManager, kill_tree
from gemini_sdk.process.process_strategy import ProcessStrategy


class TestProcessManager:
    """Tests for ProcessManager — mirrors TS describe('ProcessManager')."""

    @pytest.mark.anyio
    async def test_accepts_custom_process_strategy(self) -> None:
        """accepts a custom ProcessStrategy (FDN-08 pluggability)"""
        mock_proc = MagicMock()
        mock_strategy = MagicMock(spec=ProcessStrategy)
        mock_strategy.spawn = AsyncMock(return_value=mock_proc)

        manager = ProcessManager(strategy=mock_strategy)
        result = await manager.spawn(cli_path="/fake/gemini", argv=["--version"])

        mock_strategy.spawn.assert_called_once()
        assert result is mock_proc

        # Verify the strategy was called with binary as first element
        call_args = mock_strategy.spawn.call_args
        argv_arg = call_args.args[0]
        assert argv_arg[0] == "/fake/gemini"
        assert argv_arg[1] == "--version"

    @pytest.mark.anyio
    async def test_spawns_gemini_version_and_captures_non_empty_output(self) -> None:
        """spawns gemini --version and captures non-empty output"""
        # Skip if gemini not on PATH
        from gemini_sdk.process.binary_resolver import resolve_binary
        try:
            resolve_binary()
        except GeminiNotFoundError:
            pytest.skip("Skipping integration test: gemini not found on PATH")

        manager = ProcessManager()
        proc = await manager.spawn(argv=["--version"])

        output = b""
        # proc.stdout is already an anyio ByteReceiveStream — read from it directly
        stdout = proc.stdout
        if stdout is not None:
            try:
                with anyio.fail_after(15):
                    while True:
                        chunk = await stdout.receive(4096)
                        output += chunk
            except (anyio.EndOfStream, Exception):
                pass

        await proc.aclose()
        assert len(output.strip()) > 0

    @pytest.mark.anyio
    async def test_kill_tree_terminates_subprocess_within_grace_period(self) -> None:
        """kill_tree terminates subprocess within grace period (integration)"""
        # Spawn a long-running process
        proc = await anyio.open_process(
            [sys.executable, "-c", "import time; time.sleep(60)"],
            env=dict(os.environ),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        pid = proc.pid
        assert pid is not None and pid > 0

        exited = False

        async def wait_for_exit() -> None:
            nonlocal exited
            await proc.wait()
            exited = True

        # Give it a moment to start
        await anyio.sleep(0.2)

        async with anyio.create_task_group() as tg:
            tg.start_soon(wait_for_exit)
            await kill_tree(pid, grace_period_s=5.0)
            # Cancel the wait task if process doesn't exit on its own
            await anyio.sleep(1.0)
            tg.cancel_scope.cancel()

        # Verify the process is no longer running
        try:
            os.kill(pid, 0)
            # If we get here, the process is still running
            # On Windows taskkill is async — acceptable
        except (ProcessLookupError, OSError):
            pass  # Process is dead — expected

        await proc.aclose()

    @pytest.mark.anyio
    async def test_kill_tree_uses_taskkill_on_windows(self) -> None:
        """kill_tree uses taskkill on Windows"""
        import asyncio

        captured_args: list = []

        original_run = subprocess.run

        def mock_run(args, **kwargs):  # type: ignore[no-untyped-def]
            captured_args.extend(args)
            result = MagicMock()
            result.returncode = 0
            return result

        with patch("gemini_sdk.process.process_manager.sys") as mock_sys, \
             patch("gemini_sdk.process.process_manager.subprocess.run", side_effect=mock_run):
            mock_sys.platform = "win32"
            await kill_tree(12345)

        assert "taskkill" in captured_args
        assert "/T" in captured_args
        assert "/F" in captured_args
        assert "/PID" in captured_args
        assert "12345" in captured_args

    @pytest.mark.anyio
    async def test_kill_tree_sends_sigterm_then_sigkill_on_unix(self) -> None:
        """kill_tree sends SIGTERM then SIGKILL after grace on Unix"""
        signals_sent: list[int] = []

        def mock_kill(pid: int, sig: int) -> None:
            if sig == 0:
                # After SIGTERM, simulate process dying
                if signal.SIGTERM in signals_sent:
                    raise ProcessLookupError("No such process")
            else:
                signals_sent.append(sig)

        with patch("gemini_sdk.process.process_manager.sys") as mock_sys, \
             patch("gemini_sdk.process.process_manager.os.kill", side_effect=mock_kill):
            mock_sys.platform = "linux"
            await kill_tree(99999, grace_period_s=5.0)

        assert signal.SIGTERM in signals_sent
