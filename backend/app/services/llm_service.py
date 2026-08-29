from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, cast

from any_llm import alist_models, amessages
from any_llm.types.messages import MessageResponse, MessageStreamEvent

# Map reasoning_effort values to Anthropic's thinking/output_config format.
# amessages() is a native pass-through that does NOT convert reasoning_effort
# (unlike acompletion which uses _convert_params). We must do it ourselves.
_REASONING_EFFORT_TO_ANTHROPIC = {
    "minimal": "low",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "max",
}


@dataclass(frozen=True, slots=True)
class LLMCallParams:
    """Typed parameters for amessages() calls.

    Using a dataclass instead of dict[str, Any] so the type checker catches
    invalid fields (e.g. passing reasoning_effort directly to amessages).
    """

    model: str
    provider: str
    messages: list[dict[str, Any]]
    system: str
    max_tokens: int
    api_base: str | None = None
    api_key: str | None = None
    thinking: dict[str, Any] | None = None
    output_config: dict[str, str] | None = None

    async def send(
        self, *, stream: bool = False
    ) -> MessageResponse | AsyncIterator[MessageStreamEvent]:
        """Call amessages() with typed arguments."""
        # output_config is Anthropic-specific; pass via **kwargs only when set.
        extra: dict[str, Any] = {}
        if self.output_config is not None:
            extra["output_config"] = self.output_config
        return await amessages(
            model=self.model,
            provider=self.provider,
            messages=self.messages,
            system=self.system,
            max_tokens=self.max_tokens,
            api_base=self.api_base,
            api_key=self.api_key,
            thinking=self.thinking,
            stream=stream,
            **extra,
        )


def _resolve_thinking(
    reasoning_effort: str | None,
) -> tuple[dict[str, Any] | None, dict[str, str] | None]:
    """Convert reasoning_effort to (thinking, output_config) for amessages().

    Returns (None, None) when no thinking config is needed.
    """
    if not reasoning_effort or reasoning_effort == "auto":
        return None, None
    if reasoning_effort == "none":
        return {"type": "disabled"}, None
    effort = _REASONING_EFFORT_TO_ANTHROPIC.get(reasoning_effort)
    if effort is not None:
        return {"type": "adaptive"}, {"effort": effort}
    return None, None


def _get_content(response: MessageResponse) -> str:
    """Extract text content from a message response, raising on empty."""
    for block in response.content:
        if block.type == "text" and block.text:
            return block.text
    raise ValueError("LLM returned empty response")


def _get_usage(response: MessageResponse) -> dict[str, int | None]:
    """Extract token usage from a message response."""
    usage = response.usage
    result: dict[str, int | None] = {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
    }
    if usage.cache_creation_input_tokens is not None:
        result["cache_creation_input_tokens"] = usage.cache_creation_input_tokens
    if usage.cache_read_input_tokens is not None:
        result["cache_read_input_tokens"] = usage.cache_read_input_tokens
    return result


def _get_reasoning(response: MessageResponse) -> str | None:
    """Extract reasoning/thinking content from a message response."""
    for block in response.content:
        if block.type == "thinking" and block.thinking:
            return block.thinking
    return None


CLEAN_SYSTEM_PROMPT = """You are PorchSongs, a song lyric editing assistant. You are part of the \
PorchSongs application, which helps users rewrite and customize song lyrics. \
Your ONLY job is to clean up raw pasted song input. Do NOT rewrite or change the content in any way. \
Do NOT engage in discussions or tasks unrelated to song editing.

STEP 1 — IDENTIFY:
- Determine the song's title and artist from the input
- If you cannot determine either, use "UNKNOWN"

STEP 2 — CLEAN UP:
- Strip any ads, site navigation, duplicate headers, or non-song text
- Keep section headers like [Verse], [Chorus], etc.
- Preserve blank lines between sections
- Do NOT change any content

CHORD PRESERVATION (critical):
- Chords appear on their own line directly ABOVE the lyric line they belong to
- The horizontal spacing of each chord is meaningful — it aligns the chord to a specific \
word or syllable in the lyric line below
- You MUST keep every chord line exactly as-is: same chords, same spacing, same position
- Do NOT reformat, re-space, or merge chord lines
- Example of correct above-line chord format:
    G          C          D
    Amazing grace how sweet the sound
  The spaces before G, C, and D position them above specific words. Preserve this exactly.

Respond with exactly these two XML sections:

<meta>
Title: <song title or UNKNOWN>
Artist: <artist name or UNKNOWN>
</meta>
<original>
(the cleaned-up version of the pasted input with chords and their spacing preserved exactly)
</original>"""


CHAT_SYSTEM_PROMPT = """You are PorchSongs, a song lyric editing assistant. You are part of the \
PorchSongs application, which helps users rewrite and customize song lyrics.

Stay on topic: only discuss song lyrics, songwriting, chord progressions, and music-related topics. \
If the user asks about something unrelated to song editing or music, politely decline and redirect \
the conversation back to their song.

You can have a normal conversation — answer questions, discuss options, brainstorm ideas — as long as \
it relates to the song or songwriting in general.

When the user wants changes to the song, go ahead and make them. You don't need an explicit \
"rewrite it" command — if the user's message implies a change (e.g. "the second verse feels \
too wordy", "can we make this more upbeat?", "I don't like line 3"), apply the edit directly. \
Bias toward action: rewrite first, explain after.

When making changes:
1. Preserve syllable counts per line
2. Maintain rhyme scheme
3. Keep the song singable and natural
4. Only change what the user is asking about
5. Preserve chord lines — chords appear on their own line above the lyric they belong to.
   Keep each chord above the same word/syllable. If a word moves, reposition the chord to stay aligned.
6. Preserve all non-lyric content (capo notes, section headers, tuning info, etc.)

IMPORTANT — only include <content> tags when you are actually changing the song:

<content>
(the complete updated song, every line, preserving blank lines, structure, chord lines, and all non-lyric content)
</content>

(A friendly explanation of what you changed and why)

If you need to edit the ORIGINAL/SOURCE version of the song (e.g. fixing a chord, correcting a \
lyric in the original, adjusting tuning info), wrap the updated original in \
<original_song>...</original_song> tags. You can use this alongside <content> tags or on its own:

<original_song>
(the complete updated original song)
</original_song>

If the user is purely asking a question or brainstorming without implying any specific edit, \
respond conversationally WITHOUT <content> tags.

The song is provided in the system prompt. When you make changes and emit <content> tags, \
that becomes the new current version for subsequent turns. If the user tells you the song \
has been manually edited and provides a current version, base your edits on that version."""

# Providers that support Anthropic-style prompt caching via cache_control.
# The gateway ("otari") does NOT honor Anthropic cache_control passthrough
# (cache tokens come back as 0), so it is intentionally not listed here.
_CACHEABLE_PROVIDERS = {"anthropic"}


async def get_models(
    provider: str, api_base: str | None = None, api_key: str | None = None
) -> list[str]:
    """Fetch available models for a provider (e.g. the gateway's model catalog)."""
    kwargs: dict[str, Any] = {"provider": provider}
    if api_base:
        kwargs["api_base"] = api_base
    if api_key:
        kwargs["api_key"] = api_key
    raw = await alist_models(**kwargs)
    return [m.id if hasattr(m, "id") else str(m) for m in raw]


def _add_cache_breakpoint(message: dict[str, Any]) -> dict[str, Any]:
    """Add an ephemeral cache_control breakpoint to a message's content.

    Converts plain-string content to a content-block list so Anthropic
    can attach a cache breakpoint. Messages that are already block-lists
    get the breakpoint appended to the last block.
    """
    content = message["content"]
    if isinstance(content, str):
        message["content"] = [
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
        ]
    elif isinstance(content, list) and content:
        # Add cache_control to the last content block
        last_block = content[-1]
        if isinstance(last_block, dict):
            last_block["cache_control"] = {"type": "ephemeral"}
    return message


IMAGE_EXTRACT_SYSTEM_PROMPT = """You are a text extraction tool for the PorchSongs song lyric editing app. \
Your ONLY job is to extract song lyrics and chords from an image.

INSTRUCTIONS:
- Extract ALL text visible in the image, preserving the original formatting
- Keep chord lines exactly as they appear, preserving spacing and alignment
- Keep section headers like [Verse], [Chorus], etc.
- Preserve blank lines between sections
- If the image contains multiple songs, extract all of them
- If the image is not a song or contains no readable text, say so briefly

Do NOT add any commentary, explanation, or formatting beyond what appears in the image. \
Just return the raw extracted text."""


async def extract_text_from_image(
    image_data_url: str,
    provider: str,
    model: str,
    api_base: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Extract text from an image using LLM vision.

    Returns dict with: text, usage
    """
    from ..config import settings

    params = LLMCallParams(
        model=model,
        provider=provider,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_data_url},
                    },
                    {
                        "type": "text",
                        "text": "Extract the song lyrics and chords from this image. "
                        "Preserve all formatting, spacing, and chord positions exactly.",
                    },
                ],
            }
        ],
        system=IMAGE_EXTRACT_SYSTEM_PROMPT,
        max_tokens=max_tokens if max_tokens is not None else settings.default_max_tokens,
        api_base=api_base,
        api_key=api_key,
    )
    response = cast("MessageResponse", await params.send())
    text = _get_content(response)
    usage = _get_usage(response)

    return {"text": text, "usage": usage}


def _build_parse_params(
    content: str,
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    instruction: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> LLMCallParams:
    """Build typed parameters for parse LLM calls."""
    user_text = "Clean up this pasted input. Identify the title and artist."
    if instruction:
        user_text += f"\n\nUSER INSTRUCTIONS:\n{instruction}"
    user_text += f"\n\nPASTED INPUT:\n{content}"

    from ..config import settings

    thinking, output_config = _resolve_thinking(reasoning_effort)

    return LLMCallParams(
        model=model,
        provider=provider,
        messages=[{"role": "user", "content": user_text}],
        system=system_prompt or CLEAN_SYSTEM_PROMPT,
        max_tokens=max_tokens if max_tokens is not None else settings.default_max_tokens,
        api_base=api_base,
        api_key=api_key,
        thinking=thinking,
        output_config=output_config,
    )


async def parse_content(
    content: str,
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    instruction: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Clean up raw pasted content and identify title/artist (non-streaming).

    Returns dict with: original_content, title, artist, reasoning, usage
    """
    params = _build_parse_params(
        content,
        provider,
        model,
        api_base,
        reasoning_effort,
        instruction,
        system_prompt,
        max_tokens,
        api_key,
    )
    clean_response = cast("MessageResponse", await params.send())
    clean_result = _parse_clean_response(_get_content(clean_response), content)
    reasoning = _get_reasoning(clean_response)
    usage = _get_usage(clean_response)

    return {
        "original_content": clean_result["original"],
        "title": clean_result["title"],
        "artist": clean_result["artist"],
        "reasoning": reasoning,
        "usage": usage,
    }


async def parse_content_stream(
    content: str,
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    instruction: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """Stream parse tokens as ``(type, text)`` tuples.

    Types: ``"token"`` for content, ``"reasoning"`` for reasoning/thinking,
    ``"usage"`` for final token usage JSON.
    """
    params = _build_parse_params(
        content,
        provider,
        model,
        api_base,
        reasoning_effort,
        instruction,
        system_prompt,
        max_tokens,
        api_key,
    )
    response = cast(
        "AsyncIterator[MessageStreamEvent]",
        await params.send(stream=True),
    )

    input_usage: dict[str, int | None] = {}

    async for event in response:
        if event.type == "message_start" and event.message:
            u = event.message.usage
            input_usage = {
                "input_tokens": u.input_tokens,
                "cache_creation_input_tokens": u.cache_creation_input_tokens,
                "cache_read_input_tokens": u.cache_read_input_tokens,
            }
        elif event.type == "content_block_delta" and event.delta:
            if event.delta.type == "text_delta":
                yield ("token", event.delta.text)
            elif event.delta.type == "thinking_delta":
                yield ("reasoning", event.delta.thinking)
        elif event.type == "message_delta" and event.usage:
            usage_data: dict[str, int | None] = {
                # Some gateway models report input tokens only on message_delta
                # rather than message_start; prefer whichever is non-zero.
                "input_tokens": (input_usage.get("input_tokens") or 0)
                or (getattr(event.usage, "input_tokens", None) or 0),
                "output_tokens": event.usage.output_tokens,
            }
            cache_create = input_usage.get("cache_creation_input_tokens")
            cache_read = input_usage.get("cache_read_input_tokens")
            if cache_create is not None:
                usage_data["cache_creation_input_tokens"] = cache_create
            if cache_read is not None:
                usage_data["cache_read_input_tokens"] = cache_read
            yield ("usage", json.dumps(usage_data))


def _extract_xml_section(raw: str, tag: str) -> str | None:
    """Extract content between <tag> and </tag>, or None if not found."""
    pattern = re.compile(rf"<{tag}>\s*(.*?)\s*</{tag}>", re.DOTALL)
    m = pattern.search(raw)
    return m.group(1).strip() if m else None


def _parse_meta_section(meta_text: str) -> dict[str, str | None]:
    """Parse title/artist from a meta section. UNKNOWN maps to None."""
    title: str | None = None
    artist: str | None = None
    for line in meta_text.split("\n"):
        line = line.strip()
        if line.lower().startswith("title:"):
            val = line.split(":", 1)[1].strip()
            title = None if val.upper() == "UNKNOWN" else val
        elif line.lower().startswith("artist:"):
            val = line.split(":", 1)[1].strip()
            artist = None if val.upper() == "UNKNOWN" else val
    return {"title": title, "artist": artist}


def _parse_clean_response(raw: str, fallback_original: str) -> dict[str, str | None]:
    """Parse the cleanup LLM response (Call 1).

    Extracts <meta> (title/artist) and <original> (cleaned text).
    Falls back to fallback_original if <original> tag is missing.
    """
    title: str | None = None
    artist: str | None = None

    xml_meta = _extract_xml_section(raw, "meta")
    if xml_meta is not None:
        parsed_meta = _parse_meta_section(xml_meta)
        title = parsed_meta["title"]
        artist = parsed_meta["artist"]

    xml_original = _extract_xml_section(raw, "original")
    original = xml_original if xml_original is not None else fallback_original

    return {"original": original, "title": title, "artist": artist}


def _parse_chat_response(raw: str) -> dict[str, str | None]:
    """Parse chat LLM response, extracting content from <content> tags and explanation.

    Returns ``{"content": ..., "original_content": ..., "explanation": ...}``
    where ``content`` and ``original_content`` are ``None`` when the LLM
    responded conversationally without the respective tags.
    """
    xml_content = _extract_xml_section(raw, "content")
    original_content = _extract_xml_section(raw, "original_song")

    if xml_content is not None:
        after = raw.split("</content>", 1)
        explanation = after[1].strip() if len(after) > 1 else ""
        # Strip any <original_song> tags from the explanation
        if original_content is not None and "</original_song>" in explanation:
            explanation = re.sub(
                r"<original_song>.*?</original_song>", "", explanation, flags=re.DOTALL
            ).strip()
        return {
            "content": xml_content,
            "original_content": original_content,
            "explanation": explanation,
        }

    # No <content> tags — check if there's an original_song update alone
    explanation = raw.strip()
    if original_content is not None:
        explanation = re.sub(
            r"<original_song>.*?</original_song>", "", explanation, flags=re.DOTALL
        ).strip()

    return {"content": None, "original_content": original_content, "explanation": explanation}


def _build_chat_params(
    original_content: str,
    messages: list[dict[str, object]],
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
    history_len: int = 0,
    rewritten_content: str | None = None,
) -> LLMCallParams:
    """Build typed parameters for chat LLM calls."""
    system_content = system_prompt or CHAT_SYSTEM_PROMPT
    system_content += "\n\nORIGINAL SONG:\n" + original_content

    llm_messages: list[dict[str, Any]] = []
    for msg in messages:
        content = msg["content"]
        # Skip messages with empty content - LLM providers reject them.
        if isinstance(content, str) and not content:
            continue
        if isinstance(content, list) and not content:
            continue
        llm_messages.append({"role": msg["role"], "content": content})

    # Prepend the current version to the final user message so the LLM sees
    # manual edits without changing the (cacheable) system prompt or history.
    # Skipped for multimodal messages (list content) since those are image/PDF
    # payloads where prepending plain text would break the content structure.
    if rewritten_content and rewritten_content != original_content and llm_messages:
        last = llm_messages[-1]
        if last["role"] == "user" and isinstance(last["content"], str):
            last["content"] = (
                f"[The song has been manually edited. Current version:]\n"
                f"{rewritten_content}\n\n"
                f"{last['content']}"
            )

    # Add prompt caching breakpoints for providers that support it.
    # Mark the last history message so the provider caches everything up to it.
    if provider in _CACHEABLE_PROVIDERS and history_len > 0 and len(llm_messages) > 1:
        # history_len is the count of history messages; the last one is at index history_len - 1
        # (but some may have been skipped due to empty content, so clamp to actual length)
        cache_idx = min(history_len - 1, len(llm_messages) - 2)
        if cache_idx >= 0:
            _add_cache_breakpoint(llm_messages[cache_idx])

    from ..config import settings

    thinking, output_config = _resolve_thinking(reasoning_effort)

    return LLMCallParams(
        model=model,
        provider=provider,
        messages=llm_messages,
        system=system_content,
        max_tokens=max_tokens if max_tokens is not None else settings.default_max_tokens,
        api_base=api_base,
        api_key=api_key,
        thinking=thinking,
        output_config=output_config,
    )


async def chat_edit_content(
    original_content: str,
    messages: list[dict[str, object]],
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
    history_len: int = 0,
    rewritten_content: str | None = None,
) -> dict[str, Any]:
    """Process a chat-based content edit (non-streaming).

    Builds system context with original + current content and the conversation history,
    sends to LLM, parses the response for updated content.

    ``rewritten_content`` is ``None`` when the LLM responded conversationally
    without ``<content>`` tags.
    """
    params = _build_chat_params(
        original_content,
        messages,
        provider,
        model,
        api_base,
        reasoning_effort,
        system_prompt,
        max_tokens,
        api_key,
        history_len=history_len,
        rewritten_content=rewritten_content,
    )
    response = cast("MessageResponse", await params.send())

    raw_response = _get_content(response)
    parsed = _parse_chat_response(raw_response)
    reasoning = _get_reasoning(response)
    usage = _get_usage(response)

    # Build a changes summary
    changes_summary = parsed["explanation"] or "Chat edit applied."

    return {
        "rewritten_content": parsed["content"],
        "original_content": parsed["original_content"],
        "assistant_message": raw_response,
        "changes_summary": changes_summary,
        "reasoning": reasoning,
        "usage": usage,
    }


async def chat_edit_content_stream(
    original_content: str,
    messages: list[dict[str, object]],
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
    history_len: int = 0,
    rewritten_content: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """Stream a chat-based content edit token by token as ``(type, text)`` tuples.

    Types: ``"token"`` for content, ``"reasoning"`` for reasoning/thinking,
    ``"usage"`` for final token usage JSON.
    """
    params = _build_chat_params(
        original_content,
        messages,
        provider,
        model,
        api_base,
        reasoning_effort,
        system_prompt,
        max_tokens,
        api_key,
        history_len=history_len,
        rewritten_content=rewritten_content,
    )
    response = cast(
        "AsyncIterator[MessageStreamEvent]",
        await params.send(stream=True),
    )

    input_usage: dict[str, int | None] = {}

    async for event in response:
        if event.type == "message_start" and event.message:
            u = event.message.usage
            input_usage = {
                "input_tokens": u.input_tokens,
                "cache_creation_input_tokens": u.cache_creation_input_tokens,
                "cache_read_input_tokens": u.cache_read_input_tokens,
            }
        elif event.type == "content_block_delta" and event.delta:
            if event.delta.type == "text_delta":
                yield ("token", event.delta.text)
            elif event.delta.type == "thinking_delta":
                yield ("reasoning", event.delta.thinking)
        elif event.type == "message_delta" and event.usage:
            usage_data: dict[str, int | None] = {
                # Some gateway models report input tokens only on message_delta
                # rather than message_start; prefer whichever is non-zero.
                "input_tokens": (input_usage.get("input_tokens") or 0)
                or (getattr(event.usage, "input_tokens", None) or 0),
                "output_tokens": event.usage.output_tokens,
            }
            cache_create = input_usage.get("cache_creation_input_tokens")
            cache_read = input_usage.get("cache_read_input_tokens")
            if cache_create is not None:
                usage_data["cache_creation_input_tokens"] = cache_create
            if cache_read is not None:
                usage_data["cache_read_input_tokens"] = cache_read
            yield ("usage", json.dumps(usage_data))


FOLLOW_ARBITER_SYSTEM_PROMPT = """You help a live lyric-following app decide which line of a song a \
singer is currently on.

The app already narrowed it to a few candidate lines that all match the recent audio about equally \
(for example a chorus line that repeats in several verses). Using the recent recognized words and \
where the singer was a moment ago, pick the single most likely candidate.

Reply with ONLY the numeric id of the best candidate. If you genuinely cannot tell, reply with -1. \
Output nothing else."""


async def disambiguate_position(
    *,
    recent_words: str,
    candidates: list[dict[str, Any]],
    current_index: int | None,
    provider: str,
    model: str,
    api_base: str | None = None,
    api_key: str | None = None,
    max_tokens: int = 64,
) -> dict[str, int | None]:
    """Pick the best candidate line id for the lyric follower.

    ``candidates`` is a list of ``{"index": int, "context": str}``. Returns
    ``{"choice": <candidate index>}`` or ``{"choice": None}`` when the model is
    unsure or replies with an id outside the candidate set.
    """
    valid_ids = {int(c["index"]) for c in candidates}
    parts = [f'Recent recognized words: "{recent_words}"']
    if current_index is not None:
        parts.append(f"A moment ago the singer was near candidate id {current_index}.")
    parts.append("Candidates:")
    for c in candidates:
        parts.append(f"[id {int(c['index'])}]\n{str(c.get('context', '')).strip()}")
    parts.append("Which candidate id is the singer most likely on? Reply with only the id number.")

    params = LLMCallParams(
        model=model,
        provider=provider,
        messages=[{"role": "user", "content": "\n".join(parts)}],
        system=FOLLOW_ARBITER_SYSTEM_PROMPT,
        max_tokens=max_tokens,
        api_base=api_base,
        api_key=api_key,
    )
    response = cast("MessageResponse", await params.send())
    text = _get_content(response)

    match = re.search(r"-?\d+", text)
    choice: int | None = None
    if match:
        value = int(match.group())
        if value in valid_ids:
            choice = value
    return {"choice": choice}


# ── Tag suggestion ──────────────────────────────────────────────────────────
# Filing a chart is a one-word answer, so this call is deliberately the cheapest
# thing in the app. The caps below keep both sides of it small: a truncated
# chart and a bounded tag list going in, a 64-token ceiling coming out. That
# ceiling is what makes the price honest: premium bills
# ``max(1, ceil(output_tokens / 100))``, so anything at or under 100 output
# tokens is one credit and no more.
#
# Enforced in two places, deliberately. Premium's guard rewrites max_tokens on
# the way through, which covers every hosted request whatever the client asked
# for; ``TagSuggestRequest`` bounds the field so a self-hosted install without
# that guard cannot be talked into a larger answer either.
TAG_SUGGEST_MAX_OUTPUT_TOKENS = 96

# How much of the chart the model sees. The opening lines carry the title,
# artist and mood; the remaining verses add tokens without adding signal.
TAG_SUGGEST_CONTENT_CHARS = 1200

# Upper bound on how many of the user's tags are offered as choices.
TAG_SUGGEST_MAX_CHOICES = 20

# Upper bound on how many existing tags come back ranked.
TAG_SUGGEST_MAX_PICKS = 4

# Upper bound on how many tags the model may invent in one reply.
TAG_SUGGEST_MAX_NEW = 2

# Mirrors the limit the write path enforces (``clean_tags``, and
# ``TagRename.name`` for a rename). A longer name would be rejected by the
# ``PUT`` the user's tap turns into, so proposing one would offer a dead button.
FOLDER_NAME_MAX_CHARS = 100

TAG_SUGGEST_SYSTEM_PROMPT = """You help a musician tag a chord chart.

You are given a chart and the numbered list of tags the musician already uses. A song carries as \
many tags as suit it, so pick every existing tag that fits and propose new ones where a good tag \
is missing.

Reply with ONE line of JSON and nothing else:
{"existing": [2, 1], "new": ["Carter Family", "waltz"]}

- "existing": up to 4 numbers from the list, best fit first. Use [] when none of them fit.
- "new": up to 2 short tag names, at most three words each, that would suit this chart. Use [] \
when the existing tags already cover it.
- Never use a number that is not in the list, and never invent a tag that is already listed.
- Prefer what the song *is* over what it is about: instrument, genre, feel, key, who wrote it.

Say nothing else. No explanation, no code fences."""


def _parse_tag_suggestions(
    raw: str,
    offered_tags: list[str],
    all_tags: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Turn the model's reply into ranked, validated tag suggestions.

    Existing tags are referenced by number rather than by name so a creative
    or truncated reply cannot smuggle in a tag the user does not have:
    anything outside the offered list is dropped. Only ``new`` is free text, and
    it is squeezed onto one line and cut to the same limit the write path
    enforces.

    ``offered_tags`` is what the prompt numbered, so it is what an ``existing``
    index resolves against. ``all_tags`` is every tag the user has, which
    may be longer: only the first TAG_SUGGEST_MAX_CHOICES are offered, and a
    proposed name has to be checked against the whole library or a tag the
    user already has would come back badged "New tag".

    Returns ``[{"tag": str, "is_new": bool}, ...]`` with existing tags first,
    or ``[]`` when nothing usable came back.
    """
    if all_tags is None:
        all_tags = offered_tags
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        parsed = json.loads(raw[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(parsed, dict):
        return []

    suggestions: list[dict[str, Any]] = []
    seen: set[str] = set()

    raw_existing = parsed.get("existing")
    if isinstance(raw_existing, list):
        for entry in raw_existing:
            if len(suggestions) >= TAG_SUGGEST_MAX_PICKS:
                break
            name = _resolve_existing_tag(entry, offered_tags)
            if name is None or name.casefold() in seen:
                continue
            seen.add(name.casefold())
            suggestions.append({"tag": name, "is_new": False})

    raw_new = parsed.get("new")
    # A list now, because a song carries several tags. A bare string is still
    # accepted: it is what the old prompt asked for, and a model that has seen
    # this shape before will sometimes answer that way regardless.
    if isinstance(raw_new, str):
        raw_new = [raw_new]
    if not isinstance(raw_new, list):
        raw_new = []
    for candidate in raw_new[:TAG_SUGGEST_MAX_NEW]:
        if not isinstance(candidate, str):
            continue
        new_name = " ".join(candidate.split())[:FOLDER_NAME_MAX_CHARS].strip()
        if new_name and new_name.casefold() not in seen:
            # A "new" tag that already exists is an existing tag, and
            # offering it twice would let one tap look like two different
            # outcomes. Matched against every tag the user has rather than
            # just the offered slice: past TAG_SUGGEST_MAX_CHOICES there are
            # tags the model never saw, so it proposes them as new. Those are
            # good suggestions, they are simply not new, and badging one "New
            # tag" would tell the user their library is about to grow when it
            # is not.
            match = next((f for f in all_tags if f.casefold() == new_name.casefold()), None)
            if match is None:
                seen.add(new_name.casefold())
                suggestions.append({"tag": new_name, "is_new": True})
            else:
                seen.add(match.casefold())
                suggestions.append({"tag": match, "is_new": False})

    return suggestions


def _resolve_existing_tag(entry: object, existing_tags: list[str]) -> str | None:
    """Resolve one ``existing`` entry to a tag the user actually has.

    Accepts the 1-based number the prompt asks for, and also tolerates a model
    that echoes the tag name instead. Returns None for anything else.
    """
    if isinstance(entry, bool):
        return None
    if isinstance(entry, int):
        index = entry
    elif isinstance(entry, str):
        stripped = entry.strip()
        if stripped.lstrip("-").isdigit():
            index = int(stripped)
        else:
            for tag in existing_tags:
                if tag.casefold() == stripped.casefold():
                    return tag
            return None
    else:
        return None
    if 1 <= index <= len(existing_tags):
        return existing_tags[index - 1]
    return None


async def suggest_tags(
    *,
    title: str | None,
    artist: str | None,
    content: str,
    existing_tags: list[str],
    provider: str,
    model: str,
    api_base: str | None = None,
    api_key: str | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Suggest tags for a chord chart, ranking the user's own tags first.

    Returns ``{"suggestions": [{"tag", "is_new"}, ...], "usage": {...}}``.
    Suggestions may be empty; the caller decides what to fall back to. Nothing
    here writes to a song: this only proposes.
    """
    parts = ["CHART"]
    parts.append(f"Title: {(title or '').strip() or 'Unknown'}")
    parts.append(f"Artist: {(artist or '').strip() or 'Unknown'}")
    excerpt = content.strip()[:TAG_SUGGEST_CONTENT_CHARS]
    if excerpt:
        parts.append(f"Opening lines:\n{excerpt}")

    choices = existing_tags[:TAG_SUGGEST_MAX_CHOICES]
    parts.append("")
    if choices:
        parts.append("EXISTING FOLDERS")
        parts.extend(f"{i}. {name}" for i, name in enumerate(choices, start=1))
    else:
        parts.append("EXISTING FOLDERS\n(none yet, so propose a new one)")

    params = LLMCallParams(
        model=model,
        provider=provider,
        messages=[{"role": "user", "content": "\n".join(parts)}],
        system=TAG_SUGGEST_SYSTEM_PROMPT,
        max_tokens=max_tokens if max_tokens is not None else TAG_SUGGEST_MAX_OUTPUT_TOKENS,
        api_base=api_base,
        api_key=api_key,
    )
    response = cast("MessageResponse", await params.send())

    return {
        "suggestions": _parse_tag_suggestions(_get_content(response), choices, existing_tags),
        "usage": _get_usage(response),
    }
