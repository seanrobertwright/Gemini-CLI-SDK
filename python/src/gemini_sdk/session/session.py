"""
python/src/gemini_sdk/session/session.py

Session value object — immutable, identifier-based, NOT process-bound.
Frozen dataclass — mutation attempts raise FrozenInstanceError.
JSON round-trip via dataclasses.asdict() + json.dumps().

Requirement: SES-03
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple, Union


@dataclass(frozen=True)
class TranscriptEntry:
    """One prior turn in a Session transcript (SES-04 fallback)."""

    role: str      # "user" | "assistant"
    content: str


@dataclass(frozen=True)
class Session:
    """Session value object (SES-03).

    Fields:
      id: Session id captured from the init event (SES-01).
      model: Model reported by init; retained for logging / UI / debugging.
      created_at: ISO 8601 timestamp of first init event.
      transcript: Prior turns when GEMINI_SDK_TRANSCRIPT_FALLBACK is active (SES-04).
                  None when the fallback is off (default).
    """

    id: str
    model: str
    created_at: str
    transcript: Optional[Tuple[TranscriptEntry, ...]] = field(default=None)


def normalise_session_id(session: Union["Session", str]) -> str:
    """Normalise Session | str into a session id string.

    Callers who stored an id (DB row, URL param) can pass a bare string;
    callers who held a live Session pass the object.
    """
    if isinstance(session, str):
        return session
    return session.id
