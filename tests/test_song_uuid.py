"""Tests for song UUID field behavior."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Profile, Song, User


def _make_profile(client: TestClient) -> dict[str, object]:
    """Helper: create a profile and return it."""
    return client.post("/api/profiles", json={}).json()


def _make_song(client: TestClient) -> dict[str, object]:
    """Helper: create a profile + song and return the song dict."""
    profile = _make_profile(client)
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "title": "UUID Test Song",
            "artist": "Test Artist",
            "original_content": "Hello world",
            "rewritten_content": "Hi world",
        },
    ).json()
    return song


# --- UUID creation ---


def test_song_has_uuid_on_create(client: TestClient) -> None:
    """Created songs should have a UUID field."""
    song = _make_song(client)
    assert "uuid" in song
    assert song["uuid"] is not None
    # Validate it's a proper UUID format
    song_uuid = str(song["uuid"])
    parsed = uuid.UUID(song_uuid)
    assert str(parsed) == song_uuid


def test_each_song_gets_unique_uuid(client: TestClient) -> None:
    """Each new song should get a different UUID."""
    profile = _make_profile(client)
    uuids = set()
    for i in range(5):
        song = client.post(
            "/api/songs",
            json={
                "profile_id": profile["id"],
                "original_content": f"Content {i}",
                "rewritten_content": f"Rewritten {i}",
            },
        ).json()
        uuids.add(song["uuid"])
    assert len(uuids) == 5


def test_uuid_in_list_songs(client: TestClient) -> None:
    """Listed songs should include their UUID."""
    song = _make_song(client)
    resp = client.get("/api/songs")
    assert resp.status_code == 200
    songs = resp.json()
    assert len(songs) == 1
    assert songs[0]["uuid"] == song["uuid"]


# --- UUID-based lookups ---


def test_get_song_by_uuid(client: TestClient) -> None:
    """GET /api/songs/{uuid} should work."""
    song = _make_song(client)
    resp = client.get(f"/api/songs/{song['uuid']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == song["id"]
    assert data["uuid"] == song["uuid"]
    assert data["title"] == "UUID Test Song"


def test_get_song_by_id_still_works(client: TestClient) -> None:
    """GET /api/songs/{id} should still work for backward compat."""
    song = _make_song(client)
    resp = client.get(f"/api/songs/{song['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["uuid"] == song["uuid"]


def test_update_song_by_uuid(client: TestClient) -> None:
    """PUT /api/songs/{uuid} should work."""
    song = _make_song(client)
    resp = client.put(f"/api/songs/{song['uuid']}", json={"title": "Updated Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"


def test_delete_song_by_uuid(client: TestClient) -> None:
    """DELETE /api/songs/{uuid} should work."""
    song = _make_song(client)
    resp = client.delete(f"/api/songs/{song['uuid']}")
    assert resp.status_code == 200

    # Verify it's gone
    resp = client.get(f"/api/songs/{song['uuid']}")
    assert resp.status_code == 404


def test_get_song_revisions_by_uuid(client: TestClient) -> None:
    """GET /api/songs/{uuid}/revisions should work."""
    song = _make_song(client)
    resp = client.get(f"/api/songs/{song['uuid']}/revisions")
    assert resp.status_code == 200
    revisions = resp.json()
    assert len(revisions) == 1
    assert revisions[0]["version"] == 1


def test_get_song_messages_by_uuid(client: TestClient) -> None:
    """GET /api/songs/{uuid}/messages should work."""
    song = _make_song(client)
    resp = client.get(f"/api/songs/{song['uuid']}/messages")
    assert resp.status_code == 200
    assert resp.json() == []


def test_save_messages_by_uuid(client: TestClient) -> None:
    """POST /api/songs/{uuid}/messages should work."""
    song = _make_song(client)
    resp = client.post(
        f"/api/songs/{song['uuid']}/messages",
        json=[{"role": "user", "content": "Test via UUID"}],
    )
    assert resp.status_code == 201
    assert len(resp.json()) == 1


def test_update_song_status_by_uuid(client: TestClient) -> None:
    """PUT /api/songs/{uuid}/status should work."""
    song = _make_song(client)
    resp = client.put(f"/api/songs/{song['uuid']}/status", json={"status": "completed"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


def test_nonexistent_uuid_returns_404(client: TestClient) -> None:
    """A random UUID that doesn't exist should return 404."""
    fake_uuid = str(uuid.uuid4())
    resp = client.get(f"/api/songs/{fake_uuid}")
    assert resp.status_code == 404


# --- UUID model field ---


def test_song_model_uuid_auto_generated(db_session: Session, test_user: User) -> None:
    """Song model should auto-generate a UUID on creation."""
    profile = Profile(user_id=test_user.id, is_default=True)
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)

    song = Song(
        user_id=test_user.id,
        profile_id=profile.id,
        original_content="Test",
        rewritten_content="Test",
    )
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)

    assert song.uuid is not None
    parsed = uuid.UUID(song.uuid)
    assert str(parsed) == song.uuid


def test_song_model_uuid_is_unique(db_session: Session, test_user: User) -> None:
    """Two songs should get different UUIDs."""
    profile = Profile(user_id=test_user.id, is_default=True)
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)

    song1 = Song(
        user_id=test_user.id,
        profile_id=profile.id,
        original_content="Test 1",
        rewritten_content="Test 1",
    )
    song2 = Song(
        user_id=test_user.id,
        profile_id=profile.id,
        original_content="Test 2",
        rewritten_content="Test 2",
    )
    db_session.add_all([song1, song2])
    db_session.commit()
    db_session.refresh(song1)
    db_session.refresh(song2)

    assert song1.uuid != song2.uuid
