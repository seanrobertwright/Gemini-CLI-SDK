"""Fixture-corpus contract tests (ERR-04 + ERR-05) at scale.

Iterates every spec/fixtures/error-*.ndjson + .stderr.txt + .expected.json triple.
Adding a new fixture triple automatically adds new coverage on the next run.

Function names use test_run_corpus_* prefix for AST-parity extraction
(matches scripts/diff-test-names.sh pattern).

Parity: every def test_run_corpus_* here has a matching TS it('run_corpus_...')
in ts/src/errors/errorMapperCorpus.spec.ts whose description equals the docstring
first line.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any

import pytest

from gemini_sdk.errors.error_mapper import ErrorMapper
from gemini_sdk.errors import errors as error_classes

FIXTURES = pathlib.Path(__file__).resolve().parents[3] / "spec" / "fixtures"


def _slugs() -> list[str]:
    """Return sorted list of error-* fixture slugs (based on .ndjson files)."""
    return sorted(p.stem for p in FIXTURES.glob("error-*.ndjson"))


def _load_fixture(slug: str) -> tuple[str, str, dict[str, Any], dict[str, Any] | None]:
    """Load (ndjson, stderr, expected, error_event) for a slug."""
    ndjson = (FIXTURES / f"{slug}.ndjson").read_text(encoding="utf-8")
    stderr_path = FIXTURES / f"{slug}.stderr.txt"
    stderr = stderr_path.read_text(encoding="utf-8") if stderr_path.exists() else ""
    expected = json.loads((FIXTURES / f"{slug}.expected.json").read_text(encoding="utf-8"))
    error_event: dict[str, Any] | None = None
    for line in ndjson.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "error":
            error_event = obj
            break
    return ndjson, stderr, expected, error_event


def test_run_corpus_fromStreamEvent_matches_expected_type():
    """run_corpus_fromStreamEvent_matches_expected_type"""
    slugs = _slugs()
    assert len(slugs) > 0, "No error-* fixtures found"

    for slug in slugs:
        _ndjson, _stderr, expected, error_event = _load_fixture(slug)
        expected_class_name = expected.get("_errorType")
        if not expected_class_name:
            continue  # fixture doesn't test error classification
        if error_event is None:
            continue  # no stream error event in this fixture

        expected_cls = getattr(error_classes, expected_class_name, None)
        assert expected_cls is not None, (
            f"{slug}: _errorType '{expected_class_name}' not found in errors module"
        )

        err = ErrorMapper.from_stream_event(error_event)
        assert isinstance(err, expected_cls), (
            f"{slug}: from_stream_event got {type(err).__name__}, expected {expected_class_name}"
        )


def test_run_corpus_fromExit_matches_expected_type():
    """run_corpus_fromExit_matches_expected_type"""
    slugs = _slugs()
    assert len(slugs) > 0, "No error-* fixtures found"

    for slug in slugs:
        _ndjson, stderr, expected, _error_event = _load_fixture(slug)
        expected_class_name = expected.get("_errorType")
        if not expected_class_name:
            continue  # fixture doesn't test error classification
        if not stderr.strip():
            continue  # no stderr — skip exit-path test

        expected_cls = getattr(error_classes, expected_class_name, None)
        assert expected_cls is not None, (
            f"{slug}: _errorType '{expected_class_name}' not found in errors module"
        )

        err = ErrorMapper.from_exit(exit_code=1, stderr=stderr)
        assert isinstance(err, expected_cls), (
            f"{slug}: from_exit got {type(err).__name__}, expected {expected_class_name}"
        )


def test_run_corpus_both_paths_agree_on_class():
    """run_corpus_both_paths_agree_on_class"""
    slugs = _slugs()
    assert len(slugs) > 0, "No error-* fixtures found"

    for slug in slugs:
        _ndjson, stderr, expected, error_event = _load_fixture(slug)
        expected_class_name = expected.get("_errorType")
        if not expected_class_name:
            continue  # fixture doesn't test error classification
        if error_event is None or not stderr.strip():
            continue  # need both paths for parity check

        from_stream = ErrorMapper.from_stream_event(error_event)
        from_exit = ErrorMapper.from_exit(exit_code=1, stderr=stderr)
        assert type(from_stream).__name__ == type(from_exit).__name__, (
            f"{slug}: stream-path={type(from_stream).__name__}, "
            f"exit-path={type(from_exit).__name__}"
        )


# Phase 6 plan 03 (AUT-07): explicit contract row for error-auth-invalid-key
# (auto-discovered by corpus glob above; explicit row confirms slug is exercised)


def test_run_error_auth_invalid_key():
    """error-auth-invalid-key → AuthError with bucket=auth"""
    from gemini_sdk.errors import AuthError

    stderr = (FIXTURES / "error-auth-invalid-key.stderr.txt").read_text(encoding="utf-8")
    expected = json.loads((FIXTURES / "error-auth-invalid-key.expected.json").read_text())
    err = ErrorMapper.from_exit(exit_code=1, stderr=stderr)
    assert isinstance(err, AuthError)
    assert err.bucket == "auth"
    assert err.retryable is False
    assert type(err).__name__ == expected["_errorType"]
