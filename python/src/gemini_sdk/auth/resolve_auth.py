"""Resolve auth mode from env vars per Phase 6 precedence chain."""

from __future__ import annotations

from typing import Literal, TypedDict

AuthMode = Literal["api-key", "vertex-sa", "vertex-key", "adc", "none"]

AUTH_PRECEDENCE: list[str] = [
    "GEMINI_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_API_KEY",
    "ADC",
]


class ResolvedAuth(TypedDict):
    """Resolved authentication context returned by resolve_auth()."""

    mode: AuthMode
    env_overrides: dict[str, str]
    warnings: list[str]


def resolve_auth(env: dict[str, str], options: dict | None = None) -> ResolvedAuth:
    """Resolve auth mode from env vars per Phase 6 precedence chain.

    Inspects the given env dictionary, applies the documented precedence chain
    GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC,
    and returns the resolved mode, env_overrides (empty today; reserved for
    future per-call override), and a warnings list.

    Args:
        env: os.environ or any dictionary (pure: caller-supplied, not read directly).
        options: Reserved for future QueryOptions.auth; currently ignored.

    Returns:
        ResolvedAuth with mode, env_overrides (empty), and warnings.
    """
    void = options  # noqa: F841 — reserved for future per-call auth override

    configured: list[tuple[AuthMode, str]] = []

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
            f"[gemini-sdk] Multiple auth modes configured: {names}.\n"
            f"Using {configured[0][1]} per documented precedence:\n"
            f"  {chain}.\n"
            f"See docs/auth.md."
        )

    # env_overrides is intentionally empty: all resolved env vars already flow through
    # EnvBuilder's allowlist. resolve_auth's job is DIAGNOSIS, not MUTATION.
    # Reserved for future per-call auth override (Deferred Ideas).
    env_overrides: dict[str, str] = {}

    return {"mode": winner, "env_overrides": env_overrides, "warnings": warnings_list}
