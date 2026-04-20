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
  ERR-06 — saw_result tracking: stream ending without terminal result raises via ErrorMapper
"""

from __future__ import annotations

import os
import secrets
import tempfile
import warnings as _warnings
from typing import AsyncIterator, Optional

import anyio
import anyio.abc

from ..auth import resolve_auth
from ..errors import ErrorMapper, GeminiError, InvalidPromptError
from ..parser.dispatch import dispatch
from ..parser.parse_ndjson import parse_ndjson
from ..parser.types import MessageChunk, RawEvent, ResultChunk
from ..process.process_manager import ProcessManager, kill_tree
from ..session import Session, normalise_session_id
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
      7. ERR-06: if stream ends without result chunk AND not cancelled AND non-zero exit, raise
      8. Finally: kill subprocess, delete temp file
    """
    # Phase 7 (SES-01 Layer 1 guard): reject empty/whitespace session ids BEFORE spawn.
    session = options.get("session")
    if session is not None:
        _sid = normalise_session_id(session)
        if not _sid or not _sid.strip():
            raise InvalidPromptError("session id is empty")

    # Step 1: Pre-cancel check
    cancel_scope = options.get("cancel_scope")
    if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
        raise AbortError()

    # Phase 6 (AUT-06): resolve auth mode and emit precedence warning if multiple configured.
    # Snapshot os.environ — resolve_auth is pure and does not re-read env at spawn time.
    resolved = resolve_auth(dict(os.environ))
    for w in resolved["warnings"]:
        _warnings.warn(w, UserWarning, stacklevel=2)

    # Step 2: Write optional system prompt to temp file
    temp_path = await _write_temp_system_prompt(options.get("system_prompt"))

    # Step 3: Build env overrides
    env_overrides: dict[str, str] = {
        **resolved["env_overrides"],
        **(options.get("env") or {}),
    }
    if temp_path:
        env_overrides["GEMINI_SYSTEM_MD"] = temp_path

    # Step 4: Build argv and spawn subprocess
    argv = build_argv(options)
    manager = ProcessManager()
    spawn_result = await manager.spawn(
        argv=argv,
        cli_path=options.get("cli_path"),
        env=env_overrides,
        cwd=options.get("cwd"),
    )

    # Step 5: Track model for mismatch detection (MDL-04)
    import enum as _enum
    model_opt = options.get("model")
    requested_model: Optional[str] = None
    if model_opt is not None:
        _model_str = model_opt.value if isinstance(model_opt, _enum.Enum) else str(model_opt)
        if _model_str != "auto":
            requested_model = _model_str
    actual_model: Optional[str] = None

    # Step 6: Tool chunk buffering — unpaired tool_use chunks accumulate here
    pending_tool_chunks: list[MessageChunk] = []

    # Track whether we got cancelled mid-stream
    cancelled = False

    # ERR-06: track whether a terminal result chunk was received
    saw_result = False

    try:
        raw_events = parse_ndjson(spawn_result.process.stdout)  # type: ignore[arg-type]
        chunks_iter = dispatch(raw_events)

        async for chunk in chunks_iter:
            # Capture model from init event (MDL-04)
            if chunk.get("type") == "system" and chunk.get("subtype") == "init":  # type: ignore[union-attr]
                actual_model = chunk.get("model")  # type: ignore[union-attr]

            # Enrich ResultChunk with model mismatch (MDL-04) and session mismatch (Phase 7)
            if chunk.get("type") == "result":  # type: ignore[union-attr]
                saw_result = True
                base = chunk  # type: ignore[assignment]
                model_mismatch = bool(
                    requested_model and actual_model and requested_model != actual_model
                )
                requested_session_id: Optional[str] = None
                actual_session_id: Optional[str] = None
                if session is not None:
                    requested_session_id = normalise_session_id(session)
                    actual_session_id = base.get("sessionId")  # type: ignore[union-attr]
                    if requested_session_id == actual_session_id:
                        requested_session_id = None
                        actual_session_id = None
                if model_mismatch or (requested_session_id is not None and actual_session_id is not None):
                    enriched: ResultChunk = {**base}  # type: ignore[misc]
                    if model_mismatch:
                        enriched["requestedModel"] = requested_model
                        enriched["actualModel"] = actual_model
                    if requested_session_id is not None and actual_session_id is not None:
                        enriched["requestedSessionId"] = requested_session_id
                        enriched["actualSessionId"] = actual_session_id
                    # Result chunk ends the stream, clear pending
                    pending_tool_chunks.clear()
                    yield enriched  # type: ignore[misc]
                    # Check cancel after yield (outer consumer may have set it)
                    if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
                        cancelled = True
                        break
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

            # Check cancellation AFTER yielding — the outer consumer may have set the flag
            # while processing this chunk before asking for the next one
            if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
                cancelled = True
                break

        # After loop: also check cancel in case stream ended right after cancel was set
        if not cancelled and cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
            cancelled = True

        if cancelled:
            # Abort flush: yield pending tool_use chunks with incomplete=True (Phase 3 contract)
            for pending in pending_tool_chunks:
                yield {**pending, "incomplete": True}  # type: ignore[misc]
            raise AbortError()

        # ERR-06 (SC-2): stream ended without a terminal result chunk AND not cancelled.
        # Per ROADMAP Phase 5 SC-2, ProcessError must be raised regardless of exit code
        # (including exit 0) when no terminal result event was seen. ErrorMapper.from_exit
        # classifies the resulting exit + stderr tail into the correct typed subclass
        # (ProcessError for the generic no-result case; more specific subclasses when
        # stderr patterns match, e.g. AuthError / RateLimitError).
        if not saw_result and not cancelled:
            exit_code = spawn_result.process.returncode
            code = exit_code if exit_code is not None else 0
            tail = spawn_result.get_stderr_tail()
            raise ErrorMapper.from_exit(exit_code=code, stderr=tail)

    except GeminiError:
        raise  # already typed from dispatch or ErrorMapper.from_exit
    except AbortError:
        raise
    except Exception:
        # Unexpected error during iteration — treat as exit-code path
        exit_code = spawn_result.process.returncode
        code = exit_code if exit_code is not None else 1
        tail = spawn_result.get_stderr_tail()
        raise ErrorMapper.from_exit(exit_code=code, stderr=tail) from None

    finally:
        # Cleanup: kill subprocess, remove temp file
        if spawn_result.pid is not None:
            try:
                await kill_tree(spawn_result.pid)
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
    # Phase 7 (SES-01 Layer 1 guard): reject empty/whitespace session ids BEFORE spawn.
    _raw_session = options.get("session")
    if _raw_session is not None:
        _raw_sid = normalise_session_id(_raw_session)
        if not _raw_sid or not _raw_sid.strip():
            raise InvalidPromptError("session id is empty")

    # Pre-cancel check
    cancel_scope = options.get("cancel_scope")
    if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
        raise AbortError()

    # Phase 6 (AUT-06): resolve auth mode and emit precedence warning if multiple configured.
    # Snapshot os.environ — resolve_auth is pure and does not re-read env at spawn time.
    resolved = resolve_auth(dict(os.environ))
    for w in resolved["warnings"]:
        _warnings.warn(w, UserWarning, stacklevel=2)

    temp_path = await _write_temp_system_prompt(options.get("system_prompt"))

    env_overrides: dict[str, str] = {
        **resolved["env_overrides"],
        **(options.get("env") or {}),
    }
    if temp_path:
        env_overrides["GEMINI_SYSTEM_MD"] = temp_path

    argv = build_argv(options)
    manager = ProcessManager()
    spawn_result = await manager.spawn(
        argv=argv,
        cli_path=options.get("cli_path"),
        env=env_overrides,
        cwd=options.get("cwd"),
    )

    cancelled = False

    try:
        raw_events = parse_ndjson(spawn_result.process.stdout)  # type: ignore[arg-type]

        async for event in raw_events:
            if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
                cancelled = True
                break
            yield event

        if cancelled:
            raise AbortError()

    finally:
        if spawn_result.pid is not None:
            try:
                await kill_tree(spawn_result.pid)
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
    """Run a full query and accumulate all MessageChunks into a QueryResult."""
    import datetime

    chunks: list[MessageChunk] = []
    text = ""
    session_id = ""
    stop_reason = ""
    init_session_id = ""
    init_model = ""

    async for chunk in query(options):
        chunks.append(chunk)
        if chunk.get("type") == "assistant":  # type: ignore[union-attr]
            text += chunk.get("content", "")  # type: ignore[union-attr]
        if chunk.get("type") == "system" and chunk.get("subtype") == "init":  # type: ignore[union-attr]
            init_session_id = chunk.get("sessionId", "") or ""  # type: ignore[union-attr]
            init_model = chunk.get("model", "") or ""  # type: ignore[union-attr]
        if chunk.get("type") == "result":  # type: ignore[union-attr]
            session_id = chunk.get("sessionId", "") or ""  # type: ignore[union-attr]
            stop_reason = chunk.get("stopReason", "") or ""  # type: ignore[union-attr]

    session_obj = Session(
        id=init_session_id or session_id,
        model=init_model,
        created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    )

    return {
        "text": text,
        "session_id": session_id,
        "stop_reason": stop_reason,
        "chunks": chunks,
        "session": session_obj,
    }
