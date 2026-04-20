"""python/src/gemini_sdk/output/retry.py

Pure function: build_retry_prompt.
Mirrors ts/src/output/retry.ts.

Requirement: OUT-03.
"""

from __future__ import annotations


def build_retry_prompt(
    original_prompt: str,
    validator_error: str,
    raw_response: str,
) -> str:
    """Construct the retry prompt given the caller's original prompt,
    the validator's error message, and the raw (invalid) assistant response.

    Output is byte-identical to TS canonical buildRetryPrompt.
    """
    return "\n".join([
        original_prompt,
        "",
        "Your previous response was invalid JSON for the required schema.",
        f"Validator error: {validator_error}",
        "Your previous response was:",
        "```",
        raw_response,
        "```",
        "",
        "Return ONLY valid JSON matching the schema.",
    ])
