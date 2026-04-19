"""Python parity tests for resolve_auth() — Phase 6 auth module.

Docstring first lines match the corresponding TS it() descriptions in
ts/src/auth/resolveAuth.spec.ts verbatim so that scripts/diff-test-names.sh
reports 0 divergence (PAR-03 / Phase 5 parity convention).
"""

import os

import pytest

from gemini_sdk.auth import resolve_auth, AUTH_PRECEDENCE
from gemini_sdk.process.env_builder import build_env


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Clear all auth-related env vars before each test for deterministic isolation."""
    for k in [
        "GEMINI_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_API_KEY",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_PROJECT_ID",
        "GOOGLE_CLOUD_LOCATION",
    ]:
        monkeypatch.delenv(k, raising=False)
    yield


def test_run_api_key_only(monkeypatch):
    """AUT-01 api-key only — winner=api-key, no warnings, buildEnv passes GEMINI_API_KEY through"""
    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")

    r = resolve_auth(dict(os.environ))

    assert r["mode"] == "api-key"
    assert r["warnings"] == []
    assert r["env_overrides"] == {}

    env = build_env(r["env_overrides"])
    assert env["GEMINI_API_KEY"] == "test-api-key"
    assert env.get("GOOGLE_APPLICATION_CREDENTIALS", "") == ""
    assert env.get("GOOGLE_API_KEY", "") == ""


def test_run_vertex_sa_only(monkeypatch):
    """AUT-02 vertex-sa only — winner=vertex-sa, no warnings, buildEnv passes GOOGLE_APPLICATION_CREDENTIALS through"""
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/path/to/sa.json")

    r = resolve_auth(dict(os.environ))

    assert r["mode"] == "vertex-sa"
    assert r["warnings"] == []
    assert r["env_overrides"] == {}

    env = build_env(r["env_overrides"])
    assert env["GOOGLE_APPLICATION_CREDENTIALS"] == "/path/to/sa.json"
    assert env.get("GEMINI_API_KEY", "") == ""
    assert env.get("GOOGLE_API_KEY", "") == ""


def test_run_vertex_key_only(monkeypatch):
    """AUT-03 vertex-key only — winner=vertex-key, no warnings, buildEnv passes GOOGLE_API_KEY through"""
    monkeypatch.setenv("GOOGLE_API_KEY", "google-api-key-value")

    r = resolve_auth(dict(os.environ))

    assert r["mode"] == "vertex-key"
    assert r["warnings"] == []
    assert r["env_overrides"] == {}

    env = build_env(r["env_overrides"])
    assert env["GOOGLE_API_KEY"] == "google-api-key-value"
    assert env.get("GEMINI_API_KEY", "") == ""
    assert env.get("GOOGLE_APPLICATION_CREDENTIALS", "") == ""


def test_run_zero_env():
    """AUT-05 zero env — winner=adc, no warnings, no envOverrides"""
    # All auth keys cleared by _clean_env fixture
    r = resolve_auth(dict(os.environ))

    assert r["mode"] == "adc"
    assert r["warnings"] == []
    assert r["env_overrides"] == {}


def test_run_api_key_plus_vertex_sa():
    """AUT-06 api-key + vertex-sa — winner=api-key, exactly one warning containing full chain"""
    r = resolve_auth({
        "GEMINI_API_KEY": "k",
        "GOOGLE_APPLICATION_CREDENTIALS": "/sa.json",
    })

    assert r["mode"] == "api-key"
    assert len(r["warnings"]) == 1

    # Warning must reference the AUTH_PRECEDENCE constant (single source of truth per RESEARCH Pitfall 3)
    chain = " > ".join(AUTH_PRECEDENCE)
    assert chain in r["warnings"][0]
    assert "GEMINI_API_KEY" in r["warnings"][0]
    assert "GOOGLE_APPLICATION_CREDENTIALS" in r["warnings"][0]


def test_run_all_four_explicit_modes():
    """AUT-06 all four explicit modes — winner=api-key (highest precedence), warning names all losers"""
    r = resolve_auth({
        "GEMINI_API_KEY": "k",
        "GOOGLE_APPLICATION_CREDENTIALS": "/sa.json",
        "GOOGLE_API_KEY": "g",
    })

    assert r["mode"] == "api-key"
    assert len(r["warnings"]) == 1

    chain = " > ".join(AUTH_PRECEDENCE)
    assert chain in r["warnings"][0]
    assert "GEMINI_API_KEY" in r["warnings"][0]
    assert "GOOGLE_APPLICATION_CREDENTIALS" in r["warnings"][0]
    assert "GOOGLE_API_KEY" in r["warnings"][0]


def test_run_gcp_project_vars_flow_through(monkeypatch):
    """AUT-04 GCP project vars flow through buildEnv regardless of mode"""
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "my-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    r = resolve_auth(dict(os.environ))

    assert r["mode"] == "api-key"

    env = build_env(r["env_overrides"])
    assert env["GOOGLE_CLOUD_PROJECT"] == "my-project"
    assert env["GOOGLE_CLOUD_LOCATION"] == "us-central1"


def test_run_precedence_constant():
    """AUTH_PRECEDENCE constant equals [GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_API_KEY, ADC]"""
    assert AUTH_PRECEDENCE == [
        "GEMINI_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_API_KEY",
        "ADC",
    ]
