"""
python/tests/test_build_argv.py

Unit tests + property-based fuzz test for build_argv.
Test names (docstrings) match TS buildArgv.spec.ts for parity enforcement.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gemini_sdk.query import Model, build_argv


# ── basic prompt ──────────────────────────────────────────────────────────────


class TestBuildArgvBasicPrompt:
    def test_returns_fixed_header(self):
        """returns fixed header followed by -p and prompt"""
        result = build_argv({"prompt": "hello"})
        assert result == ["--output-format", "stream-json", "-p", "hello"]

    def test_prompt_is_fourth_element(self):
        """prompt is always the 4th element"""
        result = build_argv({"prompt": "world"})
        assert result[3] == "world"

    def test_always_starts_with_output_format(self):
        """always starts with --output-format stream-json"""
        result = build_argv({"prompt": "test"})
        assert result[0] == "--output-format"
        assert result[1] == "stream-json"


# ── model omission ────────────────────────────────────────────────────────────


class TestBuildArgvModelOmission:
    def test_omits_model_when_undefined(self):
        """omits --model when model is undefined"""
        result = build_argv({"prompt": "x", "model": None})  # type: ignore[typeddict-item]
        assert "--model" not in result

    def test_omits_model_when_auto_string(self):
        """omits --model when model is 'auto'"""
        result = build_argv({"prompt": "x", "model": "auto"})
        assert "--model" not in result

    def test_omits_model_when_model_auto(self):
        """omits --model when model is Model.AUTO"""
        result = build_argv({"prompt": "x", "model": Model.AUTO})
        assert "--model" not in result

    def test_has_exactly_4_elements(self):
        """has exactly 4 elements when prompt only and no model"""
        result = build_argv({"prompt": "x"})
        assert len(result) == 4


# ── explicit model ────────────────────────────────────────────────────────────


class TestBuildArgvExplicitModel:
    def test_adds_model_pro_25(self):
        """adds --model gemini-2.5-pro for Model.PRO_25"""
        result = build_argv({"prompt": "x", "model": "gemini-2.5-pro"})
        assert "--model" in result
        idx = result.index("--model")
        assert result[idx + 1] == "gemini-2.5-pro"

    def test_adds_model_flash_25(self):
        """adds --model gemini-2.5-flash for Model.FLASH_25"""
        result = build_argv({"prompt": "x", "model": Model.FLASH_25})
        idx = result.index("--model")
        assert result[idx + 1] == "gemini-2.5-flash"

    def test_adds_model_flash_20(self):
        """adds --model gemini-2.0-flash for Model.FLASH_20"""
        result = build_argv({"prompt": "x", "model": Model.FLASH_20})
        idx = result.index("--model")
        assert result[idx + 1] == "gemini-2.0-flash"

    def test_adds_model_flash_3(self):
        """adds --model gemini-3-flash for Model.FLASH_3"""
        result = build_argv({"prompt": "x", "model": Model.FLASH_3})
        idx = result.index("--model")
        assert result[idx + 1] == "gemini-3-flash"

    def test_adds_model_pro_3(self):
        """adds --model gemini-3-pro for Model.PRO_3"""
        result = build_argv({"prompt": "x", "model": Model.PRO_3})
        idx = result.index("--model")
        assert result[idx + 1] == "gemini-3-pro"


# ── string escape hatch (MDL-02) ──────────────────────────────────────────────


class TestBuildArgvStringEscapeHatch:
    def test_passes_through_arbitrary_model_string(self):
        """passes through arbitrary model string to --model (MDL-02)"""
        result = build_argv({"prompt": "x", "model": "custom-future-model"})
        assert "--model" in result
        idx = result.index("--model")
        assert result[idx + 1] == "custom-future-model"

    def test_passes_through_gemini_99_ultra(self):
        """passes through gemini-99-ultra as raw string model"""
        result = build_argv({"prompt": "x", "model": "gemini-99-ultra"})
        idx = result.index("--model")
        assert result[idx + 1] == "gemini-99-ultra"


# ── additionalDirectories (CWD-02) ────────────────────────────────────────────


class TestBuildArgvAdditionalDirectories:
    def test_maps_two_dirs_to_two_flags(self):
        """maps two directories to two --include-directories flags"""
        result = build_argv({"prompt": "x", "additional_directories": ["dir1", "dir2"]})
        assert result == [
            "--output-format", "stream-json",
            "-p", "x",
            "--include-directories", "dir1",
            "--include-directories", "dir2",
        ]

    def test_omits_include_when_empty_array(self):
        """omits --include-directories when array is empty"""
        result = build_argv({"prompt": "x", "additional_directories": []})
        assert "--include-directories" not in result
        assert len(result) == 4

    def test_omits_include_when_not_provided(self):
        """omits --include-directories when not provided"""
        result = build_argv({"prompt": "x"})
        assert "--include-directories" not in result

    def test_handles_single_directory(self):
        """handles a single directory"""
        result = build_argv({"prompt": "x", "additional_directories": ["only-dir"]})
        idx = result.index("--include-directories")
        assert result[idx + 1] == "only-dir"
        assert result.count("--include-directories") == 1


# ── Model enum values ─────────────────────────────────────────────────────────


class TestBuildArgvModelEnumValues:
    def test_model_auto_is_string(self):
        """Model.AUTO is the string "auto\""""
        assert Model.AUTO == "auto"

    def test_model_flash_25_is_string(self):
        """Model.FLASH_25 is the string "gemini-2.5-flash\""""
        assert Model.FLASH_25 == "gemini-2.5-flash"

    def test_model_pro_25_is_string(self):
        """Model.PRO_25 is the string "gemini-2.5-pro\""""
        assert Model.PRO_25 == "gemini-2.5-pro"

    def test_model_flash_20_is_string(self):
        """Model.FLASH_20 is the string "gemini-2.0-flash\""""
        assert Model.FLASH_20 == "gemini-2.0-flash"

    def test_model_flash_3_is_string(self):
        """Model.FLASH_3 is the string "gemini-3-flash\""""
        assert Model.FLASH_3 == "gemini-3-flash"

    def test_model_pro_3_is_string(self):
        """Model.PRO_3 is the string "gemini-3-pro\""""
        assert Model.PRO_3 == "gemini-3-pro"

    def test_model_has_6_keys(self):
        """Model has exactly 6 keys"""
        assert len(list(Model)) == 6

    def test_all_model_values_are_strings(self):
        """all Model values are strings"""
        for member in Model:
            assert isinstance(member.value, str)


# ── fuzz tests ────────────────────────────────────────────────────────────────


class TestBuildArgvFuzzTest:
    @given(
        st.fixed_dictionaries({
            "prompt": st.text(min_size=1),
            "model": st.one_of(
                st.none(),
                st.just("auto"),
                st.just("gemini-2.5-flash"),
                st.just("gemini-2.5-pro"),
                st.just("gemini-2.0-flash"),
                st.just("gemini-3-flash"),
                st.just("gemini-3-pro"),
                st.text(min_size=1),
            ),
            "additional_directories": st.one_of(
                st.none(),
                st.lists(st.text()),
            ),
        })
    )
    @settings(max_examples=100)
    def test_never_throws(self, opts: dict) -> None:
        """never throws for arbitrary input and always returns non-empty string[]"""
        # Build a QueryOptions-compatible dict (skip None values)
        options = {"prompt": opts["prompt"]}
        if opts.get("model") is not None:
            options["model"] = opts["model"]  # type: ignore[assignment]
        if opts.get("additional_directories") is not None:
            options["additional_directories"] = opts["additional_directories"]  # type: ignore[assignment]

        result = build_argv(options)  # type: ignore[arg-type]
        assert isinstance(result, list)
        assert len(result) > 0
        assert result[0] == "--output-format"
        assert result[1] == "stream-json"
        assert result[2] == "-p"
        assert result[3] == opts["prompt"]
        for el in result:
            assert isinstance(el, str)

    @given(
        st.text(min_size=1),
        st.one_of(st.none(), st.just("auto")),
    )
    def test_fuzz_auto_undefined_no_model_flag(self, prompt: str, model) -> None:
        """fuzz: model auto/undefined never produces --model flag"""
        options = {"prompt": prompt}
        if model is not None:
            options["model"] = model  # type: ignore[assignment]
        result = build_argv(options)  # type: ignore[arg-type]
        # Check that '--model' does not appear as a CLI flag (at index 4+ as a flag key).
        # The prompt itself may contain '--model' as text (at index 3), which is correct.
        # Flags start after the fixed 4-element header: [--output-format, stream-json, -p, prompt]
        flags_section = result[4:]
        assert "--model" not in flags_section

    @given(
        st.text(min_size=1),
        st.text(min_size=1).filter(lambda s: s != "auto"),
    )
    def test_fuzz_non_auto_model_flag(self, prompt: str, model: str) -> None:
        """fuzz: non-auto model always produces --model flag"""
        result = build_argv({"prompt": prompt, "model": model})
        assert "--model" in result
        idx = result.index("--model")
        assert result[idx + 1] == model
