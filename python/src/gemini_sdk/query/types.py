"""
python/src/gemini_sdk/query/types.py

Public type definitions for the query module.

QueryOptions  — options passed to query() / query_raw() / query_full()
QueryResult   — final accumulated result returned by query_full()
Model         — known Gemini model identifiers (str enum)
AbortError    — thrown when a cancel scope fires during a query
"""

from __future__ import annotations

import enum
from typing import Any, Dict, List, Union

from typing_extensions import Required, TypedDict

from ..parser.types import MessageChunk

# ────────────────────────────────────────────────────────────────────────────
# Model — known Gemini model identifiers
# ────────────────────────────────────────────────────────────────────────────


class Model(str, enum.Enum):
    """Known Gemini model identifiers."""

    AUTO = "auto"
    FLASH_25 = "gemini-2.5-flash"   # Deprecated: gemini-cli EOL 2026-06-17
    PRO_25 = "gemini-2.5-pro"       # Deprecated: gemini-cli EOL 2026-06-17
    FLASH_20 = "gemini-2.0-flash"
    FLASH_3 = "gemini-3-flash"
    PRO_3 = "gemini-3-pro"


# ────────────────────────────────────────────────────────────────────────────
# QueryOptions — input to all query functions
# ────────────────────────────────────────────────────────────────────────────


class QueryOptions(TypedDict, total=False):
    """Options passed to query(), query_raw(), query_full()."""

    prompt: Required[str]
    """The prompt text to send to gemini-cli. Required."""

    model: Union[Model, str]
    """Model to use. Pass Model.AUTO or omit to let gemini-cli choose."""

    system_prompt: str
    """System prompt injected before the user message."""

    cwd: str
    """Working directory for the gemini-cli subprocess."""

    additional_directories: List[str]
    """Additional directories for gemini-cli to include (CWD-02)."""

    cancel_scope: Any
    """anyio.CancelScope that cancels the in-flight query when cancelled."""

    cli_path: str
    """Explicit path to the gemini-cli binary (overrides PATH resolution)."""

    env: Dict[str, str]
    """Extra environment variables merged into the subprocess environment."""


# ────────────────────────────────────────────────────────────────────────────
# QueryResult — returned by query_full() after stream is fully consumed
# ────────────────────────────────────────────────────────────────────────────


class QueryResult(TypedDict):
    """Accumulated result from query_full()."""

    text: str
    """Concatenated assistant text from all AssistantChunks."""

    session_id: str
    """Session ID from the gemini-cli init event."""

    stop_reason: str
    """Stop reason from the gemini-cli result event."""

    chunks: List[MessageChunk]
    """All MessageChunks yielded during the query."""


# ────────────────────────────────────────────────────────────────────────────
# AbortError — thrown when cancel scope fires during an in-flight query
# ────────────────────────────────────────────────────────────────────────────


class AbortError(Exception):
    """Thrown when a cancel scope fires during an in-flight query."""

    name: str = "AbortError"
    retryable: bool = False

    def __init__(self) -> None:
        super().__init__("Query aborted by caller")
