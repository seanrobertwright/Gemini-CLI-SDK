"""gemini_sdk.query — Public query module."""

from .build_argv import build_argv
from .query import query, query_full, query_raw
from .types import AbortError, ApprovalMode, Model, QueryOptions, QueryResult
from ..session import Session, TranscriptEntry, normalise_session_id  # Phase 7 re-export

__all__ = [
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
