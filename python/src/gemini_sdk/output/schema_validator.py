"""python/src/gemini_sdk/output/schema_validator.py

Pure functions: strip_markdown_fences, validate_with_schema.
Mirrors ts/src/output/schemaValidator.ts.

Requirements: OUT-02, OUT-03 (used inside retry loop).
"""

from __future__ import annotations

import json
import re
from typing import Any, Tuple

import jsonschema

# Match ```json ... ``` or ``` ... ``` wrappers, with optional language tag
# and CRLF line endings. Mirrors TS FENCE_RE.
_FENCE_RE = re.compile(r"^```(?:json)?\r?\n?([\s\S]*?)\r?\n?```$", re.DOTALL)


def strip_markdown_fences(text: str) -> str:
    """Strip ```json ... ``` or ``` ... ``` wrappers from LLM output."""
    trimmed = text.strip()
    m = _FENCE_RE.match(trimmed)
    return m.group(1).strip() if m else trimmed


def validate_with_schema(schema: dict, text: str) -> Tuple[bool, Any, str]:
    """Strip fences -> json.loads -> jsonschema.validate.

    Returns:
      (True, data, "")          on valid JSON matching the schema.
      (False, None, <message>)  on JSON parse failure OR schema mismatch.
        <message> is a non-empty string suitable for feeding to build_retry_prompt.
    """
    stripped = strip_markdown_fences(text)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as e:
        return False, None, f"JSON parse failed: {e}"

    try:
        jsonschema.validate(instance=parsed, schema=schema)
        return True, parsed, ""
    except jsonschema.ValidationError as e:
        return False, None, e.message
