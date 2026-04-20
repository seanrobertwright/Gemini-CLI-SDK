"""
python/tests/session/test_session.py

Mirror of ts/src/session/Session.spec.ts.
Test names (docstrings) match TS it() strings for parity enforcement (PAR-03).

Python-only runtime behavior: test_frozen_raises_on_mutation verifies
@dataclass(frozen=True) raises FrozenInstanceError. The TS equivalent is a
compile-time readonly check — Session.spec.ts contains a matching it() with a
structural assertion instead of a runtime throw, ensuring parity is maintained.
See .planning/phases/07-session-resume-multi-turn/07-CONTEXT.md.
"""

import dataclasses
import json

import pytest

from gemini_sdk.session import Session, TranscriptEntry, normalise_session_id


class TestSessionShape:
    def test_returns_fixed_three_field_record(self):
        """returns fixed three-field record with id, model, createdAt"""
        s = Session(id="abc", model="auto", created_at="2026-04-19T00:00:00.000Z")
        assert s.id == "abc"
        assert s.model == "auto"
        assert s.created_at == "2026-04-19T00:00:00.000Z"

    def test_has_no_process_handles(self):
        """has no process handles or file descriptors"""
        field_names = {f.name for f in dataclasses.fields(Session)}
        assert field_names <= {"id", "model", "created_at", "transcript"}


class TestSessionJsonRoundTrip:
    def test_round_trip_structural_equal(self):
        """JSON round-trip returns structurally-equal Session"""
        s = Session(id="abc", model="auto", created_at="2026-04-19T00:00:00.000Z")
        rehydrated = json.loads(json.dumps(dataclasses.asdict(s)))
        assert rehydrated == dataclasses.asdict(s)

    def test_round_trip_preserves_transcript(self):
        """JSON round-trip preserves transcript array"""
        s = Session(
            id="abc",
            model="auto",
            created_at="2026-04-19T00:00:00.000Z",
            transcript=(
                TranscriptEntry(role="user", content="hi"),
                TranscriptEntry(role="assistant", content="hello"),
            ),
        )
        rehydrated = json.loads(json.dumps(dataclasses.asdict(s)))
        # transcript is serialized as a list of dicts; asdict converts tuple->list
        assert rehydrated["transcript"] == [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]

    def test_no_transcript_round_trips_as_none(self):
        """Session with no transcript round-trips with transcript undefined"""
        s = Session(id="abc", model="auto", created_at="2026-04-19T00:00:00.000Z")
        rehydrated = json.loads(json.dumps(dataclasses.asdict(s)))
        assert rehydrated["transcript"] is None


class TestNormaliseSessionId:
    def test_returns_string_argument_unchanged(self):
        """returns string argument unchanged"""
        assert normalise_session_id("abc-123") == "abc-123"

    def test_extracts_id_field_from_session(self):
        """extracts id field from Session object"""
        s = Session(id="xyz", model="", created_at="")
        assert normalise_session_id(s) == "xyz"


class TestTranscriptEntry:
    def test_accepts_user_and_assistant(self):
        """TranscriptEntry accepts role user and assistant"""
        u = TranscriptEntry(role="user", content="hi")
        a = TranscriptEntry(role="assistant", content="hey")
        assert u.role == "user"
        assert a.role == "assistant"


class TestSessionFrozen:
    def test_frozen_raises_on_mutation(self):
        """@dataclass frozen raises FrozenInstanceError on mutation"""
        s = Session(id="abc", model="", created_at="")
        with pytest.raises(dataclasses.FrozenInstanceError):
            s.id = "other"  # type: ignore[misc]
