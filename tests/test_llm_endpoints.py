"""Tests for endpoints that call the LLM, using mocked amessages/list_models."""

import asyncio
import base64
from collections.abc import AsyncIterator
from io import BytesIO
from typing import Any
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import ChatMessage as ChatMessageModel
from app.models import Song, SongRevision


def _fake_message_response(text: str) -> MagicMock:
    """Build a mock object that looks like a MessageResponse."""
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = text
    text_block.thinking = None

    usage = MagicMock()
    usage.input_tokens = 10
    usage.output_tokens = 20
    usage.cache_creation_input_tokens = None
    usage.cache_read_input_tokens = None

    resp = MagicMock()
    resp.content = [text_block]
    resp.usage = usage
    return resp


def _make_profile_and_song(client: TestClient) -> tuple[dict[str, Any], dict[str, Any]]:
    """Helper: create a profile and a song, return (profile, song)."""
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Test",
        },
    ).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "title": "Test Song",
            "artist": "Test Artist",
            "original_content": "G  Am\nHello world\nDm  G\nGoodbye moon",
            "rewritten_content": "G  Am\nHi there world\nDm  G\nSee ya moon",
            "changes_summary": "Changed hello to hi",
        },
    ).json()
    return profile, song


LLM_SETTINGS = {
    "provider": "openai",
    "model": "gpt-4o-mini",
}


# --- POST /api/parse ---


@patch("app.services.llm_service.amessages")
def test_parse_endpoint(mock_amessages: MagicMock, client: TestClient) -> None:
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Nathan",
        },
    ).json()

    mock_amessages.return_value = _fake_message_response(
        "<meta>\nTitle: Test Song\nArtist: Test Artist\n</meta>\n"
        "<original>\nG  Am\nHello world\nDm  G\nGoodbye moon\n</original>"
    )

    resp = client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "G  Am\nHello world\nDm  G\nGoodbye moon",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "Hello world" in data["original_content"]
    assert data["title"] == "Test Song"
    assert data["artist"] == "Test Artist"

    # Verify only 1 LLM call (cleanup only, no rewrite)
    assert mock_amessages.call_count == 1
    # System prompt should be passed as a separate 'system' kwarg, not in messages
    call_kwargs = mock_amessages.call_args.kwargs
    assert "system" in call_kwargs
    messages = call_kwargs.get("messages", [])
    assert not any(m.get("role") == "system" for m in messages), (
        "system prompt should not be in messages list"
    )


@patch("app.services.llm_service.amessages")
def test_parse_unknown_title_artist(mock_amessages: MagicMock, client: TestClient) -> None:
    """Parse with UNKNOWN title/artist should return null."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    mock_amessages.return_value = _fake_message_response(
        "<meta>\nTitle: UNKNOWN\nArtist: UNKNOWN\n</meta>\n"
        "<original>\nOriginal line one\nOriginal line two\n</original>"
    )

    resp = client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "Original line one\nOriginal line two",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] is None
    assert data["artist"] is None
    assert "Original line one" in data["original_content"]


def test_parse_profile_not_found(client: TestClient) -> None:
    resp = client.post(
        "/api/parse",
        json={
            "profile_id": 9999,
            "content": "Hello",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 404


@patch("app.services.llm_service.amessages")
def test_parse_llm_error(mock_amessages: MagicMock, client: TestClient) -> None:
    """LLM throwing an exception should return 502."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()
    mock_amessages.side_effect = RuntimeError("API rate limit exceeded")

    resp = client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "Hello world",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 502
    assert "Something went wrong" in resp.json()["detail"]
    # Raw exception details should NOT leak to the client
    assert "rate limit" not in resp.json()["detail"]


# --- POST /api/parse/image ---


@patch("app.services.llm_service.amessages")
def test_parse_image_endpoint(mock_amessages: MagicMock, client: TestClient) -> None:
    """Image extract endpoint returns extracted text."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    mock_amessages.return_value = _fake_message_response("G  Am\nHello world\nDm  G\nGoodbye moon")

    resp = client.post(
        "/api/parse/image",
        json={
            "profile_id": profile["id"],
            "image": "data:image/png;base64,iVBORw0KGgo=",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "Hello world" in data["text"]

    # Verify the LLM received multimodal content (image + text)
    call_kwargs = mock_amessages.call_args.kwargs
    messages = call_kwargs.get("messages", [])
    assert len(messages) == 1
    content = messages[0]["content"]
    assert isinstance(content, list)
    assert any(block.get("type") == "image_url" for block in content)
    assert any(block.get("type") == "text" for block in content)


@patch("app.services.llm_service.amessages")
def test_parse_image_llm_error(mock_amessages: MagicMock, client: TestClient) -> None:
    """LLM error during image extract should return 502."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()
    mock_amessages.side_effect = RuntimeError("Vision model not available")

    resp = client.post(
        "/api/parse/image",
        json={
            "profile_id": profile["id"],
            "image": "data:image/png;base64,iVBORw0KGgo=",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 502


def test_parse_image_profile_not_found(client: TestClient) -> None:
    """Missing profile should return 404."""
    resp = client.post(
        "/api/parse/image",
        json={
            "profile_id": 9999,
            "image": "data:image/png;base64,iVBORw0KGgo=",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 404


# --- POST /api/chat ---


@patch("app.services.llm_service.amessages")
def test_chat_endpoint(mock_amessages: MagicMock, client: TestClient) -> None:
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response(
        "<content>\nHi there world\nCatch ya moon\n</content>\nI changed 'see ya' to 'catch ya'."
    )

    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [
                {"role": "user", "content": "Change 'see ya' to 'catch ya'"},
            ],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert (
        "catch ya" in data["rewritten_content"].lower() or "Catch ya" in data["rewritten_content"]
    )
    assert "assistant_message" in data
    assert data["version"] == 2  # bumped from 1


@patch("app.services.llm_service.amessages")
def test_chat_persists_changes(mock_amessages: MagicMock, client: TestClient) -> None:
    """Chat edits should be persisted to the song and create a revision."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response(
        "<content>\nUpdated line one\nUpdated line two\n</content>\nChanged everything."
    )

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Rewrite everything"}],
            **LLM_SETTINGS,
        },
    )

    # Check the song was updated
    song_resp = client.get(f"/api/songs/{song['id']}")
    assert song_resp.json()["current_version"] == 2

    # Check a revision was created
    revisions = client.get(f"/api/songs/{song['id']}/revisions").json()
    assert len(revisions) == 2  # initial + chat edit
    assert revisions[1]["edit_type"] == "chat"


@patch("app.services.llm_service.amessages")
def test_chat_persists_messages(mock_amessages: MagicMock, client: TestClient) -> None:
    """POST /api/chat should create ChatMessage rows for user + assistant."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response(
        "<content>\nUpdated line one\nUpdated line two\n</content>\nChanged everything."
    )

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Rewrite everything"}],
            **LLM_SETTINGS,
        },
    )

    # Check that chat messages were persisted
    msgs = client.get(f"/api/songs/{song['id']}/messages").json()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "Rewrite everything"
    assert msgs[0]["is_note"] is False
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["is_note"] is False


@patch("app.services.llm_service.amessages")
def test_chat_conversational_no_content(mock_amessages: MagicMock, client: TestClient) -> None:
    """When the LLM responds without <content> tags, no version bump or revision is created."""
    _, song = _make_profile_and_song(client)
    original_version = song["current_version"]

    mock_amessages.return_value = _fake_message_response(
        "Sure! The rhyme scheme in verse 2 is ABAB. Want me to change it?"
    )

    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "What's the rhyme scheme in verse 2?"}],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()

    # No content returned
    assert data["rewritten_content"] is None
    # Version should NOT be bumped
    assert data["version"] == original_version

    # Song in DB should be unchanged
    song_resp = client.get(f"/api/songs/{song['id']}")
    assert song_resp.json()["current_version"] == original_version

    # No new revision created (only the initial one from song creation)
    revisions = client.get(f"/api/songs/{song['id']}/revisions").json()
    assert len(revisions) == 1  # only the initial revision


@patch("app.services.llm_service.amessages")
def test_chat_stores_full_raw_response(mock_amessages: MagicMock, client: TestClient) -> None:
    """The assistant ChatMessage stored in DB should be the full raw LLM response."""
    _, song = _make_profile_and_song(client)

    raw_response = (
        "<content>\nNew line one\nNew line two\n</content>\nI rewrote both lines for clarity."
    )
    mock_amessages.return_value = _fake_message_response(raw_response)

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Rewrite both lines"}],
            **LLM_SETTINGS,
        },
    )

    msgs = client.get(f"/api/songs/{song['id']}/messages").json()
    assert len(msgs) == 2
    assistant_msg = msgs[1]
    assert assistant_msg["role"] == "assistant"
    # Should contain the full raw response, not just the summary
    assert "<content>" in assistant_msg["content"]
    assert "I rewrote both lines" in assistant_msg["content"]


@patch("app.services.llm_service.amessages")
def test_chat_conversational_stores_messages(mock_amessages: MagicMock, client: TestClient) -> None:
    """Conversational (no-content) responses should still persist chat messages."""
    _, song = _make_profile_and_song(client)

    conversational_response = "Great question! I think we could try an AABB scheme instead."
    mock_amessages.return_value = _fake_message_response(conversational_response)

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "What do you think about the rhyme scheme?"}],
            **LLM_SETTINGS,
        },
    )

    msgs = client.get(f"/api/songs/{song['id']}/messages").json()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == conversational_response


@patch("app.services.llm_service.amessages")
def test_chat_persists_user_message_before_llm_call(
    mock_amessages: MagicMock, client: TestClient
) -> None:
    """User message should be persisted even when the LLM call fails (e.g. cancellation)."""
    _, song = _make_profile_and_song(client)

    mock_amessages.side_effect = RuntimeError("connection cancelled")

    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Change the first verse"}],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 502  # LLM error

    # The user message should still be persisted in the DB
    msgs = client.get(f"/api/songs/{song['id']}/messages").json()
    assert len(msgs) == 1
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "Change the first verse"


def test_chat_song_not_found(client: TestClient) -> None:
    resp = client.post(
        "/api/chat",
        json={
            "song_id": 9999,
            "messages": [{"role": "user", "content": "hello"}],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 404


# --- GET /api/providers/{provider}/models ---


@patch("app.services.llm_service.alist_models")
def test_list_provider_models_success(mock_list_models: MagicMock, client: TestClient) -> None:
    mock_model = MagicMock()
    mock_model.id = "gpt-4o"
    mock_list_models.return_value = [mock_model]

    resp = client.get("/api/providers/openai/models")
    assert resp.status_code == 200
    data = resp.json()
    assert "gpt-4o" in data


@patch("app.services.llm_service.alist_models")
def test_list_provider_models_failure(mock_list_models: MagicMock, client: TestClient) -> None:
    mock_list_models.side_effect = RuntimeError("Invalid API key")

    resp = client.get("/api/providers/openai/models")
    assert resp.status_code == 502
    assert "OPENAI_API_KEY" in resp.json()["detail"]


# --- api_base passthrough tests ---


@patch("app.services.llm_service.amessages")
def test_parse_passes_api_base(mock_amessages: MagicMock, client: TestClient) -> None:
    """When a ProfileModel has api_base set, the parse call should pass it to amessages."""
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Local LLM User",
        },
    ).json()

    # Save a ProfileModel with api_base
    client.post(
        f"/api/profiles/{profile['id']}/models",
        json={
            "provider": "ollama",
            "model": "llama3",
            "api_base": "http://localhost:11434",
        },
    )

    mock_amessages.return_value = _fake_message_response(
        "<meta>\nTitle: UNKNOWN\nArtist: UNKNOWN\n</meta>\n<original>\nHello world\n</original>"
    )

    resp = client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "Hello world",
            "provider": "ollama",
            "model": "llama3",
        },
    )
    assert resp.status_code == 200

    assert mock_amessages.call_count == 1
    assert mock_amessages.call_args.kwargs.get("api_base") == "http://localhost:11434"


@patch("app.services.llm_service.amessages")
def test_parse_no_api_base_when_no_profile_model(
    mock_amessages: MagicMock, client: TestClient
) -> None:
    """When no ProfileModel exists, api_base should not be passed."""
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Cloud User",
        },
    ).json()

    mock_amessages.return_value = _fake_message_response(
        "<meta>\nTitle: UNKNOWN\nArtist: UNKNOWN\n</meta>\n<original>\nHello world\n</original>"
    )

    resp = client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "Hello world",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200

    assert mock_amessages.call_count == 1
    assert mock_amessages.call_args.kwargs.get("api_base") is None


@patch("app.services.llm_service.alist_models")
def test_list_models_with_api_base(mock_list_models: MagicMock, client: TestClient) -> None:
    """GET /providers/{provider}/models?api_base= should pass api_base to alist_models."""
    mock_model = MagicMock()
    mock_model.id = "llama3"
    mock_list_models.return_value = [mock_model]

    resp = client.get("/api/providers/ollama/models?api_base=http://localhost:11434")
    assert resp.status_code == 200
    assert "llama3" in resp.json()

    mock_list_models.assert_called_once()
    call_kwargs = mock_list_models.call_args.kwargs
    assert call_kwargs.get("api_base") == "http://localhost:11434"


# --- GET /api/prompts/defaults ---


def test_get_default_prompts(client: TestClient) -> None:
    resp = client.get("/api/prompts/defaults")
    assert resp.status_code == 200
    data = resp.json()
    assert "parse" in data
    assert "chat" in data
    assert "porchsongs" in data["parse"].lower()
    assert "song lyric editing assistant" in data["parse"].lower()
    assert "porchsongs" in data["chat"].lower()
    assert "song lyric editing assistant" in data["chat"].lower()


# --- System prompt fields on profiles ---


def test_profile_system_prompt_fields_roundtrip(client: TestClient) -> None:
    """Creating and updating profiles with system prompt fields."""
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Custom Prompts",
            "system_prompt_parse": "Custom parse prompt",
            "system_prompt_chat": "Custom chat prompt",
        },
    ).json()
    assert profile["system_prompt_parse"] == "Custom parse prompt"
    assert profile["system_prompt_chat"] == "Custom chat prompt"

    # Update to clear one prompt
    updated = client.put(
        f"/api/profiles/{profile['id']}",
        json={
            "system_prompt_parse": None,
        },
    ).json()
    assert updated["system_prompt_parse"] is None
    assert updated["system_prompt_chat"] == "Custom chat prompt"


@patch("app.services.llm_service.amessages")
def test_parse_uses_custom_system_prompt(mock_amessages: MagicMock, client: TestClient) -> None:
    """When a profile has a custom parse prompt, it should be used in the LLM call."""
    custom_prompt = "You are a CUSTOM parse assistant."
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Custom",
            "system_prompt_parse": custom_prompt,
        },
    ).json()

    mock_amessages.return_value = _fake_message_response(
        "<meta>\nTitle: Test\nArtist: Test\n</meta>\n<original>\nHello world\n</original>"
    )

    client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "Hello world",
            **LLM_SETTINGS,
        },
    )

    # System prompt is now a separate kwarg, not in messages
    assert mock_amessages.call_args.kwargs["system"] == custom_prompt


@patch("app.services.llm_service.amessages")
def test_chat_uses_custom_system_prompt(mock_amessages: MagicMock, client: TestClient) -> None:
    """When a profile has a custom chat prompt, it should be used in the LLM call."""
    custom_prompt = "You are a CUSTOM chat assistant."
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Custom Chat",
            "system_prompt_chat": custom_prompt,
        },
    ).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello world",
            "rewritten_content": "Hi there world",
        },
    ).json()

    mock_amessages.return_value = _fake_message_response("Just a conversational response.")

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Hello"}],
            **LLM_SETTINGS,
        },
    )

    # The system kwarg should start with the custom prompt (song content is appended)
    system_arg = mock_amessages.call_args.kwargs["system"]
    assert system_arg.startswith(custom_prompt)


# --- Multimodal (image) content tests ---


@patch("app.services.llm_service.amessages")
def test_chat_multimodal_content_passthrough(mock_amessages: MagicMock, client: TestClient) -> None:
    """Multimodal content (image + text) should be passed through to the LLM."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response(
        "I can see the chord chart. Looks like it's in the key of G."
    )

    multimodal_content = [
        {"type": "text", "text": "What chords are in this image?"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBOR..."}},
    ]

    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": multimodal_content}],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200

    # Verify the multimodal content was passed through to the LLM
    call_messages = mock_amessages.call_args.kwargs.get("messages", [])
    # Last message should have the multimodal content array
    user_msg = call_messages[-1]
    assert user_msg["role"] == "user"
    assert isinstance(user_msg["content"], list)
    assert user_msg["content"][0]["type"] == "text"
    assert user_msg["content"][1]["type"] == "image_url"


@patch("app.services.llm_service.amessages")
def test_chat_multimodal_display_text_only(mock_amessages: MagicMock, client: TestClient) -> None:
    """Messages endpoint returns text-only display content for multimodal messages."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response("I can see the chord chart.")

    multimodal_content = [
        {"type": "text", "text": "Describe this chord chart"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc123"}},
    ]

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": multimodal_content}],
            **LLM_SETTINGS,
        },
    )

    msgs = client.get(f"/api/songs/{song['id']}/messages").json()
    assert len(msgs) == 2
    # Display endpoint extracts text portion only
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "Describe this chord chart"
    assert "base64" not in msgs[0]["content"]


@patch("app.services.llm_service.amessages")
def test_chat_plain_string_still_works(mock_amessages: MagicMock, client: TestClient) -> None:
    """Plain string content should still work after the multimodal change."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response("Sure, here's some feedback.")

    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Give me feedback"}],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200

    msgs = client.get(f"/api/songs/{song['id']}/messages").json()
    assert msgs[0]["content"] == "Give me feedback"


@patch("app.services.llm_service.amessages")
def test_chat_image_only_displays_placeholder(
    mock_amessages: MagicMock, client: TestClient
) -> None:
    """Image-only messages display as '[Image]' but full content is preserved for LLM."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response("I can see the image.")

    image_only_content = [
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc123"}},
    ]

    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": image_only_content}],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200

    # Display endpoint shows placeholder
    msgs = client.get(f"/api/songs/{song['id']}/messages").json()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "[Image]"


@patch("app.services.llm_service.amessages")
def test_chat_after_image_preserves_multimodal_for_llm(
    mock_amessages: MagicMock, client: TestClient
) -> None:
    """Follow-up chat loads the full multimodal content (including image) for the LLM."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response("I can see the image.")

    image_content = [
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc123"}},
    ]

    # First chat: image-only
    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": image_content}],
            **LLM_SETTINGS,
        },
    )

    # Second chat: text follow-up
    mock_amessages.return_value = _fake_message_response("Here are some suggestions.")

    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Now improve the chorus"}],
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200

    # Verify the LLM received the full multimodal content from history, not a placeholder
    call_messages = mock_amessages.call_args.kwargs.get("messages", [])
    user_msgs = [m for m in call_messages if m["role"] == "user"]
    # First user message should be the deserialized multimodal content
    assert isinstance(user_msgs[0]["content"], list)
    assert user_msgs[0]["content"][0]["type"] == "image_url"
    # Second user message is plain text
    assert user_msgs[1]["content"] == "Now improve the chorus"


# --- Background stream completion (client disconnect recovery) ---


def test_finish_chat_in_background_persists_result(client: TestClient, db_session: Session) -> None:
    """When a client disconnects mid-stream, _finish_chat_in_background should
    consume remaining tokens and persist the result to the database."""
    from app.routers.rewrite import _finish_chat_in_background

    _, song_data = _make_profile_and_song(client)
    song_id = song_data["id"]

    # Verify starting state
    song = db_session.query(Song).filter(Song.id == song_id).first()
    assert song is not None
    assert song.current_version == 1

    # Simulate an async stream with remaining tokens (as if the client
    # disconnected after receiving some tokens but before the stream ended).
    async def _fake_remaining_stream() -> AsyncIterator[tuple[str, str]]:
        yield ("token", "\nBetter lyrics here")
        yield ("token", "\n</content>")
        yield ("token", "\nI improved the lyrics.")
        yield ("usage", '{"input_tokens": 10, "output_tokens": 20}')

    # The accumulated text so far (before disconnect) already has the opening tag.
    accumulated = "<content>\nHi there world"
    reasoning = "thinking about improvements"

    asyncio.run(
        _finish_chat_in_background(
            _fake_remaining_stream(),
            accumulated,
            reasoning,
            song_id,
            "gpt-4o-mini",
        )
    )

    # Refresh the session to see changes from the background task's own session
    db_session.expire_all()

    # Song should be updated with new content and bumped version
    song = db_session.query(Song).filter(Song.id == song_id).first()
    assert song is not None
    assert song.current_version == 2
    assert "Better lyrics here" in song.rewritten_content

    # A revision should have been created
    revisions = db_session.query(SongRevision).filter(SongRevision.song_id == song_id).all()
    assert len(revisions) == 2  # initial + background completion
    assert revisions[1].edit_type == "chat"

    # An assistant chat message should have been persisted
    messages = db_session.query(ChatMessageModel).filter(ChatMessageModel.song_id == song_id).all()
    assert any(m.role == "assistant" and m.model == "gpt-4o-mini" for m in messages)


# --- Prompt caching tests ---


@patch("app.services.llm_service.amessages")
def test_chat_anthropic_adds_cache_breakpoint(
    mock_amessages: MagicMock, client: TestClient
) -> None:
    """For anthropic provider, history messages should get cache breakpoints."""
    _, song = _make_profile_and_song(client)

    # First chat: builds history
    mock_amessages.return_value = _fake_message_response("First response.")
    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "First question"}],
            "provider": "anthropic",
            "model": "claude-sonnet-4-20250514",
        },
    )

    # Second chat: should add cache breakpoint to last history message
    mock_amessages.return_value = _fake_message_response("Second response.")
    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Second question"}],
            "provider": "anthropic",
            "model": "claude-sonnet-4-20250514",
        },
    )

    call_messages = mock_amessages.call_args.kwargs.get("messages", [])
    # The last history message (assistant's first response) should have cache_control
    # History is [user1, assistant1], new is [user2]
    # assistant1 is at index 1, and should have cache breakpoint
    history_assistant_msg = call_messages[1]
    assert history_assistant_msg["role"] == "assistant"
    content = history_assistant_msg["content"]
    # Content should be converted to block format with cache_control
    assert isinstance(content, list)
    assert content[0].get("cache_control") == {"type": "ephemeral"}


@patch("app.services.llm_service.amessages")
def test_chat_non_anthropic_no_cache_breakpoint(
    mock_amessages: MagicMock, client: TestClient
) -> None:
    """For non-anthropic providers, no cache breakpoints should be added."""
    _, song = _make_profile_and_song(client)

    # First chat: builds history
    mock_amessages.return_value = _fake_message_response("First response.")
    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "First question"}],
            **LLM_SETTINGS,
        },
    )

    # Second chat: no cache breakpoints for openai
    mock_amessages.return_value = _fake_message_response("Second response.")
    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Second question"}],
            **LLM_SETTINGS,
        },
    )

    call_messages = mock_amessages.call_args.kwargs.get("messages", [])
    # No message should have cache_control
    for msg in call_messages:
        content = msg["content"]
        if isinstance(content, str):
            continue  # plain string, no cache_control possible
        if isinstance(content, list):
            for block in content:
                assert "cache_control" not in block


# --- Usage with cache metrics ---


@patch("app.services.llm_service.amessages")
def test_parse_returns_cache_usage(mock_amessages: MagicMock, client: TestClient) -> None:
    """Parse endpoint should return cache token metrics when present."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    resp_mock = _fake_message_response(
        "<meta>\nTitle: Test\nArtist: Test\n</meta>\n<original>\nHello\n</original>"
    )
    resp_mock.usage.cache_creation_input_tokens = 100
    resp_mock.usage.cache_read_input_tokens = 50
    mock_amessages.return_value = resp_mock

    resp = client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "Hello",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["usage"]["cache_creation_input_tokens"] == 100
    assert data["usage"]["cache_read_input_tokens"] == 50


# --- Messages API format tests ---


@patch("app.services.llm_service.amessages")
def test_parse_uses_system_parameter(mock_amessages: MagicMock, client: TestClient) -> None:
    """Parse should use the 'system' parameter instead of a system message."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    mock_amessages.return_value = _fake_message_response(
        "<meta>\nTitle: T\nArtist: A\n</meta>\n<original>\nHello\n</original>"
    )

    client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "Hello",
            **LLM_SETTINGS,
        },
    )

    call_kwargs = mock_amessages.call_args.kwargs
    # System prompt should be a separate parameter
    assert "system" in call_kwargs
    assert "PorchSongs" in call_kwargs["system"]
    # Messages should only contain user messages, no system role
    messages = call_kwargs["messages"]
    assert all(m["role"] != "system" for m in messages)
    assert messages[0]["role"] == "user"


@patch("app.services.llm_service.amessages")
def test_chat_uses_system_parameter(mock_amessages: MagicMock, client: TestClient) -> None:
    """Chat should use the 'system' parameter with song content appended."""
    _, song = _make_profile_and_song(client)

    mock_amessages.return_value = _fake_message_response("Got it.")

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Hello"}],
            **LLM_SETTINGS,
        },
    )

    call_kwargs = mock_amessages.call_args.kwargs
    # System prompt should include PorchSongs prompt + original song
    assert "system" in call_kwargs
    assert "PorchSongs" in call_kwargs["system"]
    assert "Hello world" in call_kwargs["system"]  # original song content
    # Messages should not contain system role
    messages = call_kwargs["messages"]
    assert all(m["role"] != "system" for m in messages)


# --- POST /api/parse/file ---


def _make_test_pdf(text: str = "G  Am\nHello world\nDm  G\nGoodbye moon") -> str:
    """Create a minimal PDF with text content and return base64-encoded string."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    for line in text.split("\n"):
        pdf.cell(0, 10, text=line, new_x="LMARGIN", new_y="NEXT")
    buf = BytesIO()
    pdf.output(buf)
    return base64.b64encode(buf.getvalue()).decode()


def _make_blank_pdf() -> str:
    """Create a blank PDF (no text content) and return base64-encoded string."""
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buf = BytesIO()
    writer.write(buf)
    return base64.b64encode(buf.getvalue()).decode()


def test_parse_file_pdf_happy_path(client: TestClient) -> None:
    """PDF with text content should be extracted successfully."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    file_data = _make_test_pdf("G  Am\nHello world\nDm  G\nGoodbye moon")
    resp = client.post(
        "/api/parse/file",
        json={
            "profile_id": profile["id"],
            "file_data": file_data,
            "filename": "test_song.pdf",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "Hello world" in data["text"]
    assert "Goodbye moon" in data["text"]


def test_parse_file_text_happy_path(client: TestClient) -> None:
    """Plain text file should be extracted successfully."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    text_content = "G  Am\nHello world\nDm  G\nGoodbye moon"
    file_data = base64.b64encode(text_content.encode()).decode()
    resp = client.post(
        "/api/parse/file",
        json={
            "profile_id": profile["id"],
            "file_data": file_data,
            "filename": "test.txt",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "Hello world" in data["text"]
    assert "Goodbye moon" in data["text"]


def test_parse_file_corrupted_pdf(client: TestClient) -> None:
    """Corrupted PDF (non-PDF bytes with .pdf extension) should return 422."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    garbled = base64.b64encode(b"this is not a valid pdf file at all").decode()
    resp = client.post(
        "/api/parse/file",
        json={
            "profile_id": profile["id"],
            "file_data": garbled,
            "filename": "bad.pdf",
        },
    )
    assert resp.status_code == 422
    assert (
        "corrupted" in resp.json()["detail"].lower()
        or "could not read" in resp.json()["detail"].lower()
    )


def test_parse_file_empty_pdf(client: TestClient) -> None:
    """PDF with no text content (blank pages) should return 422 with scanned images hint."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    file_data = _make_blank_pdf()
    resp = client.post(
        "/api/parse/file",
        json={
            "profile_id": profile["id"],
            "file_data": file_data,
            "filename": "blank.pdf",
        },
    )
    assert resp.status_code == 422
    assert "scanned images" in resp.json()["detail"].lower()


def test_parse_file_unsupported_type(client: TestClient) -> None:
    """Unsupported file type (.docx) should return 422."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    file_data = base64.b64encode(b"fake docx content").decode()
    resp = client.post(
        "/api/parse/file",
        json={
            "profile_id": profile["id"],
            "file_data": file_data,
            "filename": "test.docx",
        },
    )
    assert resp.status_code == 422
    assert "Unsupported file type" in resp.json()["detail"]


def test_parse_file_too_large(client: TestClient) -> None:
    """File larger than 10MB should return 422."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    # Create data that decodes to >10MB
    large_bytes = b"x" * (10 * 1024 * 1024 + 1)
    file_data = base64.b64encode(large_bytes).decode()
    resp = client.post(
        "/api/parse/file",
        json={
            "profile_id": profile["id"],
            "file_data": file_data,
            "filename": "big.txt",
        },
    )
    assert resp.status_code == 422
    assert "too large" in resp.json()["detail"].lower()


def test_parse_file_profile_not_found(client: TestClient) -> None:
    """Missing profile should return 404."""
    file_data = base64.b64encode(b"some content").decode()
    resp = client.post(
        "/api/parse/file",
        json={
            "profile_id": 9999,
            "file_data": file_data,
            "filename": "test.txt",
        },
    )
    assert resp.status_code == 404
