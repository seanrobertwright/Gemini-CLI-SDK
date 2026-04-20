"""
python/tests/test_build_argv.py

Unit tests + property-based fuzz test for build_argv.
Test names (docstrings) match TS buildArgv.spec.ts for parity enforcement.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gemini_sdk.query import ApprovalMode, Model, build_argv
from gemini_sdk.session import Session, TranscriptEntry


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
        """omits --model when model is auto"""
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
        """Model.AUTO is the string auto"""
        assert Model.AUTO == "auto"

    def test_model_flash_25_is_string(self):
        """Model.FLASH_25 is the string gemini-2.5-flash"""
        assert Model.FLASH_25 == "gemini-2.5-flash"

    def test_model_pro_25_is_string(self):
        """Model.PRO_25 is the string gemini-2.5-pro"""
        assert Model.PRO_25 == "gemini-2.5-pro"

    def test_model_flash_20_is_string(self):
        """Model.FLASH_20 is the string gemini-2.0-flash"""
        assert Model.FLASH_20 == "gemini-2.0-flash"

    def test_model_flash_3_is_string(self):
        """Model.FLASH_3 is the string gemini-3-flash"""
        assert Model.FLASH_3 == "gemini-3-flash"

    def test_model_pro_3_is_string(self):
        """Model.PRO_3 is the string gemini-3-pro"""
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
            "session": st.one_of(
                st.none(),
                st.text(min_size=1),
            ),
        })
    )
    @settings(max_examples=100)
    def test_never_throws(self, opts: dict) -> None:
        """never throws for arbitrary input and always returns non-empty string[]"""
        import os as _os
        # Ensure deterministic env state: fallback env var must not be set
        _os.environ.pop("GEMINI_SDK_TRANSCRIPT_FALLBACK", None)
        # Build a QueryOptions-compatible dict (skip None values)
        options = {"prompt": opts["prompt"]}
        if opts.get("model") is not None:
            options["model"] = opts["model"]  # type: ignore[assignment]
        if opts.get("additional_directories") is not None:
            options["additional_directories"] = opts["additional_directories"]  # type: ignore[assignment]
        if opts.get("session") is not None:
            options["session"] = opts["session"]  # type: ignore[assignment]

        result = build_argv(options)  # type: ignore[arg-type]
        assert isinstance(result, list)
        assert len(result) > 0
        assert result[0] == "--output-format"
        assert result[1] == "stream-json"
        # Session invariant (fallback env var NOT set, so primary path applies)
        if opts.get("session") is not None:
            assert result[2] == "--resume"
        else:
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


# ── session primary path (SES-02) ────────────────────────────────────────────


class TestBuildArgvSessionPrimaryPath:
    def test_run_omits_resume_when_no_session(self, monkeypatch):
        """omits --resume when no session option provided"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        result = build_argv({"prompt": "x"})
        assert "--resume" not in result

    def test_run_inserts_resume_id_for_string_session(self, monkeypatch):
        """inserts --resume id between stream-json and -p when session is a string"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        result = build_argv({"prompt": "x", "session": "abc-123"})
        assert result == ["--output-format", "stream-json", "--resume", "abc-123", "-p", "x"]

    def test_run_inserts_resume_id_for_session_object(self, monkeypatch):
        """inserts --resume id when session is a Session object"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        s = Session(id="xyz-9", model="", created_at="")
        result = build_argv({"prompt": "x", "session": s})
        assert result[2] == "--resume"
        assert result[3] == "xyz-9"

    def test_run_places_resume_before_p(self, monkeypatch):
        """places --resume before -p"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        result = build_argv({"prompt": "x", "session": "abc"})
        resume_idx = result.index("--resume")
        p_idx = result.index("-p")
        assert resume_idx < p_idx

    def test_run_session_and_additional_directories_both_emit(self, monkeypatch):
        """session and additionalDirectories both produce flags in argv"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        result = build_argv({"prompt": "x", "session": "s", "additional_directories": ["d1"]})
        assert result == [
            "--output-format", "stream-json",
            "--resume", "s",
            "-p", "x",
            "--include-directories", "d1",
        ]

    def test_run_session_and_model_both_emit(self, monkeypatch):
        """session and model both produce flags in argv"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        result = build_argv({"prompt": "x", "session": "s", "model": "gemini-3-pro"})
        assert "--resume" in result
        assert "--model" in result
        assert "gemini-3-pro" in result


# ── transcript-prepend fallback (SES-04) ─────────────────────────────────────


class TestBuildArgvTranscriptFallback:
    def test_run_fallback_and_transcript_prepends(self, monkeypatch):
        """fallback env var set plus transcript present omits --resume and prepends transcript"""
        monkeypatch.setenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", "1")
        s = Session(
            id="abc",
            model="",
            created_at="",
            transcript=(
                TranscriptEntry(role="user", content="hi"),
                TranscriptEntry(role="assistant", content="hello"),
            ),
        )
        result = build_argv({"prompt": "next", "session": s})
        assert "--resume" not in result
        assert result[3] == "User: hi\nAssistant: hello\n\nUser: next"

    def test_run_fallback_no_transcript_falls_back(self, monkeypatch):
        """fallback env var set but no transcript falls back to primary path"""
        monkeypatch.setenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", "1")
        s = Session(id="abc", model="", created_at="")
        result = build_argv({"prompt": "x", "session": s})
        assert "--resume" in result

    def test_run_fallback_string_session_falls_back(self, monkeypatch):
        """fallback env var set but session is a string falls back to primary path"""
        monkeypatch.setenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", "1")
        result = build_argv({"prompt": "x", "session": "abc"})
        assert "--resume" in result

    def test_run_no_fallback_transcript_ignored(self, monkeypatch):
        """fallback env var unset with transcript present uses primary path"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        s = Session(
            id="abc",
            model="",
            created_at="",
            transcript=(TranscriptEntry(role="user", content="hi"),),
        )
        result = build_argv({"prompt": "x", "session": s})
        assert "--resume" in result


# ── allowedTools (TOL-01) ─────────────────────────────────────────────────────


class TestBuildArgvAllowedTools:
    def test_emits_allowed_tools_csv_for_two_tools(self):
        """emits --allowed-tools with CSV value for two tools"""
        result = build_argv({"prompt": "x", "allowed_tools": ["read_file", "write_file"]})
        assert "--allowed-tools" in result
        idx = result.index("--allowed-tools")
        assert result[idx + 1] == "read_file,write_file"

    def test_emits_allowed_tools_single_value(self):
        """emits --allowed-tools with single value for one tool"""
        result = build_argv({"prompt": "x", "allowed_tools": ["only_one"]})
        idx = result.index("--allowed-tools")
        assert result[idx + 1] == "only_one"

    def test_omits_allowed_tools_when_empty_array(self):
        """omits --allowed-tools when array is empty"""
        result = build_argv({"prompt": "x", "allowed_tools": []})
        assert "--allowed-tools" not in result

    def test_omits_allowed_tools_when_undefined(self):
        """omits --allowed-tools when option is undefined"""
        result = build_argv({"prompt": "x"})
        assert "--allowed-tools" not in result

    def test_passes_through_mcp_style_names(self):
        """passes through mcp__server__tool-style names unchanged"""
        result = build_argv({"prompt": "x", "allowed_tools": ["mcp__srv__do"]})
        idx = result.index("--allowed-tools")
        assert result[idx + 1] == "mcp__srv__do"


# ── approvalMode (TOL-02) ─────────────────────────────────────────────────────


class TestBuildArgvApprovalMode:
    def test_emits_approval_mode_yolo_literal(self):
        """emits --approval-mode yolo for literal string"""
        result = build_argv({"prompt": "x", "approval_mode": "yolo"})
        assert "--approval-mode" in result
        idx = result.index("--approval-mode")
        assert result[idx + 1] == "yolo"

    def test_emits_approval_mode_plan_enum(self):
        """emits --approval-mode plan for ApprovalMode.PLAN"""
        result = build_argv({"prompt": "x", "approval_mode": ApprovalMode.PLAN})
        idx = result.index("--approval-mode")
        assert result[idx + 1] == "plan"

    def test_emits_approval_mode_for_all_4_values(self):
        """emits --approval-mode for all 4 ApprovalMode values"""
        for mode in [ApprovalMode.DEFAULT, ApprovalMode.AUTO_EDIT, ApprovalMode.YOLO, ApprovalMode.PLAN]:
            result = build_argv({"prompt": "x", "approval_mode": mode})
            idx = result.index("--approval-mode")
            assert result[idx + 1] == mode.value

    def test_passes_raw_string_through_as_escape_hatch(self):
        """passes raw string through as escape hatch"""
        result = build_argv({"prompt": "x", "approval_mode": "some-future-mode"})
        idx = result.index("--approval-mode")
        assert result[idx + 1] == "some-future-mode"

    def test_omits_approval_mode_when_undefined(self):
        """omits --approval-mode when option is undefined"""
        result = build_argv({"prompt": "x"})
        assert "--approval-mode" not in result


# ── combined tools + approval + directories ──────────────────────────────────


class TestBuildArgvPhase8FlagsCombined:
    def test_emits_all_phase_8_additions_plus_model_plus_directories(self):
        """emits all three Phase 8 additions plus model plus directories"""
        result = build_argv({
            "prompt": "x",
            "allowed_tools": ["read_file"],
            "approval_mode": "default",
            "additional_directories": ["d1"],
            "model": "gemini-3-pro",
        })
        assert "--allowed-tools" in result
        assert "--approval-mode" in result
        assert "--include-directories" in result
        assert "--model" in result
        pos_model = result.index("--model")
        pos_include = result.index("--include-directories")
        pos_allowed = result.index("--allowed-tools")
        pos_approval = result.index("--approval-mode")
        assert pos_model < pos_include
        assert pos_include < pos_allowed
        assert pos_allowed < pos_approval

    def test_allowed_tools_coexists_with_session(self, monkeypatch):
        """allowedTools coexists with session (--resume stays between stream-json and -p)"""
        monkeypatch.delenv("GEMINI_SDK_TRANSCRIPT_FALLBACK", raising=False)
        result = build_argv({"prompt": "x", "session": "abc", "allowed_tools": ["t1"]})
        assert result[:4] == ["--output-format", "stream-json", "--resume", "abc"]
        assert "--allowed-tools" in result


# ── fuzz: allowedTools CSV property ──────────────────────────────────────────


class TestBuildArgvAllowedToolsCsvFuzz:
    @given(
        st.lists(st.text(min_size=1).filter(lambda s: "," not in s)),
    )
    def test_csv_value_always_equals_arr_join(self, tools):
        """CSV value always equals arr.join comma for non-empty arrays"""
        options = {"prompt": "p"}
        if tools:
            options["allowed_tools"] = tools  # type: ignore[assignment]
        result = build_argv(options)  # type: ignore[arg-type]
        if not tools:
            assert "--allowed-tools" not in result
        else:
            idx = result.index("--allowed-tools")
            assert idx >= 0
            assert result[idx + 1] == ",".join(tools)
