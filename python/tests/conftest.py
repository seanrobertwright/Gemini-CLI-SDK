"""Shared pytest fixtures and plugin registration."""

import pytest

# Use asyncio backend by default (ProactorEventLoop on Windows via anyio)
pytest_plugins = ("anyio",)
