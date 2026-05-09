"""
python/src/gemini_sdk/mcp/cleanup_config_dir.py

Phase 9 (MCP-04): retry-resilient cleanup of an isolated GEMINI_CONFIG_DIR.

Python's ``shutil.rmtree`` has no native retry options (unlike Node's
``fs.rm({maxRetries, retryDelay})``) — this module wraps rmtree in a manual
retry loop: 3 attempts total, 200 ms between attempts. Matches the TS
cleanupConfigDir retry semantics exactly (PAR-01 lockstep).

Never re-raises — masking the original error the caller is handling in a
finally block is worse than leaking a temp dir. On persistent failure,
emits ``warnings.warn`` and returns None.
"""

from __future__ import annotations

import shutil
import warnings

import anyio

_MAX_RETRIES = 3
_RETRY_DELAY_MS = 200


async def cleanup_config_dir(temp_dir: str) -> None:
    """Remove the temp GEMINI_CONFIG_DIR created by write_config_dir.

    Safe to call on non-existent paths. Never raises.
    """
    last_err: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            await anyio.to_thread.run_sync(
                lambda: shutil.rmtree(temp_dir, ignore_errors=False)
            )
            return
        except FileNotFoundError:
            # Already gone — treat as success (mirrors TS force:true semantics)
            return
        except (OSError, PermissionError) as err:
            last_err = err
            if attempt < _MAX_RETRIES - 1:
                await anyio.sleep(_RETRY_DELAY_MS / 1000.0)
    # All retries exhausted — warn but never re-raise
    warnings.warn(
        f"[gemini-cli-sdk] MCP config dir cleanup failed, stranded path: {temp_dir} ({last_err!r})",
        UserWarning,
        stacklevel=2,
    )
