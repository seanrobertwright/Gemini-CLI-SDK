"""gemini-sdk — Python SDK for gemini-cli."""

__version__ = "0.0.0"

from .compat import check_compat_once
from .auth import resolve_auth, AUTH_PRECEDENCE
from .errors import GeminiNotFoundError, SchemaValidationError, UnsupportedFeatureError
from .process import (
    ProcessStrategy,
    SpawnPerCallStrategy,
    build_env,
    kill_tree,
    resolve_binary,
    ProcessManager,
)
from .query import (
    build_argv,
    query,
    query_full,
    query_raw,
    AbortError,
    ApprovalMode,
    Model,
    QueryOptions,
    QueryResult,
)
from .session import Session, TranscriptEntry, normalise_session_id

__all__ = [
    "check_compat_once",
    "resolve_auth",
    "AUTH_PRECEDENCE",
    "ProcessStrategy",
    "SpawnPerCallStrategy",
    "resolve_binary",
    "build_env",
    "ProcessManager",
    "kill_tree",
    "GeminiNotFoundError",
    "SchemaValidationError",
    "UnsupportedFeatureError",
    "build_argv",
    "query",
    "query_full",
    "query_raw",
    "AbortError",
    "ApprovalMode",
    "Model",
    "QueryOptions",
    "QueryResult",
    "Session",
    "TranscriptEntry",
    "normalise_session_id",
]
