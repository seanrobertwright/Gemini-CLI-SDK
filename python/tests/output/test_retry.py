"""Parity mirror of ts/src/output/retry.spec.ts."""

from __future__ import annotations

from gemini_sdk.output import build_retry_prompt


class TestBuildRetryPrompt:
    def test_starts_with_original_prompt(self):
        """starts with the original prompt on its own line"""
        result = build_retry_prompt('Tell me a joke', 'expected string', '{"x":1}')
        assert result.startswith('Tell me a joke\n')

    def test_contains_invalid_json_notice(self):
        """contains the invalid-JSON notice"""
        result = build_retry_prompt('p', 'e', 'r')
        assert 'Your previous response was invalid JSON for the required schema.' in result

    def test_contains_validator_error_prefix(self):
        """contains the validator error text prefixed by Validator error:"""
        result = build_retry_prompt('p', 'expected string at .x', 'r')
        assert 'Validator error: expected string at .x' in result

    def test_contains_raw_response_in_fence(self):
        """contains the raw response wrapped in a code fence"""
        raw = '{"x":1}'
        result = build_retry_prompt('p', 'e', raw)
        assert f'```\n{raw}\n```' in result

    def test_ends_with_return_only_directive(self):
        """ends with the Return ONLY valid JSON directive"""
        result = build_retry_prompt('p', 'e', 'r')
        assert result.endswith('Return ONLY valid JSON matching the schema.')

    def test_is_deterministic(self):
        """is deterministic"""
        a = build_retry_prompt('p', 'e', 'r')
        b = build_retry_prompt('p', 'e', 'r')
        assert a == b

    def test_preserves_multiline_prompts(self):
        """preserves multiline original prompts"""
        orig = 'line 1\nline 2'
        result = build_retry_prompt(orig, 'e', 'r')
        assert result.index(orig) == 0
