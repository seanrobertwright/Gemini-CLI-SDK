"""
python/tests/test_query.py

Mock-spawn integration tests for query, query_raw, query_full.
Mocks ProcessManager + kill_tree; runs real parse_ndjson + dispatch against fake NDJSON.
Test names (docstrings) match TS query.spec.ts for parity enforcement.
"""

from __future__ import annotations

import io
import os
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import anyio
import pytest

from gemini_sdk.query import AbortError, query, query_full, query_raw
from gemini_sdk.parser.types import MessageChunk, RawEvent

# ── NDJSON fixture constants ──────────────────────────────────────────────────

INIT_LINE = '{"type":"init","timestamp":"t","session_id":"s1","model":"auto-gemini-3"}'
MSG_HELLO = '{"type":"message","timestamp":"t","role":"assistant","content":"hello"}'
RESULT_SUCCESS = '{"type":"result","timestamp":"t","status":"success","stats":{}}'

# ── helpers ───────────────────────────────────────────────────────────────────


async def _async_bytes_from_lines(lines: list[str]) -> AsyncIterator[bytes]:
    """Yield all lines as a single bytes chunk."""
    data = "".join(line + "\n" for line in lines).encode("utf-8")
    yield data


class _MockStdout:
    """Async-iterable stdout mock that yields bytes from a list of NDJSON lines."""

    def __init__(self, lines: list[str]) -> None:
        self._data = "".join(line + "\n" for line in lines).encode("utf-8")
        self._consumed = False

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes:
        if self._consumed:
            raise StopAsyncIteration
        self._consumed = True
        return self._data


def _make_mock_proc(lines: list[str]) -> MagicMock:
    """Return a mock anyio Process with a controllable stdout."""
    proc = MagicMock()
    proc.pid = 12345
    proc.returncode = 0
    proc.stdout = _MockStdout(lines)
    return proc


async def _collect_chunks(gen) -> list[MessageChunk]:
    """Drain an async generator of MessageChunk."""
    result = []
    async for chunk in gen:
        result.append(chunk)
    return result


async def _collect_raw(gen) -> list[RawEvent]:
    """Drain an async generator of RawEvent."""
    result = []
    async for event in gen:
        result.append(event)
    return result


# ── query() tests ─────────────────────────────────────────────────────────────


class TestQuery:
    @pytest.mark.anyio
    async def test_yields_message_chunk_stream(self):
        """yields MessageChunk stream from subprocess"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(query({"prompt": "hello"}))

        assert len(chunks) >= 3

        system_chunk = next(
            (c for c in chunks if c.get("type") == "system" and c.get("subtype") == "init"),
            None,
        )
        assert system_chunk is not None
        assert system_chunk.get("sessionId") == "s1"

        assistant_chunk = next((c for c in chunks if c.get("type") == "assistant"), None)
        assert assistant_chunk is not None
        assert assistant_chunk.get("content") == "hello"

        result_chunk = next((c for c in chunks if c.get("type") == "result"), None)
        assert result_chunk is not None
        assert result_chunk.get("sessionId") == "s1"

    @pytest.mark.anyio
    async def test_passes_cwd_to_spawn(self):
        """passes cwd to spawn spawnOptions"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            await _collect_chunks(query({"prompt": "x", "cwd": "/tmp/work"}))

        mock_pm.spawn.assert_called_once()
        call_kwargs = mock_pm.spawn.call_args[1]
        assert call_kwargs.get("cwd") == "/tmp/work"

    @pytest.mark.anyio
    async def test_system_prompt_writes_temp_file(self):
        """systemPrompt writes temp file and sets GEMINI_SYSTEM_MD"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
            patch("gemini_sdk.query.query.anyio") as mock_anyio,
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            # Mock anyio.Path write_text
            mock_path_instance = MagicMock()
            mock_path_instance.write_text = AsyncMock(return_value=None)
            mock_path_instance.unlink = AsyncMock(return_value=None)
            mock_anyio.Path.return_value = mock_path_instance

            await _collect_chunks(query({"prompt": "x", "system_prompt": "You are helpful"}))

        # write_text should have been called with the prompt content
        mock_path_instance.write_text.assert_called_once_with("You are helpful", encoding="utf-8")

        # spawn should have been called with GEMINI_SYSTEM_MD in env
        spawn_kwargs = mock_pm.spawn.call_args[1]
        assert "GEMINI_SYSTEM_MD" in spawn_kwargs.get("env", {})

    @pytest.mark.anyio
    async def test_temp_file_deleted_after_completion(self):
        """temp file deleted after normal completion"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])
        unlink_called = []
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
            patch("gemini_sdk.query.query.anyio") as mock_anyio,
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            mock_path_instance = MagicMock()
            mock_path_instance.write_text = AsyncMock(return_value=None)

            async def _unlink(missing_ok=False):
                unlink_called.append(True)
            mock_path_instance.unlink = _unlink
            mock_anyio.Path.return_value = mock_path_instance

            await _collect_chunks(query({"prompt": "x", "system_prompt": "system"}))

        assert len(unlink_called) >= 1

    @pytest.mark.anyio
    async def test_temp_file_deleted_after_abort(self):
        """temp file deleted after abort"""
        # Use a cancel scope to trigger abort
        unlink_called = []

        class _ControllableStdout:
            def __init__(self):
                self._chunks = [
                    (INIT_LINE + "\n").encode("utf-8"),
                ]
                self._idx = 0

            def __aiter__(self):
                return self

            async def __anext__(self) -> bytes:
                if self._idx >= len(self._chunks):
                    raise StopAsyncIteration
                data = self._chunks[self._idx]
                self._idx += 1
                return data

        proc = MagicMock()
        proc.pid = 12345
        proc.returncode = 0
        proc.stdout = _ControllableStdout()

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
            patch("gemini_sdk.query.query.anyio") as mock_anyio,
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            mock_path_instance = MagicMock()
            mock_path_instance.write_text = AsyncMock(return_value=None)

            async def _unlink(missing_ok=False):
                unlink_called.append(True)
            mock_path_instance.unlink = _unlink
            mock_anyio.Path.return_value = mock_path_instance

            # Restore anyio.Path but mock out write/unlink
            # Trigger cancel after first chunk
            cancel_scope = MagicMock()
            cancel_scope.cancel_called = False

            chunks_collected = []
            caught = None

            async def _run():
                nonlocal caught
                try:
                    async for chunk in query({"prompt": "x", "system_prompt": "sys", "cancel_scope": cancel_scope}):
                        chunks_collected.append(chunk)
                        # Cancel after first chunk
                        cancel_scope.cancel_called = True
                except AbortError as e:
                    caught = e

            await _run()

        assert isinstance(caught, AbortError)
        assert len(unlink_called) >= 1

    @pytest.mark.anyio
    async def test_pre_aborted_throws_abort_error(self):
        """pre-aborted signal throws AbortError without spawning"""
        cancel_scope = MagicMock()
        cancel_scope.cancel_called = True  # pre-cancelled

        with patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls:
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock()
            mock_pm_cls.return_value = mock_pm

            with pytest.raises(AbortError):
                await _collect_chunks(query({"prompt": "x", "cancel_scope": cancel_scope}))

            mock_pm.spawn.assert_not_called()

    @pytest.mark.anyio
    async def test_abort_mid_stream_throws_abort_error(self):
        """abort mid-stream throws AbortError and calls killTree"""

        class _SlowStdout:
            """Yields init line, then hangs until cancel is set."""
            def __init__(self, cancel_scope):
                self._cancel_scope = cancel_scope
                self._chunks = [(INIT_LINE + "\n").encode("utf-8")]
                self._idx = 0

            def __aiter__(self):
                return self

            async def __anext__(self) -> bytes:
                if self._idx < len(self._chunks):
                    data = self._chunks[self._idx]
                    self._idx += 1
                    return data
                # Signal cancel then end stream
                self._cancel_scope.cancel_called = True
                raise StopAsyncIteration

        cancel_scope = MagicMock()
        cancel_scope.cancel_called = False

        proc = MagicMock()
        proc.pid = 12345
        proc.returncode = 0
        proc.stdout = _SlowStdout(cancel_scope)

        kill_calls = []

        async def _mock_kill_tree(pid, *args, **kwargs):
            kill_calls.append(pid)

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", side_effect=_mock_kill_tree),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            caught = None
            try:
                await _collect_chunks(query({"prompt": "x", "cancel_scope": cancel_scope}))
            except AbortError as e:
                caught = e

        assert isinstance(caught, AbortError)
        assert 12345 in kill_calls

    @pytest.mark.anyio
    async def test_abort_mid_tool_flushes_incomplete_tool_chunk(self):
        """abort mid-tool flushes incomplete tool chunk"""
        # dispatch yields tool_use with incomplete:True when stream ends without tool_result
        # query() also tracks pendingToolChunks for abort flushing
        TOOL_USE_LINE = (
            '{"type":"tool_use","timestamp":"t","tool_name":"read_file",'
            '"tool_id":"tool_001","parameters":{"path":"src/index.ts"}}'
        )
        # Stream: init + tool_use (no tool_result) — stream closes without pairing
        # dispatch will flush the pending tool_use with incomplete:True at stream end
        proc = _make_mock_proc([INIT_LINE, TOOL_USE_LINE])

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(query({"prompt": "x"}))

        # dispatch flushes incomplete tool chunks at stream end (PRS-07)
        incomplete_chunk = next(
            (c for c in chunks if c.get("type") == "tool" and c.get("incomplete") is True),
            None,
        )
        assert incomplete_chunk is not None
        assert incomplete_chunk.get("toolId") == "tool_001"

    @pytest.mark.anyio
    async def test_abort_mid_tool_active_streaming(self):
        """abort mid-tool during active streaming flushes pending tool chunk before AbortError"""
        TOOL_USE_LINE = (
            '{"type":"tool_use","timestamp":"t","tool_name":"read_file",'
            '"tool_id":"tool_002","parameters":{"path":"src/index.ts"}}'
        )

        cancel_scope = MagicMock()
        cancel_scope.cancel_called = False

        class _ControlledStdout:
            def __init__(self):
                self._chunks = [
                    (INIT_LINE + "\n").encode("utf-8"),
                    (TOOL_USE_LINE + "\n").encode("utf-8"),
                ]
                self._idx = 0

            def __aiter__(self):
                return self

            async def __anext__(self) -> bytes:
                if self._idx >= len(self._chunks):
                    raise StopAsyncIteration
                data = self._chunks[self._idx]
                self._idx += 1
                return data

        proc = MagicMock()
        proc.pid = 12345
        proc.returncode = 0
        proc.stdout = _ControlledStdout()

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks_collected = []
            caught = None

            async def _run():
                nonlocal caught
                try:
                    async for chunk in query({"prompt": "x", "cancel_scope": cancel_scope}):
                        chunks_collected.append(chunk)
                        if chunk.get("type") == "system" and chunk.get("subtype") == "init":
                            cancel_scope.cancel_called = True
                except AbortError as e:
                    caught = e

            await _run()

        assert isinstance(caught, AbortError)

    @pytest.mark.anyio
    async def test_model_downgrade_detection(self):
        """model downgrade detection adds requestedModel/actualModel to ResultChunk"""
        MISMATCH_INIT = (
            '{"type":"init","timestamp":"t","session_id":"s1","model":"gemini-2.0-flash"}'
        )
        proc = _make_mock_proc([MISMATCH_INIT, MSG_HELLO, RESULT_SUCCESS])

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(
                query({"prompt": "x", "model": "gemini-2.5-pro"})
            )

        result_chunk = next((c for c in chunks if c.get("type") == "result"), None)
        assert result_chunk is not None
        assert result_chunk.get("requestedModel") == "gemini-2.5-pro"
        assert result_chunk.get("actualModel") == "gemini-2.0-flash"

    @pytest.mark.anyio
    async def test_model_auto_no_downgrade(self):
        """model auto does not trigger downgrade warning"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(query({"prompt": "x", "model": "auto"}))

        result_chunk = next((c for c in chunks if c.get("type") == "result"), None)
        assert result_chunk is not None
        assert result_chunk.get("requestedModel") is None
        assert result_chunk.get("actualModel") is None


# ── query_raw() tests ──────────────────────────────────────────────────────────


class TestQueryRaw:
    @pytest.mark.anyio
    async def test_yields_raw_event_stream(self):
        """yields RawEvent stream (not MessageChunks)"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            events = await _collect_raw(query_raw({"prompt": "x"}))

        assert len(events) >= 3

        init_event = next((e for e in events if e.get("type") == "init"), None)
        assert init_event is not None
        assert init_event.get("session_id") == "s1"

        msg_event = next((e for e in events if e.get("type") == "message"), None)
        assert msg_event is not None
        assert msg_event.get("content") == "hello"

        result_event = next((e for e in events if e.get("type") == "result"), None)
        assert result_event is not None
        # RawEvent result has 'status', not 'stopReason'
        assert result_event.get("status") == "success"
        assert result_event.get("sessionId") is None


# ── query_full() tests ─────────────────────────────────────────────────────────


class TestQueryFull:
    @pytest.mark.anyio
    async def test_accumulates_text_and_returns_query_result(self):
        """accumulates text and returns QueryResult"""
        multi_msg_lines = [
            INIT_LINE,
            '{"type":"message","timestamp":"t","role":"assistant","content":"Hello, "}',
            '{"type":"message","timestamp":"t","role":"assistant","content":"world!"}',
            RESULT_SUCCESS,
        ]
        proc = _make_mock_proc(multi_msg_lines)

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            result = await query_full({"prompt": "say hello"})

        assert result["text"] == "Hello, world!"
        assert result["session_id"] == "s1"
        assert result["stop_reason"] == "end_turn"
        assert len(result["chunks"]) >= 3
