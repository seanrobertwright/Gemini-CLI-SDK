"""Resolve auth mode from env vars per Phase 6 precedence chain."""

from __future__ import annotations

import os
import platform
from typing import Literal, TypedDict

AuthMode = Literal["api-key", "vertex-sa", "vertex-key", "adc", "none"]

AUTH_PRECEDENCE: list[str] = [
    "ADC",
    "GEMINI_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_API_KEY",
]


class ResolvedAuth(TypedDict):
    """Resolved authentication context returned by resolve_auth()."""

    mode: AuthMode
    env_overrides: dict[str, str]
    warnings: list[str]


def _has_adc_credentials() -> bool:
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE")
    if not home:
        return False

    # Check gemini-cli's native credentials
    if os.path.exists(os.path.join(home, ".gemini", "credentials.json")):
        return True

    # Check gcloud ADC
    if platform.system() == "Windows":
        appdata = os.environ.get("APPDATA")
        if appdata and os.path.exists(os.path.join(appdata, "gcloud", "application_default_credentials.json")):
            return True
    else:
        if os.path.exists(os.path.join(home, ".config", "gcloud", "application_default_credentials.json")):
            return True

    return False


def resolve_auth(env: dict[str, str], options: dict | None = None) -> ResolvedAuth:
    """Resolve auth mode from env vars per Phase 6 precedence chain.

    Inspects the given env dictionary, applies the documented precedence chain
    ADC > GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY,
    and returns the resolved mode, env_overrides, and a warnings list.

    Args:
        env: os.environ or any dictionary (pure: caller-supplied, not read directly).
        options: Reserved for future QueryOptions.auth; currently ignored.

    Returns:
        ResolvedAuth with mode, env_overrides, and warnings.
    """
    void = options  # noqa: F841 — reserved for future per-call auth override

    configured: list[tuple[AuthMode, str]] = []
    env_overrides: dict[str, str] = {}

    if _has_adc_credentials():
        configured.append(("adc", "ADC"))
        # Strip the API key so it doesn't accidentally override the CLI Auth
        if env.get("GEMINI_API_KEY"):
            env_overrides["GEMINI_API_KEY"] = ""

    if bool(env.get("GEMINI_API_KEY")):
        configured.append(("api-key", "GEMINI_API_KEY"))
    if bool(env.get("GOOGLE_APPLICATION_CREDENTIALS")):
        configured.append(("vertex-sa", "GOOGLE_APPLICATION_CREDENTIALS"))
    if bool(env.get("GOOGLE_API_KEY")):
        configured.append(("vertex-key", "GOOGLE_API_KEY"))

    winner: AuthMode = configured[0][0] if configured else "adc"
    warnings_list: list[str] = []

    if len(configured) > 1:
        names = ", ".join(n for _, n in configured)
        chain = " > ".join(AUTH_PRECEDENCE)
        warnings_list.append(
            f"[gemini-cli-sdk] Multiple auth modes configured: {names}.\n"
            f"Using {configured[0][1]} per documented precedence:\n"
            f"  {chain}.\n"
            f"See docs/auth.md."
        )

    return {"mode": winner, "env_overrides": env_overrides, "warnings": warnings_list}
