"""Auth resolution module — Phase 6."""

from .resolve_auth import (
    AUTH_PRECEDENCE,
    AuthMode,
    ResolvedAuth,
    resolve_auth,
)

__all__ = ["resolve_auth", "AUTH_PRECEDENCE", "AuthMode", "ResolvedAuth"]
