"""BinaryResolver — Python port of TypeScript BinaryResolver.ts.

Resolution order: cli_path argument > GEMINI_BIN_PATH env var > PATH lookup.
On Windows, searches for ``gemini.cmd`` on PATH (not ``gemini``).
Throws ``GeminiNotFoundError`` if not found.
"""

from __future__ import annotations

import os
import shutil
import sys

from gemini_sdk.errors import GeminiNotFoundError


def resolve_binary(cli_path: str | None = None) -> str:
    """Resolve the path to the gemini-cli binary.

    Resolution order:
    1. ``cli_path`` argument (highest priority)
    2. ``GEMINI_BIN_PATH`` environment variable
    3. ``shutil.which()`` PATH lookup

    Raises ``GeminiNotFoundError`` if the binary cannot be found.
    """
    # 1. Explicit cli_path takes highest priority
    if cli_path:
        return cli_path

    # 2. GEMINI_BIN_PATH env var
    env_bin_path = os.environ.get("GEMINI_BIN_PATH")
    if env_bin_path:
        return env_bin_path

    # 3. PATH lookup via shutil.which — handles Windows .cmd/.exe precedence automatically
    is_win = sys.platform == "win32"
    binary_name = "gemini.cmd" if is_win else "gemini"
    found = shutil.which(binary_name)
    if found:
        return found

    raise GeminiNotFoundError()
