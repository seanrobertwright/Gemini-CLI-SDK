"""error_mapper.py — hand-written error classifier for Phase 5 taxonomy.

Maps raw stream-json error events and process exit codes to typed GeminiError
subclasses. Mirrors ts/src/errors/ErrorMapper.ts exactly (same regex patterns).

ERR-04: Two-path mapping (from_stream_event + from_exit)
ERR-05: Both paths produce the same class for the same condition
ERR-06: query() uses from_exit when stream ends without a terminal result chunk
"""
from __future__ import annotations

import re
from typing import Any

from .errors import (
    GeminiError,
    RateLimitError,
    AuthError,
    NotConfigured,
    Forbidden403,
    Expired,
    ToSViolation,
    ModelAccessError,
    InvalidPromptError,
    ProcessCrashError,
)

# ── compiled patterns (module-level for performance) ────────────────────────

_RE_RATE_LIMIT = re.compile(
    r"quota|RESOURCE_EXHAUSTED|429|Too Many Requests", re.IGNORECASE
)
_RE_AUTH = re.compile(r"API key not valid|UNAUTHENTICATED|401", re.IGNORECASE)
_RE_NOT_CONFIGURED = re.compile(
    r"no API key|not configured|GEMINI_API_KEY", re.IGNORECASE
)
_RE_FORBIDDEN = re.compile(r"403|PERMISSION_DENIED|Forbidden", re.IGNORECASE)
_RE_EXPIRED = re.compile(r"token expired|oauth.*expired", re.IGNORECASE)
_RE_TOS = re.compile(r"Terms of Service|ToS|account suspended", re.IGNORECASE)
_RE_INVALID_PROMPT = re.compile(
    r"400|INVALID_ARGUMENT|invalid.*prompt|content policy|safety", re.IGNORECASE
)
_RE_MODEL = re.compile(
    r"404|NOT_FOUND|model.*not found|deprecated|not available", re.IGNORECASE
)


def _classify_auth_subtype(message: str) -> AuthError:
    """Classify an AuthError subtype by message content (stream-event path only)."""
    if _RE_NOT_CONFIGURED.search(message):
        return NotConfigured(message)
    if _RE_FORBIDDEN.search(message):
        return Forbidden403(message)
    if _RE_EXPIRED.search(message):
        return Expired(message)
    if _RE_TOS.search(message):
        return ToSViolation(message)
    return AuthError(message)


class ErrorMapper:
    """Maps stream-json error events and exit codes to typed GeminiError subclasses."""

    @staticmethod
    def from_stream_event(event: dict[str, Any]) -> GeminiError:
        """Stream-json path (ERR-04, ERR-05).

        Called from dispatch() for {"type": "error"} events.
        """
        err = event.get("error") or {}
        code = err.get("code")
        status = err.get("status")
        message = err.get("message") or ""
        retry_after = err.get("retryAfter")

        if code == 429 or status == "RESOURCE_EXHAUSTED":
            # retryAfter interpretation: if present, treat as seconds per RESEARCH.md §"Pattern 4";
            # adjust post-capture if real gemini-cli emits ms (see 05-01-SUMMARY.md Open Q #3).
            retry_after_ms = (
                int(retry_after) * 1000
                if isinstance(retry_after, (int, float))
                else None
            )
            return RateLimitError(
                message or "Rate limit exceeded", retry_after_ms=retry_after_ms
            )
        if code == 401 or status == "UNAUTHENTICATED":
            return _classify_auth_subtype(message)
        if code == 403 or status == "PERMISSION_DENIED":
            return Forbidden403(message)
        if code == 400 or status == "INVALID_ARGUMENT":
            return InvalidPromptError(message)
        if code == 404 or status == "NOT_FOUND":
            return ModelAccessError(message)
        return GeminiError(message or "Unknown error from stream event")

    @staticmethod
    def from_exit(
        *,
        exit_code: int,
        stderr: str,
        last_events: list[Any] | None = None,  # noqa: ARG002 — reserved for ERR-06 future use
    ) -> GeminiError:
        """Exit-code + stderr path (ERR-04, ERR-05, ERR-06).

        Called from query() on non-zero exit OR premature EOF without a terminal
        result chunk.
        """
        tail = stderr or ""
        snippet = tail[-200:]

        if _RE_RATE_LIMIT.search(tail):
            return RateLimitError(snippet or "Rate limit exceeded")
        if _RE_AUTH.search(tail):
            # Use generic AuthError for exit path — without clean message we cannot
            # reliably distinguish auth subtypes from mixed stderr tail.
            # (see 05-01-SUMMARY.md decision: AuthError generic base chosen)
            return AuthError(snippet or "Authentication failure")
        if _RE_FORBIDDEN.search(tail):
            return Forbidden403(snippet)
        if _RE_INVALID_PROMPT.search(tail):
            return InvalidPromptError(snippet)
        if _RE_MODEL.search(tail):
            return ModelAccessError(snippet)
        if exit_code != 0 and exit_code in (1, 2, 137, 143):
            return ProcessCrashError(
                f"Process exited with code {exit_code}. Stderr tail: {snippet}"
            )
        return GeminiError(
            f"Process exited with code {exit_code}. Stderr tail: {snippet or '(empty)'}"
        )
