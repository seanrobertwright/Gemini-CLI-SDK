"""ProcessStrategy Protocol — Python port of TypeScript ProcessStrategy interface."""

from __future__ import annotations

from typing import Any, Protocol

from anyio.abc import Process


class ProcessStrategy(Protocol):
    """
    Advanced/escape-hatch interface for customizing how gemini-cli processes are spawned.
    The default implementation is ``SpawnPerCallStrategy``.
    Most users should not need to implement this Protocol directly.
    """

    async def spawn(
        self,
        argv: list[str],
        env: dict[str, str],
        **kwargs: Any,
    ) -> Process:
        """Spawn a new gemini-cli process and return the anyio Process handle."""
        ...
