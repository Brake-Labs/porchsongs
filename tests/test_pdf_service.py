"""Tests for PDF generation service."""

from fastapi.testclient import TestClient
from fpdf import FPDF
from sqlalchemy.orm import Session

from app.models import Profile, Song, User
from app.services.pdf_service import (
    _fit_font_size,
    _sanitize_for_latin1,
    generate_song_pdf,
)

# ── Unit tests for generate_song_pdf ─────────────────────────────────────────


def test_basic_pdf_returns_valid_bytes() -> None:
    """Generated PDF is non-empty and starts with %PDF header."""
    result = generate_song_pdf("My Song", "Artist", "Am  C  G\nHello world")
    assert isinstance(result, bytes)
    assert len(result) > 0
    assert result[:5] == b"%PDF-"


def test_title_and_artist_produce_larger_pdf() -> None:
    """PDF with title and artist is larger than one without (content is compressed)."""
    with_artist = generate_song_pdf("Amazing Grace", "John Newton", "G  C  G\nAmazing grace")
    without_artist = generate_song_pdf("Amazing Grace", None, "G  C  G\nAmazing grace")
    assert with_artist[:5] == b"%PDF-"
    # Having an artist adds an extra cell, so PDF should be larger
    assert len(with_artist) > len(without_artist)


def test_no_artist_still_works() -> None:
    """artist=None produces a valid PDF without crashing."""
    result = generate_song_pdf("Solo Song", None, "Dm  Am\nJust chords")
    assert result[:5] == b"%PDF-"
    assert len(result) > 100


def test_empty_title_defaults_to_untitled() -> None:
    """Empty or blank title doesn't crash — falls back to 'Untitled' internally."""
    result = generate_song_pdf("", None, "some content")
    assert result[:5] == b"%PDF-"
    assert len(result) > 100

    result2 = generate_song_pdf(None, None, "some content")
    assert result2[:5] == b"%PDF-"
    assert len(result2) > 100

    # Both should produce the same size (both use "Untitled" fallback, no artist)
    assert len(result) == len(result2)


# ── Unit tests for _sanitize_for_latin1 ──────────────────────────────────────


def test_unicode_sanitization() -> None:
    """Curly quotes, em dashes, and ellipsis are replaced with ASCII equivalents."""
    text = "\u201cHello\u201d \u2018world\u2019 \u2014 test\u2026"
    result = _sanitize_for_latin1(text)
    assert "\u201c" not in result
    assert "\u201d" not in result
    assert '"Hello"' in result
    assert "'world'" in result
    assert "--" in result
    assert "..." in result


def test_non_latin1_characters_replaced() -> None:
    """Characters outside latin-1 (e.g. emoji) get replaced with '?'."""
    result = _sanitize_for_latin1("Hello \U0001f3b5 World")
    assert "\U0001f3b5" not in result
    assert "?" in result


# ── Unit tests for _fit_font_size ─────────────────────────────────────────────


def test_short_lines_get_large_font() -> None:
    """Short lines that easily fit should use 10pt."""
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.add_page()
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    size = _fit_font_size(pdf, "Am  C  G\nShort line", usable)
    assert size == 10.0


def test_very_long_lines_get_small_font() -> None:
    """Very long lines should shrink the font to 6pt minimum."""
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.add_page()
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    long_line = "X" * 300  # extremely long line
    size = _fit_font_size(pdf, long_line, usable)
    assert size == 6.0


# ── Multi-page content ───────────────────────────────────────────────────────


def test_multi_page_content_does_not_crash() -> None:
    """Many lines of content should produce a valid multi-page PDF."""
    content = "\n".join(f"Line {i}: Am  C  G  D" for i in range(200))
    result = generate_song_pdf("Long Song", "Prolific Artist", content)
    assert result[:5] == b"%PDF-"
    assert len(result) > 1000  # should be substantially larger


# ── Endpoint test (song PDF download) ────────────────────────────────────────


def test_song_pdf_endpoint(client: TestClient, db_session: Session, test_user: User) -> None:
    """GET /api/songs/{id}/pdf returns PDF with correct headers."""
    profile = Profile(user_id=test_user.id, is_default=True)
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)

    song = Song(
        user_id=test_user.id,
        profile_id=profile.id,
        title="Test Song",
        artist="Test Artist",
        original_content="original",
        rewritten_content="Am  C  G\nRewritten content here",
        status="completed",
        current_version=1,
    )
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)

    resp = client.get(f"/api/songs/{song.id}/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "Content-Disposition" in resp.headers
    assert "Test Song - Test Artist.pdf" in resp.headers["Content-Disposition"]
    assert resp.content[:5] == b"%PDF-"


def test_pdf_filename_sanitizes_special_chars(
    client: TestClient, db_session: Session, test_user: User
) -> None:
    """Content-Disposition filename strips quotes and newlines."""
    profile = Profile(user_id=test_user.id, is_default=True)
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)

    song = Song(
        user_id=test_user.id,
        profile_id=profile.id,
        title='He said "hello"',
        artist="O'Brien",
        original_content="original",
        rewritten_content="content",
        status="completed",
        current_version=1,
    )
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)

    resp = client.get(f"/api/songs/{song.id}/pdf")
    assert resp.status_code == 200
    cd = resp.headers["Content-Disposition"]
    # Sanitized ASCII filename should not contain raw double quotes
    assert "He said hello" in cd
    # UTF-8 encoded filename should be present for Unicode support
    assert "filename*=UTF-8''" in cd
