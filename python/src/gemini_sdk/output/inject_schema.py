"""python/src/gemini_sdk/output/inject_schema.py

Pure function: build_schema_injection_block.
Mirrors ts/src/output/injectSchema.ts buildSchemaInjectionBlock exactly.

Requirement: OUT-01.
"""

from __future__ import annotations

import json


def build_schema_injection_block(schema: dict) -> str:
    """Build the "## Required Output Format" block for injection into a system prompt.

    Template is deterministic and byte-identical to the TS canonical implementation.
    """
    return "\n".join([
        "## Required Output Format",
        "Your response MUST be valid JSON matching this JSON Schema:",
        "",
        "```json",
        json.dumps(schema, indent=2),
        "```",
        "",
        "Return ONLY the JSON object. No prose, no markdown fences in the output.",
    ])
