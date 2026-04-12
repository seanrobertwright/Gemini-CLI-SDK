"""SpawnPerCallStrategy — Python port of TypeScript SpawnPerCallStrategy.ts.

Default ProcessStrategy implementation that spawns a new gemini-cli process per call.

Windows .cmd handling (CVE-2024-27980 mitigation):
- Passes the command as a pre-built string to anyio.open_process on Windows,
  which triggers cmd.exe shell execution for .cmd shims.
- Sets ``CREATE_NO_WINDOW`` to suppress console windows on Windows (FDN-05).
- Does NOT combine ``detached`` with ``CREATE_NO_WINDOW`` (Node issue #21825 analog).

Unix: Passes ``argv`` as a list directly — no shell, clean argument handling.
"""

from __future__ import annotations

import subprocess
import sys
from typing import Any

import anyio
from anyio.abc import Process


class SpawnPerCallStrategy:
    """Default ProcessStrategy: spawns one gemini-cli process per query call."""

    async def spawn(
        self,
        argv: list[str],
        env: dict[str, str],
        **kwargs: Any,
    ) -> Process:
        """Spawn a new process using anyio.open_process.

        Windows: Passes the command as a pre-built string (triggers cmd.exe for .cmd shims)
        and sets ``CREATE_NO_WINDOW`` to suppress console windows.

        Unix: Passes ``argv`` as a list for clean argument handling without shell.
        """
        if sys.platform == "win32":
            # FDN-05: Hide console window on Windows
            creation_flags = subprocess.CREATE_NO_WINDOW
            # Phase 1 confirmed: Windows .cmd shims require shell execution
            # CVE-2024-27980: pre-build command string so cmd.exe handles .cmd correctly
            # anyio.open_process interprets a string command via the shell on Windows
            cmd_str = " ".join(f'"{a}"' for a in argv)
            return await anyio.open_process(
                cmd_str,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creation_flags,
                **kwargs,
            )

        # Unix: pass argv as a list — no shell, clean argument handling
        return await anyio.open_process(
            argv,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            **kwargs,
        )
