"""Integration tests for API endpoints using FastAPI TestClient."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

# --- Profile CRUD ---


def test_create_profile(client: TestClient) -> None:
    resp = client.post("/api/profiles", json={})
    assert resp.status_code == 201
    data = resp.json()
    assert data["is_default"] is True  # first profile becomes default


def test_list_profiles_empty(client: TestClient) -> None:
    resp = client.get("/api/profiles")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_profile(client: TestClient) -> None:
    create = client.post("/api/profiles", json={})
    pid = create.json()["id"]

    resp = client.get(f"/api/profiles/{pid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == pid


def test_get_profile_404(client: TestClient) -> None:
    resp = client.get("/api/profiles/9999")
    assert resp.status_code == 404


def test_update_profile(client: TestClient) -> None:
    create = client.post("/api/profiles", json={})
    pid = create.json()["id"]

    resp = client.put(
        f"/api/profiles/{pid}",
        json={
            "is_default": True,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["is_default"] is True


def test_delete_profile(client: TestClient) -> None:
    create = client.post("/api/profiles", json={})
    pid = create.json()["id"]

    resp = client.delete(f"/api/profiles/{pid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Confirm deleted
    resp = client.get(f"/api/profiles/{pid}")
    assert resp.status_code == 404


# --- Songs ---


def test_create_and_list_songs(client: TestClient) -> None:
    # Need a profile first
    profile = client.post("/api/profiles", json={}).json()

    song_data = {
        "profile_id": profile["id"],
        "title": "Test Song",
        "artist": "Test Artist",
        "original_content": "Original line one\nOriginal line two",
        "rewritten_content": "Rewritten line one\nRewritten line two",
        "changes_summary": "Changed some words",
    }
    resp = client.post("/api/songs", json=song_data)
    assert resp.status_code == 201
    song = resp.json()
    assert song["title"] == "Test Song"
    assert song["status"] == "draft"
    assert song["current_version"] == 1

    # List songs
    resp = client.get(f"/api/songs?profile_id={profile['id']}")
    assert resp.status_code == 200
    songs = resp.json()
    assert len(songs) == 1
    assert songs[0]["id"] == song["id"]


def test_get_song(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello",
            "rewritten_content": "Hi",
        },
    ).json()

    resp = client.get(f"/api/songs/{song['id']}")
    assert resp.status_code == 200
    assert resp.json()["original_content"] == "Hello"


def test_get_song_404(client: TestClient) -> None:
    resp = client.get("/api/songs/9999")
    assert resp.status_code == 404


def test_update_song_title(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello",
            "rewritten_content": "Hi",
        },
    ).json()
    assert song["title"] is None

    resp = client.put(f"/api/songs/{song['id']}", json={"title": "My Song"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "My Song"

    # Verify persisted
    resp = client.get(f"/api/songs/{song['id']}")
    assert resp.json()["title"] == "My Song"


def test_update_song_not_found(client: TestClient) -> None:
    resp = client.put("/api/songs/9999", json={"title": "Nope"})
    assert resp.status_code == 404


def test_delete_song(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello",
            "rewritten_content": "Hi",
        },
    ).json()

    resp = client.delete(f"/api/songs/{song['id']}")
    assert resp.status_code == 200

    resp = client.get(f"/api/songs/{song['id']}")
    assert resp.status_code == 404


def test_rename_folder(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    # Create two songs in "Rock" folder
    for title in ("Song A", "Song B"):
        client.post(
            "/api/songs",
            json={
                "profile_id": profile["id"],
                "title": title,
                "original_content": "orig",
                "rewritten_content": "rw",
                "folder": "Rock",
            },
        )
    # And one song in a different folder
    client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "title": "Song C",
            "original_content": "orig",
            "rewritten_content": "rw",
            "folder": "Jazz",
        },
    )

    resp = client.put("/api/songs/folders/Rock", json={"name": "Classic Rock"})
    assert resp.status_code == 200

    songs = client.get("/api/songs").json()
    rock_songs = [s for s in songs if s["folder"] == "Classic Rock"]
    jazz_songs = [s for s in songs if s["folder"] == "Jazz"]
    assert len(rock_songs) == 2
    assert len(jazz_songs) == 1  # unchanged


def test_delete_folder(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "title": "Song A",
            "original_content": "orig",
            "rewritten_content": "rw",
            "folder": "Temp",
        },
    )

    resp = client.delete("/api/songs/folders/Temp")
    assert resp.status_code == 200

    songs = client.get("/api/songs").json()
    assert songs[0]["folder"] is None

    folders = client.get("/api/songs/folders").json()
    assert "Temp" not in folders


def test_update_song_status(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello",
            "rewritten_content": "Hi",
        },
    ).json()

    resp = client.put(f"/api/songs/{song['id']}/status", json={"status": "completed"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


def test_update_song_status_invalid(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello",
            "rewritten_content": "Hi",
        },
    ).json()

    resp = client.put(f"/api/songs/{song['id']}/status", json={"status": "invalid"})
    assert resp.status_code == 422


# --- Song Revisions ---


def test_song_revisions(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello",
            "rewritten_content": "Hi",
            "changes_summary": "Initial",
        },
    ).json()

    resp = client.get(f"/api/songs/{song['id']}/revisions")
    assert resp.status_code == 200
    revisions = resp.json()
    assert len(revisions) == 1
    assert revisions[0]["version"] == 1
    assert revisions[0]["edit_type"] == "full"


# --- Chat Messages ---


def _make_song(client: TestClient) -> dict[str, Any]:
    """Helper: create a profile + song and return the song dict."""
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "Hello world",
            "rewritten_content": "Hi world",
            "changes_summary": "Changed hello to hi",
        },
    ).json()
    return song


def test_save_chat_messages(client: TestClient) -> None:
    song = _make_song(client)
    messages = [
        {"role": "user", "content": "Pasted lyrics here", "is_note": True},
        {"role": "assistant", "content": "Changed hello to hi", "is_note": True},
    ]
    resp = client.post(f"/api/songs/{song['id']}/messages", json=messages)
    assert resp.status_code == 201
    data = resp.json()
    assert len(data) == 2
    assert data[0]["role"] == "user"
    assert data[0]["is_note"] is True
    assert data[1]["role"] == "assistant"


def test_get_chat_messages(client: TestClient) -> None:
    song = _make_song(client)
    messages = [
        {"role": "user", "content": "First message", "is_note": True},
        {"role": "assistant", "content": "Summary", "is_note": True},
        {"role": "user", "content": "Make it better"},
        {"role": "assistant", "content": "Done!"},
    ]
    client.post(f"/api/songs/{song['id']}/messages", json=messages)

    resp = client.get(f"/api/songs/{song['id']}/messages")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 4
    assert data[0]["content"] == "First message"
    assert data[3]["content"] == "Done!"
    # Verify ordering (created_at ascending)
    assert data[0]["id"] < data[3]["id"]


def test_chat_messages_token_usage_roundtrip(client: TestClient) -> None:
    """Token usage saved via POST should be returned by GET."""
    song = _make_song(client)
    messages = [
        {"role": "user", "content": "Edit this"},
        {"role": "assistant", "content": "Done", "input_tokens": 150, "output_tokens": 300},
    ]
    resp = client.post(f"/api/songs/{song['id']}/messages", json=messages)
    assert resp.status_code == 201

    resp = client.get(f"/api/songs/{song['id']}/messages")
    data = resp.json()
    assert data[0]["input_tokens"] is None
    assert data[0]["output_tokens"] is None
    assert data[1]["input_tokens"] == 150
    assert data[1]["output_tokens"] == 300


def test_get_chat_messages_song_not_found(client: TestClient) -> None:
    resp = client.get("/api/songs/9999/messages")
    assert resp.status_code == 404


def test_save_chat_messages_song_not_found(client: TestClient) -> None:
    resp = client.post(
        "/api/songs/9999/messages",
        json=[
            {"role": "user", "content": "hello"},
        ],
    )
    assert resp.status_code == 404


def test_delete_song_deletes_messages(client: TestClient) -> None:
    song = _make_song(client)
    client.post(
        f"/api/songs/{song['id']}/messages",
        json=[
            {"role": "user", "content": "test message"},
        ],
    )

    # Verify messages exist
    resp = client.get(f"/api/songs/{song['id']}/messages")
    assert len(resp.json()) == 1

    # Delete the song
    client.delete(f"/api/songs/{song['id']}")

    # Song is gone
    resp = client.get(f"/api/songs/{song['id']}")
    assert resp.status_code == 404


# --- Parse (LLM) ---


def _make_message_resp(content: str) -> MagicMock:
    """Build a mock object shaped like a MessageResponse."""
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = content
    text_block.thinking = None

    usage = MagicMock()
    usage.input_tokens = 10
    usage.output_tokens = 20
    usage.cache_creation_input_tokens = None
    usage.cache_read_input_tokens = None

    r = MagicMock()
    r.content = [text_block]
    r.usage = usage
    return r


def test_parse_uses_gateway_credentials(client: TestClient) -> None:
    """POST /parse should call amessages with the server gateway provider/key."""
    profile = client.post("/api/profiles", json={}).json()

    with patch("app.services.llm_service.amessages", new_callable=AsyncMock) as mock_ac:
        mock_ac.return_value = _make_message_resp(
            "<meta>\nTitle: Hello Song\nArtist: Test Artist\n</meta>\n"
            "<original>\nHello world\n</original>"
        )
        resp = client.post(
            "/api/parse",
            json={
                "profile_id": profile["id"],
                "content": "Hello world",
                "model": "gpt-4",
            },
        )
        assert resp.status_code == 200
        assert mock_ac.call_count == 1
        assert mock_ac.call_args.kwargs.get("provider") == "otari"
        assert mock_ac.call_args.kwargs.get("api_key") == "test-gateway-key"


def test_parse_returns_title_artist(client: TestClient) -> None:
    """POST /parse with META section should return title and artist."""
    profile = client.post("/api/profiles", json={}).json()

    with patch("app.services.llm_service.amessages", new_callable=AsyncMock) as mock_ac:
        mock_ac.return_value = _make_message_resp(
            "<meta>\nTitle: Wagon Wheel\nArtist: Old Crow Medicine Show\n</meta>\n"
            "<original>\nRock me mama\n</original>"
        )
        resp = client.post(
            "/api/parse",
            json={
                "profile_id": profile["id"],
                "content": "Rock me mama",
                "provider": "openai",
                "model": "gpt-4",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Wagon Wheel"
        assert data["artist"] == "Old Crow Medicine Show"
        assert "Rock me mama" in data["original_content"]


def test_parse_unknown_title_artist(client: TestClient) -> None:
    """POST /parse with UNKNOWN in META should return null title/artist."""
    profile = client.post("/api/profiles", json={}).json()

    with patch("app.services.llm_service.amessages", new_callable=AsyncMock) as mock_ac:
        mock_ac.return_value = _make_message_resp(
            "<meta>\nTitle: UNKNOWN\nArtist: UNKNOWN\n</meta>\n<original>\nSome lyrics\n</original>"
        )
        resp = client.post(
            "/api/parse",
            json={
                "profile_id": profile["id"],
                "content": "Some lyrics",
                "provider": "openai",
                "model": "gpt-4",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] is None
        assert data["artist"] is None


def test_health(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_health_degraded_when_db_unreachable(client: TestClient) -> None:
    from collections.abc import Generator

    from sqlalchemy.orm import Session

    from app.database import get_db
    from app.main import app

    original = app.dependency_overrides.get(get_db)

    def _broken_db() -> Generator[Session]:
        mock_session = MagicMock(spec=Session)
        mock_session.execute.side_effect = Exception("connection refused")
        yield mock_session

    app.dependency_overrides[get_db] = _broken_db
    resp = client.get("/api/health")

    if original is not None:
        app.dependency_overrides[get_db] = original

    assert resp.status_code == 503
    data = resp.json()
    assert data["status"] == "degraded"
    assert "version" in data


def test_parse_missing_tags_fallback(client: TestClient) -> None:
    """When LLM returns no XML tags, original_content should fall back to raw input."""
    profile = client.post("/api/profiles", json={}).json()

    with patch("app.services.llm_service.amessages", new_callable=AsyncMock) as mock_ac:
        mock_ac.return_value = _make_message_resp("Just some text without XML tags")
        resp = client.post(
            "/api/parse",
            json={
                "profile_id": profile["id"],
                "content": "My raw lyrics",
                "provider": "openai",
                "model": "gpt-4",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["original_content"] == "My raw lyrics"
        assert data["title"] is None
        assert data["artist"] is None


# --- Input Size Validation ---


def test_parse_rejects_oversized_content(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    resp = client.post(
        "/api/parse",
        json={
            "profile_id": profile["id"],
            "content": "x" * 100_001,
            "provider": "openai",
            "model": "gpt-4",
        },
    )
    assert resp.status_code == 422


def test_song_create_rejects_oversized_content(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    resp = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "x" * 100_001,
            "rewritten_content": "ok",
        },
    )
    assert resp.status_code == 422


def test_song_create_rejects_oversized_title(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    resp = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "title": "x" * 501,
            "original_content": "ok",
            "rewritten_content": "ok",
        },
    )
    assert resp.status_code == 422


def test_song_update_rejects_oversized_title(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "ok",
            "rewritten_content": "ok",
        },
    ).json()
    resp = client.put(f"/api/songs/{song['id']}", json={"title": "x" * 501})
    assert resp.status_code == 422


def test_chat_message_rejects_oversized_content(client: TestClient) -> None:
    profile = client.post("/api/profiles", json={}).json()
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "original_content": "ok",
            "rewritten_content": "ok",
        },
    ).json()
    resp = client.post(
        f"/api/songs/{song['id']}/messages",
        json=[{"role": "user", "content": "x" * 10_001}],
    )
    assert resp.status_code == 422


# --- Cache headers middleware ---


def test_hashed_asset_gets_cache_header(client: TestClient) -> None:
    """Requests to /assets/* should include an immutable Cache-Control header."""
    resp = client.get("/assets/index-abc123.js")
    assert resp.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_api_route_no_cache_header(client: TestClient) -> None:
    """Non-asset routes should not get the static asset cache header."""
    resp = client.get("/api/health")
    assert "immutable" not in resp.headers.get("cache-control", "")
