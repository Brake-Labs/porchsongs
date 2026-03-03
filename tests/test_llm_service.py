"""Tests for llm_service pure functions (no LLM calls)."""

from types import SimpleNamespace

from app.services.llm_service import (
    ABC_SYSTEM_PROMPT,
    CHAT_SYSTEM_PROMPT,
    CLEAN_SYSTEM_PROMPT,
    _build_abc_kwargs,
    _build_chat_kwargs,
    _build_parse_kwargs,
    _parse_abc_response,
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
    kwargs = _build_chat_kwargs(song, messages, "openai", "gpt-4o")

    system_msg = kwargs["messages"][0]  # type: ignore[index]
    assert system_msg["role"] == "system"  # type: ignore[index]
    assert "ORIGINAL SONG" in system_msg["content"]  # type: ignore[index]
    assert song.original_content in system_msg["content"]  # type: ignore[index]
    assert "EDITED SONG" not in system_msg["content"]  # type: ignore[index]

    # User/assistant messages passed through unchanged
    assert kwargs["messages"][1] == {"role": "user", "content": "make it sadder"}  # type: ignore[index]
    assert kwargs["messages"][2] == {"role": "assistant", "content": "ok"}  # type: ignore[index]


def test_build_chat_kwargs_reasoning_effort_off() -> None:
    """reasoning_effort='off' should be passed through to disable thinking."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [{"role": "user", "content": "make it sadder"}]
    kwargs = _build_chat_kwargs(song, messages, "openai", "gpt-4o", reasoning_effort="off")
    assert kwargs["reasoning_effort"] == "off"


def test_build_chat_kwargs_reasoning_effort_high() -> None:
    """reasoning_effort='high' should be included in kwargs."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [{"role": "user", "content": "make it sadder"}]
    kwargs = _build_chat_kwargs(song, messages, "openai", "gpt-4o", reasoning_effort="high")
    assert kwargs["reasoning_effort"] == "high"


def test_build_parse_kwargs_reasoning_effort_off() -> None:
    """reasoning_effort='off' should be passed through to disable thinking."""
    kwargs = _build_parse_kwargs("some content", "openai", "gpt-4o", reasoning_effort="off")
    assert kwargs["reasoning_effort"] == "off"


def test_build_parse_kwargs_reasoning_effort_low() -> None:
    """reasoning_effort='low' should be included in kwargs."""
    kwargs = _build_parse_kwargs("some content", "openai", "gpt-4o", reasoning_effort="low")
    assert kwargs["reasoning_effort"] == "low"


# --- _parse_chat_response ---


def test_parse_chat_with_xml_tags() -> None:
    raw = "<content>\nHello world\nSecond line\n</content>\nI changed the first word."
    result = _parse_chat_response(raw)
    assert result["content"] == "Hello world\nSecond line"
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


# --- ABC System Prompt ---


def test_abc_system_prompt_identifies_as_porchsongs() -> None:
    """ABC_SYSTEM_PROMPT should identify the LLM as PorchSongs."""
    assert "PorchSongs" in ABC_SYSTEM_PROMPT
    assert "ABC" in ABC_SYSTEM_PROMPT


def test_abc_system_prompt_describes_output_format() -> None:
    """ABC_SYSTEM_PROMPT should describe both abc and tips output formats."""
    assert "<abc>" in ABC_SYSTEM_PROMPT
    assert "<tips>" in ABC_SYSTEM_PROMPT


# --- _parse_abc_response ---


def test_parse_abc_with_abc_tags() -> None:
    raw = "<abc>\nX:1\nT:Test\nM:4/4\nK:G\n\"G\"B2 B A |\n</abc>\nI assumed 4/4 time."
    result = _parse_abc_response(raw)
    assert result["abc"] is not None
    assert "X:1" in result["abc"]
    assert result["tips"] is None
    assert result["explanation"] == "I assumed 4/4 time."


def test_parse_abc_with_tips_tags() -> None:
    raw = "<tips>\nThis song needs chords.\n</tips>\nTry adding G, Am, C."
    result = _parse_abc_response(raw)
    assert result["abc"] is None
    assert result["tips"] is not None
    assert "needs chords" in result["tips"]
    assert result["explanation"] == "Try adding G, Am, C."


def test_parse_abc_with_neither_tags() -> None:
    raw = "Just some text without any tags."
    result = _parse_abc_response(raw)
    assert result["abc"] is None
    assert result["tips"] is None
    assert result["explanation"] is None


# --- _build_abc_kwargs ---


def test_build_abc_kwargs_basic() -> None:
    kwargs = _build_abc_kwargs("G Am\nHello world", "openai", "gpt-4o")
    messages = kwargs["messages"]
    assert messages[0]["role"] == "system"  # type: ignore[index]
    assert "ABC" in messages[0]["content"]  # type: ignore[index]
    assert messages[1]["role"] == "user"  # type: ignore[index]
    assert "Hello world" in messages[1]["content"]  # type: ignore[index]


def test_build_abc_kwargs_with_title_artist() -> None:
    kwargs = _build_abc_kwargs(
        "G Am\nHello world", "openai", "gpt-4o",
        title="My Song", artist="Test Artist",
    )
    user_msg = kwargs["messages"][1]["content"]  # type: ignore[index]
    assert "My Song" in user_msg
    assert "Test Artist" in user_msg


def test_build_abc_kwargs_reasoning_effort() -> None:
    kwargs = _build_abc_kwargs("content", "openai", "gpt-4o", reasoning_effort="high")
    assert kwargs["reasoning_effort"] == "high"
