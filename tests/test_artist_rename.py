"""Renaming an artist across every song of theirs.

The counterpart to renaming a tag, and the interesting cases are the same ones:
what counts as the same artist, and what happens when the new name is already in
use by somebody else's spelling of it.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


@pytest.fixture()
def profile_id(client: TestClient) -> int:
    return client.post("/api/profiles", json={}).json()["id"]


def _song(client: TestClient, profile_id: int, title: str | None, artist: str | None) -> dict:
    resp = client.post(
        "/api/songs",
        json={
            "title": title,
            "artist": artist,
            "original_content": "G C G",
            "rewritten_content": "G C G",
            "profile_id": profile_id,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _artists(client: TestClient) -> list[str]:
    return sorted((s["artist"] or "") for s in client.get("/api/songs").json())


def test_renames_every_song_by_that_artist(client: TestClient, profile_id: int) -> None:
    _song(client, profile_id, "Old Man", "Neil Young")
    _song(client, profile_id, "Powderfinger", "Neil Young")
    _song(client, profile_id, "Salt Creek", "Bill Monroe")

    resp = client.put("/api/songs/artists", json={"from_name": "Neil Young", "name": "Neil Young & Crazy Horse"})

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"name": "Neil Young & Crazy Horse", "renamed": 2, "merged_into": 0}
    assert _artists(client) == ["Bill Monroe", "Neil Young & Crazy Horse", "Neil Young & Crazy Horse"]


def test_matching_folds_case_and_whitespace(client: TestClient, profile_id: int) -> None:
    """The same rule the library groups its artist cards by."""
    _song(client, profile_id, "Old Man", "Neil Young")
    _song(client, profile_id, "Powderfinger", "neil  young")

    resp = client.put("/api/songs/artists", json={"from_name": "NEIL YOUNG", "name": "Neil Young"})

    assert resp.json()["renamed"] == 2
    assert _artists(client) == ["Neil Young", "Neil Young"]


def test_renaming_onto_an_existing_artist_reports_the_merge(client: TestClient, profile_id: int) -> None:
    """Two cards become one, which is the point as often as it is an accident."""
    _song(client, profile_id, "Old Man", "Neil Young")
    _song(client, profile_id, "Cortez The Killer", "Neil Young & Crazy Horse")

    resp = client.put("/api/songs/artists", json={"from_name": "Neil Young", "name": "Neil Young & Crazy Horse"})

    body = resp.json()
    assert body["renamed"] == 1
    # The client warns before this happens and says what happened after.
    assert body["merged_into"] == 1
    assert _artists(client) == ["Neil Young & Crazy Horse", "Neil Young & Crazy Horse"]


def test_the_new_name_keeps_the_spelling_that_was_typed(client: TestClient, profile_id: int) -> None:
    _song(client, profile_id, "Old Man", "neil young")

    client.put("/api/songs/artists", json={"from_name": "neil young", "name": "  Neil   Young  "})

    assert _artists(client) == ["Neil Young"]


def test_an_artist_with_no_songs_is_a_404(client: TestClient, profile_id: int) -> None:
    _song(client, profile_id, "Salt Creek", "Bill Monroe")

    resp = client.put("/api/songs/artists", json={"from_name": "Nobody", "name": "Somebody"})

    assert resp.status_code == 404


def test_the_unknown_bucket_is_not_an_artist(client: TestClient, profile_id: int) -> None:
    """It is not a name, and giving those songs one is the tidy screen's job."""
    _song(client, profile_id, "Shady Grove", None)

    resp = client.put("/api/songs/artists", json={"from_name": "   ", "name": "Traditional"})

    assert resp.status_code == 422


def test_an_artist_with_a_slash_in_their_name_can_be_renamed(
    client: TestClient, profile_id: int
) -> None:
    """Both names travel in the body for exactly this.

    As a path segment "AC/DC" is undeliverable: ASGI decodes %2F before routing,
    so the request arrives with an extra segment and is answered 405 before the
    endpoint sees it.
    """
    _song(client, profile_id, "Back In Black", "AC/DC")

    resp = client.put("/api/songs/artists", json={"from_name": "AC/DC", "name": "ACDC"})

    assert resp.status_code == 200, resp.text
    assert _artists(client) == ["ACDC"]


def test_an_empty_new_name_is_refused(client: TestClient, profile_id: int) -> None:
    _song(client, profile_id, "Old Man", "Neil Young")

    resp = client.put("/api/songs/artists", json={"from_name": "Neil Young", "name": "   "})

    assert resp.status_code == 422
    assert _artists(client) == ["Neil Young"]


def test_one_persons_rename_leaves_another_persons_songs_alone(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    """OSS serves one local user, so the other account is built directly."""
    from datetime import UTC, datetime

    from app.models import Profile, Song, User

    _song(client, profile_id, "Old Man", "Neil Young")

    stranger = User(
        email="someone.else@example.com",
        name="Someone Else",
        role="user",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(stranger)
    db_session.flush()
    profile = Profile(user_id=stranger.id, is_default=True)
    db_session.add(profile)
    db_session.flush()
    theirs = Song(
        user_id=stranger.id,
        profile_id=profile.id,
        title="Powderfinger",
        artist="Neil Young",
        original_content="G",
        rewritten_content="G",
    )
    db_session.add(theirs)
    db_session.commit()

    client.put("/api/songs/artists", json={"from_name": "Neil Young", "name": "Shakey"})

    assert _artists(client) == ["Shakey"]
    db_session.refresh(theirs)
    assert theirs.artist == "Neil Young"


def test_a_name_carrying_a_byte_order_mark_is_still_one_artist(
    client: TestClient, profile_id: int
) -> None:
    """The frontend folds U+FEFF as whitespace and Python does not.

    A file saved with a BOM puts one on the front of its first field, so the
    library groups the song under the plain card while a rename targeting that
    card would miss it, and the UI would then show a change the database never
    made.
    """
    _song(client, profile_id, "Old Man", "Neil﻿ Young")

    resp = client.put("/api/songs/artists", json={"from_name": "Neil Young", "name": "Shakey"})

    assert resp.status_code == 200, resp.text
    assert _artists(client) == ["Shakey"]
