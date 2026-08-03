"""Tests for the URL scraping service and the /api/parse/url endpoint."""

import html
import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.services import scrape_service
from app.services.scrape_service import ScrapeError, scrape_url


def _store_html(
    content: str, song_name: str = "Test Song", artist_name: str = "Test Artist"
) -> str:
    """Build a minimal page carrying an escaped ``js-store`` chord blob."""
    store = {
        "store": {
            "page": {
                "data": {
                    "tab": {"song_name": song_name, "artist_name": artist_name},
                    "tab_view": {"wiki_tab": {"content": content}},
                }
            }
        }
    }
    escaped = html.escape(json.dumps(store), quote=True)
    return f'<html><body><div class="js-store" data-content="{escaped}"></div></body></html>'


STORE_CONTENT = "[tab][ch]G[/ch]      [ch]D[/ch]\nsample [ch]lyric[/ch] line[/tab]\nsecond line."


# --- Embedded js-store extraction ---


def test_extract_embedded_tab_store_strips_markup() -> None:
    result = scrape_service._extract_embedded_tab_store(_store_html(STORE_CONTENT))
    assert result is not None
    assert result.title == "Test Song"
    assert result.artist == "Test Artist"
    # [ch]/[tab] markers removed, chord-over-lyric layout preserved
    assert "[ch]" not in result.text
    assert "[tab]" not in result.text
    assert "G      D" in result.text
    assert "sample lyric line" in result.text


def test_extract_embedded_tab_store_returns_none_without_a_store() -> None:
    assert scrape_service._extract_embedded_tab_store("<html><body>nope</body></html>") is None


@pytest.mark.parametrize(
    "url",
    [
        "https://chords.example.com/some-song",
        "https://a-totally-different-host.example.org/tab/123",
    ],
)
def test_scrape_keys_on_structure_not_hostname(url: str) -> None:
    """Identical markup must extract identically whatever host served it.

    The store branch is selected purely by markup, so no host is special-cased.
    That is what lets this module carry no site names: there is no per-site branch
    to name, and adding or dropping a site requires no code change here.
    """
    html_text = _store_html(STORE_CONTENT)
    with (
        patch.object(scrape_service, "_validate_url"),
        patch.object(scrape_service, "_fetch", return_value=html_text),
    ):
        result = scrape_url(url)
    assert result.title == "Test Song"
    assert "sample lyric line" in result.text


def test_scrape_prepends_title_and_artist() -> None:
    html_text = _store_html(STORE_CONTENT)
    with (
        patch.object(scrape_service, "_validate_url"),
        patch.object(scrape_service, "_fetch", return_value=html_text),
    ):
        result = scrape_url("https://chords.example.com/song")
    assert result.text.startswith("Test Song - Test Artist")
    assert result.title == "Test Song"


# --- Generic extraction ---


def test_extract_generic_prefers_pre_blocks() -> None:
    html_text = (
        "<html><head><title>My Song</title></head><body><pre>C G Am\nlyrics</pre></body></html>"
    )
    result = scrape_service._extract_generic(html_text)
    assert "C G Am" in result.text
    assert "lyrics" in result.text
    assert result.title == "My Song"


def test_extract_generic_strips_scripts() -> None:
    html_text = "<html><body><script>alert(1)</script><p>hello chords</p></body></html>"
    result = scrape_service._extract_generic(html_text)
    assert "alert" not in result.text
    assert "hello chords" in result.text


# --- SSRF / URL validation ---


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/file",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "not-a-url",
    ],
)
def test_validate_url_rejects_bad_schemes(url: str) -> None:
    with pytest.raises(ScrapeError):
        scrape_service._validate_url(url)


def test_validate_url_rejects_localhost() -> None:
    with pytest.raises(ScrapeError) as exc:
        scrape_service._validate_url("http://localhost:8000/admin")
    assert exc.value.status_code == 400


def test_validate_url_rejects_private_ip() -> None:
    with pytest.raises(ScrapeError):
        scrape_service._validate_url("http://169.254.169.254/latest/meta-data/")


# --- Fetch escalation (requests -> curl_cffi impersonation) ---


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (200, "<html>real content</html>", False),
        (403, "", True),
        (429, "", True),
        (503, "", True),
        (200, "<html>Just a moment...</html>", True),
        (200, "<html>cf-browser-verification</html>", True),
    ],
)
def test_looks_blocked(status: int, body: str, expected: bool) -> None:
    assert scrape_service._looks_blocked(status, body) is expected


def test_fetch_escalates_to_impersonation_when_blocked() -> None:
    store_html = _store_html(STORE_CONTENT)
    with (
        patch.object(
            scrape_service, "_fetch_with_requests", return_value=(403, "blocked")
        ) as mock_requests,
        patch.object(
            scrape_service, "_fetch_with_impersonation", return_value=(200, store_html)
        ) as mock_imp,
    ):
        body = scrape_service._fetch("https://chords.example.com/song")
    mock_requests.assert_called_once()
    mock_imp.assert_called_once()
    assert "js-store" in body


def test_fetch_skips_impersonation_when_first_attempt_succeeds() -> None:
    with (
        patch.object(scrape_service, "_fetch_with_requests", return_value=(200, "<html>ok</html>")),
        patch.object(scrape_service, "_fetch_with_impersonation") as mock_imp,
    ):
        body = scrape_service._fetch("https://example.com")
    mock_imp.assert_not_called()
    assert "ok" in body


def test_fetch_raises_block_error_when_still_blocked_after_escalation() -> None:
    with (
        patch.object(scrape_service, "_fetch_with_requests", return_value=(403, "")),
        patch.object(scrape_service, "_fetch_with_impersonation", return_value=None),
    ):
        with pytest.raises(ScrapeError) as exc:
            scrape_service._fetch("https://chords.example.com/song")
    assert "blocked" in str(exc.value)


def test_fetch_raises_not_found_for_404() -> None:
    with patch.object(scrape_service, "_fetch_with_requests", return_value=(404, "nope")):
        with pytest.raises(ScrapeError) as exc:
            scrape_service._fetch("https://example.com/missing")
    assert "404" in str(exc.value)


def test_scrape_via_impersonation_end_to_end() -> None:
    """A CDN-blocked page is recovered via impersonation and parsed."""
    store_html = _store_html(STORE_CONTENT)
    with (
        patch.object(scrape_service, "_validate_url"),
        patch.object(scrape_service, "_fetch_with_requests", return_value=(403, "blocked")),
        patch.object(scrape_service, "_fetch_with_impersonation", return_value=(200, store_html)),
    ):
        result = scrape_url("https://chords.example.com/another-song")
    assert result.title == "Test Song"
    assert "sample lyric line" in result.text


# --- Endpoint: POST /api/parse/url ---


def _make_profile(client: TestClient) -> dict[str, Any]:
    return client.post("/api/profiles", json={"name": "Test"}).json()


def test_parse_url_endpoint_success(client: TestClient) -> None:
    profile = _make_profile(client)
    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.encoding = "utf-8"
    fake_resp.iter_content = MagicMock(return_value=[_store_html(STORE_CONTENT).encode()])

    with (
        patch.object(scrape_service, "_validate_url"),
        patch.object(scrape_service.requests, "get", return_value=fake_resp),
    ):
        resp = client.post(
            "/api/parse/url",
            json={
                "profile_id": profile["id"],
                "url": "https://chords.example.com/some-song",
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Test Song"
    assert body["artist"] == "Test Artist"
    assert "[ch]" not in body["text"]
    assert body["source_url"].endswith("/some-song")


def test_parse_url_endpoint_profile_not_found(client: TestClient) -> None:
    resp = client.post(
        "/api/parse/url",
        json={"profile_id": 9999, "url": "https://example.com/song"},
    )
    assert resp.status_code == 404


def test_parse_url_endpoint_maps_scrape_error(client: TestClient) -> None:
    profile = _make_profile(client)
    with patch.object(
        scrape_service,
        "scrape_url",
        side_effect=ScrapeError("That site blocked the request.", status_code=422),
    ):
        resp = client.post(
            "/api/parse/url",
            json={"profile_id": profile["id"], "url": "https://example.com/song"},
        )
    assert resp.status_code == 422
    assert "blocked" in resp.json()["detail"]


def test_parse_url_endpoint_rejects_private_address(client: TestClient) -> None:
    profile = _make_profile(client)
    resp = client.post(
        "/api/parse/url",
        json={"profile_id": profile["id"], "url": "http://localhost:8000/admin"},
    )
    assert resp.status_code == 400
