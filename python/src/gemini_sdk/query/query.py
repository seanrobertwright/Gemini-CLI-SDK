"""
python/src/gemini_sdk/query/query.py

Three public query functions:
  query()      — async generator yielding MessageChunk stream
  query_raw()  — async generator yielding RawEvent stream (no dispatch)
  query_full() — accumulates all chunks into a QueryResult

Requirements satisfied:
  API-01 — query() public entry point
  API-03 — query_raw() raw event stream
  API-04 — query_full() accumulated result
  API-05 — Abort kills subprocess + cleans temp file + flushes incomplete tool chunks
  API-06 — system_prompt temp file lifecycle
  SYS-01 — GEMINI_SYSTEM_MD env var for system prompt injection
  SYS-02 — Temp system-prompt file deleted in finally
  CWD-01 — cwd option passed to subprocess
  MDL-04 — Model mismatch surfaced on ResultChunk
"""

from __future__ import annotations

import os
import secrets
import tempfile
from typing import AsyncIterator, Optional

import anyio
import anyio.abc

from ..parser.dispatch import dispatch
from ..parser.parse_ndjson import parse_ndjson
from ..parser.types import MessageChunk, RawEvent, ResultChunk
from ..process.process_manager import ProcessManager, kill_tree
from .build_argv import build_argv
from .types import AbortError, QueryOptions, QueryResult

# ────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ────────────────────────────────────────────────────────────────────────────


async def _write_temp_system_prompt(system_prompt: Optional[str]) -> Optional[str]:
    """Write a system prompt to a uniquely-named temp file.

    Returns the absolute path to the temp file, or None if no prompt given.
    """
    if not system_prompt:
        return None
    suffix = secrets.token_hex(8)
    temp_path = os.path.join(tempfile.gettempdir(), f"gemini-sdk-system-{suffix}.md")
    await anyio.Path(temp_path).write_text(system_prompt, encoding="utf-8")
    return temp_path


# ────────────────────────────────────────────────────────────────────────────
# query() — primary public API (MessageChunk stream)
# ────────────────────────────────────────────────────────────────────────────


async def query(options: QueryOptions) -> AsyncIterator[MessageChunk]:
    """Yield a MessageChunk stream backed by a gemini-cli subprocess pipeline.

    Lifecycle:
      1. Pre-cancel check
      2. Write optional system prompt to temp file -> GEMINI_SYSTEM_MD
      3. Spawn subprocess via ProcessManager
      4. Pipe stdout through parse_ndjson -> dispatch
      5. Yield chunks; detect model mismatch; buffer pending tool_use chunks
      6. On cancel: flush pending tool_use as incomplete, raise AbortError
      7. Finally: kill subprocess, delete temp file
    """
    # Step 1: Pre-cancel check
    cancel_scope = options.get("cancel_scope")
    if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
        raise AbortError()

    # Step 2: Write optional system prompt to temp file
    temp_path = await _write_temp_system_prompt(options.get("system_prompt"))

    # Step 3: Build env overrides
    env_overrides: dict[str, str] = dict(options.get("env") or {})
    if temp_path:
        env_overrides["GEMINI_SYSTEM_MD"] = temp_path

    # Step 4: Build argv and spawn subprocess
    argv = build_argv(options)
    manager = ProcessManager()
    proc = await manager.spawn(
        argv=argv,
        cli_path=options.get("cli_path"),
        env=env_overrides,
        cwd=options.get("cwd"),
    )

    # Step 5: Track model for mismatch detection (MDL-04)
    model_opt = options.get("model")
    requested_model: Optional[str] = None
    if model_opt is not None and str(model_opt) != "auto":
        requested_model = str(model_opt)
    actual_model: Optional[str] = None

    # Step 6: Tool chunk buffering — unpaired tool_use chunks accumulate here
    pending_tool_chunks: list[MessageChunk] = []

    # Track whether we got cancelled mid-stream
    cancelled = False

    try:
        raw_events = parse_ndjson(proc.stdout)  # type: ignore[arg-type]
        chunks_iter = dispatch(raw_events)

        async for chunk in chunks_iter:
            # Check cancellation on each chunk
            if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
                cancelled = True
                break

            # Capture model from init event (MDL-04)
            if chunk.get("type") == "system" and chunk.get("subtype") == "init":  # type: ignore[union-attr]
                actual_model = chunk.get("model")  # type: ignore[union-attr]

            # Enrich ResultChunk with model mismatch info (MDL-04)
            if chunk.get("type") == "result":  # type: ignore[union-attr]
                if requested_model and actual_model and requested_model != actual_model:
                    enriched: ResultChunk = {
                        **chunk,  # type: ignore[misc]
                        "requestedModel": requested_model,
                        "actualModel": actual_model,
                    }
                    # Result chunk ends the stream, clear pending
                    pending_tool_chunks.clear()
                    yield enriched  # type: ignore[misc]
                    continue
                # No mismatch — clear pending and yield as-is
                pending_tool_chunks.clear()

            # Tool chunk buffering
            if chunk.get("type") == "tool":  # type: ignore[union-attr]
                pending_tool_chunks.append(chunk)
            elif chunk.get("type") == "tool_result":  # type: ignore[union-attr]
                # Paired — pop the last pending tool_use
                if pending_tool_chunks:
                    pending_tool_chunks.pop()

            yield chunk

        # After loop: if cancelled, perform abort flush then raise AbortError
        if cancelled:
            # Abort flush: yield pending tool_use chunks with incomplete=True (Phase 3 contract)
            for pending in pending_tool_chunks:
                yield {**pending, "incomplete": True}  # type: ignore[misc]
            raise AbortError()

    finally:
        # Cleanup: kill subprocess, remove temp file
        if proc.pid is not None:
            try:
                await kill_tree(proc.pid)
            except Exception:
                pass
        if temp_path:
            try:
                await anyio.Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass


# ────────────────────────────────────────────────────────────────────────────
# query_raw() — raw RawEvent stream (skips dispatch)
# ────────────────────────────────────────────────────────────────────────────


async def query_raw(options: QueryOptions) -> AsyncIterator[RawEvent]:
    """Yield a RawEvent stream from a gemini-cli subprocess.

    Skips the dispatch stage — intended for low-level introspection.
    """
    # Pre-cancel check
    cancel_scope = options.get("cancel_scope")
    if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
        raise AbortError()

    temp_path = await _write_temp_system_prompt(options.get("system_prompt"))

    env_overrides: dict[str, str] = dict(options.get("env") or {})
    if temp_path:
        env_overrides["GEMINI_SYSTEM_MD"] = temp_path

    argv = build_argv(options)
    manager = ProcessManager()
    proc = await manager.spawn(
        argv=argv,
        cli_path=options.get("cli_path"),
        env=env_overrides,
        cwd=options.get("cwd"),
    )

    cancelled = False

    try:
        raw_events = parse_ndjson(proc.stdout)  # type: ignore[arg-type]

        async for event in raw_events:
            if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
                cancelled = True
                break
            yield event

        if cancelled:
            raise AbortError()

    finally:
        if proc.pid is not None:
            try:
                await kill_tree(proc.pid)
            except Exception:
                pass
        if temp_path:
            try:
                await anyio.Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass


# ────────────────────────────────────────────────────────────────────────────
# query_full() — accumulates chunks into a QueryResult
# ────────────────────────────────────────────────────────────────────────────


async def query_full(options: QueryOptions) -> QueryResult:
    """Run a full query and accumulate all MessageChunks into a QueryResult.

    Convenience wrapper around query() for callers that don't need streaming.
    """
    chunks: list[MessageChunk] = []
    text = ""
    session_id = ""
    stop_reason = ""

    async for chunk in query(options):
        chunks.append(chunk)
        if chunk.get("type") == "assistant":  # type: ignore[union-attr]
            text += chunk.get("content", "")  # type: ignore[union-attr]
        if chunk.get("type") == "result":  # type: ignore[union-attr]
            session_id = chunk.get("sessionId", "")  # type: ignore[union-attr]
            stop_reason = chunk.get("stopReason", "")  # type: ignore[union-attr]

    return {
        "text": text,
        "session_id": session_id,
        "stop_reason": stop_reason,
        "chunks": chunks,
    }
