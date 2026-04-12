"""gemini-sdk — Python SDK for gemini-cli."""

__version__ = "0.0.0"

from .errors import GeminiNotFoundError
from .process import (
    ProcessStrategy,
    SpawnPerCallStrategy,
    build_env,
    kill_tree,
    resolve_binary,
    ProcessManager,
)

__all__ = [
    "ProcessStrategy",
    "SpawnPerCallStrategy",
    "resolve_binary",
    "build_env",
    "ProcessManager",
    "kill_tree",
    "GeminiNotFoundError",
]
