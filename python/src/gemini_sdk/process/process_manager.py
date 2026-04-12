"""ProcessManager — Python port of TypeScript ProcessManager.ts.

Orchestrates the full lifecycle of gemini-cli subprocesses:
binary resolution, env building, spawning, and process tree cleanup.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from typing import Any

import anyio
from anyio.abc import Process

from .binary_resolver import resolve_binary
from .env_builder import build_env
from .process_strategy import ProcessStrategy
from .spawn_per_call import SpawnPerCallStrategy


class ProcessManager:
    """Orchestrates the full lifecycle of gemini-cli subprocesses.

    Accepts a pluggable ``ProcessStrategy`` for advanced use cases (FDN-08).
    """

    def __init__(self, strategy: ProcessStrategy | None = None) -> None:
        self._strategy: ProcessStrategy = strategy or SpawnPerCallStrategy()

    async def spawn(
        self,
        *,
        argv: list[str] | None = None,
        cli_path: str | None = None,
        env: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Process:
        """Spawn a new gemini-cli process.

        Args:
            argv: Additional arguments to pass to gemini-cli (after the binary).
            cli_path: Explicit path to the gemini-cli binary (highest priority).
            env: Additional environment variables to merge into the clean env.
            **kwargs: Extra keyword arguments forwarded to the strategy's spawn().

        Returns:
            An anyio ``Process`` handle.
        """
        binary = resolve_binary(cli_path)
        clean_env = build_env(env)
        full_argv = [binary, *(argv or [])]
        return await self._strategy.spawn(full_argv, clean_env, **kwargs)


async def kill_tree(pid: int, grace_period_s: float = 5.0) -> None:
    """Terminate a process and its entire tree.

    - Windows: uses ``taskkill /T /F /PID <pid>`` (immediate tree-kill, FDN-06)
    - Unix: sends ``SIGTERM``, waits ``grace_period_s`` seconds, then sends ``SIGKILL``

    Silently ignores ``ProcessLookupError`` (process already dead).

    For orphan detection (FDN-09), uses ``psutil`` to kill recursive children first.

    Args:
        pid: Process ID of the root process to kill.
        grace_period_s: Grace period in seconds before SIGKILL on Unix. Default 5.0.
    """
    if sys.platform == "win32":
        # Windows: taskkill /T kills the process and its children immediately (FDN-06)
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(pid)],
            capture_output=True,
        )
        return

    # Try psutil first for recursive child cleanup (FDN-09: orphan detection)
    try:
        import psutil
        parent = psutil.Process(pid)
        children = parent.children(recursive=True)
        # Kill children first, then parent
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
    except (ImportError, Exception):
        pass  # psutil is optional; fall back to basic kill below

    # Unix: SIGTERM -> grace period -> SIGKILL
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return  # already dead

    # Wait grace period, then escalate to SIGKILL
    with anyio.move_on_after(grace_period_s):
        while True:
            try:
                os.kill(pid, 0)  # signal 0 = check if process is alive
            except ProcessLookupError:
                return  # died during grace period
            await anyio.sleep(0.1)

    # Still alive after grace — SIGKILL
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass  # died between check and kill
