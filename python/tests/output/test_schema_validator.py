"""Parity mirror of ts/src/output/schemaValidator.spec.ts."""

from __future__ import annotations

from gemini_sdk.output import strip_markdown_fences, validate_with_schema


class TestStripMarkdownFences:
    def test_returns_input_unchanged_no_fences(self):
        """returns input unchanged when there are no fences"""
        assert strip_markdown_fences('{"x": 1}') == '{"x": 1}'

    def test_strips_json_fence_wrappers(self):
        """strips ```json ... ``` wrappers"""
        assert strip_markdown_fences('```json\n{"x": 1}\n```') == '{"x": 1}'

    def test_strips_bare_fence_wrappers(self):
        """strips ``` ... ``` wrappers with no language tag"""
        assert strip_markdown_fences('```\n{"x": 1}\n```') == '{"x": 1}'

    def test_tolerates_crlf(self):
        """tolerates CRLF line endings"""
        assert strip_markdown_fences('```json\r\n{"x": 1}\r\n```') == '{"x": 1}'

    def test_trims_whitespace_on_unfenced(self):
        """trims leading and trailing whitespace on unfenced input"""
        assert strip_markdown_fences('   {"x": 1}   ') == '{"x": 1}'

    def test_returns_unfenced_on_partial_fence(self):
        """returns unfenced when only opening fence present (no closing)"""
        assert strip_markdown_fences('```json\n{"x": 1}').strip() == '```json\n{"x": 1}'


class TestValidateWithSchema:
    _schema = {
        "type": "object",
        "properties": {"x": {"type": "string"}},
        "required": ["x"],
    }

    def test_returns_success_for_valid_json(self):
        """returns success for valid JSON matching the schema"""
        success, data, err = validate_with_schema(self._schema, '{"x": "hello"}')
        assert success is True
        assert data == {"x": "hello"}
        assert err == ""

    def test_returns_failure_on_unparsable_input(self):
        """returns failure with JSON parse error for unparsable input"""
        success, data, err = validate_with_schema(self._schema, 'not json')
        assert success is False
        assert "JSON parse failed" in err

    def test_returns_failure_on_type_mismatch(self):
        """returns failure for type mismatch on required field"""
        success, data, err = validate_with_schema(self._schema, '{"x": 123}')
        assert success is False
        assert len(err) > 0

    def test_returns_failure_on_missing_required(self):
        """returns failure when required field missing"""
        success, data, err = validate_with_schema(self._schema, '{}')
        assert success is False
        assert len(err) > 0

    def test_strips_fences_before_parsing(self):
        """strips markdown fences before parsing"""
        success, data, err = validate_with_schema(self._schema, '```json\n{"x": "hi"}\n```')
        assert success is True
        assert data == {"x": "hi"}

    def test_works_on_plain_schema_no_required(self):
        """works on plain schema with no required array"""
        success, data, err = validate_with_schema({"type": "object"}, '{"anything": true}')
        assert success is True
