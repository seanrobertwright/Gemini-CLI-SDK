"""Phase 5 RED — implementation lands in plan 05-02 / 05-03.

Failing test scaffolds for ERR-04 (two-path mapping: from_stream_event +
from_exit) and ERR-05 (parity between the two paths). These tests fail at
import time because `gemini_sdk.errors.error_mapper` does not yet exist.
That is the correct RED state for Wave 1 of Phase 5.

Parity: every `def test_run_X()` here has a matching TS `it('run_X')` in
ts/src/errors/errorMapper.spec.ts. Docstring first line equals the TS
`run_X` description so scripts/diff-test-names.sh extracts identical names
on both sides.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from gemini_sdk.errors import (  # noqa: F401  — RED imports
    AuthError,
    Forbidden403,
    GeminiError,
    RateLimitError,
)
from gemini_sdk.errors.error_mapper import ErrorMapper  # noqa: F401 — RED import


FIXTURES_DIR = Path(__file__).parents[3] / "spec" / "fixtures"


# ── ERR-04: from_stream_event ────────────────────────────────────────────────


def test_run_fromStreamEvent_code429_yields_RateLimitError():
    """run_fromStreamEvent_code429_yields_RateLimitError"""
    err = ErrorMapper.from_stream_event(
        {"type": "error", "error": {"code": 429, "message": "quota exceeded"}}
    )
    assert isinstance(err, RateLimitError)
    assert err.retryable is True


def test_run_fromStreamEvent_RESOURCE_EXHAUSTED_status_yields_RateLimitError():
    """run_fromStreamEvent_RESOURCE_EXHAUSTED_status_yields_RateLimitError"""
    err = ErrorMapper.from_stream_event(
        {"type": "error", "error": {"status": "RESOURCE_EXHAUSTED", "message": "quota exceeded"}}
    )
    assert isinstance(err, RateLimitError)


def test_run_fromStreamEvent_code401_yields_AuthError():
    """run_fromStreamEvent_code401_yields_AuthError"""
    err = ErrorMapper.from_stream_event(
        {"type": "error", "error": {"code": 401, "message": "API key not valid"}}
    )
    assert isinstance(err, AuthError)


def test_run_fromStreamEvent_code403_yields_Forbidden403():
    """run_fromStreamEvent_code403_yields_Forbidden403"""
    err = ErrorMapper.from_stream_event(
        {"type": "error", "error": {"code": 403, "message": "Forbidden"}}
    )
    assert isinstance(err, Forbidden403)


def test_run_fromStreamEvent_unknown_event_yields_GeminiError_with_bucket_unknown():
    """run_fromStreamEvent_unknown_event_yields_GeminiError_with_bucket_unknown"""
    err = ErrorMapper.from_stream_event(
        {"type": "error", "error": {"message": "something weird"}}
    )
    assert isinstance(err, GeminiError)
    assert err.bucket == "unknown"


def test_run_fromStreamEvent_retryAfter_populates_retryAfterMs():
    """run_fromStreamEvent_retryAfter_populates_retryAfterMs"""
    # Phase 5 plan 01: real 429 not captured; actual retry-after field name
    # unknown. ErrorMapper must tolerate absence — asserting None/int is valid
    # until follow-up capture resolves RESEARCH.md Open Question #3.
    err = ErrorMapper.from_stream_event(
        {"type": "error", "error": {"code": 429, "message": "quota exceeded"}}
    )
    assert isinstance(err, RateLimitError)
    assert err.retry_after_ms is None or isinstance(err.retry_after_ms, int)


# ── ERR-04: from_exit ────────────────────────────────────────────────────────


def test_run_fromExit_quota_stderr_yields_RateLimitError():
    """run_fromExit_quota_stderr_yields_RateLimitError"""
    err = ErrorMapper.from_exit(
        exit_code=1,
        stderr="Error: You have exceeded your quota. Please try again later. Status: RESOURCE_EXHAUSTED",
    )
    assert isinstance(err, RateLimitError)


def test_run_fromExit_api_key_not_valid_yields_AuthError():
    """run_fromExit_api_key_not_valid_yields_AuthError"""
    err = ErrorMapper.from_exit(
        exit_code=1,
        stderr="Error: API key not valid. Please pass a valid API key. Status: UNAUTHENTICATED",
    )
    assert isinstance(err, AuthError)


def test_run_fromExit_unmatched_stderr_yields_generic_GeminiError_bucket_unknown():
    """run_fromExit_unmatched_stderr_yields_generic_GeminiError_bucket_unknown"""
    err = ErrorMapper.from_exit(exit_code=42, stderr="some unrecognized error tail")
    assert isinstance(err, GeminiError)
    assert err.bucket == "unknown"
    assert err.retryable is False
    assert "42" in str(err)
    assert "some unrecognized error tail" in str(err)


# ── ERR-05: two-path parity ─────────────────────────────────────────────────


def test_run_stream_and_exit_path_produce_same_class_for_rate_limit():
    """run_stream_and_exit_path_produce_same_class_for_rate_limit"""
    stream_err = ErrorMapper.from_stream_event(
        {
            "type": "error",
            "error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota exceeded"},
        }
    )
    exit_err = ErrorMapper.from_exit(
        exit_code=1,
        stderr="Error: You have exceeded your quota. Status: RESOURCE_EXHAUSTED",
    )
    assert type(stream_err).__name__ == type(exit_err).__name__
    assert type(stream_err).__name__ == "RateLimitError"


def test_run_stream_and_exit_path_produce_same_class_for_auth():
    """run_stream_and_exit_path_produce_same_class_for_auth"""
    stream_err = ErrorMapper.from_stream_event(
        {
            "type": "error",
            "error": {"code": 401, "status": "UNAUTHENTICATED", "message": "API key not valid"},
        }
    )
    exit_err = ErrorMapper.from_exit(
        exit_code=1,
        stderr="Error: API key not valid. Status: UNAUTHENTICATED",
    )
    assert type(stream_err).__name__ == type(exit_err).__name__


# ── ERR-04 + ERR-05: fixture corpus contract ────────────────────────────────


def test_run_fixture_corpus_both_paths_match_expected_errorType():
    """run_fixture_corpus_both_paths_match_expected_errorType"""
    error_fixture_slugs = sorted(
        p.name.replace(".expected.json", "")
        for p in FIXTURES_DIR.glob("error-*.expected.json")
    )
    assert len(error_fixture_slugs) > 0

    for slug in error_fixture_slugs:
        expected_path = FIXTURES_DIR / f"{slug}.expected.json"
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        if not expected.get("_throws") or not expected.get("_errorType"):
            continue

        stderr_path = FIXTURES_DIR / f"{slug}.stderr.txt"
        stderr_tail = stderr_path.read_text(encoding="utf-8") if stderr_path.exists() else ""

        ndjson_path = FIXTURES_DIR / f"{slug}.ndjson"
        error_event = None
        if ndjson_path.exists():
            for line in ndjson_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "error":
                    error_event = obj
                    break

        if error_event is not None:
            err = ErrorMapper.from_stream_event(error_event)
            assert type(err).__name__ == expected["_errorType"]

        exit_err = ErrorMapper.from_exit(exit_code=1, stderr=stderr_tail)
        assert type(exit_err).__name__ == expected["_errorType"]
