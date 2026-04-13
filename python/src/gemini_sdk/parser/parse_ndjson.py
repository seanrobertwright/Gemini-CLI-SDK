"""
python/src/gemini_sdk/parser/parse_ndjson.py

Stage 1 of the two-stage parser pipeline.
Converts a byte stream (AsyncIterator[bytes]) into an AsyncIterator[RawEvent].

Requirements satisfied:
  PRS-01 — 1 MiB line limit (oversized lines yield cli_log, never throw)
  PRS-02 — CRLF tolerance (strip \r before \n)
  PRS-03 — Unknown event type fallback → {type: 'unknown', raw}
  PRS-04 — Non-JSON line fallback → {type: 'cli_log', line}
"""
from __future__ import annotations

import json
from typing import AsyncIterator, Union

from .types import KNOWN_RAW_TYPES, RawEvent

MAX_LINE = 1024 * 1024  # 1 MiB (PRS-01)


async def parse_ndjson(
    stream: Union[AsyncIterator[bytes], "anyio.abc.ByteReceiveStream"],  # type: ignore[name-defined]
) -> AsyncIterator[RawEvent]:
    """Stage 1: byte stream -> RawEvent async iterator."""
    buf = b""
    async for chunk in stream:
        buf += chunk
        while b"\n" in buf:
            line_bytes, buf = buf.split(b"\n", 1)
            line = line_bytes.rstrip(b"\r").decode("utf-8", errors="replace")
            if not line:
                continue
            yield _parse_line(line)
        # Check buffer overflow (PRS-01)
        if len(buf) > MAX_LINE:
            yield {"type": "cli_log", "line": buf[:MAX_LINE].decode("utf-8", errors="replace")}
            buf = buf[MAX_LINE:]
    # Flush remaining buffer on stream end
    if buf:
        line = buf.rstrip(b"\r").decode("utf-8", errors="replace")
        if line:
            yield _parse_line(line)


def _parse_line(line: str) -> RawEvent:
    """Parse a single line into a RawEvent."""
    try:
        obj = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return {"type": "cli_log", "line": line}  # PRS-04
    if not isinstance(obj, dict) or "type" not in obj:
        return {"type": "cli_log", "line": line}  # PRS-04
    if obj["type"] not in KNOWN_RAW_TYPES:
        return {"type": "unknown", "raw": obj}  # PRS-03
    return obj  # type: ignore[return-value]
