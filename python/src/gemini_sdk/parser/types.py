"""
python/src/gemini_sdk/parser/types.py

RawEvent — discriminated union mirroring spec/events.schema.json's 6 event types
           plus two lenient fallbacks (UnknownEvent, CliLogEvent).

MessageChunk — 8-variant discriminated union per the Archon MessageChunk contract.
               This is the output type of the EventDispatcher (Phase 3 Plan 2).
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from typing_extensions import Required, TypedDict

# ─────────────────────────────────────────────────────────────────────────────
# RawEvent — wire-protocol events emitted by gemini-cli
# ─────────────────────────────────────────────────────────────────────────────


class InitEvent(TypedDict, total=False):
    type: Required[Literal["init"]]
    timestamp: Required[str]
    session_id: Required[str]
    model: Required[str]
    _synthetic: bool
    _note: str


class MessageEvent(TypedDict, total=False):
    type: Required[Literal["message"]]
    timestamp: Required[str]
    role: Required[str]
    content: Required[str]
    delta: bool
    thought: bool


class ResultEvent(TypedDict, total=False):
    type: Required[Literal["result"]]
    timestamp: Required[str]
    status: Required[str]
    stats: Required[Dict[str, Any]]


class ToolUseEvent(TypedDict, total=False):
    type: Required[Literal["tool_use"]]
    timestamp: Required[str]
    tool_name: Required[str]
    tool_id: Required[str]
    parameters: Required[Dict[str, Any]]


class ToolResultEvent(TypedDict, total=False):
    type: Required[Literal["tool_result"]]
    timestamp: Required[str]
    tool_id: Required[str]
    status: Required[str]
    output: Required[str]
    error: Dict[str, Any]


class ErrorEvent(TypedDict, total=False):
    type: Required[Literal["error"]]
    timestamp: Required[str]
    error: Required[Dict[str, Any]]


class UnknownEvent(TypedDict):
    """Lenient fallback for unknown event types (PRS-03)."""

    type: Literal["unknown"]
    raw: Dict[str, Any]


class CliLogEvent(TypedDict):
    """Non-JSON lines from gemini-cli stdout (e.g. policy warnings)."""

    type: Literal["cli_log"]
    line: str


RawEvent = Union[
    InitEvent,
    MessageEvent,
    ResultEvent,
    ToolUseEvent,
    ToolResultEvent,
    ErrorEvent,
    UnknownEvent,
    CliLogEvent,
]

KNOWN_RAW_TYPES: List[str] = [
    "init",
    "message",
    "result",
    "tool_use",
    "tool_result",
    "error",
]

# ─────────────────────────────────────────────────────────────────────────────
# MessageChunk — EventDispatcher output variants (Archon contract)
# ─────────────────────────────────────────────────────────────────────────────


class AssistantChunk(TypedDict):
    type: Literal["assistant"]
    content: str


class SystemChunk(TypedDict, total=False):
    type: Required[Literal["system"]]
    subtype: Required[str]  # 'init' | 'message'
    sessionId: str
    model: str
    role: str
    content: str


class ThinkingChunk(TypedDict):
    type: Literal["thinking"]
    content: str


class ResultChunk(TypedDict, total=False):
    type: Required[Literal["result"]]
    sessionId: Required[str]
    stopReason: Required[str]
    requestedModel: str  # MDL-04: populated only on mismatch
    actualModel: str     # MDL-04: populated only on mismatch
    requestedSessionId: str  # Phase 7: populated only on session-id mismatch
    actualSessionId: str     # Phase 7: populated only on session-id mismatch


class RateLimitChunk(TypedDict, total=False):
    type: Required[Literal["rate_limit"]]
    code: Required[int]
    message: Required[str]
    status: str


class ToolChunk(TypedDict, total=False):
    type: Required[Literal["tool"]]
    toolName: Required[str]
    toolId: Required[str]
    parameters: Required[Dict[str, Any]]
    incomplete: bool


class ToolResultChunk(TypedDict, total=False):
    type: Required[Literal["tool_result"]]
    toolId: Required[str]
    status: Required[str]
    output: Required[str]
    error: Dict[str, Any]


class WorkflowDispatchChunk(TypedDict):
    """Reserved for Phase 10 Archon adapter; Phase 3 EventDispatcher never emits this."""

    type: Literal["workflow_dispatch"]


MessageChunk = Union[
    AssistantChunk,
    SystemChunk,
    ThinkingChunk,
    ResultChunk,
    RateLimitChunk,
    ToolChunk,
    ToolResultChunk,
    WorkflowDispatchChunk,
]
