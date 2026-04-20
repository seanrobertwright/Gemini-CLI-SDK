"""Phase 9 Plan 01 Python mirror — write_config_dir + cleanup_config_dir tests."""
from __future__ import annotations

import json
import os
import pathlib
import secrets
import shutil
import tempfile
import warnings

import anyio
import pytest

from gemini_sdk.mcp import write_config_dir, cleanup_config_dir


# write_config_dir tests (mirror ts/src/mcp/writeConfigDir.spec.ts)

@pytest.mark.anyio
async def test_writes_settings_json_containing_only_mcpservers_key_at_temp_dir_root():
    """writes settings.json containing only mcpServers key at temp dir root"""
    path = await write_config_dir({"foo": {"command": "node", "args": ["x.js"]}})
    try:
        entries = os.listdir(path)
        assert entries == ["settings.json"]
        parsed = json.loads(pathlib.Path(path, "settings.json").read_text(encoding="utf-8"))
        assert list(parsed.keys()) == ["mcpServers"]
        assert parsed["mcpServers"] == {"foo": {"command": "node", "args": ["x.js"]}}
    finally:
        shutil.rmtree(path, ignore_errors=True)


@pytest.mark.anyio
async def test_returns_an_absolute_path_beginning_with_gemini_sdk_mcp_prefix():
    """returns an absolute path beginning with gemini-sdk-mcp- prefix"""
    path = await write_config_dir({"a": {}})
    try:
        assert os.path.isabs(path)
        basename = os.path.basename(path)
        assert basename.startswith("gemini-sdk-mcp-")
        assert len(basename) == len("gemini-sdk-mcp-") + 16
    finally:
        shutil.rmtree(path, ignore_errors=True)


@pytest.mark.anyio
async def test_produces_unique_paths_for_back_to_back_invocations():
    """produces unique paths for back-to-back invocations"""
    p1 = await write_config_dir({"x": {}})
    p2 = await write_config_dir({"x": {}})
    try:
        assert p1 != p2
    finally:
        shutil.rmtree(p1, ignore_errors=True)
        shutil.rmtree(p2, ignore_errors=True)


@pytest.mark.anyio
async def test_accepts_an_empty_mcpservers_map_and_writes_mcpservers_as_empty_object():
    """accepts an empty mcpServers map and writes mcpServers as empty object"""
    path = await write_config_dir({})
    try:
        parsed = json.loads(pathlib.Path(path, "settings.json").read_text(encoding="utf-8"))
        assert parsed["mcpServers"] == {}
    finally:
        shutil.rmtree(path, ignore_errors=True)


@pytest.mark.anyio
async def test_passes_verbatim_nested_server_config_through_without_modification():
    """passes verbatim nested server config through without modification"""
    value = {"http": {"httpUrl": "http://x", "headers": {"auth": "Bearer t"}}}
    path = await write_config_dir(value)
    try:
        parsed = json.loads(pathlib.Path(path, "settings.json").read_text(encoding="utf-8"))
        assert parsed["mcpServers"] == value
    finally:
        shutil.rmtree(path, ignore_errors=True)


# cleanup_config_dir tests (mirror ts/src/mcp/cleanupConfigDir.spec.ts)

@pytest.mark.anyio
async def test_removes_an_existing_temp_dir_created_by_writeconfigdir():
    """removes an existing temp dir created by writeConfigDir"""
    path = await write_config_dir({"a": {}})
    assert os.path.isdir(path)
    await cleanup_config_dir(path)
    assert not os.path.exists(path)


@pytest.mark.anyio
async def test_returns_normally_when_path_does_not_exist():
    """returns normally when path does not exist"""
    fake = os.path.join(tempfile.gettempdir(), f"gemini-sdk-mcp-does-not-exist-{secrets.token_hex(4)}")
    assert not os.path.exists(fake)
    await cleanup_config_dir(fake)  # must not raise


@pytest.mark.anyio
async def test_warns_and_does_not_throw_when_rm_fails_persistently(monkeypatch):
    """warns and does not throw when rm fails persistently"""
    import shutil as _shutil
    def always_fails(*_args, **_kwargs):
        raise PermissionError("simulated EBUSY")
    monkeypatch.setattr(_shutil, "rmtree", always_fails)
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        await cleanup_config_dir("/some/stubbed/path")
    assert any("stranded path" in str(w.message) and "/some/stubbed/path" in str(w.message) for w in captured)


@pytest.mark.anyio
async def test_uses_fs_rm_with_maxretries_3_and_retrydelay_200():
    """uses fs.rm with maxRetries 3 and retryDelay 200"""
    # Python mirror: assert the _MAX_RETRIES and _RETRY_DELAY_MS module constants are 3 and 200
    # (maintains TS parity of Windows EBUSY resilience)
    import importlib
    cdd = importlib.import_module("gemini_sdk.mcp.cleanup_config_dir")
    assert cdd._MAX_RETRIES == 3
    assert cdd._RETRY_DELAY_MS == 200
