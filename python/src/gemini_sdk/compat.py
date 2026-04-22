"""Runtime gemini-cli version compat probe (REL-05, REL-06)."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

from packaging.version import InvalidVersion, Version

_checked: bool = False


def _reset_compat_cache_for_testing() -> None:
    global _checked
    _checked = False


def _find_compat_file() -> Optional[Path]:
    # Walk upward from this file to find .gemini-cli-compat at repo root.
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / ".gemini-cli-compat"
        if candidate.is_file():
            return candidate
    return None


def _in_range(detected: str, pinned: str) -> bool:
    """Return True if detected satisfies ~pinned (same major.minor)."""
    try:
        d = Version(detected)
        p = Version(pinned)
    except InvalidVersion:
        return True  # unparseable — treat as in-range (silent)
    return d.major == p.major and d.minor == p.minor and d >= p


def check_compat_once(cli_path: str, *, compat_file_path: Optional[str] = None) -> None:
    global _checked
    if _checked:
        return
    _checked = True

    mode = os.environ.get("GEMINI_SDK_COMPAT", "warn")
    if mode == "silent":
        return

    compat_file = Path(compat_file_path) if compat_file_path else _find_compat_file()
    if compat_file is None or not compat_file.is_file():
        if mode == "strict":
            raise RuntimeError("[gemini-sdk] .gemini-cli-compat not found")
        return

    try:
        pinned = compat_file.read_text(encoding="utf-8").strip()
    except OSError as err:
        if mode == "strict":
            raise RuntimeError(f"[gemini-sdk] failed to read {compat_file}: {err}") from err
        return

    try:
        pinned_ver = Version(pinned)
    except InvalidVersion:
        return  # malformed compat file — silent

    display_range = f"{pinned_ver.major}.{pinned_ver.minor}.x"

    try:
        result = subprocess.run(
            [cli_path, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5.0,
            check=True,
        )
        detected_raw = result.stdout.strip()
    except (subprocess.SubprocessError, OSError) as err:
        if mode == "strict":
            raise RuntimeError(f"[gemini-sdk] probe failed: {err}") from err
        return

    # Extract first semver-like token
    match = re.search(r"\d+\.\d+\.\d+", detected_raw)
    if not match:
        return
    detected = match.group(0)

    if not _in_range(detected, pinned):
        msg = f"[gemini-sdk] tested against gemini-cli {display_range}, detected {detected} — proceeding"
        if mode == "strict":
            raise RuntimeError(msg)
        print(msg, file=sys.stderr)
