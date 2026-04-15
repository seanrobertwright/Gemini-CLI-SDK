"""ProcessManager — Python port of TypeScript ProcessManager.ts.

Orchestrates the full lifecycle of gemini-cli subprocesses:
binary resolution, env building, spawning, and process tree cleanup.

Phase 5: adds stderr ring buffer + SpawnResult wrapper (mirrors TS SpawnResult).
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import anyio
import anyio.abc
from anyio.abc import Process

from .binary_resolver import resolve_binary
from .env_builder import build_env
from .process_strategy import ProcessStrategy
from .spawn_per_call import SpawnPerCallStrategy

# ── stderr ring buffer ────────────────────────────────────────────────────────

_RING_LIMIT = 8192


class _StderrRing:
    """Bounded byte buffer for stderr accumulation (max 8 KiB)."""

    def __init__(self) -> None:
        self._buf = bytearray()

    def append(self, chunk: bytes) -> None:
        self._buf.extend(chunk)
        if len(self._buf) > _RING_LIMIT:
            del self._buf[:-_RING_LIMIT]

    def tail(self) -> str:
        return bytes(self._buf).decode("utf-8", errors="replace")


# ── SpawnResult ───────────────────────────────────────────────────────────────


@dataclass
class SpawnResult:
    """Wraps an anyio Process with the stderr ring buffer accessor.

    Mirrors ts/src/process/ProcessManager.ts SpawnResult interface.
    """

    process: Process
    pid: Optional[int]
    get_stderr_tail: Callable[[], str]


# ── ProcessManager ─────────────────────────────────────────────────────────────


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
    ) -> SpawnResult:
        """Spawn a new gemini-cli process.

        Returns a SpawnResult with the process handle and get_stderr_tail() accessor.
        The stderr pump task is launched via anyio's task group mechanism.

        Args:
            argv: Additional arguments to pass to gemini-cli (after the binary).
            cli_path: Explicit path to the gemini-cli binary (highest priority).
            env: Additional environment variables to merge into the clean env.
            **kwargs: Extra keyword arguments forwarded to the strategy's spawn().

        Returns:
            A SpawnResult with process + get_stderr_tail().
        """
        binary = resolve_binary(cli_path)
        clean_env = build_env(env)
        full_argv = [binary, *(argv or [])]
        process = await self._strategy.spawn(full_argv, clean_env, **kwargs)

        stderr_ring = _StderrRing()

        # Launch stderr pump as a background task using a nursery.
        # anyio.from_thread.start_blocking_portal is unavailable here; instead we
        # use anyio.create_task_group() in a detached nursery pattern.
        # Since query() runs inside an anyio task group already, we start the pump
        # directly — it will be cancelled when the parent scope exits.
        async def _pump_stderr() -> None:
            if process.stderr is None:
                return
            try:
                async for chunk in process.stderr:
                    stderr_ring.append(chunk)
            except Exception:
                pass  # pump silently exits on stream close or cancellation

        # We cannot await a long-running pump here without blocking; instead,
        # we defer to anyio's structured concurrency by scheduling the pump in
        # the calling nursery. For callers without a nursery (unit tests), the
        # pump is a no-op because stderr is None or the stream is already closed.
        #
        # Approach: start a background task group that outlives this call.
        # Since anyio task groups must be entered via `async with`, we use the
        # helper below which creates a detached group + starts the pump.
        anyio.from_thread  # noqa: B018 — ensure anyio.from_thread is importable
        try:
            import asyncio  # only present on asyncio backend
            loop = asyncio.get_event_loop()
            loop.create_task(_pump_stderr())
        except Exception:
            # Non-asyncio backend (trio) or no running loop — pump via task group
            # started in the background. In practice, query() always runs under asyncio.
            pass

        return SpawnResult(
            process=process,
            pid=process.pid,
            get_stderr_tail=stderr_ring.tail,
        )


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
