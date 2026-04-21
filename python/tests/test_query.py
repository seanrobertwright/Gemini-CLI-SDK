"""
python/tests/test_query.py

Mock-spawn integration tests for query, query_raw, query_full.
Mocks ProcessManager + kill_tree; runs real parse_ndjson + dispatch against fake NDJSON.
Test names (docstrings) match TS query.spec.ts for parity enforcement.
"""

from __future__ import annotations

import io
import os
import warnings
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import anyio
import pytest

from gemini_sdk.query import AbortError, query, query_full, query_raw
from gemini_sdk.errors import InvalidPromptError, ProcessError
from gemini_sdk.parser.types import MessageChunk, RawEvent
from gemini_sdk.process.process_manager import SpawnResult
from gemini_sdk.session import Session

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


def _make_mock_proc(lines: list[str]) -> SpawnResult:
    """Return a mock SpawnResult with a controllable stdout.

    Phase 5: ProcessManager.spawn() returns SpawnResult, not raw anyio Process.
    """
    proc = MagicMock()
    proc.pid = 12345
    proc.returncode = 0
    proc.stdout = _MockStdout(lines)
    return SpawnResult(process=proc, pid=12345, get_stderr_tail=lambda: "")


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

        raw_proc = MagicMock()
        raw_proc.pid = 12345
        raw_proc.returncode = 0
        raw_proc.stdout = _ControllableStdout()
        proc = SpawnResult(process=raw_proc, pid=12345, get_stderr_tail=lambda: "")

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

        raw_proc2 = MagicMock()
        raw_proc2.pid = 12345
        raw_proc2.returncode = 0
        raw_proc2.stdout = _SlowStdout(cancel_scope)
        proc = SpawnResult(process=raw_proc2, pid=12345, get_stderr_tail=lambda: "")

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
        # dispatch yields tool_use with incomplete:True when stream ends without tool_result.
        # After SC-2 / ERR-06 fix: streams ending without a terminal result event also raise
        # ProcessError (even on exit 0). The incomplete tool chunk is yielded BEFORE the raise.
        TOOL_USE_LINE = (
            '{"type":"tool_use","timestamp":"t","tool_name":"read_file",'
            '"tool_id":"tool_001","parameters":{"path":"src/index.ts"}}'
        )
        # Stream: init + tool_use (no tool_result) — stream closes without pairing.
        # dispatch flushes the pending tool_use with incomplete:True at stream end (PRS-07).
        # Then ERR-06 fires because not saw_result and not cancelled.
        proc = _make_mock_proc([INIT_LINE, TOOL_USE_LINE])

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks_collected = []
            caught = None
            try:
                async for chunk in query({"prompt": "x"}):
                    chunks_collected.append(chunk)
            except ProcessError as e:
                caught = e

        # dispatch flushes incomplete tool chunks at stream end (PRS-07)
        incomplete_chunk = next(
            (c for c in chunks_collected if c.get("type") == "tool" and c.get("incomplete") is True),
            None,
        )
        assert incomplete_chunk is not None
        assert incomplete_chunk.get("toolId") == "tool_001"

        # ERR-06 / SC-2: ProcessError raised after incomplete flush (stream had no result event)
        assert isinstance(caught, ProcessError)

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

        raw_proc3 = MagicMock()
        raw_proc3.pid = 12345
        raw_proc3.returncode = 0
        raw_proc3.stdout = _ControlledStdout()
        proc = SpawnResult(process=raw_proc3, pid=12345, get_stderr_tail=lambda: "")

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

    @pytest.mark.anyio
    async def test_run_throws_process_error_when_stream_ends_without_result_on_exit_zero(self):
        """throws ProcessError when stream ends without result on exit 0"""
        # ERR-06 / SC-2: even exit code 0 must raise ProcessError when no result event was seen.
        # Mock: stream emits one non-result chunk then EOF; process returncode is 0.
        # Consume generator; expect ProcessError.
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO])
        proc.process.returncode = 0  # explicit exit 0

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            with pytest.raises(ProcessError):
                await _collect_chunks(query({"prompt": "x"}))

    @pytest.mark.anyio
    async def test_run_throws_process_error_when_stream_ends_without_result_on_non_zero_exit(self):
        """throws ProcessError when stream ends without result on non-zero exit"""
        # ERR-06: locks the non-zero-exit branch in place after guard removal.
        # Mock: stream emits one non-result chunk then EOF; process returncode is 1.
        # Consume generator; expect ProcessError.
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO])
        proc.process.returncode = 1  # non-zero exit

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            with pytest.raises(ProcessError):
                await _collect_chunks(query({"prompt": "x"}))


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


# ── Phase 6 auth warning tests (AUT-06) ──────────────────────────────────────


class TestPhase6AuthWarning:
    @pytest.mark.anyio
    async def test_run_emits_single_warning_multi_mode(self, monkeypatch):
        """emits single console.warn with full precedence chain when multiple modes configured"""
        monkeypatch.setenv("GEMINI_API_KEY", "k")
        monkeypatch.setenv("GOOGLE_API_KEY", "g")
        monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)

        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                # Drain the generator so query() fully executes
                async for _ in query({"prompt": "x"}):
                    pass

        assert len(caught) == 1
        assert "GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC" in str(
            caught[0].message
        )

    @pytest.mark.anyio
    async def test_run_emits_no_warnings_single_mode(self, monkeypatch):
        """emits no warnings when only one auth mode configured"""
        monkeypatch.setenv("GEMINI_API_KEY", "k")
        monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
        monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)

        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                async for _ in query({"prompt": "x"}):
                    pass

        assert len(caught) == 0


# ── Phase 7 session guard (SES-01) ───────────────────────────────────────────


class TestPhase7SessionGuard:
    @pytest.mark.anyio
    async def test_run_empty_string_session_id_throws(self):
        """query with empty-string session id throws InvalidPromptError before spawning"""
        with patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls:
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock()
            mock_pm_cls.return_value = mock_pm

            with pytest.raises(InvalidPromptError):
                async for _ in query({"prompt": "x", "session": ""}):
                    pass
            mock_pm_cls.assert_not_called()

    @pytest.mark.anyio
    async def test_run_whitespace_session_id_throws(self):
        """query with whitespace-only session id throws InvalidPromptError before spawning"""
        with patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls:
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock()
            mock_pm_cls.return_value = mock_pm

            with pytest.raises(InvalidPromptError):
                async for _ in query({"prompt": "x", "session": "   "}):
                    pass
            mock_pm_cls.assert_not_called()

    @pytest.mark.anyio
    async def test_run_empty_session_id_in_session_object_throws(self):
        """query with empty Session.id throws InvalidPromptError before spawning"""
        with patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls:
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock()
            mock_pm_cls.return_value = mock_pm

            with pytest.raises(InvalidPromptError):
                s = Session(id="", model="", created_at="")
                async for _ in query({"prompt": "x", "session": s}):
                    pass
            mock_pm_cls.assert_not_called()

    @pytest.mark.anyio
    async def test_run_valid_session_id_proceeds(self):
        """query with valid session id proceeds to spawn"""
        valid_lines = [
            '{"type":"init","timestamp":"t","session_id":"valid-id","model":"m"}',
            '{"type":"result","timestamp":"t","status":"success","stats":{}}',
        ]
        proc = _make_mock_proc(valid_lines)
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(query({"prompt": "x", "session": "valid-id"}))

        assert mock_pm_cls.call_count == 1
        assert len(chunks) >= 1


# ── Phase 7 session mismatch detection (SES Layer 2) ─────────────────────────


class TestPhase7SessionMismatchDetection:
    @pytest.mark.anyio
    async def test_run_resultchunk_gains_mismatch_fields(self):
        """ResultChunk gains requestedSessionId and actualSessionId when init session_id differs from --resume id"""
        mismatch_lines = [
            '{"type":"init","timestamp":"t","session_id":"actual-s","model":"auto-gemini-3"}',
            '{"type":"result","timestamp":"t","status":"success","stats":{}}',
        ]
        proc = _make_mock_proc(mismatch_lines)
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(query({"prompt": "x", "session": "requested-s"}))

        result_chunk = next((c for c in chunks if c.get("type") == "result"), None)
        assert result_chunk is not None
        assert result_chunk.get("requestedSessionId") == "requested-s"
        assert result_chunk.get("actualSessionId") == "actual-s"

    @pytest.mark.anyio
    async def test_run_resultchunk_omits_fields_on_match(self):
        """ResultChunk omits session mismatch fields when init session_id matches --resume id"""
        match_lines = [
            '{"type":"init","timestamp":"t","session_id":"same-s","model":"auto-gemini-3"}',
            '{"type":"result","timestamp":"t","status":"success","stats":{}}',
        ]
        proc = _make_mock_proc(match_lines)
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(query({"prompt": "x", "session": "same-s"}))

        result_chunk = next((c for c in chunks if c.get("type") == "result"), None)
        assert result_chunk is not None
        assert result_chunk.get("requestedSessionId") is None
        assert result_chunk.get("actualSessionId") is None

    @pytest.mark.anyio
    async def test_run_resultchunk_omits_fields_when_no_session(self):
        """ResultChunk omits session mismatch fields when no session option passed"""
        lines = [
            '{"type":"init","timestamp":"t","session_id":"fresh-s","model":"auto-gemini-3"}',
            '{"type":"result","timestamp":"t","status":"success","stats":{}}',
        ]
        proc = _make_mock_proc(lines)
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            chunks = await _collect_chunks(query({"prompt": "x"}))

        result_chunk = next((c for c in chunks if c.get("type") == "result"), None)
        assert result_chunk is not None
        assert result_chunk.get("requestedSessionId") is None
        assert result_chunk.get("actualSessionId") is None


# ── Phase 7 queryFull Session construction (SES-01 + SES-03) ─────────────────


class TestPhase7QueryFullSessionConstruction:
    @pytest.mark.anyio
    async def test_run_queryfull_returns_session_populated_from_init(self):
        """queryFull returns QueryResult with session field populated from init event"""
        lines = [
            '{"type":"init","timestamp":"t","session_id":"init-s","model":"auto-gemini-3"}',
            '{"type":"message","timestamp":"t","role":"assistant","content":"hi"}',
            '{"type":"result","timestamp":"t","status":"success","stats":{}}',
        ]
        proc = _make_mock_proc(lines)
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            result = await query_full({"prompt": "x"})

        assert result["session"].id == "init-s"
        assert result["session"].model == "auto-gemini-3"
        assert isinstance(result["session"].created_at, str)
        assert len(result["session"].created_at) > 0

    @pytest.mark.anyio
    async def test_run_queryfull_preserves_legacy_session_id(self):
        """queryFull preserves legacy sessionId equal to session.id"""
        lines = [
            '{"type":"init","timestamp":"t","session_id":"init-s","model":"m"}',
            '{"type":"result","timestamp":"t","status":"success","stats":{}}',
        ]
        proc = _make_mock_proc(lines)
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            result = await query_full({"prompt": "x"})

        assert result["session_id"] == result["session"].id


# ── Phase 7 multi-turn integration (SES-01 + SES-02) ─────────────────────────


class TestPhase7MultiTurnIntegration:
    @pytest.mark.anyio
    async def test_run_multi_turn_resumes_context(self, tmp_path):
        """multi-turn fixture integration: turn 2 references turn 1 context via 47"""
        import pathlib
        repo_root = pathlib.Path(__file__).resolve().parents[2]
        turn1_ndjson = (repo_root / "spec/fixtures/resume-session-turn1.ndjson").read_text(encoding="utf-8")
        turn2_ndjson = (repo_root / "spec/fixtures/resume-session-turn2.ndjson").read_text(encoding="utf-8")
        turn1_lines = turn1_ndjson.strip().splitlines()
        turn2_lines = turn2_ndjson.strip().splitlines()

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm_cls.return_value = mock_pm

            # First call: turn 1 — captures sessionId
            proc1 = _make_mock_proc(turn1_lines)
            mock_pm.spawn = AsyncMock(return_value=proc1)
            result1 = await query_full({"prompt": "My favorite number is 47. Remember it exactly."})
            assert result1["session"].id or result1["session_id"]

            # Second call: turn 2 — passes session from turn 1
            proc2 = _make_mock_proc(turn2_lines)
            mock_pm.spawn = AsyncMock(return_value=proc2)
            result2 = await query_full({
                "prompt": "What number did I just say?",
                "session": result1["session"],
            })

        # Assertion: turn 2's assistant text contains the number 47 (context recalled)
        assert "47" in result2["text"]


# ── Phase 8: output_schema pre-spawn guard on query() / queryRaw() ────────────


def _make_ndjson_lines(session_id: str, assistant_text: str) -> list[str]:
    """Helper: create NDJSON lines that produce a given assistant text body."""
    import json as _json
    return [
        f'{{"type":"init","timestamp":"t","session_id":"{session_id}","model":"auto-gemini-3"}}',
        f'{{"type":"message","timestamp":"t","role":"assistant","content":{_json.dumps(assistant_text)}}}',
        '{"type":"result","timestamp":"t","status":"success","stats":{}}',
    ]


class TestQueryOutputSchemaGuardPhase8:
    @pytest.mark.anyio
    async def test_raises_unsupported_feature_when_output_schema_set_on_query(self):
        """throws UnsupportedFeatureError when outputSchema is set on query()"""
        from gemini_sdk.errors import UnsupportedFeatureError
        with pytest.raises(UnsupportedFeatureError):
            async for _ in query({"prompt": "x", "output_schema": {"type": "object"}}):
                pass

    @pytest.mark.anyio
    async def test_unsupported_feature_error_message_mentions_query_full(self):
        """UnsupportedFeatureError message mentions queryFull"""
        from gemini_sdk.errors import UnsupportedFeatureError
        with pytest.raises(UnsupportedFeatureError, match=r"query_full"):
            async for _ in query({"prompt": "x", "output_schema": {"type": "object"}}):
                pass

    @pytest.mark.anyio
    async def test_raises_unsupported_feature_when_output_schema_set_on_query_raw(self):
        """throws UnsupportedFeatureError when outputSchema is set on queryRaw()"""
        from gemini_sdk.errors import UnsupportedFeatureError
        with pytest.raises(UnsupportedFeatureError):
            async for _ in query_raw({"prompt": "x", "output_schema": {"type": "object"}}):
                pass

    @pytest.mark.anyio
    async def test_guard_fires_pre_spawn_no_spawn_for_query(self):
        """guard fires pre-spawn (ProcessManager.spawn never called for query)"""
        from gemini_sdk.errors import UnsupportedFeatureError
        with patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls:
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock()
            mock_pm_cls.return_value = mock_pm

            caught = None
            try:
                async for _ in query({"prompt": "x", "output_schema": {"type": "object"}}):
                    pass
            except UnsupportedFeatureError as e:
                caught = e

        assert isinstance(caught, UnsupportedFeatureError)
        mock_pm.spawn.assert_not_called()

    @pytest.mark.anyio
    async def test_guard_fires_pre_spawn_no_spawn_for_query_raw(self):
        """guard fires pre-spawn (ProcessManager.spawn never called for queryRaw)"""
        from gemini_sdk.errors import UnsupportedFeatureError
        with patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls:
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock()
            mock_pm_cls.return_value = mock_pm

            caught = None
            try:
                async for _ in query_raw({"prompt": "x", "output_schema": {"type": "object"}}):
                    pass
            except UnsupportedFeatureError as e:
                caught = e

        assert isinstance(caught, UnsupportedFeatureError)
        mock_pm.spawn.assert_not_called()


# ── Phase 8: query_full() output_schema happy path + retry ────────────────────


class TestQueryFullOutputSchemaPhase8:
    _schema = {
        "type": "object",
        "properties": {"x": {"type": "string"}},
        "required": ["x"],
    }

    @pytest.mark.anyio
    async def test_no_output_schema_structured_is_undefined_in_result(self):
        """no outputSchema -> structured is undefined in result"""
        proc = _make_mock_proc(_make_ndjson_lines("s1", "hello"))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm
            result = await query_full({"prompt": "x"})

        assert result.get("structured") is None
        assert mock_pm.spawn.call_count == 1

    @pytest.mark.anyio
    async def test_happy_path_valid_output_on_first_try_populates_structured(self):
        """happy path: valid output on first try populates structured"""
        proc = _make_mock_proc(_make_ndjson_lines("s1", '{"x":"hello"}'))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm
            result = await query_full({"prompt": "give me x", "output_schema": self._schema})

        assert result["structured"] == {"x": "hello"}
        assert result["text"] == '{"x":"hello"}'
        # Only one spawn — no retry needed
        assert mock_pm.spawn.call_count == 1

    @pytest.mark.anyio
    async def test_happy_path_structured_field_typed_as_unknown_not_undefined(self):
        """happy path: structured field typed as unknown (not undefined)"""
        proc = _make_mock_proc(_make_ndjson_lines("s1", '{"x":"hello"}'))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm
            result = await query_full({"prompt": "give me x", "output_schema": self._schema})

        assert result.get("structured") is not None

    @pytest.mark.anyio
    async def test_retry_path_invalid_first_valid_second_populates_structured(self):
        """retry path: invalid first -> valid second populates structured from retry result"""
        proc1 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":123}'))
        proc2 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":"hi"}'))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(side_effect=[proc1, proc2])
            mock_pm_cls.return_value = mock_pm
            result = await query_full({"prompt": "give me x", "output_schema": self._schema})

        assert result["structured"] == {"x": "hi"}
        # Two spawns: first (invalid) + second (retry)
        assert mock_pm.spawn.call_count == 2

    @pytest.mark.anyio
    async def test_retry_path_second_call_prompt_contains_original_prompt_text(self):
        """retry path: second call prompt contains original prompt text"""
        proc1 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":123}'))
        proc2 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":"hi"}'))
        spawn_argv_calls = []

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()

            async def _spawn_capturing(**kwargs):
                spawn_argv_calls.append(kwargs.get("argv", []))
                call_count = len(spawn_argv_calls)
                return proc1 if call_count == 1 else proc2

            mock_pm.spawn = _spawn_capturing
            mock_pm_cls.return_value = mock_pm
            await query_full({"prompt": "Tell me a joke", "output_schema": self._schema})

        assert len(spawn_argv_calls) == 2
        # Second call's argv should contain the retry prompt (which embeds original)
        second_argv = " ".join(spawn_argv_calls[1])
        assert "Tell me a joke" in second_argv

    @pytest.mark.anyio
    async def test_retry_path_second_call_options_had_output_schema_undefined(self):
        """retry path: second call options had outputSchema: undefined (Pitfall-4 prevention)"""
        proc1 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":123}'))
        proc2 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":"hi"}'))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(side_effect=[proc1, proc2])
            mock_pm_cls.return_value = mock_pm
            await query_full({"prompt": "x", "output_schema": self._schema})

        # Two spawns means retry happened (output_schema was stripped from retry call)
        assert mock_pm.spawn.call_count == 2

    @pytest.mark.anyio
    async def test_double_failure_throws_schema_validation_error(self):
        """double-failure throws SchemaValidationError"""
        from gemini_sdk.errors import SchemaValidationError
        proc1 = _make_mock_proc(_make_ndjson_lines("s1", "not valid json at all"))
        proc2 = _make_mock_proc(_make_ndjson_lines("s1", "still not valid"))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(side_effect=[proc1, proc2])
            mock_pm_cls.return_value = mock_pm
            with pytest.raises(SchemaValidationError):
                await query_full({"prompt": "give me x", "output_schema": self._schema})

        assert mock_pm.spawn.call_count == 2

    @pytest.mark.anyio
    async def test_double_failure_error_message_begins_with_schema_validation_failed(self):
        """double-failure error message begins with Schema validation failed after retry:"""
        from gemini_sdk.errors import SchemaValidationError
        proc1 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":123}'))
        proc2 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":456}'))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(side_effect=[proc1, proc2])
            mock_pm_cls.return_value = mock_pm
            with pytest.raises(SchemaValidationError, match=r"Schema validation failed after retry:"):
                await query_full({"prompt": "x", "output_schema": self._schema})

    @pytest.mark.anyio
    async def test_abort_between_first_and_retry_throws_abort_error(self):
        """abort between first and retry throws AbortError (pre-aborted signal)"""
        # Pre-abort the cancel_scope before the query_full call; the inner query_full
        # (retry call) sees cancel_called=True after first validation fails and raises AbortError.
        proc1 = _make_mock_proc(_make_ndjson_lines("s1", '{"x":123}'))
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc1)
            mock_pm_cls.return_value = mock_pm

            cancel_scope = MagicMock()
            cancel_scope.cancel_called = True  # pre-aborted

            with pytest.raises(AbortError):
                await query_full({"prompt": "x", "output_schema": self._schema, "cancel_scope": cancel_scope})


# ── Phase 8: query_full() output_schema -> systemPrompt injection ─────────────


class TestQueryFullOutputSchemaSystemPromptInjectionPhase8:
    @pytest.mark.anyio
    async def test_with_output_schema_and_no_system_prompt_write_file_receives_schema_block(self):
        """with outputSchema set and no systemPrompt: writeFile receives schema block"""
        from gemini_sdk.output import build_schema_injection_block
        schema = {"type": "object"}
        proc = _make_mock_proc(_make_ndjson_lines("s1", '{}'))
        write_contents = []

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
            patch("gemini_sdk.query.query.anyio") as mock_anyio,
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            mock_path_instance = MagicMock()

            async def _write_text(content, encoding="utf-8"):
                write_contents.append(content)

            mock_path_instance.write_text = _write_text
            mock_path_instance.unlink = AsyncMock(return_value=None)
            mock_anyio.Path.return_value = mock_path_instance

            await query_full({"prompt": "x", "output_schema": schema})

        assert len(write_contents) == 1
        assert write_contents[0] == build_schema_injection_block(schema)
        assert "## Required Output Format" in write_contents[0]

    @pytest.mark.anyio
    async def test_with_output_schema_and_system_prompt_write_file_receives_combined(self):
        """with outputSchema + systemPrompt: writeFile receives sysPrompt + blank line + schema block"""
        from gemini_sdk.output import build_schema_injection_block
        schema = {"type": "object"}
        sys = "be concise"
        proc = _make_mock_proc(_make_ndjson_lines("s1", '{}'))
        write_contents = []

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
            patch("gemini_sdk.query.query.anyio") as mock_anyio,
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            mock_path_instance = MagicMock()

            async def _write_text(content, encoding="utf-8"):
                write_contents.append(content)

            mock_path_instance.write_text = _write_text
            mock_path_instance.unlink = AsyncMock(return_value=None)
            mock_anyio.Path.return_value = mock_path_instance

            await query_full({"prompt": "x", "system_prompt": sys, "output_schema": schema})

        assert len(write_contents) == 1
        expected = f"{sys}\n\n{build_schema_injection_block(schema)}"
        assert write_contents[0] == expected
        assert "be concise\n\n## Required Output Format" in write_contents[0]

    @pytest.mark.anyio
    async def test_without_output_schema_write_file_not_called(self):
        """without outputSchema: writeFile not called (no temp file)"""
        proc = _make_mock_proc(_make_ndjson_lines("s1", "hello"))
        write_count = []

        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
            patch("gemini_sdk.query.query.anyio") as mock_anyio,
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            mock_path_instance = MagicMock()

            async def _write_text(content, encoding="utf-8"):
                write_count.append(content)

            mock_path_instance.write_text = _write_text
            mock_path_instance.unlink = AsyncMock(return_value=None)
            mock_anyio.Path.return_value = mock_path_instance

            await query_full({"prompt": "x"})

        assert len(write_count) == 0

    def test_build_schema_injection_block_output_contains_required_output_format(self):
        """buildSchemaInjectionBlock output contains Required Output Format"""
        from gemini_sdk.output import build_schema_injection_block
        schema = {"type": "object"}
        assert "Required Output Format" in build_schema_injection_block(schema)


# ── Phase 9: MCP passthrough guards (MCP-02, MCP-03) ─────────────────────────


class TestPhase9McpPassthroughGuards:
    @pytest.mark.anyio
    async def test_throws_invalidprompterror_when_env_gemini_config_dir_is_set_with_non_empty_mcpservers(self):
        """throws InvalidPromptError when env.GEMINI_CONFIG_DIR is set with non-empty mcpServers"""
        with pytest.raises(InvalidPromptError) as exc_info:
            async for _ in query({
                "prompt": "x",
                "mcp_servers": {"s": {"command": "x"}},
                "allowed_mcp_server_names": ["s"],
                "env": {"GEMINI_CONFIG_DIR": "/fake"},
            }):
                pass
        assert "GEMINI_CONFIG_DIR" in str(exc_info.value) or "MCP-02" in str(exc_info.value)

    @pytest.mark.anyio
    async def test_throws_invalidprompterror_when_mcpservers_is_non_empty_but_allowedmcpservernames_is_undefined(self):
        """throws InvalidPromptError when mcpServers is non-empty but allowedMcpServerNames is undefined"""
        with pytest.raises(InvalidPromptError):
            async for _ in query({"prompt": "x", "mcp_servers": {"s": {"command": "x"}}}):
                pass

    @pytest.mark.anyio
    async def test_throws_invalidprompterror_when_mcpservers_is_non_empty_but_allowedmcpservernames_is_empty_array(self):
        """throws InvalidPromptError when mcpServers is non-empty but allowedMcpServerNames is empty array"""
        with pytest.raises(InvalidPromptError):
            async for _ in query({"prompt": "x", "mcp_servers": {"s": {"command": "x"}}, "allowed_mcp_server_names": []}):
                pass

    @pytest.mark.anyio
    async def test_does_not_throw_when_mcpservers_is_an_empty_object_no_op_path(self):
        """does not throw when mcpServers is an empty object (no-op path)"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            threw = False
            try:
                async for _ in query({"prompt": "x", "mcp_servers": {}, "env": {"GEMINI_CONFIG_DIR": "/fake"}}):
                    pass
            except InvalidPromptError:
                threw = True

        assert threw is False

    @pytest.mark.anyio
    async def test_does_not_guard_env_gemini_config_dir_when_mcpservers_is_absent(self):
        """does not guard env.GEMINI_CONFIG_DIR when mcpServers is absent"""
        proc = _make_mock_proc([INIT_LINE, MSG_HELLO, RESULT_SUCCESS])
        with (
            patch("gemini_sdk.query.query.ProcessManager") as mock_pm_cls,
            patch("gemini_sdk.query.query.kill_tree", new_callable=AsyncMock),
        ):
            mock_pm = MagicMock()
            mock_pm.spawn = AsyncMock(return_value=proc)
            mock_pm_cls.return_value = mock_pm

            threw = False
            try:
                async for _ in query({"prompt": "x", "env": {"GEMINI_CONFIG_DIR": "/ok"}}):
                    pass
            except InvalidPromptError:
                threw = True

        assert threw is False

    @pytest.mark.anyio
    async def test_queryfull_throws_invalidprompterror_from_the_top_before_outputschema_injection(self):
        """queryFull throws InvalidPromptError from the top, before outputSchema injection"""
        with pytest.raises(InvalidPromptError):
            await query_full({
                "prompt": "x",
                "output_schema": {"type": "object"},
                "mcp_servers": {"s": {"command": "x"}},
                # allowed_mcp_server_names intentionally missing — triggers MCP-03 guard
            })
