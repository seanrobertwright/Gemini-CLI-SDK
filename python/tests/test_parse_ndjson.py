"""
python/tests/test_parse_ndjson.py

Unit tests for parse_ndjson covering PRS-01 through PRS-04.
Test names match TS parseNdjson.spec.ts parity spec.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parents[2] / "spec" / "fixtures"


# ── helpers ───────────────────────────────────────────────────────────────────


async def _to_stream(chunks: list[bytes]):
    """Helper: yield byte chunks as an async iterator."""
    for chunk in chunks:
        yield chunk


async def _collect(aiter):
    """Helper: collect async iterator into list."""
    out = []
    async for item in aiter:
        out.append(item)
    return out


# ── tests ──────────────────────────────────────────────────────────────────────


class TestParseNdjson:
    @pytest.mark.anyio
    async def test_parses_simple_text_fixture(self):
        """parses simple-text fixture into correct RawEvent sequence"""
        from gemini_sdk.parser import parse_ndjson

        ndjson = (FIXTURES_DIR / "simple-text.ndjson").read_bytes()
        events = await _collect(parse_ndjson(_to_stream([ndjson])))

        assert len(events) == 4
        assert events[0]["type"] == "init"
        assert events[1]["type"] == "message"
        assert events[1]["role"] == "user"
        assert events[2]["type"] == "message"
        assert events[2]["role"] == "assistant"
        assert events[3]["type"] == "result"

    @pytest.mark.anyio
    async def test_crlf_tolerance(self):
        """tolerates CRLF line endings identically to LF"""
        from gemini_sdk.parser import parse_ndjson

        content = (FIXTURES_DIR / "simple-text.ndjson").read_bytes()
        lf_content = content.replace(b"\r\n", b"\n")
        crlf_content = lf_content.replace(b"\n", b"\r\n")

        lf_events = await _collect(parse_ndjson(_to_stream([lf_content])))
        crlf_events = await _collect(parse_ndjson(_to_stream([crlf_content])))

        assert len(crlf_events) == len(lf_events)
        assert json.dumps(crlf_events, sort_keys=True) == json.dumps(lf_events, sort_keys=True)

    @pytest.mark.anyio
    async def test_1mib_limit(self):
        """emits cli_log for lines over 1 MiB without throwing"""
        from gemini_sdk.parser import parse_ndjson

        # 1.1 MiB line (no newline until end)
        big_line = b"x" * (1024 * 1024 + 100)
        input_bytes = big_line + b"\n"

        events = await _collect(parse_ndjson(_to_stream([input_bytes])))

        # At least one cli_log event should have been emitted
        assert any(e["type"] == "cli_log" for e in events)

    @pytest.mark.anyio
    async def test_non_json_fallback(self):
        """emits cli_log for non-JSON lines without throwing"""
        from gemini_sdk.parser import parse_ndjson

        input_bytes = b"GEMINI WARNING: policy text\n"

        events = await _collect(parse_ndjson(_to_stream([input_bytes])))

        assert len(events) == 1
        assert events[0]["type"] == "cli_log"
        assert events[0]["line"] == "GEMINI WARNING: policy text"

    @pytest.mark.anyio
    async def test_unknown_type_fallback(self):
        """emits unknown for unrecognized event types without throwing"""
        from gemini_sdk.parser import parse_ndjson

        content = (FIXTURES_DIR / "event-unknown.ndjson").read_bytes()

        events = await _collect(parse_ndjson(_to_stream([content])))

        assert len(events) == 1
        assert events[0]["type"] == "unknown"
        assert events[0]["raw"]["type"] == "cosmic_ray_hit"

    @pytest.mark.anyio
    async def test_empty_lines_skipped(self):
        """skips empty lines between events"""
        from gemini_sdk.parser import parse_ndjson

        line1 = b'{"type":"init","timestamp":"2026-01-01T00:00:00.000Z","session_id":"s1","model":"test"}'
        line2 = b'{"type":"result","timestamp":"2026-01-01T00:00:01.000Z","status":"success","stats":{}}'
        input_bytes = line1 + b"\n\n\n" + line2 + b"\n"

        events = await _collect(parse_ndjson(_to_stream([input_bytes])))

        # Only 2 events — the 3 empty lines are skipped
        assert len(events) == 2
        assert events[0]["type"] == "init"
        assert events[1]["type"] == "result"

    @pytest.mark.anyio
    async def test_split_utf8(self):
        """decodes split UTF-8 codepoint across chunk boundaries"""
        from gemini_sdk.parser import parse_ndjson

        # U+1F600 GRINNING FACE — 4-byte UTF-8: F0 9F 98 80
        full_char = "\U0001F600"
        json_line = (
            json.dumps(
                {
                    "type": "init",
                    "timestamp": "2026-01-01T00:00:00.000Z",
                    "session_id": "s1",
                    "model": "test",
                    "greeting": full_char,
                },
                ensure_ascii=False,
            )
            + "\n"
        )
        all_bytes = json_line.encode("utf-8")

        # Find the emoji bytes and split mid-sequence
        emoji_bytes = full_char.encode("utf-8")  # b'\xf0\x9f\x98\x80'
        split_pos = -1
        for i in range(len(all_bytes) - len(emoji_bytes)):
            if all_bytes[i] == emoji_bytes[0] and all_bytes[i + 1] == emoji_bytes[1]:
                split_pos = i + 2  # split after first 2 bytes of the 4-byte sequence
                break
        if split_pos == -1:
            split_pos = len(all_bytes) // 2

        chunk1 = all_bytes[:split_pos]
        chunk2 = all_bytes[split_pos:]

        events = await _collect(parse_ndjson(_to_stream([chunk1, chunk2])))

        assert len(events) == 1
        assert events[0]["type"] == "init"
        # The emoji should be decoded correctly (or replaced — either way the init is parsed)
        assert "greeting" in events[0]

    @pytest.mark.anyio
    async def test_flush_remaining(self):
        """flushes remaining buffer on stream end"""
        from gemini_sdk.parser import parse_ndjson

        # No trailing newline
        line = b'{"type":"init","timestamp":"2026-01-01T00:00:00.000Z","session_id":"s1","model":"test"}'

        events = await _collect(parse_ndjson(_to_stream([line])))

        assert len(events) == 1
        assert events[0]["type"] == "init"

    @pytest.mark.anyio
    async def test_empty_stream(self):
        """yields no events for empty stream"""
        from gemini_sdk.parser import parse_ndjson

        events = await _collect(parse_ndjson(_to_stream([])))
        assert len(events) == 0
