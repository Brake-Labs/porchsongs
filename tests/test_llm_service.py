"""Tests for llm_service pure functions (no LLM calls)."""

from types import SimpleNamespace

from app.services.llm_service import (
    CHAT_SYSTEM_PROMPT,
    CLEAN_SYSTEM_PROMPT,
    LLMCallParams,
    _build_chat_params,
    _build_parse_params,
    _parse_chat_response,
    _parse_clean_response,
    _resolve_thinking,
)

# --- System prompt guardrails ---


def test_clean_system_prompt_identifies_as_porchsongs() -> None:
    """CLEAN_SYSTEM_PROMPT should identify the LLM as PorchSongs."""
    assert "PorchSongs" in CLEAN_SYSTEM_PROMPT
    assert "song lyric editing assistant" in CLEAN_SYSTEM_PROMPT


def test_clean_system_prompt_describes_application() -> None:
    """CLEAN_SYSTEM_PROMPT should explain it is part of the PorchSongs application."""
    assert "PorchSongs application" in CLEAN_SYSTEM_PROMPT
    assert "rewrite and customize song lyrics" in CLEAN_SYSTEM_PROMPT


def test_clean_system_prompt_declines_off_topic() -> None:
    """CLEAN_SYSTEM_PROMPT should instruct declining unrelated discussions."""
    assert "unrelated to song editing" in CLEAN_SYSTEM_PROMPT


def test_chat_system_prompt_identifies_as_porchsongs() -> None:
    """CHAT_SYSTEM_PROMPT should identify the LLM as PorchSongs."""
    assert "PorchSongs" in CHAT_SYSTEM_PROMPT
    assert "song lyric editing assistant" in CHAT_SYSTEM_PROMPT


def test_chat_system_prompt_describes_application() -> None:
    """CHAT_SYSTEM_PROMPT should explain it is part of the PorchSongs application."""
    assert "PorchSongs application" in CHAT_SYSTEM_PROMPT
    assert "rewrite and customize song lyrics" in CHAT_SYSTEM_PROMPT


def test_chat_system_prompt_stays_on_topic() -> None:
    """CHAT_SYSTEM_PROMPT should instruct staying on-topic and declining unrelated requests."""
    assert "Stay on topic" in CHAT_SYSTEM_PROMPT
    assert "politely decline" in CHAT_SYSTEM_PROMPT


def test_chat_system_prompt_preserves_existing_instructions() -> None:
    """CHAT_SYSTEM_PROMPT should still contain existing formatting/chord instructions."""
    assert "Preserve syllable counts" in CHAT_SYSTEM_PROMPT
    assert "chord lines" in CHAT_SYSTEM_PROMPT
    assert "<content>" in CHAT_SYSTEM_PROMPT


def test_clean_system_prompt_preserves_existing_instructions() -> None:
    """CLEAN_SYSTEM_PROMPT should still contain existing cleanup/chord instructions."""
    assert "CHORD PRESERVATION" in CLEAN_SYSTEM_PROMPT
    assert "<meta>" in CLEAN_SYSTEM_PROMPT
    assert "<original>" in CLEAN_SYSTEM_PROMPT


# --- _resolve_thinking ---


def test_resolve_thinking_none_input() -> None:
    """None reasoning_effort returns (None, None)."""
    thinking, output_config = _resolve_thinking(None)
    assert thinking is None
    assert output_config is None


def test_resolve_thinking_auto() -> None:
    """'auto' returns (None, None) — let the provider decide."""
    thinking, output_config = _resolve_thinking("auto")
    assert thinking is None
    assert output_config is None


def test_resolve_thinking_none_value() -> None:
    """'none' disables thinking."""
    thinking, output_config = _resolve_thinking("none")
    assert thinking == {"type": "disabled"}
    assert output_config is None


def test_resolve_thinking_low() -> None:
    """'low' maps to adaptive thinking with low effort."""
    thinking, output_config = _resolve_thinking("low")
    assert thinking == {"type": "adaptive"}
    assert output_config == {"effort": "low"}


def test_resolve_thinking_medium() -> None:
    """'medium' maps to adaptive thinking with medium effort."""
    thinking, output_config = _resolve_thinking("medium")
    assert thinking == {"type": "adaptive"}
    assert output_config == {"effort": "medium"}


def test_resolve_thinking_high() -> None:
    """'high' maps to adaptive thinking with high effort."""
    thinking, output_config = _resolve_thinking("high")
    assert thinking == {"type": "adaptive"}
    assert output_config == {"effort": "high"}


def test_resolve_thinking_xhigh() -> None:
    """'xhigh' maps to adaptive thinking with max effort."""
    thinking, output_config = _resolve_thinking("xhigh")
    assert thinking == {"type": "adaptive"}
    assert output_config == {"effort": "max"}


def test_resolve_thinking_minimal() -> None:
    """'minimal' maps to adaptive thinking with low effort."""
    thinking, output_config = _resolve_thinking("minimal")
    assert thinking == {"type": "adaptive"}
    assert output_config == {"effort": "low"}


def test_resolve_thinking_unknown_value() -> None:
    """Unknown reasoning_effort returns (None, None)."""
    thinking, output_config = _resolve_thinking("unknown_value")
    assert thinking is None
    assert output_config is None


# --- LLMCallParams ---


def test_llm_call_params_rejects_unknown_fields() -> None:
    """LLMCallParams dataclass should not accept arbitrary fields."""
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(LLMCallParams)}
    assert "reasoning_effort" not in field_names


def test_llm_call_params_has_expected_fields() -> None:
    """LLMCallParams should have all the fields amessages() needs."""
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(LLMCallParams)}
    assert field_names == {
        "model",
        "provider",
        "messages",
        "system",
        "max_tokens",
        "api_base",
        "api_key",
        "thinking",
        "output_config",
    }


# --- _build_chat_params ---


def test_build_chat_params_system_prompt() -> None:
    """System prompt contains ORIGINAL SONG but NOT EDITED SONG."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [
        {"role": "user", "content": "make it sadder"},
        {"role": "assistant", "content": "ok"},
    ]
    params = _build_chat_params(song, messages, "openai", "gpt-4o")  # type: ignore[arg-type]

    assert isinstance(params, LLMCallParams)
    assert "ORIGINAL SONG" in params.system
    assert song.original_content in params.system
    assert "EDITED SONG" not in params.system

    # Messages should only contain user/assistant messages, no system role
    assert all(m["role"] != "system" for m in params.messages)
    assert params.messages[0] == {"role": "user", "content": "make it sadder"}
    assert params.messages[1] == {"role": "assistant", "content": "ok"}


def test_build_chat_params_reasoning_effort_none_value() -> None:
    """reasoning_effort='none' should set thinking to disabled."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [{"role": "user", "content": "make it sadder"}]
    params = _build_chat_params(song, messages, "openai", "gpt-4o", reasoning_effort="none")  # type: ignore[arg-type]
    assert params.thinking == {"type": "disabled"}
    assert params.output_config is None


def test_build_chat_params_reasoning_effort_high() -> None:
    """reasoning_effort='high' should convert to thinking + output_config."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [{"role": "user", "content": "make it sadder"}]
    params = _build_chat_params(song, messages, "openai", "gpt-4o", reasoning_effort="high")  # type: ignore[arg-type]
    assert params.thinking == {"type": "adaptive"}
    assert params.output_config == {"effort": "high"}


def test_build_parse_params_reasoning_effort_none_value() -> None:
    """reasoning_effort='none' should set thinking to disabled."""
    params = _build_parse_params("some content", "openai", "gpt-4o", reasoning_effort="none")
    assert params.thinking == {"type": "disabled"}
    assert params.output_config is None


def test_build_parse_params_reasoning_effort_low() -> None:
    """reasoning_effort='low' should convert to thinking + output_config."""
    params = _build_parse_params("some content", "openai", "gpt-4o", reasoning_effort="low")
    assert params.thinking == {"type": "adaptive"}
    assert params.output_config == {"effort": "low"}


def test_build_chat_params_reasoning_effort_xhigh() -> None:
    """reasoning_effort='xhigh' should convert to adaptive thinking with max effort."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages: list[dict[str, object]] = [{"role": "user", "content": "make it sadder"}]
    params = _build_chat_params(
        song, messages, "anthropic", "claude-opus-4-6", reasoning_effort="xhigh"
    )  # type: ignore[arg-type]
    assert params.thinking == {"type": "adaptive"}
    assert params.output_config == {"effort": "max"}


def test_build_parse_params_reasoning_effort_xhigh() -> None:
    """reasoning_effort='xhigh' should convert to adaptive thinking with max effort."""
    params = _build_parse_params(
        "some content", "anthropic", "claude-opus-4-6", reasoning_effort="xhigh"
    )
    assert params.thinking == {"type": "adaptive"}
    assert params.output_config == {"effort": "max"}


def test_build_chat_params_reasoning_effort_auto_no_thinking() -> None:
    """reasoning_effort='auto' should NOT add thinking or output_config."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages: list[dict[str, object]] = [{"role": "user", "content": "test"}]
    params = _build_chat_params(
        song, messages, "anthropic", "claude-opus-4-6", reasoning_effort="auto"
    )  # type: ignore[arg-type]
    assert params.thinking is None
    assert params.output_config is None


def test_build_chat_params_no_reasoning_effort() -> None:
    """No reasoning_effort should NOT add thinking or output_config."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages: list[dict[str, object]] = [{"role": "user", "content": "test"}]
    params = _build_chat_params(song, messages, "anthropic", "claude-opus-4-6")  # type: ignore[arg-type]
    assert params.thinking is None
    assert params.output_config is None


# --- _parse_chat_response ---


def test_parse_chat_with_xml_tags() -> None:
    raw = "<content>\nHello world\nSecond line\n</content>\nI changed the first word."
    result = _parse_chat_response(raw)
    assert result["content"] == "Hello world\nSecond line"
    assert result["explanation"] is not None
    assert "changed" in result["explanation"]


def test_parse_chat_with_xml_tags_no_explanation() -> None:
    raw = "<content>\nHello\n</content>"
    result = _parse_chat_response(raw)
    assert result["content"] == "Hello"
    assert result["explanation"] == ""


def test_parse_chat_no_markers() -> None:
    """Without <content> tags the response is conversational — no content update."""
    raw = "Just some text without markers"
    result = _parse_chat_response(raw)
    assert result["content"] is None
    assert result["explanation"] == "Just some text without markers"


# --- _parse_clean_response ---


def test_parse_clean_basic() -> None:
    raw = (
        "<meta>\nTitle: Wagon Wheel\nArtist: Old Crow\n</meta>\n"
        "<original>\nG  Am\nHello world\n</original>"
    )
    result = _parse_clean_response(raw, "fallback")
    assert result["title"] == "Wagon Wheel"
    assert result["artist"] == "Old Crow"
    assert result["original"] == "G  Am\nHello world"


def test_parse_clean_unknown_maps_to_none() -> None:
    raw = "<meta>\nTitle: UNKNOWN\nArtist: UNKNOWN\n</meta>\n<original>\nHello\n</original>"
    result = _parse_clean_response(raw, "fallback")
    assert result["title"] is None
    assert result["artist"] is None


def test_parse_clean_missing_tags_fallback() -> None:
    raw = "Just some text without XML tags"
    result = _parse_clean_response(raw, "fallback original")
    assert result["original"] == "fallback original"
    assert result["title"] is None
    assert result["artist"] is None
