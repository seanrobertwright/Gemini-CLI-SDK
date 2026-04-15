"""Phase 5 RED — implementation lands in plan 05-02.

Failing test scaffolds for ERR-01 (class hierarchy), ERR-02 (5-bucket map),
ERR-03 (retryable invariant). These tests fail at import time because
`gemini_sdk.errors` does not yet re-export the new class hierarchy. That is
the correct RED state for Wave 1 of Phase 5.

Parity: every `def test_run_X()` here has a matching TS `it('run_X')` in
ts/src/errors/errors.spec.ts. Docstring first line equals the TS `run_X`
description so scripts/diff-test-names.sh extracts identical names on both
sides.

Python naming note (RESEARCH.md Pitfall 7): Python uses snake_case for
instance attributes (retry_after_ms) while TS uses camelCase (retryAfterMs).
The public attribute names diverge; the test *descriptions* are kept
identical for parity.
"""
from __future__ import annotations

import pytest

from gemini_sdk.errors import (  # noqa: F401  — imports fail by design (RED)
    AbortError,
    AuthError,
    Expired,
    Forbidden403,
    GeminiError,
    GeminiNotFoundError,
    InvalidPromptError,
    ModelAccessError,
    NotConfigured,
    ParseError,
    ProcessCrashError,
    ProcessError,
    RateLimitError,
    ToSViolation,
    UnsupportedFeatureError,
)


# ── ERR-01: class hierarchy ─────────────────────────────────────────────────


def test_run_GeminiError_exists_and_is_base():
    """run_GeminiError_exists_and_is_base"""
    e = GeminiError("test")
    assert isinstance(e, Exception)


def test_run_all_10_subclasses_extend_GeminiError():
    """run_all_10_subclasses_extend_GeminiError"""
    subclasses = [
        RateLimitError,
        AuthError,
        ModelAccessError,
        InvalidPromptError,
        ProcessError,
        ProcessCrashError,
        ParseError,
        AbortError,
        UnsupportedFeatureError,
        GeminiNotFoundError,
    ]
    for cls in subclasses:
        instance = cls("test")
        assert isinstance(instance, GeminiError)


def test_run_AuthError_subtypes_extend_AuthError():
    """run_AuthError_subtypes_extend_AuthError"""
    subtypes = [NotConfigured, Forbidden403, Expired, ToSViolation]
    for cls in subtypes:
        instance = cls("test")
        assert isinstance(instance, AuthError)
        assert isinstance(instance, GeminiError)


# ── ERR-02 + ERR-03: bucket + retryable invariants ──────────────────────────


_ALL_CLASSES_AND_BUCKETS = [
    (RateLimitError, "rate_limit"),
    (AuthError, "auth"),
    (NotConfigured, "auth"),
    (Forbidden403, "auth"),
    (Expired, "auth"),
    (ToSViolation, "auth"),
    (ModelAccessError, "model_access"),
    (ProcessError, "crash"),
    (ProcessCrashError, "crash"),
    (AbortError, "crash"),
    (InvalidPromptError, "unknown"),
    (ParseError, "unknown"),
    (UnsupportedFeatureError, "unknown"),
    (GeminiNotFoundError, "unknown"),
]

_ALLOWED_BUCKETS = {"rate_limit", "auth", "model_access", "crash", "unknown"}


def test_run_bucket_matches_archon_5():
    """run_bucket_matches_archon_5"""
    for cls, expected_bucket in _ALL_CLASSES_AND_BUCKETS:
        instance = cls("test")
        assert instance.bucket in _ALLOWED_BUCKETS
        assert instance.bucket == expected_bucket


def test_run_retryable_is_boolean():
    """run_retryable_is_boolean"""
    for cls, _ in _ALL_CLASSES_AND_BUCKETS:
        instance = cls("test")
        assert isinstance(instance.retryable, bool)


def test_run_RateLimitError_retryable_is_true():
    """run_RateLimitError_retryable_is_true"""
    e = RateLimitError("test")
    assert e.retryable is True


def test_run_RateLimitError_retryAfterMs_populates_from_constructor_options():
    """run_RateLimitError_retryAfterMs_populates_from_constructor_options"""
    # Python convention: snake_case attribute (RESEARCH.md Pitfall 7).
    # Test description kept identical to TS for parity.
    e = RateLimitError("msg", retry_after_ms=5000)
    assert e.retry_after_ms == 5000


def test_run_AuthError_retryable_is_false():
    """run_AuthError_retryable_is_false"""
    e = AuthError("test")
    assert e.retryable is False
