"""
python/src/gemini_sdk/query/types.py

Public type definitions for the query module.

QueryOptions  — options passed to query() / query_raw() / query_full()
QueryResult   — final accumulated result returned by query_full()
Model         — known Gemini model identifiers (str enum)
AbortError    — re-exported from errors module (reparented to ProcessError in Phase 5)
"""

from __future__ import annotations

import enum
from typing import Any, Dict, List, Union

from typing_extensions import NotRequired, Required, TypedDict

from ..parser.types import MessageChunk
# AbortError is now canonical in the errors module (extends ProcessError, bucket=crash).
from ..errors import AbortError as AbortError  # re-export
from ..session import Session  # Phase 7 (SES-01, SES-02)

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
# ApprovalMode — known --approval-mode values for gemini-cli
# ────────────────────────────────────────────────────────────────────────────


class ApprovalMode(str, enum.Enum):
    """Known --approval-mode values for gemini-cli.

    Mirrors the Phase 4 Model str enum pattern.
    Raw string values accepted for forward compatibility (use Union type).
    """

    DEFAULT = "default"
    AUTO_EDIT = "auto_edit"
    YOLO = "yolo"
    PLAN = "plan"


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

    session: Union[Session, str]
    """Resume an existing session (SES-01, SES-02). Accepts a Session or a bare id str."""

    allowed_tools: List[str]
    """Tool names to whitelist via --allowed-tools (TOL-01).
    CSV-joined at argv boundary. Empty list or absent -> flag omitted.
    """

    approval_mode: Union["ApprovalMode", str]
    """Approval mode passed as --approval-mode <mode> (TOL-02)."""

    output_schema: Dict[str, Any]
    """**Experimental:** Best-effort JSON schema for structured output (OUT-01..04).

    WARNING: Only works with query_full() -- calling query()/query_raw() with
    this option raises UnsupportedFeatureError. Subject to change; see
    docs/structured-output.md Known Limitations and gemini-cli #13388.
    """

    mcp_servers: Dict[str, Dict[str, Any]]
    """**Experimental:** MCP server map (MCP-01). Written verbatim into temp
    settings.json in isolated GEMINI_CONFIG_DIR per query. Empty/absent ->
    no temp dir. Requires allowed_mcp_server_names when non-empty; cannot
    be combined with env.GEMINI_CONFIG_DIR.
    See docs/mcp.md Known Limitations (#2654, #3406, #20694, #13604, #17787).
    """

    allowed_mcp_server_names: List[str]
    """**Experimental:** MCP server name whitelist (MCP-03). CSV-joined at
    argv boundary as --allowed-mcp-server-names. Required when mcp_servers
    set. See docs/mcp.md.
    """


# ────────────────────────────────────────────────────────────────────────────
# QueryResult — returned by query_full() after stream is fully consumed
# ────────────────────────────────────────────────────────────────────────────


class QueryResult(TypedDict, total=False):
    """Accumulated result from query_full()."""

    text: Required[str]
    """Concatenated assistant text from all AssistantChunks."""

    session_id: Required[str]
    """Session ID from the gemini-cli init event."""

    stop_reason: Required[str]
    """Stop reason from the gemini-cli result event."""

    chunks: Required[List[MessageChunk]]
    """All MessageChunks yielded during the query."""

    session: Required[Session]
    """Phase 7 (SES-03): Session value object populated from init event."""

    structured: Any
    """**Experimental:** Parsed + validated output when output_schema was set
    on the query_full() call. Absent when output_schema was not set.
    """


# AbortError is imported from errors module above and re-exported.
# It extends ProcessError (bucket: crash, retryable: False) per Phase 5 taxonomy.
