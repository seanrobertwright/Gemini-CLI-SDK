"""
python/src/gemini_sdk/parser/dispatch.py

Stage 2 of the two-stage parser pipeline.
Maps RawEvents into MessageChunks.

Requirements satisfied:
  PRS-05 — EventDispatcher routes all known event types to MessageChunk variants
  PRS-07 — Tool pairing by tool_id with incomplete:true flush on stream end
"""
from __future__ import annotations

from typing import AsyncIterator, Dict

from .types import MessageChunk, RawEvent


async def dispatch(
    events: AsyncIterator[RawEvent],
) -> AsyncIterator[MessageChunk]:
    """Stage 2: RawEvent -> MessageChunk async iterator with tool pairing."""
    pending: Dict[str, dict] = {}  # tool_id -> ToolChunk (PRS-07)
    session_id = ""  # captured from init event, forwarded to result

    async for event in events:
        event_type = event.get("type", "")  # type: ignore[union-attr]

        if event_type == "init":
            session_id = event["session_id"]  # type: ignore[index]
            yield {
                "type": "system",
                "subtype": "init",
                "sessionId": event["session_id"],  # type: ignore[index]
                "model": event["model"],  # type: ignore[index]
            }

        elif event_type == "message":
            if _is_thinking(event):  # type: ignore[arg-type]
                yield {"type": "thinking", "content": event["content"]}  # type: ignore[index]
            elif event.get("role") == "assistant":  # type: ignore[union-attr]
                yield {"type": "assistant", "content": event["content"]}  # type: ignore[index]
            else:
                yield {
                    "type": "system",
                    "subtype": "message",
                    "role": event["role"],  # type: ignore[index]
                    "content": event["content"],  # type: ignore[index]
                }

        elif event_type == "tool_use":
            pending[event["tool_id"]] = {  # type: ignore[index]
                "type": "tool",
                "toolName": event["tool_name"],  # type: ignore[index]
                "toolId": event["tool_id"],  # type: ignore[index]
                "parameters": event["parameters"],  # type: ignore[index]
            }

        elif event_type == "tool_result":
            tool_id = event["tool_id"]  # type: ignore[index]
            tool_chunk = pending.pop(tool_id, None)
            if tool_chunk is not None:
                yield tool_chunk  # tool chunk first (PRS-07)
            # Build tool_result chunk — yield defensively even for orphan tool_results
            result_chunk: dict = {
                "type": "tool_result",
                "toolId": tool_id,
                "status": event["status"],  # type: ignore[index]
                "output": event["output"],  # type: ignore[index]
            }
            err = event.get("error")  # type: ignore[union-attr]
            if err is not None:
                result_chunk["error"] = err
            yield result_chunk  # type: ignore[misc]

        elif event_type == "error":
            if _is_rate_limit_error(event):  # type: ignore[arg-type]
                err = event["error"]  # type: ignore[index]
                yield {
                    "type": "rate_limit",
                    "code": err.get("code", 429),
                    "message": err.get("message", ""),
                    "status": err.get("status"),
                }
            else:
                # Phase 5 will replace this with raise GeminiError(...) from error taxonomy
                raise RuntimeError(f"Unhandled error event: {event.get('error')}")  # type: ignore[union-attr]

        elif event_type == "result":
            yield {
                "type": "result",
                "sessionId": session_id,
                "stopReason": _map_stop_reason(event["status"]),  # type: ignore[index]
            }

        # 'unknown' and 'cli_log' are parser-level events — silently skip in dispatch

    # Flush unpaired tool_use on stream end (PRS-07)
    for tool_chunk in pending.values():
        yield {**tool_chunk, "incomplete": True}  # type: ignore[misc]


def _is_thinking(event: dict) -> bool:
    """Detect thinking events (thought=True flag or role='thinking')."""
    return event.get("thought") is True or event.get("role") == "thinking"


def _is_rate_limit_error(event: dict) -> bool:
    """Detect rate-limit error events (code 429 or RESOURCE_EXHAUSTED status)."""
    err = event.get("error", {})
    return err.get("code") == 429 or err.get("status") == "RESOURCE_EXHAUSTED"


def _map_stop_reason(status: str) -> str:
    """Map result status to stopReason string."""
    if status == "success":
        return "end_turn"
    return status  # pass-through for unknown statuses
