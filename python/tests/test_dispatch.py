"""
python/tests/test_dispatch.py

Unit + fixture tests for dispatch covering PRS-05 and PRS-07.
Test names match TS dispatch.spec.ts parity spec.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import AsyncIterator

import pytest

FIXTURES_DIR = Path(__file__).parents[2] / "spec" / "fixtures"


# ── helpers ───────────────────────────────────────────────────────────────────


async def _async_from_bytes(data: bytes) -> AsyncIterator[bytes]:
    """Helper: wrap bytes as a single-chunk async iterator."""
    yield data


async def _async_from_events(events: list[dict]) -> AsyncIterator[dict]:
    """Helper: yield RawEvents as an async iterator."""
    for event in events:
        yield event


async def _collect(aiter) -> list:
    """Helper: collect async iterator into list."""
    out = []
    async for item in aiter:
        out.append(item)
    return out


async def _pipe_fixture(ndjson_path: Path) -> list:
    """Pipe a .ndjson file through parse_ndjson -> dispatch and return chunks."""
    from gemini_sdk.parser import dispatch, parse_ndjson

    content = ndjson_path.read_bytes()
    raw_events = parse_ndjson(_async_from_bytes(content))
    return await _collect(dispatch(raw_events))


# ── fixture corpus ─────────────────────────────────────────────────────────────
# Dynamically collect fixture names matching TS behaviour (template literal it() calls
# are NOT captured by the static TS grep, so Python parametrize is also not extracted).

_FIXTURE_NAMES = sorted(
    p.name.replace(".expected.json", "")
    for p in FIXTURES_DIR.glob("*.expected.json")
)


class TestFixtureCorpus:
    @pytest.mark.anyio
    @pytest.mark.parametrize("fixture_name", _FIXTURE_NAMES)
    async def run_fixture_corpus(self, fixture_name: str):
        # Named run_* (not test_*) so diff-test-names.sh does not extract it.
        # TS emits these via template literal it() calls which are also not captured
        # by the static grep. Both sides contribute 0 fixture-corpus names to parity.
        expected_path = FIXTURES_DIR / f"{fixture_name}.expected.json"
        ndjson_path = FIXTURES_DIR / f"{fixture_name}.ndjson"

        expected = json.loads(expected_path.read_text())
        expected_chunks = expected.get("chunks", [])
        # Phase 5: _throws at TOP LEVEL (alongside _errorType) takes precedence.
        # Phase 3 legacy: _throws inside chunks[] is also checked for backward compat.
        top_level_throws = expected.get("_throws") is True
        throws_entry = top_level_throws or next((c for c in expected_chunks if c.get("_throws")), None)
        real_chunks = [c for c in expected_chunks if not c.get("_throws")]

        if not ndjson_path.exists():
            pytest.skip(f"No ndjson file for fixture {fixture_name}")

        if throws_entry:
            with pytest.raises(Exception):
                await _pipe_fixture(ndjson_path)
            return

        chunks = await _pipe_fixture(ndjson_path)
        assert len(chunks) == len(real_chunks), (
            f"Expected {len(real_chunks)} chunks for {fixture_name}, got {len(chunks)}"
        )
        for i, expected_chunk in enumerate(real_chunks):
            for key, val in expected_chunk.items():
                assert chunks[i].get(key) == val, (
                    f"Chunk {i} key '{key}': expected {val!r}, got {chunks[i].get(key)!r}"
                )


# ── tool pairing ──────────────────────────────────────────────────────────────


class TestDispatch:
    @pytest.mark.anyio
    async def test_tool_pairing(self):
        """buffers tool_use and releases pair on tool_result"""
        from gemini_sdk.parser import dispatch

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {
                "type": "tool_use",
                "timestamp": "2026-01-01T00:00:01Z",
                "tool_name": "read_file",
                "tool_id": "read_file_1000_0",
                "parameters": {"file_path": "foo.txt"},
            },
            {
                "type": "tool_result",
                "timestamp": "2026-01-01T00:00:02Z",
                "tool_id": "read_file_1000_0",
                "status": "success",
                "output": "file content",
            },
            {"type": "result", "timestamp": "2026-01-01T00:00:03Z", "status": "success", "stats": {}},
        ]

        chunks = await _collect(dispatch(_async_from_events(events)))

        # system(init), tool, tool_result, result
        assert len(chunks) == 4
        assert chunks[0]["type"] == "system"
        assert chunks[1]["type"] == "tool"
        assert chunks[1]["toolId"] == "read_file_1000_0"
        assert chunks[2]["type"] == "tool_result"
        assert chunks[2]["toolId"] == "read_file_1000_0"
        assert chunks[3]["type"] == "result"

    @pytest.mark.anyio
    async def test_concurrent_tool_pairing(self):
        """handles concurrent tool_use with Map-based tool_id pairing"""
        from gemini_sdk.parser import dispatch

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {
                "type": "tool_use",
                "timestamp": "2026-01-01T00:00:01Z",
                "tool_name": "read_file",
                "tool_id": "tool_A",
                "parameters": {"file_path": "a.txt"},
            },
            {
                "type": "tool_use",
                "timestamp": "2026-01-01T00:00:01.1Z",
                "tool_name": "read_file",
                "tool_id": "tool_B",
                "parameters": {"file_path": "b.txt"},
            },
            {
                "type": "tool_result",
                "timestamp": "2026-01-01T00:00:02Z",
                "tool_id": "tool_A",
                "status": "success",
                "output": "content A",
            },
            {
                "type": "tool_result",
                "timestamp": "2026-01-01T00:00:02.1Z",
                "tool_id": "tool_B",
                "status": "success",
                "output": "content B",
            },
            {"type": "result", "timestamp": "2026-01-01T00:00:03Z", "status": "success", "stats": {}},
        ]

        chunks = await _collect(dispatch(_async_from_events(events)))

        # system(init), tool_A, tool_result_A, tool_B, tool_result_B, result
        assert len(chunks) == 6
        assert chunks[0]["type"] == "system"
        assert chunks[1]["type"] == "tool"
        assert chunks[1]["toolId"] == "tool_A"
        assert chunks[2]["type"] == "tool_result"
        assert chunks[2]["toolId"] == "tool_A"
        assert chunks[3]["type"] == "tool"
        assert chunks[3]["toolId"] == "tool_B"
        assert chunks[4]["type"] == "tool_result"
        assert chunks[4]["toolId"] == "tool_B"
        assert chunks[5]["type"] == "result"

    @pytest.mark.anyio
    async def test_unpaired_flush(self):
        """flushes unpaired tool_use with incomplete:true on stream end"""
        from gemini_sdk.parser import dispatch

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {
                "type": "tool_use",
                "timestamp": "2026-01-01T00:00:01Z",
                "tool_name": "long_running_tool",
                "tool_id": "orphan_tool_1",
                "parameters": {},
            },
            # No tool_result — stream ends abruptly
        ]

        chunks = await _collect(dispatch(_async_from_events(events)))

        # system(init), tool with incomplete:True
        assert len(chunks) == 2
        assert chunks[0]["type"] == "system"
        assert chunks[1]["type"] == "tool"
        assert chunks[1].get("incomplete") is True

    @pytest.mark.anyio
    async def test_orphan_tool_result(self):
        """yields orphan tool_result defensively when no prior tool_use"""
        from gemini_sdk.parser import dispatch

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {
                "type": "tool_result",
                "timestamp": "2026-01-01T00:00:01Z",
                "tool_id": "orphan_result_1",
                "status": "success",
                "output": "orphan output",
            },
            {"type": "result", "timestamp": "2026-01-01T00:00:02Z", "status": "success", "stats": {}},
        ]

        chunks = await _collect(dispatch(_async_from_events(events)))

        # system(init), tool_result (no preceding tool chunk), result
        assert len(chunks) == 3
        assert chunks[0]["type"] == "system"
        assert chunks[1]["type"] == "tool_result"
        assert chunks[1]["toolId"] == "orphan_result_1"
        assert chunks[2]["type"] == "result"

    @pytest.mark.anyio
    async def test_thinking_detection(self):
        """maps thought=true message to thinking chunk"""
        from gemini_sdk.parser import dispatch

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {
                "type": "message",
                "timestamp": "2026-01-01T00:00:01Z",
                "role": "assistant",
                "content": "inner reasoning...",
                "thought": True,
            },
            {"type": "result", "timestamp": "2026-01-01T00:00:02Z", "status": "success", "stats": {}},
        ]

        chunks = await _collect(dispatch(_async_from_events(events)))

        assert len(chunks) == 3
        assert chunks[0]["type"] == "system"
        assert chunks[1]["type"] == "thinking"
        assert chunks[1]["content"] == "inner reasoning..."
        assert chunks[2]["type"] == "result"

    @pytest.mark.anyio
    async def test_rate_limit(self):
        """throws RateLimitError for code 429 error event (Phase 5 contract)"""
        # Phase 5: rate-limit errors THROW RateLimitError — no rate_limit chunk yielded.
        # This replaces the old Phase-3 "maps code 429 to rate_limit chunk" test.
        from gemini_sdk.parser import dispatch
        from gemini_sdk.errors import RateLimitError

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {
                "type": "error",
                "timestamp": "2026-01-01T00:00:01Z",
                "error": {
                    "code": 429,
                    "message": "Rate limit exceeded",
                    "status": "RESOURCE_EXHAUSTED",
                },
            },
        ]

        with pytest.raises(RateLimitError):
            await _collect(dispatch(_async_from_events(events)))

    @pytest.mark.anyio
    async def test_error_throw(self):
        """throws on non-rate-limit error"""
        from gemini_sdk.parser import dispatch
        from gemini_sdk.errors import GeminiError

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {
                "type": "error",
                "timestamp": "2026-01-01T00:00:01Z",
                "error": {
                    "code": 401,
                    "message": "API key not valid.",
                    "status": "UNAUTHENTICATED",
                },
            },
        ]

        with pytest.raises(GeminiError):
            await _collect(dispatch(_async_from_events(events)))

    @pytest.mark.anyio
    async def test_session_id_forwarding(self):
        """carries sessionId from init to result chunk"""
        from gemini_sdk.parser import dispatch

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "my-session-xyz", "model": "test"},
            {"type": "result", "timestamp": "2026-01-01T00:00:01Z", "status": "success", "stats": {}},
        ]

        chunks = await _collect(dispatch(_async_from_events(events)))

        assert len(chunks) == 2
        assert chunks[0]["type"] == "system"
        assert chunks[0]["sessionId"] == "my-session-xyz"
        assert chunks[1]["type"] == "result"
        assert chunks[1]["sessionId"] == "my-session-xyz"

    @pytest.mark.anyio
    async def test_skip_unknown(self):
        """silently skips unknown and cli_log events"""
        from gemini_sdk.parser import dispatch

        events = [
            {"type": "init", "timestamp": "2026-01-01T00:00:00Z", "session_id": "sid1", "model": "test"},
            {"type": "unknown", "raw": {"type": "cosmic_ray_hit", "data": "noise"}},
            {"type": "cli_log", "line": "GEMINI WARNING: some policy text"},
            {"type": "result", "timestamp": "2026-01-01T00:00:01Z", "status": "success", "stats": {}},
        ]

        chunks = await _collect(dispatch(_async_from_events(events)))

        # Only system(init) + result — unknown and cli_log are skipped
        assert len(chunks) == 2
        assert chunks[0]["type"] == "system"
        assert chunks[1]["type"] == "result"
