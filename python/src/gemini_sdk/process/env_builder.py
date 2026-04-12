"""EnvBuilder — Python port of TypeScript EnvBuilder.ts.

Builds a clean subprocess environment dictionary by filtering ``os.environ``
through an allowlist and merging caller-supplied overrides.
"""

from __future__ import annotations

import os

# Allowlist of environment variable keys that are safe to pass to gemini-cli subprocess.
# This is intentionally opaque and not configurable — use the ``overrides`` parameter
# to add additional variables.
ALLOWED_KEYS: frozenset[str] = frozenset({
    # System essentials
    "PATH", "HOME", "USER", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "TEMP", "TMP", "TMPDIR", "SystemRoot", "SystemDrive", "COMSPEC",
    "HOMEDRIVE", "HOMEPATH", "LOGNAME", "SHELL", "TERM",
    # Gemini auth (passed through to gemini-cli)
    "GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_LOCATION",
    # Gemini config
    "GEMINI_CONFIG_DIR", "GEMINI_SYSTEM_MD", "GEMINI_BIN_PATH",
    # UTF-8 forcing (FDN-04)
    "PYTHONUTF8",
})


def build_env(overrides: dict[str, str] | None = None) -> dict[str, str]:
    """Build a clean subprocess environment dictionary.

    Filters ``os.environ`` through an allowlist and merges caller-supplied overrides.

    Args:
        overrides: Additional env vars to merge on top (these win over ``os.environ``).

    Returns:
        Clean env dict safe to pass to ``anyio.open_process``.
    """
    env: dict[str, str] = {}

    # Copy allowlisted keys from os.environ
    for key in ALLOWED_KEYS:
        value = os.environ.get(key)
        if value is not None:
            env[key] = value

    # Merge overrides on top (overrides win)
    if overrides:
        for key, value in overrides.items():
            env[key] = value

    return env
