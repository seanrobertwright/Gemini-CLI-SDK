"""gemini-sdk — Python SDK for gemini-cli."""

__version__ = "0.0.0"

from .auth import resolve_auth, AUTH_PRECEDENCE
from .errors import GeminiNotFoundError
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
    Model,
    QueryOptions,
    QueryResult,
)
from .session import Session, TranscriptEntry, normalise_session_id

__all__ = [
    "resolve_auth",
    "AUTH_PRECEDENCE",
    "ProcessStrategy",
    "SpawnPerCallStrategy",
    "resolve_binary",
    "build_env",
    "ProcessManager",
    "kill_tree",
    "GeminiNotFoundError",
    "build_argv",
    "query",
    "query_full",
    "query_raw",
    "AbortError",
    "Model",
    "QueryOptions",
    "QueryResult",
    "Session",
    "TranscriptEntry",
    "normalise_session_id",
]
