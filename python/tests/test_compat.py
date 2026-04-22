"""
python/tests/test_compat.py

Pytest suite for check_compat_once (REL-06 compat probe).
Mirrors the 8 TS vitest cases in ts/src/compat.spec.ts (PAR-03 parity convention).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from gemini_sdk.compat import (
    _reset_compat_cache_for_testing,
    check_compat_once,
)


# ────────────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_cache(monkeypatch):
    """Reset module-level _checked flag before each test."""
    _reset_compat_cache_for_testing()
    # Remove GEMINI_SDK_COMPAT from env so default (warn) is active by default.
    monkeypatch.delenv("GEMINI_SDK_COMPAT", raising=False)
    yield
    _reset_compat_cache_for_testing()


@pytest.fixture
def compat_file(tmp_path: Path) -> Path:
    """Create a stub .gemini-cli-compat file containing 0.37.1."""
    f = tmp_path / ".gemini-cli-compat"
    f.write_text("0.37.1\n", encoding="utf-8")
    return f


def _make_proc(stdout: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr="")


# ────────────────────────────────────────────────────────────────────────────
# Tests (descriptions mirror TS it() strings verbatim — PAR-03)
# ────────────────────────────────────────────────────────────────────────────


def test_warn_default_in_range(monkeypatch, capsys, compat_file):
    """warn default in-range: no warning emitted when detected version is within ~0.37.1"""
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _make_proc("gemini 0.37.5"))

    check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))

    captured = capsys.readouterr()
    assert captured.err == ""


def test_warn_default_out_of_range(monkeypatch, capsys, compat_file):
    """warn default out-of-range: writes exact warning string to stderr when detected outside ~0.37.1"""
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _make_proc("gemini 0.39.2"))

    check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))

    captured = capsys.readouterr()
    assert (
        "[gemini-sdk] tested against gemini-cli 0.37.x, detected 0.39.2 — proceeding"
        in captured.err
    )


def test_strict_mode_out_of_range(monkeypatch, compat_file):
    """strict mode out-of-range: throws Error with exact warning message"""
    monkeypatch.setenv("GEMINI_SDK_COMPAT", "strict")
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _make_proc("gemini 0.39.2"))

    with pytest.raises(RuntimeError, match=r"0\.39\.2.*proceeding"):
        check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))


def test_silent_mode_out_of_range(monkeypatch, capsys, compat_file):
    """silent mode out-of-range: no warning emitted and no throw"""
    monkeypatch.setenv("GEMINI_SDK_COMPAT", "silent")
    called = []
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: called.append(1) or _make_proc("gemini 0.39.2"))

    check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))  # must not raise

    captured = capsys.readouterr()
    assert captured.err == ""
    # subprocess.run is never called because silent returns early
    assert len(called) == 0


def test_cache_hit(monkeypatch, compat_file):
    """cache hit: execFileSync invoked exactly once across two calls"""
    call_count = []
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: call_count.append(1) or _make_proc("0.37.3"))

    check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))
    check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))

    assert len(call_count) == 1


def test_binary_not_found_warn_mode(monkeypatch, capsys, compat_file):
    """binary not found in warn mode: silent (does not re-throw)"""
    def _raise(*a, **kw):
        raise subprocess.SubprocessError("ENOENT: no such file or directory")

    monkeypatch.setattr(subprocess, "run", _raise)

    check_compat_once("/bad/path/gemini", compat_file_path=str(compat_file))  # must not raise

    captured = capsys.readouterr()
    assert captured.err == ""


def test_binary_not_found_strict_mode(monkeypatch, compat_file):
    """binary not found in strict mode: re-throws the probe error"""
    monkeypatch.setenv("GEMINI_SDK_COMPAT", "strict")

    def _raise(*a, **kw):
        raise subprocess.SubprocessError("ENOENT: no such file or directory")

    monkeypatch.setattr(subprocess, "run", _raise)

    with pytest.raises(RuntimeError, match="probe failed"):
        check_compat_once("/bad/path/gemini", compat_file_path=str(compat_file))


def test_reset_compat_cache_for_testing(monkeypatch, compat_file):
    """_resetCompatCacheForTesting clears cache enabling subsequent calls to re-probe"""
    call_count = []
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: call_count.append(1) or _make_proc("0.37.3"))

    check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))
    assert len(call_count) == 1

    _reset_compat_cache_for_testing()

    check_compat_once("/usr/bin/gemini", compat_file_path=str(compat_file))
    assert len(call_count) == 2
