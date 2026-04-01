"""Tests for llm_service pure functions (no LLM calls)."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.llm_service import (
    CHAT_SYSTEM_PROMPT,
    CLEAN_SYSTEM_PROMPT,
    IMAGE_EXTRACT_SYSTEM_PROMPT,
    LLMCallParams,
    _build_chat_params,
    _build_parse_params,
    _parse_chat_response,
    _parse_clean_response,
    _resolve_thinking,
    chat_edit_content_stream,
    extract_text_from_image,
    parse_content_stream,
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


# --- Image extract system prompt ---


def test_image_extract_prompt_identifies_as_extraction_tool() -> None:
    """IMAGE_EXTRACT_SYSTEM_PROMPT should describe its purpose."""
    assert "text extraction" in IMAGE_EXTRACT_SYSTEM_PROMPT.lower()
    assert "PorchSongs" in IMAGE_EXTRACT_SYSTEM_PROMPT


def test_image_extract_prompt_preserves_formatting() -> None:
    """IMAGE_EXTRACT_SYSTEM_PROMPT should instruct preserving formatting."""
    assert (
        "preserving" in IMAGE_EXTRACT_SYSTEM_PROMPT.lower()
        or "preserve" in IMAGE_EXTRACT_SYSTEM_PROMPT.lower()
    )


# --- extract_text_from_image ---


@patch("app.services.llm_service.amessages")
def test_extract_text_from_image_sends_multimodal_message(mock_amessages: AsyncMock) -> None:
    """extract_text_from_image should send image_url content to the LLM."""
    text_block = SimpleNamespace(type="text", text="G Am\nHello world", thinking=None)
    usage = SimpleNamespace(
        input_tokens=100,
        output_tokens=50,
        cache_creation_input_tokens=None,
        cache_read_input_tokens=None,
    )
    mock_amessages.return_value = SimpleNamespace(content=[text_block], usage=usage)

    result = asyncio.run(
        extract_text_from_image(
            image_data_url="data:image/png;base64,abc123",
            provider="openai",
            model="gpt-4o",
        )
    )

    assert result["text"] == "G Am\nHello world"
    assert result["usage"]["input_tokens"] == 100
    assert result["usage"]["output_tokens"] == 50

    # Verify the message structure sent to the LLM
    call_kwargs = mock_amessages.call_args.kwargs
    messages = call_kwargs["messages"]
    assert len(messages) == 1
    content = messages[0]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "image_url"
    assert content[0]["image_url"]["url"] == "data:image/png;base64,abc123"
    assert content[1]["type"] == "text"


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
    params = _build_chat_params(song.original_content, messages, "openai", "gpt-4o")

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
    params = _build_chat_params(
        song.original_content, messages, "openai", "gpt-4o", reasoning_effort="none"
    )
    assert params.thinking == {"type": "disabled"}
    assert params.output_config is None


def test_build_chat_params_reasoning_effort_high() -> None:
    """reasoning_effort='high' should convert to thinking + output_config."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages = [{"role": "user", "content": "make it sadder"}]
    params = _build_chat_params(
        song.original_content, messages, "openai", "gpt-4o", reasoning_effort="high"
    )
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
        song.original_content, messages, "anthropic", "claude-opus-4-6", reasoning_effort="xhigh"
    )
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
        song.original_content, messages, "anthropic", "claude-opus-4-6", reasoning_effort="auto"
    )
    assert params.thinking is None
    assert params.output_config is None


def test_build_chat_params_no_reasoning_effort() -> None:
    """No reasoning_effort should NOT add thinking or output_config."""
    song = SimpleNamespace(
        original_content="G  Am\nHello world",
        rewritten_content="G  Am\nHello changed world",
    )
    messages: list[dict[str, object]] = [{"role": "user", "content": "test"}]
    params = _build_chat_params(song.original_content, messages, "anthropic", "claude-opus-4-6")
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


# --- Streaming event parsing (attribute access, not dict access) ---


def _make_stream_events(
    text_chunks: list[str],
    *,
    thinking_chunks: list[str] | None = None,
    input_tokens: int = 10,
    output_tokens: int = 20,
    cache_creation: int | None = None,
    cache_read: int | None = None,
) -> list[SimpleNamespace]:
    """Build a list of SimpleNamespace events mimicking Anthropic Pydantic stream models.

    Uses attribute access (not dict access) to match real SDK behavior.
    """
    events: list[SimpleNamespace] = []
    # message_start
    events.append(
        SimpleNamespace(
            type="message_start",
            message=SimpleNamespace(
                usage=SimpleNamespace(
                    input_tokens=input_tokens,
                    cache_creation_input_tokens=cache_creation,
                    cache_read_input_tokens=cache_read,
                ),
            ),
            delta=None,
            usage=None,
        )
    )
    # thinking deltas (if any)
    for chunk in thinking_chunks or []:
        events.append(
            SimpleNamespace(
                type="content_block_delta",
                delta=SimpleNamespace(type="thinking_delta", thinking=chunk),
                message=None,
                usage=None,
            )
        )
    # text deltas
    for chunk in text_chunks:
        events.append(
            SimpleNamespace(
                type="content_block_delta",
                delta=SimpleNamespace(type="text_delta", text=chunk),
                message=None,
                usage=None,
            )
        )
    # message_delta (usage)
    events.append(
        SimpleNamespace(
            type="message_delta",
            usage=SimpleNamespace(output_tokens=output_tokens),
            message=None,
            delta=None,
        )
    )
    return events


async def _async_iter(items: list[SimpleNamespace]) -> SimpleNamespace:  # type: ignore[misc]
    """Convert a list to an async iterator."""
    for item in items:
        yield item


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_parse_stream_text_deltas(mock_amessages: AsyncMock) -> None:
    """parse_content_stream yields text tokens using attribute access on Pydantic models."""

    async def _run() -> list[tuple[str, str]]:
        events = _make_stream_events(["Hello ", "world"])
        mock_amessages.return_value = _async_iter(events)
        results = []
        async for kind, text in parse_content_stream("test content", "openai", "gpt-4o"):
            results.append((kind, text))
        return results

    results = asyncio.run(_run())
    text_results = [(k, t) for k, t in results if k == "token"]
    assert text_results == [("token", "Hello "), ("token", "world")]

    usage_results = [(k, t) for k, t in results if k == "usage"]
    assert len(usage_results) == 1
    usage = json.loads(usage_results[0][1])
    assert usage["input_tokens"] == 10
    assert usage["output_tokens"] == 20


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_parse_stream_thinking_deltas(mock_amessages: AsyncMock) -> None:
    """parse_content_stream yields reasoning tokens from thinking_delta events."""

    async def _run() -> list[tuple[str, str]]:
        events = _make_stream_events(["result"], thinking_chunks=["Let me ", "think..."])
        mock_amessages.return_value = _async_iter(events)
        results = []
        async for kind, text in parse_content_stream("test content", "openai", "gpt-4o"):
            results.append((kind, text))
        return results

    results = asyncio.run(_run())
    reasoning = [(k, t) for k, t in results if k == "reasoning"]
    assert reasoning == [("reasoning", "Let me "), ("reasoning", "think...")]


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_parse_stream_cache_usage(mock_amessages: AsyncMock) -> None:
    """parse_content_stream includes cache tokens in usage when present."""

    async def _run() -> list[tuple[str, str]]:
        events = _make_stream_events(["ok"], cache_creation=100, cache_read=50)
        mock_amessages.return_value = _async_iter(events)
        results = []
        async for kind, text in parse_content_stream("test content", "openai", "gpt-4o"):
            results.append((kind, text))
        return results

    results = asyncio.run(_run())
    usage_results = [(k, t) for k, t in results if k == "usage"]
    usage = json.loads(usage_results[0][1])
    assert usage["cache_creation_input_tokens"] == 100
    assert usage["cache_read_input_tokens"] == 50


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_chat_stream_text_deltas(mock_amessages: AsyncMock) -> None:
    """chat_edit_content_stream yields text tokens using attribute access."""

    async def _run() -> list[tuple[str, str]]:
        events = _make_stream_events(["<content>", "\nHi", "\n</content>"])
        mock_amessages.return_value = _async_iter(events)
        original_content = "G  Am\nHello world"
        messages: list[dict[str, object]] = [{"role": "user", "content": "make it sadder"}]
        results = []
        async for kind, text in chat_edit_content_stream(
            original_content,
            messages,
            "openai",
            "gpt-4o",
        ):
            results.append((kind, text))
        return results

    results = asyncio.run(_run())
    text_results = [(k, t) for k, t in results if k == "token"]
    assert len(text_results) == 3
    assert text_results[0] == ("token", "<content>")


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_chat_stream_thinking_deltas(mock_amessages: AsyncMock) -> None:
    """chat_edit_content_stream yields reasoning tokens from thinking_delta events."""

    async def _run() -> list[tuple[str, str]]:
        events = _make_stream_events(["result"], thinking_chunks=["hmm"])
        mock_amessages.return_value = _async_iter(events)
        original_content = "G  Am\nHello world"
        messages: list[dict[str, object]] = [{"role": "user", "content": "test"}]
        results = []
        async for kind, text in chat_edit_content_stream(
            original_content,
            messages,
            "openai",
            "gpt-4o",
        ):
            results.append((kind, text))
        return results

    results = asyncio.run(_run())
    reasoning = [(k, t) for k, t in results if k == "reasoning"]
    assert reasoning == [("reasoning", "hmm")]
