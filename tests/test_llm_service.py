"""Tests for llm_service pure functions (no LLM calls)."""

from typing import Any
from types import SimpleNamespace

from app.services.llm_service import (
    CHAT_SYSTEM_PROMPT,
    CLEAN_SYSTEM_PROMPT,
    _build_chat_kwargs,
    _build_parse_kwargs,
    _parse_chat_response,
    _parse_clean_response,
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


# --- _build_chat_kwargs ---


def test_build_chat_kwargs_system_prompt() -> None:
    """System prompt contains ORIGINAL SONG but NOT EDITED SONG."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [
        {"role": "user", "content": "make it sadder"},
        {"role": "assistant", "content": "ok"},
    ]
    kwargs = _build_chat_kwargs(song, messages, "openai", "gpt-4o")  # type: ignore[arg-type]

    # System prompt is now a separate 'system' parameter, not in messages list
    system_content = kwargs["system"]
    assert "ORIGINAL SONG" in system_content
    assert song.original_content in system_content
    assert "EDITED SONG" not in system_content

    # Messages should only contain user/assistant messages, no system role
    llm_messages: list[dict[str, Any]] = kwargs["messages"]
    assert all(m["role"] != "system" for m in llm_messages)
    assert llm_messages[0] == {"role": "user", "content": "make it sadder"}
    assert llm_messages[1] == {"role": "assistant", "content": "ok"}


def test_build_chat_kwargs_reasoning_effort_off() -> None:
    """reasoning_effort='off' should be passed through to disable thinking."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [{"role": "user", "content": "make it sadder"}]
    kwargs = _build_chat_kwargs(song, messages, "openai", "gpt-4o", reasoning_effort="off")  # type: ignore[arg-type]
    assert kwargs["reasoning_effort"] == "off"


def test_build_chat_kwargs_reasoning_effort_high() -> None:
    """reasoning_effort='high' should be included in kwargs."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [{"role": "user", "content": "make it sadder"}]
    kwargs = _build_chat_kwargs(song, messages, "openai", "gpt-4o", reasoning_effort="high")  # type: ignore[arg-type]
    assert kwargs["reasoning_effort"] == "high"


def test_build_parse_kwargs_reasoning_effort_off() -> None:
    """reasoning_effort='off' should be passed through to disable thinking."""
    kwargs = _build_parse_kwargs("some content", "openai", "gpt-4o", reasoning_effort="off")
    assert kwargs["reasoning_effort"] == "off"


def test_build_parse_kwargs_reasoning_effort_low() -> None:
    """reasoning_effort='low' should be included in kwargs."""
    kwargs = _build_parse_kwargs("some content", "openai", "gpt-4o", reasoning_effort="low")
    assert kwargs["reasoning_effort"] == "low"


def test_build_chat_kwargs_reasoning_effort_xhigh() -> None:
    """reasoning_effort='xhigh' should be passed through for adaptive max thinking."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages: list[dict[str, object]] = [{"role": "user", "content": "make it sadder"}]
    kwargs = _build_chat_kwargs(song, messages, "anthropic", "claude-opus-4-6", reasoning_effort="xhigh")  # type: ignore[arg-type]
    assert kwargs["reasoning_effort"] == "xhigh"


def test_build_parse_kwargs_reasoning_effort_xhigh() -> None:
    """reasoning_effort='xhigh' should be passed through for adaptive max thinking."""
    kwargs = _build_parse_kwargs("some content", "anthropic", "claude-opus-4-6", reasoning_effort="xhigh")
    assert kwargs["reasoning_effort"] == "xhigh"


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
