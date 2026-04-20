"""Parity mirror of ts/src/output/injectSchema.spec.ts."""

from __future__ import annotations

import json

from gemini_sdk.output import build_schema_injection_block


class TestBuildSchemaInjectionBlockTemplate:
    def test_starts_with_required_output_format_heading(self):
        """starts with the Required Output Format heading"""
        result = build_schema_injection_block({"type": "object"})
        assert result.startswith("## Required Output Format\n")

    def test_ends_with_return_only_directive(self):
        """ends with the Return ONLY directive"""
        result = build_schema_injection_block({"type": "object"})
        assert result.endswith("Return ONLY the JSON object. No prose, no markdown fences in the output.")

    def test_contains_pretty_printed_schema(self):
        """contains the pretty-printed schema inside a json code fence"""
        schema = {"type": "object", "properties": {"x": {"type": "string"}}, "required": ["x"]}
        result = build_schema_injection_block(schema)
        expected_block = "```json\n" + json.dumps(schema, indent=2) + "\n```"
        assert expected_block in result

    def test_contains_must_be_valid_json_instruction(self):
        """contains the MUST be valid JSON instruction"""
        result = build_schema_injection_block({})
        assert "Your response MUST be valid JSON matching this JSON Schema:" in result

    def test_handles_empty_schema(self):
        """handles empty schema object"""
        result = build_schema_injection_block({})
        assert "{}" in result

    def test_is_deterministic(self):
        """is deterministic (same input -> same output)"""
        a = build_schema_injection_block({"type": "object"})
        b = build_schema_injection_block({"type": "object"})
        assert a == b

