from __future__ import annotations

import os
import re
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from any_llm import LLMProvider, acompletion, alist_models

if TYPE_CHECKING:
    from collections.abc import Iterator

    from any_llm.types.completion import ChatCompletion, ChatCompletionChunk

    from ..models import Song


def _get_content(response: ChatCompletion | Iterator[ChatCompletionChunk]) -> str:
    """Extract text content from a completion response, raising on empty."""
    content = response.choices[0].message.content  # type: ignore[union-attr]
    if content is None:
        raise ValueError("LLM returned empty response")
    return content


def _get_usage(response: ChatCompletion) -> dict[str, int] | None:
    """Extract token usage from a completion response, if present."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    return {
        "input_tokens": getattr(usage, "prompt_tokens", 0) or 0,
        "output_tokens": getattr(usage, "completion_tokens", 0) or 0,
    }


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
that becomes the new current version for subsequent turns."""

ABC_SYSTEM_PROMPT = """You are PorchSongs, a song lyric editing assistant that generates ABC music notation. \
You are part of the PorchSongs application, which helps users rewrite and customize song lyrics. \
Your job is to convert a song with chord/lyric format into valid ABC notation for sheet music rendering.

STEP 1 - ASSESS the song:
- Does it have chord symbols (e.g. G, Am, C7, Dm)?
- Can you determine or infer the key from the chord progression?
- Can you determine or infer the time signature?
- Can you determine or infer the tempo?

STEP 2 - DECIDE:

IF the song has chord symbols:
Generate valid ABC notation wrapped in <abc> tags. Include:
- X: reference number (always 1)
- T: title (from song title if provided, otherwise "Untitled")
- M: time signature (default 4/4 if not explicit)
- L: default note length (typically 1/4 or 1/8)
- Q: tempo (default 1/4=120 if not explicit)
- K: key (infer from chord progression if not explicit)
- Use quoted chord syntax: "G" "Am" "C" etc. above the notes
- Use w: lines for lyrics below each music line
- Use sensible note durations that match natural speech rhythm
- Use | for bar lines and |] for the final bar line
- Use [| for section starts when appropriate
- Keep it simple and playable: one note per syllable is fine

Example format:
<abc>
X:1
T:Example Song
M:4/4
L:1/4
Q:1/4=120
K:G
"G"B2 B A | "C"G2 G E | "D"D2 D F | "G"G4 |
w:Hel-lo how are you to-day my dear friend
</abc>

After the closing </abc> tag, briefly explain any assumptions you made (key, tempo, time signature).

IF the song lacks chord symbols entirely:
Return helpful tips wrapped in <tips> tags explaining what information is needed \
to generate sheet music.

Example:
<tips>
This song doesn't have chord symbols yet. To generate sheet music, the song needs:
- Chord symbols above the lyrics (e.g. G, Am, C)
- Optionally: key signature, time signature, and tempo markings

You can add chords using the chat workshop, then try generating sheet music again.
</tips>

IMPORTANT:
- Only respond with <abc> OR <tips>, never both
- Do NOT engage in discussions unrelated to music or song notation
- Preserve the original song structure (verses, choruses, bridges) in the ABC notation"""

_LOCAL_PROVIDERS = {"ollama", "llamafile", "llamacpp", "lmstudio", "vllm"}

# Meta-providers that proxy to other providers and should not be directly selectable.
_HIDDEN_PROVIDERS = {"platform"}


def is_platform_enabled() -> bool:
    """Return True when the Any LLM Platform key is configured."""
    return bool(os.getenv("ANY_LLM_KEY"))


def get_configured_providers() -> list[dict[str, object]]:
    """Return all known providers. Actual validation happens when listing models."""
    return [
        {"name": p.value, "local": p.value in _LOCAL_PROVIDERS}
        for p in LLMProvider
        if p.value not in _HIDDEN_PROVIDERS
    ]


async def get_models(provider: str, api_base: str | None = None) -> list[str]:
    """Fetch available models for a provider using env-var credentials."""
    kwargs: dict[str, str] = {"provider": provider}
    if api_base:
        kwargs["api_base"] = api_base
    raw = await alist_models(**kwargs)
    return [m.id if hasattr(m, "id") else str(m) for m in raw]


def _build_parse_kwargs(
    content: str,
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    instruction: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> dict[str, object]:
    """Build the common kwargs dict for parse LLM calls."""
    user_text = "Clean up this pasted input. Identify the title and artist."
    if instruction:
        user_text += f"\n\nUSER INSTRUCTIONS:\n{instruction}"
    user_text += f"\n\nPASTED INPUT:\n{content}"

    kwargs: dict[str, object] = {
        "model": model,
        "provider": provider,
        "messages": [
            {"role": "system", "content": system_prompt or CLEAN_SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
    }
    if api_base:
        kwargs["api_base"] = api_base
    if api_key:
        kwargs["api_key"] = api_key
    # Always pass reasoning_effort explicitly. any_llm defaults to "auto" which
    # lets Anthropic enable extended thinking automatically — causing max_tokens
    # vs budget_tokens conflicts. Passing None tells any_llm to disable thinking.
    kwargs["reasoning_effort"] = reasoning_effort
    from ..config import settings

    kwargs["max_tokens"] = max_tokens if max_tokens is not None else settings.default_max_tokens
    return kwargs


def _get_reasoning(response: ChatCompletion) -> str | None:
    """Extract reasoning content from a completion response, if present."""
    msg = response.choices[0].message  # type: ignore[union-attr]
    reasoning = getattr(msg, "reasoning", None)
    if reasoning is not None:
        reasoning_content = getattr(reasoning, "content", None)
        if reasoning_content:
            return str(reasoning_content)
    return None


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
) -> dict[str, str | None]:
    """Clean up raw pasted content and identify title/artist (non-streaming).

    Returns dict with: original_content, title, artist, reasoning
    """
    kwargs = _build_parse_kwargs(
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
    clean_response = await acompletion(**kwargs)
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

    Types: ``"token"`` for content, ``"reasoning"`` for reasoning/thinking.
    """
    kwargs = _build_parse_kwargs(
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
    if provider == "openai":
        kwargs["stream_options"] = {"include_usage": True}
    response = await acompletion(stream=True, **kwargs)

    import json

    async for chunk in response:
        if not chunk.choices:  # type: ignore[union-attr]
            continue
        delta = chunk.choices[0].delta  # type: ignore[union-attr]
        if delta:
            reasoning = getattr(delta, "reasoning", None)
            if reasoning is not None:
                reasoning_content = getattr(reasoning, "content", None)
                if reasoning_content:
                    yield ("reasoning", str(reasoning_content))
            if delta.content:
                yield ("token", delta.content)

        # Check for usage in the chunk (sent in the final chunk by most providers)
        chunk_usage = getattr(chunk, "usage", None)
        if chunk_usage is not None:
            usage_data = {
                "input_tokens": getattr(chunk_usage, "prompt_tokens", 0) or 0,
                "output_tokens": getattr(chunk_usage, "completion_tokens", 0) or 0,
            }
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


def _build_chat_kwargs(
    song: Song,
    messages: list[dict[str, object]],
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> dict[str, object]:
    """Build the common kwargs dict for chat LLM calls."""
    system_content = system_prompt or CHAT_SYSTEM_PROMPT
    system_content += "\n\nORIGINAL SONG:\n" + song.original_content

    llm_messages: list[dict[str, object]] = [{"role": "system", "content": system_content}]
    for msg in messages:
        content = msg["content"]
        # Skip messages with empty content - LLM providers reject them.
        if isinstance(content, str) and not content:
            continue
        if isinstance(content, list) and not content:
            continue
        llm_messages.append({"role": msg["role"], "content": content})

    kwargs: dict[str, object] = {
        "model": model,
        "provider": provider,
        "messages": llm_messages,
    }
    if api_base:
        kwargs["api_base"] = api_base
    if api_key:
        kwargs["api_key"] = api_key
    # Always pass reasoning_effort explicitly. any_llm defaults to "auto" which
    # lets Anthropic enable extended thinking automatically — causing max_tokens
    # vs budget_tokens conflicts. Passing None tells any_llm to disable thinking.
    kwargs["reasoning_effort"] = reasoning_effort
    from ..config import settings

    kwargs["max_tokens"] = max_tokens if max_tokens is not None else settings.default_max_tokens
    return kwargs


async def chat_edit_content(
    song: Song,
    messages: list[dict[str, object]],
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> dict[str, str | None]:
    """Process a chat-based content edit (non-streaming).

    Builds system context with original + current content and the conversation history,
    sends to LLM, parses the response for updated content.

    ``rewritten_content`` is ``None`` when the LLM responded conversationally
    without ``<content>`` tags.
    """
    kwargs = _build_chat_kwargs(
        song,
        messages,
        provider,
        model,
        api_base,
        reasoning_effort,
        system_prompt,
        max_tokens,
        api_key,
    )
    response = await acompletion(**kwargs)

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
    song: Song,
    messages: list[dict[str, object]],
    provider: str,
    model: str,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """Stream a chat-based content edit token by token as ``(type, text)`` tuples.

    Types: ``"token"`` for content, ``"reasoning"`` for reasoning/thinking,
    ``"usage"`` for final token usage JSON.
    """
    kwargs = _build_chat_kwargs(
        song,
        messages,
        provider,
        model,
        api_base,
        reasoning_effort,
        system_prompt,
        max_tokens,
        api_key,
    )
    if provider == "openai":
        kwargs["stream_options"] = {"include_usage": True}
    response = await acompletion(stream=True, **kwargs)

    import json

    async for chunk in response:
        if not chunk.choices:  # type: ignore[union-attr]
            continue
        delta = chunk.choices[0].delta  # type: ignore[union-attr]
        if delta:
            reasoning = getattr(delta, "reasoning", None)
            if reasoning is not None:
                reasoning_content = getattr(reasoning, "content", None)
                if reasoning_content:
                    yield ("reasoning", str(reasoning_content))
            if delta.content:
                yield ("token", delta.content)

        # Check for usage in the chunk (sent in the final chunk by most providers)
        chunk_usage = getattr(chunk, "usage", None)
        if chunk_usage is not None:
            usage_data = {
                "input_tokens": getattr(chunk_usage, "prompt_tokens", 0) or 0,
                "output_tokens": getattr(chunk_usage, "completion_tokens", 0) or 0,
            }
            yield ("usage", json.dumps(usage_data))


def _parse_abc_response(raw: str) -> dict[str, str | None]:
    """Parse LLM response for ABC generation.

    Returns dict with ``abc``, ``tips``, and ``explanation``.
    """
    abc = _extract_xml_section(raw, "abc")
    tips = _extract_xml_section(raw, "tips")

    explanation: str | None = None
    if abc is not None:
        after = raw.split("</abc>", 1)
        explanation = after[1].strip() if len(after) > 1 else None
    elif tips is not None:
        after = raw.split("</tips>", 1)
        explanation = after[1].strip() if len(after) > 1 else None

    return {"abc": abc, "tips": tips, "explanation": explanation or None}


def _build_abc_kwargs(
    content: str,
    provider: str,
    model: str,
    title: str | None = None,
    artist: str | None = None,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> dict[str, object]:
    """Build the common kwargs dict for ABC generation LLM calls."""
    user_text = "Generate ABC notation for this song."
    if title:
        user_text += f"\nTitle: {title}"
    if artist:
        user_text += f"\nArtist: {artist}"
    user_text += f"\n\nSONG CONTENT:\n{content}"

    kwargs: dict[str, object] = {
        "model": model,
        "provider": provider,
        "messages": [
            {"role": "system", "content": ABC_SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
    }
    if api_base:
        kwargs["api_base"] = api_base
    if api_key:
        kwargs["api_key"] = api_key
    kwargs["reasoning_effort"] = reasoning_effort
    from ..config import settings

    kwargs["max_tokens"] = max_tokens if max_tokens is not None else settings.default_max_tokens
    return kwargs


async def generate_abc(
    content: str,
    provider: str,
    model: str,
    title: str | None = None,
    artist: str | None = None,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> dict[str, str | None]:
    """Generate ABC notation from song content (non-streaming).

    Returns dict with: abc, tips, explanation, reasoning, usage
    """
    kwargs = _build_abc_kwargs(
        content,
        provider,
        model,
        title,
        artist,
        api_base,
        reasoning_effort,
        max_tokens,
        api_key,
    )
    response = await acompletion(**kwargs)
    raw = _get_content(response)
    parsed = _parse_abc_response(raw)
    reasoning = _get_reasoning(response)
    usage = _get_usage(response)

    return {
        "abc": parsed["abc"],
        "tips": parsed["tips"],
        "explanation": parsed["explanation"],
        "reasoning": reasoning,
        "usage": usage,
    }


async def generate_abc_stream(
    content: str,
    provider: str,
    model: str,
    title: str | None = None,
    artist: str | None = None,
    api_base: str | None = None,
    reasoning_effort: str | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """Stream ABC generation tokens as ``(type, text)`` tuples.

    Types: ``"token"`` for content, ``"reasoning"`` for reasoning/thinking,
    ``"usage"`` for final token usage JSON.
    """
    kwargs = _build_abc_kwargs(
        content,
        provider,
        model,
        title,
        artist,
        api_base,
        reasoning_effort,
        max_tokens,
        api_key,
    )
    if provider == "openai":
        kwargs["stream_options"] = {"include_usage": True}
    response = await acompletion(stream=True, **kwargs)

    import json

    async for chunk in response:
        if not chunk.choices:  # type: ignore[union-attr]
            continue
        delta = chunk.choices[0].delta  # type: ignore[union-attr]
        if delta:
            reasoning = getattr(delta, "reasoning", None)
            if reasoning is not None:
                reasoning_content = getattr(reasoning, "content", None)
                if reasoning_content:
                    yield ("reasoning", str(reasoning_content))
            if delta.content:
                yield ("token", delta.content)

        chunk_usage = getattr(chunk, "usage", None)
        if chunk_usage is not None:
            usage_data = {
                "input_tokens": getattr(chunk_usage, "prompt_tokens", 0) or 0,
                "output_tokens": getattr(chunk_usage, "completion_tokens", 0) or 0,
            }
            yield ("usage", json.dumps(usage_data))
