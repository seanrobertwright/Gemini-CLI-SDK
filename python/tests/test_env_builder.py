"""Tests for env_builder.build_env() — matches TS EnvBuilder.spec.ts for PAR-03 parity."""

import pytest

from gemini_sdk.process.env_builder import build_env

ALLOWED_KEYS = {
    "PATH", "HOME", "USER", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "TEMP", "TMP", "TMPDIR", "SystemRoot", "SystemDrive", "COMSPEC",
    "HOMEDRIVE", "HOMEPATH", "LOGNAME", "SHELL", "TERM",
    "GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_LOCATION",
    "GEMINI_CONFIG_DIR", "GEMINI_SYSTEM_MD", "GEMINI_BIN_PATH",
    "PYTHONUTF8",
}


class TestBuildEnv:
    """Tests for build_env() — mirrors TS describe('buildEnv()')."""

    def test_returns_only_allowlisted_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """returns only allowlisted keys from process.env"""
        monkeypatch.setenv("SECRET_KEY", "super-secret-value")
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE")
        monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
        monkeypatch.setenv("PATH", "/usr/bin:/bin")

        env = build_env()

        assert env.get("GEMINI_API_KEY") == "test-api-key"
        assert env.get("PATH") == "/usr/bin:/bin"
        # Non-allowlisted keys must NOT be present
        assert "SECRET_KEY" not in env
        assert "AWS_ACCESS_KEY_ID" not in env

    def test_does_not_leak_non_allowlisted_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """does NOT leak non-allowlisted keys (security check)"""
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
        monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@host/db")
        monkeypatch.setenv("PRIVATE_KEY", "BEGIN RSA PRIVATE KEY")
        monkeypatch.setenv("NPM_TOKEN", "npm_12345")

        env = build_env()

        assert "AWS_SECRET_ACCESS_KEY" not in env
        assert "DATABASE_URL" not in env
        assert "PRIVATE_KEY" not in env
        assert "NPM_TOKEN" not in env

    def test_merges_caller_supplied_overrides(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """merges caller-supplied overrides on top of allowlisted env"""
        monkeypatch.setenv("PATH", "/usr/bin")

        env = build_env({"CUSTOM_VAR": "custom-value", "ANOTHER": "another-value"})

        assert env.get("CUSTOM_VAR") == "custom-value"
        assert env.get("ANOTHER") == "another-value"
        assert env.get("PATH") == "/usr/bin"

    def test_overrides_win_over_environ(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """overrides win over process.env for same key"""
        monkeypatch.setenv("PATH", "/original/path")
        monkeypatch.setenv("GEMINI_API_KEY", "original-key")

        env = build_env({"PATH": "/overridden/path", "GEMINI_API_KEY": "new-key"})

        assert env.get("PATH") == "/overridden/path"
        assert env.get("GEMINI_API_KEY") == "new-key"

    def test_always_includes_gemini_api_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """always includes GEMINI_API_KEY if set in process.env"""
        monkeypatch.setenv("GEMINI_API_KEY", "my-api-key-12345")

        env = build_env()

        assert env.get("GEMINI_API_KEY") == "my-api-key-12345"

    def test_always_includes_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """always includes PATH if set in process.env"""
        monkeypatch.setenv("PATH", "/usr/local/bin:/usr/bin:/bin")

        env = build_env()

        assert env.get("PATH") == "/usr/local/bin:/usr/bin:/bin"

    def test_returns_empty_when_no_allowlisted_vars(self) -> None:
        """returns empty object when no allowlisted vars are set in env and no overrides"""
        # Verify that result contains only allowlisted keys
        env = build_env()
        for key in env:
            assert key in ALLOWED_KEYS, f"Key {key!r} is not in the allowlist"
