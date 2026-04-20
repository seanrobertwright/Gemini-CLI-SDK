"""
python/src/gemini_sdk/query/build_argv.py

Pure function that maps QueryOptions to a string[] argv for gemini-cli.

Session branches (Phase 7):
  - No session              -> no --resume flag (fresh session) -- MDL-03 preserved.
  - session + no fallback   -> ['--resume', <id>] inserted BEFORE '-p' (primary path, SES-02).
  - session + fallback env  -> prompt is PREPENDED with transcript, --resume OMITTED (SES-04).

Fallback activation: env var read at call time (see code); requires Session with transcript.
Any other combination -> primary path.
"""

from __future__ import annotations

import os
from typing import Sequence

from ..session import Session, TranscriptEntry, normalise_session_id
from .types import QueryOptions


def _format_transcript_prompt(
    transcript: Sequence[TranscriptEntry],
    new_prompt: str,
) -> str:
    """Deterministic transcript prepend format (matches TS exactly).

    Example:
      [TranscriptEntry(role='user', content='hi'),
       TranscriptEntry(role='assistant', content='hello')], "next"
      -> "User: hi\\nAssistant: hello\\n\\nUser: next"
    """
    prior_lines = "\n".join(
        f"{'User' if t.role == 'user' else 'Assistant'}: {t.content}"
        for t in transcript
    )
    return f"{prior_lines}\n\nUser: {new_prompt}"


def build_argv(options: QueryOptions) -> list[str]:
    """Build the argv list to pass to gemini-cli for a given QueryOptions."""
    effective_prompt: str = options["prompt"]
    resume_flag_pair: list[str] = []

    session = options.get("session")
    if session is not None:
        session_id = normalise_session_id(session)
        fallback_active = os.environ.get("GEMINI_SDK_TRANSCRIPT_FALLBACK") == "1"
        session_obj: Session | None = session if not isinstance(session, str) else None
        has_transcript = bool(session_obj and session_obj.transcript and len(session_obj.transcript) > 0)

        if fallback_active and has_transcript:
            # SES-04 fallback: transcript-prepend; no --resume flag
            assert session_obj is not None and session_obj.transcript is not None
            effective_prompt = _format_transcript_prompt(session_obj.transcript, options["prompt"])
        else:
            # SES-02 primary path: --resume <id> before -p
            resume_flag_pair = ["--resume", session_id]

    argv: list[str] = [
        "--output-format", "stream-json",
        *resume_flag_pair,
        "-p", effective_prompt,
    ]

    # MDL-03: omit --model when None or 'auto'
    # Use .value for Model enum instances (str(Model.AUTO) gives "Model.AUTO", not "auto")
    model = options.get("model")
    if model is not None:
        import enum
        model_str = model.value if isinstance(model, enum.Enum) else str(model)
        if model_str != "auto":
            argv.extend(["--model", model_str])

    # CWD-02: one --include-directories flag per directory
    dirs = options.get("additional_directories")
    if dirs:
        for d in dirs:
            argv.extend(["--include-directories", d])

    # TOL-01: --allowed-tools (skip when None or empty list)
    allowed_tools = options.get("allowed_tools")
    if allowed_tools:
        argv.extend(["--allowed-tools", ",".join(allowed_tools)])

    # TOL-02: --approval-mode (skip when None)
    # Use .value for enum; str(ApprovalMode.PLAN) returns 'ApprovalMode.PLAN' not 'plan'
    approval_mode = options.get("approval_mode")
    if approval_mode is not None:
        import enum as _enum_mod
        mode_str = (
            approval_mode.value
            if isinstance(approval_mode, _enum_mod.Enum)
            else str(approval_mode)
        )
        argv.extend(["--approval-mode", mode_str])

    return argv
