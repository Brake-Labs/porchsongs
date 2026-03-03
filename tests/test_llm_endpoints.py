"""Tests for endpoints that call the LLM, using mocked acompletion/list_models."""

from typing import Any
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


def _fake_completion_response(content: str) -> MagicMock:
    """Build a mock object that looks like a ChatCompletion response."""
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
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


@patch("app.services.llm_service.acompletion")
def test_parse_endpoint(mock_acompletion: MagicMock, client: TestClient) -> None:
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Nathan",
        },
    ).json()

    mock_acompletion.return_value = _fake_completion_response(
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
    assert mock_acompletion.call_count == 1
    # The call should NOT contain any profile description
    call_kwargs = mock_acompletion.call_args_list[0]
    messages = call_kwargs.kwargs.get("messages") or call_kwargs[1].get("messages")
    assert not any("Dad in Austin" in m["content"] for m in messages)


@patch("app.services.llm_service.acompletion")
def test_parse_unknown_title_artist(mock_acompletion: MagicMock, client: TestClient) -> None:
    """Parse with UNKNOWN title/artist should return null."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    mock_acompletion.return_value = _fake_completion_response(
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


@patch("app.services.llm_service.acompletion")
def test_parse_llm_error(mock_acompletion: MagicMock, client: TestClient) -> None:
    """LLM throwing an exception should return 502."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()
    mock_acompletion.side_effect = RuntimeError("API rate limit exceeded")

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


# --- POST /api/chat ---


@patch("app.services.llm_service.acompletion")
def test_chat_endpoint(mock_acompletion: MagicMock, client: TestClient) -> None:
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response(
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


@patch("app.services.llm_service.acompletion")
def test_chat_persists_changes(mock_acompletion: MagicMock, client: TestClient) -> None:
    """Chat edits should be persisted to the song and create a revision."""
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response(
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


@patch("app.services.llm_service.acompletion")
def test_chat_persists_messages(mock_acompletion: MagicMock, client: TestClient) -> None:
    """POST /api/chat should create ChatMessage rows for user + assistant."""
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response(
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


@patch("app.services.llm_service.acompletion")
def test_chat_conversational_no_content(mock_acompletion: MagicMock, client: TestClient) -> None:
    """When the LLM responds without <content> tags, no version bump or revision is created."""
    _, song = _make_profile_and_song(client)
    original_version = song["current_version"]

    mock_acompletion.return_value = _fake_completion_response(
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


@patch("app.services.llm_service.acompletion")
def test_chat_stores_full_raw_response(mock_acompletion: MagicMock, client: TestClient) -> None:
    """The assistant ChatMessage stored in DB should be the full raw LLM response."""
    _, song = _make_profile_and_song(client)

    raw_response = (
        "<content>\nNew line one\nNew line two\n</content>\nI rewrote both lines for clarity."
    )
    mock_acompletion.return_value = _fake_completion_response(raw_response)

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


@patch("app.services.llm_service.acompletion")
def test_chat_conversational_stores_messages(
    mock_acompletion: MagicMock, client: TestClient
) -> None:
    """Conversational (no-content) responses should still persist chat messages."""
    _, song = _make_profile_and_song(client)

    conversational_response = "Great question! I think we could try an AABB scheme instead."
    mock_acompletion.return_value = _fake_completion_response(conversational_response)

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


@patch("app.services.llm_service.acompletion")
def test_parse_passes_api_base(mock_acompletion: MagicMock, client: TestClient) -> None:
    """When a ProfileModel has api_base set, the parse call should pass it to acompletion."""
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

    mock_acompletion.return_value = _fake_completion_response(
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

    assert mock_acompletion.call_count == 1
    assert mock_acompletion.call_args.kwargs.get("api_base") == "http://localhost:11434"


@patch("app.services.llm_service.acompletion")
def test_parse_no_api_base_when_no_profile_model(
    mock_acompletion: MagicMock, client: TestClient
) -> None:
    """When no ProfileModel exists, api_base should not be passed."""
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Cloud User",
        },
    ).json()

    mock_acompletion.return_value = _fake_completion_response(
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

    assert mock_acompletion.call_count == 1
    assert "api_base" not in mock_acompletion.call_args.kwargs


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


@patch("app.services.llm_service.acompletion")
def test_parse_uses_custom_system_prompt(mock_acompletion: MagicMock, client: TestClient) -> None:
    """When a profile has a custom parse prompt, it should be used in the LLM call."""
    custom_prompt = "You are a CUSTOM parse assistant."
    profile = client.post(
        "/api/profiles",
        json={
            "name": "Custom",
            "system_prompt_parse": custom_prompt,
        },
    ).json()

    mock_acompletion.return_value = _fake_completion_response(
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

    messages = mock_acompletion.call_args.kwargs.get("messages") or mock_acompletion.call_args[
        1
    ].get("messages")
    assert messages[0]["content"] == custom_prompt


@patch("app.services.llm_service.acompletion")
def test_chat_uses_custom_system_prompt(mock_acompletion: MagicMock, client: TestClient) -> None:
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

    mock_acompletion.return_value = _fake_completion_response("Just a conversational response.")

    client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "Hello"}],
            **LLM_SETTINGS,
        },
    )

    messages = mock_acompletion.call_args.kwargs.get("messages") or mock_acompletion.call_args[
        1
    ].get("messages")
    # The system message should start with the custom prompt (song content is appended)
    assert messages[0]["content"].startswith(custom_prompt)


# --- Multimodal (image) content tests ---


@patch("app.services.llm_service.acompletion")
def test_chat_multimodal_content_passthrough(
    mock_acompletion: MagicMock, client: TestClient
) -> None:
    """Multimodal content (image + text) should be passed through to the LLM."""
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response(
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
    call_messages = mock_acompletion.call_args.kwargs.get("messages") or mock_acompletion.call_args[
        1
    ].get("messages")
    # Last message should have the multimodal content array
    user_msg = call_messages[-1]
    assert user_msg["role"] == "user"
    assert isinstance(user_msg["content"], list)
    assert user_msg["content"][0]["type"] == "text"
    assert user_msg["content"][1]["type"] == "image_url"


@patch("app.services.llm_service.acompletion")
def test_chat_multimodal_display_text_only(
    mock_acompletion: MagicMock, client: TestClient
) -> None:
    """Messages endpoint returns text-only display content for multimodal messages."""
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response("I can see the chord chart.")

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


@patch("app.services.llm_service.acompletion")
def test_chat_plain_string_still_works(mock_acompletion: MagicMock, client: TestClient) -> None:
    """Plain string content should still work after the multimodal change."""
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response("Sure, here's some feedback.")

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


@patch("app.services.llm_service.acompletion")
def test_chat_image_only_displays_placeholder(
    mock_acompletion: MagicMock, client: TestClient
) -> None:
    """Image-only messages display as '[Image]' but full content is preserved for LLM."""
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response("I can see the image.")

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


@patch("app.services.llm_service.acompletion")
def test_chat_after_image_preserves_multimodal_for_llm(
    mock_acompletion: MagicMock, client: TestClient
) -> None:
    """Follow-up chat loads the full multimodal content (including image) for the LLM."""
    _, song = _make_profile_and_song(client)

    mock_acompletion.return_value = _fake_completion_response("I can see the image.")

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
    mock_acompletion.return_value = _fake_completion_response("Here are some suggestions.")

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
    call_messages = (
        mock_acompletion.call_args.kwargs.get("messages")
        or mock_acompletion.call_args[1].get("messages")
    )
    user_msgs = [m for m in call_messages if m["role"] == "user"]
    # First user message should be the deserialized multimodal content
    assert isinstance(user_msgs[0]["content"], list)
    assert user_msgs[0]["content"][0]["type"] == "image_url"
    # Second user message is plain text
    assert user_msgs[1]["content"] == "Now improve the chorus"


# --- POST /api/abc ---


@patch("app.services.llm_service.acompletion")
def test_abc_endpoint(mock_acompletion: MagicMock, client: TestClient) -> None:
    """ABC endpoint should return parsed ABC notation."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    mock_acompletion.return_value = _fake_completion_response(
        "<abc>\nX:1\nT:Test Song\nM:4/4\nL:1/4\nQ:1/4=120\nK:G\n"
        '"G"B2 B A | "C"G2 G E |\n</abc>\nI assumed 4/4 time and key of G.'
    )

    resp = client.post(
        "/api/abc",
        json={
            "profile_id": profile["id"],
            "content": "G  Am\nHello world\nC  G\nGoodbye moon",
            "title": "Test Song",
            "artist": "Test Artist",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["abc"] is not None
    assert "X:1" in data["abc"]
    assert data["tips"] is None


@patch("app.services.llm_service.acompletion")
def test_abc_endpoint_tips(mock_acompletion: MagicMock, client: TestClient) -> None:
    """ABC endpoint should return tips when no chords are present."""
    profile = client.post("/api/profiles", json={"name": "Test"}).json()

    mock_acompletion.return_value = _fake_completion_response(
        "<tips>\nThis song needs chord symbols to generate sheet music.\n</tips>"
    )

    resp = client.post(
        "/api/abc",
        json={
            "profile_id": profile["id"],
            "content": "Hello world\nGoodbye moon",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["abc"] is None
    assert data["tips"] is not None
    assert "chord" in data["tips"].lower()


def test_abc_profile_not_found(client: TestClient) -> None:
    """ABC with invalid profile_id should return 404."""
    resp = client.post(
        "/api/abc",
        json={
            "profile_id": 9999,
            "content": "Hello world",
            **LLM_SETTINGS,
        },
    )
    assert resp.status_code == 404
