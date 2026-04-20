"""gemini_sdk.output — Phase 8 best-effort structured output (experimental).

Pure functions used by query_full() to inject JSON Schema guidance into
the system prompt, validate model output, and build retry prompts.

Requirements: OUT-01, OUT-02, OUT-03.
"""

from .inject_schema import build_schema_injection_block
from .schema_validator import strip_markdown_fences, validate_with_schema
from .retry import build_retry_prompt

__all__ = [
    "build_schema_injection_block",
    "strip_markdown_fences",
    "validate_with_schema",
    "build_retry_prompt",
]
