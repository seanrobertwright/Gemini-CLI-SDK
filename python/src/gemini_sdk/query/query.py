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
from typing import Any, AsyncIterator, Dict, Optional

import anyio
import anyio.abc

from ..auth import resolve_auth
from ..errors import ErrorMapper, GeminiError, InvalidPromptError, SchemaValidationError, UnsupportedFeatureError
from ..output.inject_schema import build_schema_injection_block
from ..output.schema_validator import validate_with_schema
from ..output.retry import build_retry_prompt
from ..parser.dispatch import dispatch
from ..parser.parse_ndjson import parse_ndjson
from ..parser.types import MessageChunk, RawEvent, ResultChunk
from ..process.process_manager import ProcessManager, kill_tree
from ..session import Session, normalise_session_id
from ..mcp import cleanup_config_dir, write_config_dir
from .build_argv import build_argv
from .types import AbortError, QueryOptions, QueryResult

# ────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ────────────────────────────────────────────────────────────────────────────


def _assert_mcp_options(options: QueryOptions) -> None:
    """Phase 9 (MCP-02, MCP-03): pre-spawn guards for MCP options.

    Raises InvalidPromptError synchronously if:
      1. env.GEMINI_CONFIG_DIR is set together with non-empty mcp_servers
         (SDK manages GEMINI_CONFIG_DIR for isolation)
      2. mcp_servers is non-empty but allowed_mcp_server_names is absent
         or empty (gemini-cli silently ignores non-whitelisted servers)
    Empty mcp_servers ({} or absent) is a no-op.
    """
    servers = options.get("mcp_servers")
    if not servers or len(servers) == 0:
        return

    # MCP-02 collision guard
    env_map = options.get("env") or {}
    if "GEMINI_CONFIG_DIR" in env_map:
        raise InvalidPromptError(
            "Cannot set env.GEMINI_CONFIG_DIR when mcpServers is provided; "
            "SDK manages this variable for isolation (MCP-02). See docs/mcp.md."
        )

    # MCP-03 required-whitelist guard
    allowed = options.get("allowed_mcp_server_names")
    if not allowed:
        raise InvalidPromptError(
            "allowedMcpServerNames is required when mcpServers is set (MCP-03). "
            "gemini-cli silently ignores servers not in this whitelist. See docs/mcp.md."
        )


async def _write_temp_system_prompt(
    system_prompt: Optional[str],
    output_schema: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Write a system prompt (+ optional schema injection block) to a temp file.

    Returns the absolute path to the temp file, or None if no prompt or schema given.
    Phase 8 (OUT-01): when output_schema is provided, appends buildSchemaInjectionBlock
    to the system prompt content (or uses only the block if no system_prompt).
    """
    if not system_prompt and output_schema is None:
        return None
    base = system_prompt or ""
    content = base
    if output_schema is not None:
        schema_block = build_schema_injection_block(output_schema)
        content = f"{base}\n\n{schema_block}" if base else schema_block
    suffix = secrets.token_hex(8)
    temp_path = os.path.join(tempfile.gettempdir(), f"gemini-sdk-system-{suffix}.md")
    await anyio.Path(temp_path).write_text(content, encoding="utf-8")
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
    # Phase 8 (OUT-01 guard): output_schema only supported on query_full().
    if options.get("output_schema") is not None:
        raise UnsupportedFeatureError(
            "output_schema requires query_full() — not supported on query()/query_raw()"
        )

    # Phase 7 (SES-01 Layer 1 guard): reject empty/whitespace session ids BEFORE spawn.
    session = options.get("session")
    if session is not None:
        _sid = normalise_session_id(session)
        if not _sid or not _sid.strip():
            raise InvalidPromptError("session id is empty")

    # Phase 9 (MCP-02, MCP-03): pre-spawn guards for MCP options.
    _assert_mcp_options(options)

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

    # Phase 9 (MCP-01, MCP-02): write isolated GEMINI_CONFIG_DIR if mcp_servers is non-empty
    mcp_config_dir: Optional[str] = None
    mcp_servers_opt = options.get("mcp_servers")
    if mcp_servers_opt and len(mcp_servers_opt) > 0:
        mcp_config_dir = await write_config_dir(mcp_servers_opt)

    # Step 3: Build env overrides
    env_overrides: dict[str, str] = {
        **resolved["env_overrides"],
        **(options.get("env") or {}),
    }
    if temp_path:
        env_overrides["GEMINI_SYSTEM_MD"] = temp_path
    if mcp_config_dir:
        env_overrides["GEMINI_CONFIG_DIR"] = mcp_config_dir

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
        # Cleanup: kill subprocess, remove temp file, remove MCP config dir
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
        if mcp_config_dir:
            try:
                await cleanup_config_dir(mcp_config_dir)
            except Exception:
                # cleanup_config_dir already warn-swallows — this except guards against bugs
                pass


# ────────────────────────────────────────────────────────────────────────────
# query_raw() — raw RawEvent stream (skips dispatch)
# ────────────────────────────────────────────────────────────────────────────


async def query_raw(options: QueryOptions) -> AsyncIterator[RawEvent]:
    """Yield a RawEvent stream from a gemini-cli subprocess.

    Skips the dispatch stage — intended for low-level introspection.
    """
    # Phase 8 (OUT-01 guard): output_schema only supported on query_full().
    if options.get("output_schema") is not None:
        raise UnsupportedFeatureError(
            "output_schema requires query_full() — not supported on query()/query_raw()"
        )

    # Phase 7 (SES-01 Layer 1 guard): reject empty/whitespace session ids BEFORE spawn.
    _raw_session = options.get("session")
    if _raw_session is not None:
        _raw_sid = normalise_session_id(_raw_session)
        if not _raw_sid or not _raw_sid.strip():
            raise InvalidPromptError("session id is empty")

    # Phase 9 (MCP-02, MCP-03): pre-spawn guards for MCP options.
    _assert_mcp_options(options)

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

    # Phase 9 (MCP-01, MCP-02): write isolated GEMINI_CONFIG_DIR if mcp_servers is non-empty
    mcp_config_dir_raw: Optional[str] = None
    mcp_servers_raw = options.get("mcp_servers")
    if mcp_servers_raw and len(mcp_servers_raw) > 0:
        mcp_config_dir_raw = await write_config_dir(mcp_servers_raw)

    env_overrides: dict[str, str] = {
        **resolved["env_overrides"],
        **(options.get("env") or {}),
    }
    if temp_path:
        env_overrides["GEMINI_SYSTEM_MD"] = temp_path
    if mcp_config_dir_raw:
        env_overrides["GEMINI_CONFIG_DIR"] = mcp_config_dir_raw

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
        if mcp_config_dir_raw:
            try:
                await cleanup_config_dir(mcp_config_dir_raw)
            except Exception:
                # cleanup_config_dir already warn-swallows — this except guards against bugs
                pass


# ────────────────────────────────────────────────────────────────────────────
# query_full() — accumulates chunks into a QueryResult
# ────────────────────────────────────────────────────────────────────────────


async def query_full(options: QueryOptions) -> QueryResult:
    """Run a full query and accumulate all MessageChunks into a QueryResult.

    Phase 8 (OUT-01/02/03): If output_schema is set, inject schema block into
    the system prompt (inline, before calling query() which has an output_schema guard),
    validate the model response, and retry once on failure. Raises SchemaValidationError
    on double failure.
    """
    # Phase 9 (MCP-02, MCP-03): pre-spawn guards — fires at queryFull top before outputSchema injection.
    _assert_mcp_options(options)

    import datetime

    # Phase 8 (OUT-01): schema injection — inline in query_full, not through query()
    # (query() has a pre-spawn guard that blocks output_schema). Strip output_schema
    # from inner options and instead inject it into systemPrompt.
    output_schema: Optional[Dict[str, Any]] = options.get("output_schema")  # type: ignore[assignment]

    if output_schema is not None:
        # Build combined system prompt: existing sysPrompt + blank line + schema block
        existing_sys = options.get("system_prompt") or ""
        schema_block = build_schema_injection_block(output_schema)
        combined_sys = f"{existing_sys}\n\n{schema_block}" if existing_sys else schema_block

        # Strip output_schema (Pitfall-4: prevent infinite recursion) and inject combined sysPrompt
        inner_options: QueryOptions = {**options, "system_prompt": combined_sys}
        inner_options.pop("output_schema", None)  # type: ignore[misc]
    else:
        inner_options = options

    chunks: list[MessageChunk] = []
    text = ""
    session_id = ""
    stop_reason = ""
    init_session_id = ""
    init_model = ""

    async for chunk in query(inner_options):
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

    # Phase 8 (OUT-01/02/03): if output_schema is unset, existing behavior preserved.
    if output_schema is None:
        return {
            "text": text,
            "session_id": session_id,
            "stop_reason": stop_reason,
            "chunks": chunks,
            "session": session_obj,
        }

    # Validate first response. If valid -> return with structured field populated.
    first_success, first_data, first_err = validate_with_schema(output_schema, text)
    if first_success:
        return {
            "text": text,
            "session_id": session_id,
            "stop_reason": stop_reason,
            "chunks": chunks,
            "session": session_obj,
            "structured": first_data,
        }

    # Invalid -> retry once. Honor cancel_scope between calls.
    cancel_scope = options.get("cancel_scope")
    if cancel_scope is not None and getattr(cancel_scope, "cancel_called", False):
        raise AbortError()

    # Build retry options: reuse session from first call, use retry prompt text.
    # Strip output_schema from retry call (Pitfall 4 prevention: avoids infinite recursion).
    retry_prompt_text = build_retry_prompt(options["prompt"], first_err, text)
    retry_options: QueryOptions = {
        **options,
        "prompt": retry_prompt_text,
        "session": session_obj,
    }
    retry_options.pop("output_schema", None)  # type: ignore[misc]

    retry_result = await query_full(retry_options)

    second_success, second_data, second_err = validate_with_schema(output_schema, retry_result["text"])
    if second_success:
        return {
            **retry_result,
            "structured": second_data,
        }

    raise SchemaValidationError(
        f"Schema validation failed after retry: {second_err}"
    )
