"""Tests for llm_service pure functions (no LLM calls)."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.llm_service import (
    CHAT_SYSTEM_PROMPT,
    CLEAN_SYSTEM_PROMPT,
    TAG_NAME_MAX_CHARS,
    TAG_SUGGEST_MAX_NEW,
    TAG_SUGGEST_CONTENT_CHARS,
    TAG_SUGGEST_MAX_CHOICES,
    TAG_SUGGEST_MAX_OUTPUT_TOKENS,
    IMAGE_EXTRACT_SYSTEM_PROMPT,
    LLMCallParams,
    _build_chat_params,
    _build_parse_params,
    _parse_chat_response,
    _parse_clean_response,
    _parse_tag_suggestions,
    _resolve_thinking,
    chat_edit_content_stream,
    disambiguate_position,
    extract_text_from_image,
    parse_content_stream,
    suggest_tags,
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
    """System prompt contains ORIGINAL SONG."""
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

    # Messages should only contain user/assistant messages, no system role
    assert all(m["role"] != "system" for m in params.messages)
    assert params.messages[0] == {"role": "user", "content": "make it sadder"}
    assert params.messages[1] == {"role": "assistant", "content": "ok"}


def test_build_chat_params_includes_rewritten_in_user_message() -> None:
    """When rewritten_content differs from original, it is prepended to the last user message."""
    original = "G  Am\nHello world"
    rewritten = "G  Am\nHello changed world"
    messages = [{"role": "user", "content": "make it sadder"}]
    params = _build_chat_params(original, messages, "openai", "gpt-4o", rewritten_content=rewritten)
    last_msg = params.messages[-1]["content"]
    assert rewritten in last_msg
    assert "make it sadder" in last_msg
    # System prompt should NOT contain the rewritten content (caching).
    assert rewritten not in params.system


def test_build_chat_params_no_rewritten_prefix_when_same_as_original() -> None:
    """When rewritten_content matches original, user message is unchanged."""
    original = "G  Am\nHello world"
    messages = [{"role": "user", "content": "make it sadder"}]
    params = _build_chat_params(original, messages, "openai", "gpt-4o", rewritten_content=original)
    assert params.messages[-1]["content"] == "make it sadder"


def test_build_chat_params_no_rewritten_prefix_when_none() -> None:
    """When rewritten_content is None, user message is unchanged."""
    original = "G  Am\nHello world"
    messages = [{"role": "user", "content": "make it sadder"}]
    params = _build_chat_params(original, messages, "openai", "gpt-4o", rewritten_content=None)
    assert params.messages[-1]["content"] == "make it sadder"


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


# --- Follow-mode arbiter ---


def _arbiter_response(text: str) -> SimpleNamespace:
    block = SimpleNamespace(type="text", text=text, thinking=None)
    usage = SimpleNamespace(
        input_tokens=10,
        output_tokens=2,
        cache_creation_input_tokens=None,
        cache_read_input_tokens=None,
    )
    return SimpleNamespace(content=[block], usage=usage)


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_disambiguate_position_picks_a_candidate(mock_amessages: AsyncMock) -> None:
    mock_amessages.return_value = _arbiter_response("The answer is 20.")
    result = asyncio.run(
        disambiguate_position(
            recent_words="when the saints go marching in",
            candidates=[{"index": 20, "context": "..."}, {"index": 60, "context": "..."}],
            current_index=18,
            provider="otari",
            model="fast",
        )
    )
    assert result["choice"] == 20


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_disambiguate_position_rejects_out_of_set_and_unsure(mock_amessages: AsyncMock) -> None:
    # id not among candidates -> None
    mock_amessages.return_value = _arbiter_response("99")
    assert (
        asyncio.run(
            disambiguate_position(
                recent_words="x",
                candidates=[{"index": 20, "context": ""}],
                current_index=None,
                provider="otari",
                model="fast",
            )
        )["choice"]
        is None
    )
    # explicit "unsure" sentinel -> None
    mock_amessages.return_value = _arbiter_response("-1")
    assert (
        asyncio.run(
            disambiguate_position(
                recent_words="x",
                candidates=[{"index": 20, "context": ""}],
                current_index=None,
                provider="otari",
                model="fast",
            )
        )["choice"]
        is None
    )


# --- Tag suggestion ---


def test_tag_suggest_output_cap_is_one_credits_worth() -> None:
    """The output ceiling has to stay at or under one credit's worth of tokens.

    Premium bills ``max(1, ceil(output_tokens / 100))`` and the UI promises the
    user one credit. Raising this constant past 100 silently makes that promise
    false, so pin it here rather than leave it to a comment.
    """
    assert TAG_SUGGEST_MAX_OUTPUT_TOKENS <= 100


def test_parse_tag_suggestions_ranks_existing_then_new() -> None:
    result = _parse_tag_suggestions(
        '{"existing": [2, 1], "new": "Carter Family"}',
        ["Campfire", "Hymns"],
    )
    assert result == [
        {"tag": "Hymns", "is_new": False},
        {"tag": "Campfire", "is_new": False},
        {"tag": "Carter Family", "is_new": True},
    ]


def test_parse_tag_suggestions_drops_tags_the_user_does_not_have() -> None:
    """An index outside the offered list must never become a suggestion.

    The model is asked for numbers precisely so a creative reply cannot name a
    tag of its own; if that guard slipped, one tap would file the chart
    somewhere the user never chose.
    """
    result = _parse_tag_suggestions(
        '{"existing": [0, 3, 99, "nope", true], "new": ""}',
        ["Campfire", "Hymns"],
    )
    assert result == []


def test_parse_tag_suggestions_accepts_an_echoed_tag_name() -> None:
    result = _parse_tag_suggestions(
        '{"existing": ["hymns"], "new": ""}',
        ["Campfire", "Hymns"],
    )
    assert result == [{"tag": "Hymns", "is_new": False}]


def test_parse_tag_suggestions_never_offers_an_existing_tag_as_new() -> None:
    result = _parse_tag_suggestions(
        '{"existing": [1], "new": "campfire"}',
        ["Campfire", "Hymns"],
    )
    assert result == [{"tag": "Campfire", "is_new": False}]


def test_parse_tag_suggestions_does_not_badge_an_unoffered_tag_as_new() -> None:
    """A tag the user has, but which was never offered, is not a new tag.

    Only TAG_SUGGEST_MAX_CHOICES tags go into the prompt, so a library
    past that has tags the model never saw and can propose from scratch.
    Checking ``new`` against the offered slice alone would badge one of the
    user's own tags "New tag".
    """
    result = _parse_tag_suggestions(
        '{"existing": [], "new": "Zydeco"}',
        ["Campfire", "Hymns"],
        ["Campfire", "Hymns", "Zydeco"],
    )
    assert result == [{"tag": "Zydeco", "is_new": False}]


def test_parse_tag_suggestions_caps_the_ranking_and_the_name() -> None:
    result = _parse_tag_suggestions(
        json.dumps({"existing": [1, 2, 3, 4, 5, 6], "new": ["x" * 200, "y", "z"]}),
        ["A", "B", "C", "D", "E", "F"],
    )
    assert [s["tag"] for s in result if not s["is_new"]] == ["A", "B", "C", "D"]
    new = [s for s in result if s["is_new"]]
    # A chart is allowed several tags, but not a screenful: two proposed names,
    # each no longer than the write path would accept.
    assert len(new) == TAG_SUGGEST_MAX_NEW
    assert len(new[0]["tag"]) == TAG_NAME_MAX_CHARS


def test_parse_tag_suggestions_survives_prose_and_garbage() -> None:
    # Wrapped in chatter: the JSON object is still found.
    assert _parse_tag_suggestions(
        'Sure! {"existing": [], "new": "Sea Shanties"} Hope that helps.',
        ["Hymns"],
    ) == [{"tag": "Sea Shanties", "is_new": True}]
    # Truncated or not JSON at all: no suggestions rather than an exception.
    assert _parse_tag_suggestions('{"existing": [1], "new": "Sea', ["Hymns"]) == []
    assert _parse_tag_suggestions("no idea", ["Hymns"]) == []
    assert _parse_tag_suggestions("[1, 2]", ["Hymns"]) == []


def test_parse_tag_suggestions_squeezes_a_multiline_name_onto_one_line() -> None:
    result = _parse_tag_suggestions('{"existing": [], "new": "  Sunday\\n  Morning  "}', [])
    assert result == [{"tag": "Sunday Morning", "is_new": True}]


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_suggest_tags_offers_a_new_name_when_there_are_no_tags_yet(
    mock_amessages: AsyncMock,
) -> None:
    mock_amessages.return_value = _arbiter_response('{"existing": [], "new": "Carter Family"}')
    result = asyncio.run(
        suggest_tags(
            title="Wildwood Flower",
            artist="The Carter Family",
            content="C   F   C\nOh I'll twine with my mingles",
            existing_tags=[],
            provider="otari",
            model="fast",
        )
    )
    assert result["suggestions"] == [{"tag": "Carter Family", "is_new": True}]
    # A first-time user has nothing to rank, and the prompt has to say so or the
    # reply comes back as an empty ranking with no new name either.
    prompt = mock_amessages.call_args.kwargs["messages"][0]["content"]
    assert "none yet" in prompt


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_suggest_tags_bounds_what_it_sends_and_what_it_asks_for(
    mock_amessages: AsyncMock,
) -> None:
    """Both ends of the call are capped, which is what keeps it a one-credit call."""
    mock_amessages.return_value = _arbiter_response('{"existing": [1], "new": ""}')
    result = asyncio.run(
        suggest_tags(
            title="Long One",
            artist=None,
            content="x" * 9000,
            existing_tags=[f"Tag {i}" for i in range(50)],
            provider="otari",
            model="fast",
        )
    )
    kwargs = mock_amessages.call_args.kwargs
    assert kwargs["max_tokens"] == TAG_SUGGEST_MAX_OUTPUT_TOKENS
    prompt = kwargs["messages"][0]["content"]
    assert "x" * TAG_SUGGEST_CONTENT_CHARS in prompt
    assert "x" * (TAG_SUGGEST_CONTENT_CHARS + 1) not in prompt
    assert f"{TAG_SUGGEST_MAX_CHOICES}. Tag {TAG_SUGGEST_MAX_CHOICES - 1}" in prompt
    assert f"{TAG_SUGGEST_MAX_CHOICES + 1}. Tag" not in prompt
    # Only tags that were actually offered can come back.
    assert result["suggestions"] == [{"tag": "Tag 0", "is_new": False}]


def test_tag_suggest_schema_bound_matches_the_service_cap():
    """The request schema repeats the token cap rather than importing it, to keep
    schemas.py out of the LLM dependency graph. Pin the two together so the
    duplicate cannot drift: if it did, a self-hosted install would accept a
    max_tokens the price claim does not cover."""
    from app.schemas import TagSuggestRequest
    from app.services.llm_service import TAG_SUGGEST_MAX_OUTPUT_TOKENS

    meta = TagSuggestRequest.model_fields["max_tokens"].metadata
    upper = next(m.le for m in meta if hasattr(m, "le"))
    assert upper == TAG_SUGGEST_MAX_OUTPUT_TOKENS
