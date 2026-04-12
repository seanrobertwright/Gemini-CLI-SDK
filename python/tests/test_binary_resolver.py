"""Tests for binary_resolver.resolve_binary() — matches TS BinaryResolver.spec.ts for PAR-03 parity."""

import os
import stat
import sys
import pytest

from gemini_sdk.errors import GeminiNotFoundError
from gemini_sdk.process.binary_resolver import resolve_binary


class TestResolveBinary:
    """Tests for resolve_binary() — mirrors TS describe('resolveBinary()')."""

    def test_resolves_explicit_cli_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """returns cliPath directly when provided, without checking PATH"""
        # Stub PATH to empty so if it fell through to PATH lookup it would fail
        monkeypatch.setenv("PATH", "")
        monkeypatch.delenv("GEMINI_BIN_PATH", raising=False)

        result = resolve_binary("/custom/path/to/gemini")
        assert result == "/custom/path/to/gemini"

    def test_resolves_gemini_bin_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """returns GEMINI_BIN_PATH when no cliPath is given"""
        monkeypatch.setenv("GEMINI_BIN_PATH", "/env/path/gemini")
        monkeypatch.setenv("PATH", "")

        result = resolve_binary()
        assert result == "/env/path/gemini"

    def test_finds_gemini_on_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: "pytest.TempPathFactory"
    ) -> None:
        """finds gemini on PATH when no cliPath and no GEMINI_BIN_PATH"""
        fake_dir = tmp_path  # type: ignore[assignment]
        is_win = sys.platform == "win32"
        binary_name = "gemini.cmd" if is_win else "gemini"
        fake_binary = fake_dir / binary_name  # type: ignore[operator]

        if is_win:
            fake_binary.write_text("@echo off\n")  # type: ignore[union-attr]
        else:
            fake_binary.write_text("#!/bin/sh\n")  # type: ignore[union-attr]
            fake_binary.chmod(fake_binary.stat().st_mode | stat.S_IEXEC)  # type: ignore[union-attr]

        monkeypatch.delenv("GEMINI_BIN_PATH", raising=False)
        monkeypatch.setenv("PATH", str(fake_dir))

        result = resolve_binary()
        assert result == str(fake_binary)

    def test_throws_gemini_not_found_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """throws GeminiNotFoundError with helpful install message when binary not found"""
        monkeypatch.delenv("GEMINI_BIN_PATH", raising=False)
        monkeypatch.setenv("PATH", "/nonexistent/path/that/does/not/exist")

        with pytest.raises(GeminiNotFoundError, match="gemini-cli not found"):
            resolve_binary()

        with pytest.raises(GeminiNotFoundError, match="npm install -g @google/gemini-cli"):
            resolve_binary()

    def test_precedence_cli_path_over_env_and_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: "pytest.TempPathFactory"
    ) -> None:
        """respects precedence: cliPath > GEMINI_BIN_PATH > PATH"""
        fake_dir = tmp_path  # type: ignore[assignment]
        is_win = sys.platform == "win32"
        binary_name = "gemini.cmd" if is_win else "gemini"
        fake_binary = fake_dir / binary_name  # type: ignore[operator]

        if is_win:
            fake_binary.write_text("@echo off\n")  # type: ignore[union-attr]
        else:
            fake_binary.write_text("#!/bin/sh\n")  # type: ignore[union-attr]
            fake_binary.chmod(fake_binary.stat().st_mode | stat.S_IEXEC)  # type: ignore[union-attr]

        monkeypatch.setenv("GEMINI_BIN_PATH", "/env-path/gemini")
        monkeypatch.setenv("PATH", str(fake_dir))

        # cli_path wins over GEMINI_BIN_PATH and PATH
        assert resolve_binary("/explicit/gemini") == "/explicit/gemini"

        # GEMINI_BIN_PATH wins over PATH (no cli_path)
        assert resolve_binary() == "/env-path/gemini"

        # Clear GEMINI_BIN_PATH — PATH should now be used
        monkeypatch.setenv("GEMINI_BIN_PATH", "")
        assert resolve_binary() == str(fake_binary)
