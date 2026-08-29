"""Storing a tab as a file: upload, serve, and refuse to treat it as text.

A document-kind song is the library entry for a PDF you keep and play from. It
carries no chart text, so the value of these tests is mostly in the negatives:
the bytes must not leak into a listing, and every route that exists to rewrite,
discuss, or re-render chart text must decline rather than operate on emptiness.
"""

import io

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy.orm import Session

from app.models import Song, SongBlob, SongFile


def _pdf_bytes(pages: int = 2) -> bytes:
    """A real, minimal PDF. Real because the upload route sniffs the header and
    counts pages, so a b"%PDF-" stub would exercise neither."""
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


@pytest.fixture()
def profile_id(client: TestClient) -> int:
    return int(client.post("/api/profiles", json={}).json()["id"])


def _upload(client: TestClient, profile_id: int, **form: object) -> dict:
    data = {"profile_id": str(profile_id), **{k: str(v) for k, v in form.items()}}
    resp = client.post(
        "/api/songs/documents",
        data=data,
        files={"file": ("Blackberry Blossom.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# --- Upload ---------------------------------------------------------------


def test_upload_creates_a_document_song(client: TestClient, profile_id: int) -> None:
    song = _upload(client, profile_id)
    assert song["kind"] == "document"
    # Title falls back to the filename with the extension stripped, because the
    # library row needs a label and the filename is the only one we have.
    assert song["title"] == "Blackberry Blossom"
    assert song["original_content"] == ""
    assert song["rewritten_content"] == ""
    assert song["file"]["page_count"] == 2
    assert song["file"]["content_type"] == "application/pdf"
    assert song["file"]["size_bytes"] > 0
    assert len(song["file"]["sha256"]) == 64


def test_upload_honours_supplied_metadata(client: TestClient, profile_id: int) -> None:
    song = _upload(
        client, profile_id, title="Salt Creek", artist="Trad", tags="Fiddle Tunes, Reels"
    )
    assert (song["title"], song["artist"]) == ("Salt Creek", "Trad")
    # Comma-separated on the form, because a multipart upload has no JSON body
    # to put a list in.
    assert sorted(song["tags"]) == ["Fiddle Tunes", "Reels"]


def test_upload_rejects_a_non_pdf(client: TestClient, profile_id: int) -> None:
    """The declared content type says PDF and the bytes do not. The bytes win."""
    resp = client.post(
        "/api/songs/documents",
        data={"profile_id": str(profile_id)},
        files={"file": ("tab.pdf", b"GIF89a not really a pdf", "application/pdf")},
    )
    assert resp.status_code == 422
    assert "PDF" in resp.json()["detail"]


def test_upload_rejects_an_empty_file(client: TestClient, profile_id: int) -> None:
    resp = client.post(
        "/api/songs/documents",
        data={"profile_id": str(profile_id)},
        files={"file": ("tab.pdf", b"", "application/pdf")},
    )
    assert resp.status_code == 422


def test_upload_rejects_a_file_over_the_cap(
    client: TestClient, profile_id: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """413, and nothing stored. The cap exists because a bytea round-trips through
    process memory, so exceeding it must not leave a half-written row behind."""
    monkeypatch.setattr("app.routers.songs.MAX_DOCUMENT_BYTES", 1024)
    resp = client.post(
        "/api/songs/documents",
        data={"profile_id": str(profile_id)},
        files={"file": ("big.pdf", b"%PDF-" + b"x" * 4096, "application/pdf")},
    )
    assert resp.status_code == 413
    assert client.get("/api/songs").json() == []


def test_upload_rejects_another_users_profile(client: TestClient) -> None:
    resp = client.post(
        "/api/songs/documents",
        data={"profile_id": "9999"},
        files={"file": ("tab.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert resp.status_code == 404


def test_upload_survives_a_pdf_pypdf_cannot_enumerate(client: TestClient, profile_id: int) -> None:
    """A page count is a label on the file, not the file. Losing it must not cost
    the upload."""
    resp = client.post(
        "/api/songs/documents",
        data={"profile_id": str(profile_id)},
        files={"file": ("odd.pdf", b"%PDF-1.4\nbut truncated", "application/pdf")},
    )
    assert resp.status_code == 201
    assert resp.json()["file"]["page_count"] is None


# --- Serving the bytes ----------------------------------------------------


def test_file_route_serves_the_stored_pdf(client: TestClient, profile_id: int) -> None:
    song = _upload(client, profile_id)
    resp = client.get(f"/api/songs/{song['uuid']}/file")
    assert resp.status_code == 200
    assert resp.content == _pdf_bytes()
    assert resp.headers["content-type"] == "application/pdf"
    # inline, so it renders on a music stand instead of landing in Downloads.
    assert resp.headers["content-disposition"].startswith("inline;")
    assert resp.headers["etag"] == f'"{song["file"]["sha256"]}"'


def test_file_route_returns_304_for_a_matching_etag(client: TestClient, profile_id: int) -> None:
    """The request that happens every time you reopen a tab, over venue wifi."""
    song = _upload(client, profile_id)
    etag = client.get(f"/api/songs/{song['uuid']}/file").headers["etag"]
    resp = client.get(f"/api/songs/{song['uuid']}/file", headers={"If-None-Match": etag})
    assert resp.status_code == 304
    assert resp.content == b""


def test_file_route_404s_for_a_chart(client: TestClient, profile_id: int) -> None:
    song = client.post(
        "/api/songs",
        json={
            "profile_id": profile_id,
            "original_content": "G C D",
            "rewritten_content": "G C D",
        },
    ).json()
    assert client.get(f"/api/songs/{song['uuid']}/file").status_code == 404


def test_file_route_404s_for_another_users_song(client: TestClient, profile_id: int) -> None:
    _upload(client, profile_id)
    assert client.get("/api/songs/not-a-real-uuid/file").status_code == 404


# --- The bytes stay out of the listing ------------------------------------


def test_listing_carries_metadata_but_never_content(client: TestClient, profile_id: int) -> None:
    _upload(client, profile_id)
    body = client.get("/api/songs").text
    rows = client.get("/api/songs").json()
    assert rows[0]["file"]["page_count"] == 2
    # The guarantee the whole schema shape exists to provide: a library listing is
    # a listing, whatever is stored underneath it.
    assert "content" not in rows[0]["file"]
    assert "%PDF" not in body


def test_a_song_file_row_carries_no_bytes_at_all(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    """The metadata row and the bytes are separate tables, not one row with a
    deferred column. Loading everything the library shows cannot reach a PDF."""
    _upload(client, profile_id)
    db_session.expire_all()
    record = db_session.query(SongFile).one()
    assert not hasattr(record, "content")
    assert record.page_count == 2
    assert len(record.sha256) == 64


def test_blob_content_is_deferred_at_the_mapper(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    """And reaching the blob row still does not fetch the PDF until named."""
    _upload(client, profile_id)
    db_session.expire_all()
    blob = db_session.query(SongBlob).one()
    assert "content" not in blob.__dict__
    assert blob.size_bytes > 0
    assert blob.content.startswith(b"%PDF-")


def test_charts_report_no_file(client: TestClient, profile_id: int) -> None:
    client.post(
        "/api/songs",
        json={
            "profile_id": profile_id,
            "original_content": "G C D",
            "rewritten_content": "G C D",
        },
    )
    rows = client.get("/api/songs").json()
    assert rows[0]["kind"] == "chart"
    assert rows[0]["file"] is None


# --- A document is not text -----------------------------------------------


def test_document_cannot_be_edited_as_text(client: TestClient, profile_id: int) -> None:
    song = _upload(client, profile_id)
    resp = client.put(f"/api/songs/{song['uuid']}", json={"rewritten_content": "G C D"})
    assert resp.status_code == 409


def test_document_can_still_be_renamed_and_tagged(client: TestClient, profile_id: int) -> None:
    """Housekeeping is not editing. Renaming a tab and tagging it is the main
    thing you do with a stored file."""
    song = _upload(client, profile_id)
    resp = client.put(
        f"/api/songs/{song['uuid']}",
        json={"title": "Salt Creek", "artist": "Trad", "tags": ["Fiddle Tunes"]},
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Salt Creek"
    assert resp.json()["tags"] == ["Fiddle Tunes"]
    assert resp.json()["file"]["page_count"] == 2


def test_document_cannot_be_exported_as_a_chart_pdf(client: TestClient, profile_id: int) -> None:
    song = _upload(client, profile_id)
    assert client.get(f"/api/songs/{song['uuid']}/pdf").status_code == 409


def test_document_cannot_be_discussed_in_chat(client: TestClient, profile_id: int) -> None:
    song = _upload(client, profile_id)
    resp = client.post(
        f"/api/songs/{song['uuid']}/messages",
        json=[{"role": "user", "content": "transpose this"}],
    )
    assert resp.status_code == 409


def test_document_cannot_be_sent_to_the_model(client: TestClient, profile_id: int) -> None:
    song = _upload(client, profile_id)
    resp = client.post(
        "/api/chat",
        json={
            "song_id": song["id"],
            "messages": [{"role": "user", "content": "transpose this"}],
            "model": "x",
        },
    )
    assert resp.status_code == 409


def test_document_cannot_be_sent_to_tag_suggest(client: TestClient, profile_id: int) -> None:
    song = _upload(client, profile_id)
    resp = client.post("/api/tags/suggest", json={"song_id": song["id"], "model": "x"})
    assert resp.status_code == 409


# --- Deletion -------------------------------------------------------------


def test_deleting_a_document_removes_its_bytes(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    """Cascade, not a second call. A file that outlives its library row is storage
    nobody can see, find, or delete."""
    song = _upload(client, profile_id)
    assert client.delete(f"/api/songs/{song['uuid']}").status_code == 200
    assert db_session.query(SongFile).count() == 0
    assert db_session.query(Song).count() == 0


# --- One set of bytes, however many songs point at it ----------------------
#
# The reason this table exists. A tab passed around a jam used to be stored once
# per person; a scan re-imported by one person was stored twice.


def test_the_same_file_uploaded_twice_is_stored_once(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    first = _upload(client, profile_id)
    second = _upload(client, profile_id)

    assert first["uuid"] != second["uuid"]
    assert db_session.query(Song).count() == 2
    assert db_session.query(SongFile).count() == 2
    # The saving: two library entries, two claims, one copy of the PDF.
    assert db_session.query(SongBlob).count() == 1


def test_different_files_get_their_own_blobs(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    _upload(client, profile_id)
    resp = client.post(
        "/api/songs/documents",
        data={"profile_id": str(profile_id)},
        files={"file": ("other.pdf", _pdf_bytes(pages=3), "application/pdf")},
    )
    assert resp.status_code == 201

    assert db_session.query(SongBlob).count() == 2


def test_deleting_one_of_two_songs_keeps_the_shared_bytes(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    first = _upload(client, profile_id)
    second = _upload(client, profile_id)

    assert client.delete(f"/api/songs/{first['uuid']}").status_code == 200

    db_session.expire_all()
    assert db_session.query(SongBlob).count() == 1
    # And the survivor can still be read, which is the part a reference count
    # gets wrong when it drifts.
    assert client.get(f"/api/songs/{second['uuid']}/file").status_code == 200


def test_deleting_the_last_song_releases_the_bytes(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    first = _upload(client, profile_id)
    second = _upload(client, profile_id)

    client.delete(f"/api/songs/{first['uuid']}")
    client.delete(f"/api/songs/{second['uuid']}")

    db_session.expire_all()
    assert db_session.query(SongBlob).count() == 0


def test_deleting_a_chart_leaves_stored_tabs_alone(
    client: TestClient, profile_id: int, db_session: Session
) -> None:
    """A chart has no file, so the delete path must not stumble looking for one."""
    _upload(client, profile_id)
    chart = client.post(
        "/api/songs",
        json={
            "profile_id": profile_id,
            "title": "Salt Creek",
            "original_content": "G C G",
            "rewritten_content": "G C G",
        },
    ).json()

    assert client.delete(f"/api/songs/{chart['uuid']}").status_code == 200
    assert db_session.query(SongBlob).count() == 1


def test_the_served_bytes_are_the_uploaded_bytes(client: TestClient, profile_id: int) -> None:
    """Content addressing is only worth anything if the round trip is exact."""
    sent = _pdf_bytes(pages=4)
    created = client.post(
        "/api/songs/documents",
        data={"profile_id": str(profile_id)},
        files={"file": ("Big Sciota.pdf", sent, "application/pdf")},
    ).json()

    got = client.get(f"/api/songs/{created['uuid']}/file")

    assert got.status_code == 200
    assert got.content == sent
