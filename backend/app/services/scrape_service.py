"""Fetch a web page and extract song lyrics/chords as plain text.

Has dedicated handling for Ultimate Guitar tab pages, which embed their tab
content as an HTML-escaped JSON blob inside a ``<div class="js-store">``
element. Falls back to a generic HTML-to-text extraction for other sites.

The extracted text is meant to be fed through the normal parse pipeline
(``llm_service.parse_content``), which cleans formatting and identifies the
title/artist. Anything we can determine up front (e.g. Ultimate Guitar's
structured metadata) is prepended so the parser has a head start.
"""

import ipaddress
import json
import logging
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# A browser-like User-Agent. Many lyric/chord sites reject the default
# python-requests UA outright.
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_REQUEST_HEADERS = {
    "User-Agent": _BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}
_REQUEST_TIMEOUT = 15  # seconds
_MAX_BYTES = 5 * 1024 * 1024  # cap downloaded HTML at 5 MB
_MAX_TEXT_CHARS = 100_000  # keep within ParseRequest.content limit

# Browser to impersonate when escalating to curl_cffi (latest Chrome profile).
_IMPERSONATE_BROWSER = "chrome"

# Signs that a response is a bot-challenge / block page rather than real content.
# Sites like Ultimate Guitar sit behind Cloudflare, which rejects plain
# datacenter requests; these markers let us detect that and escalate.
_BLOCK_STATUS = frozenset({401, 403, 429, 503})
_BLOCK_BODY_MARKERS = (
    "Just a moment",
    "cf-browser-verification",
    "Checking your browser",
    "Attention Required",
    "__cf_chl",
)


class ScrapeError(Exception):
    """Raised when a page can't be fetched or holds no usable song text.

    ``status_code`` is the HTTP status the API endpoint should surface.
    """

    def __init__(self, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class ScrapeResult:
    text: str
    title: str | None = None
    artist: str | None = None


def _validate_url(url: str) -> None:
    """Reject non-http(s) URLs and addresses that resolve to internal hosts.

    This is a basic SSRF guard: the URL is user-supplied and fetched
    server-side, so we must not let it reach loopback, link-local, or private
    network ranges (e.g. cloud metadata endpoints).
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ScrapeError("Only http and https links are supported.", status_code=400)
    host = parsed.hostname
    if not host:
        raise ScrapeError("That doesn't look like a valid link.", status_code=400)

    try:
        addrinfos = socket.getaddrinfo(host, parsed.port or 80, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ScrapeError("Could not resolve that link's address.", status_code=400) from None

    for info in addrinfos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise ScrapeError(
                "That link points to a private or internal address, which isn't allowed.",
                status_code=400,
            )


def _read_capped(resp: object) -> bytes:
    """Read a streaming response body up to ``_MAX_BYTES``."""
    chunks: list[bytes] = []
    total = 0
    for chunk in resp.iter_content(8192):  # type: ignore[attr-defined]
        chunks.append(chunk)
        total += len(chunk)
        if total > _MAX_BYTES:
            break
    return b"".join(chunks)


def _looks_blocked(status_code: int, body: str) -> bool:
    """Heuristic: did we get a bot-challenge / block page instead of content?"""
    if status_code in _BLOCK_STATUS:
        return True
    return any(marker in body for marker in _BLOCK_BODY_MARKERS)


def _fetch_with_requests(url: str) -> tuple[int, str]:
    """Plain fetch via requests. Raises ScrapeError on transport failures."""
    try:
        resp = requests.get(url, headers=_REQUEST_HEADERS, timeout=_REQUEST_TIMEOUT, stream=True)
    except requests.Timeout:
        raise ScrapeError("That link took too long to respond. Try again.") from None
    except requests.RequestException:
        raise ScrapeError("Couldn't reach that link. Check the URL and try again.") from None
    try:
        body = _read_capped(resp).decode(resp.encoding or "utf-8", errors="replace")
    finally:
        resp.close()
    return resp.status_code, body


def _fetch_with_impersonation(url: str) -> tuple[int, str] | None:
    """Retry via curl_cffi, mimicking a real Chrome TLS/HTTP fingerprint.

    This gets past the passive Cloudflare bot checks that reject plain
    python-requests (e.g. Ultimate Guitar). Returns ``None`` if curl_cffi is
    unavailable or the request itself fails, so callers fall back to the
    original (blocked) response.
    """
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        logger.warning("curl_cffi not installed; cannot retry with browser impersonation")
        return None

    try:
        resp = cffi_requests.get(
            url,
            headers={"Accept-Language": "en-US,en;q=0.9"},
            timeout=_REQUEST_TIMEOUT,
            impersonate=_IMPERSONATE_BROWSER,
            stream=True,
        )
    except Exception:
        logger.exception("Browser-impersonation fetch failed for %s", url)
        return None

    try:
        body = _read_capped(resp).decode(resp.encoding or "utf-8", errors="replace")
    finally:
        resp.close()
    return resp.status_code, body


def _fetch(url: str) -> str:
    """Download a page as text, escalating to browser impersonation if blocked.

    Most sites succeed on the cheap requests path. When that looks like a bot
    block (Cloudflare and friends), we retry once with curl_cffi impersonating
    Chrome, which is enough for sites like Ultimate Guitar.
    """
    status, body = _fetch_with_requests(url)

    if _looks_blocked(status, body):
        logger.info(
            "Fetch for %s looks blocked (HTTP %s); retrying with impersonation", url, status
        )
        escalated = _fetch_with_impersonation(url)
        if escalated is not None:
            status, body = escalated

    if _looks_blocked(status, body):
        raise ScrapeError(
            "That site blocked the request. Try copying the chords and pasting them instead."
        )
    if status == 404:
        raise ScrapeError("That link wasn't found (404). Check the URL.")
    if status >= 400:
        raise ScrapeError(f"That link returned an error (HTTP {status}).")

    return body


def _clean_ug_markup(content: str) -> str:
    """Strip Ultimate Guitar's ``[ch]``/``[tab]`` markup, leaving plain text.

    UG wraps chords in ``[ch]...[/ch]`` and aligned chord/lyric blocks in
    ``[tab]...[/tab]``. Removing the markers leaves the chord-over-lyric layout
    intact, which is what the parser expects.
    """
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    content = re.sub(r"\[/?tab\]", "", content)
    content = re.sub(r"\[/?ch\]", "", content)
    return content.strip()


def _extract_ultimate_guitar(html_text: str) -> ScrapeResult | None:
    """Pull tab content and metadata from an Ultimate Guitar page.

    Returns ``None`` if the page isn't an Ultimate Guitar tab page (or its
    structure has changed), so callers can fall back to generic extraction.
    """
    soup = BeautifulSoup(html_text, "html.parser")
    store_div = soup.find("div", class_="js-store")
    if store_div is None:
        return None
    raw = store_div.get("data-content")
    if not raw:
        return None

    try:
        # BeautifulSoup already HTML-unescapes attribute values, so this is JSON.
        store = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None

    data = store.get("store", {}).get("page", {}).get("data", {})
    content = data.get("tab_view", {}).get("wiki_tab", {}).get("content")
    if not content or not isinstance(content, str):
        return None

    tab = data.get("tab", {})
    title = tab.get("song_name") or None
    artist = tab.get("artist_name") or None

    return ScrapeResult(text=_clean_ug_markup(content), title=title, artist=artist)


def _normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse runs of 3+ blank lines down to a single blank line.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_generic(html_text: str) -> ScrapeResult:
    """Best-effort plain-text extraction for non-UG pages.

    Chord sites commonly wrap their content in ``<pre>`` tags, so those are
    preferred; otherwise the full body text is used. The parser does the heavy
    lifting of turning this into clean chords afterward.
    """
    soup = BeautifulSoup(html_text, "html.parser")

    page_title = soup.title.get_text().strip() if soup.title else None

    pres = soup.find_all("pre")
    if pres:
        text = "\n\n".join(p.get_text() for p in pres)
        text = _normalize_whitespace(text)
        if text:
            return ScrapeResult(text=text, title=page_title)

    for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        tag.decompose()

    text = _normalize_whitespace(soup.get_text("\n"))
    return ScrapeResult(text=text, title=page_title)


def scrape_url(url: str) -> ScrapeResult:
    """Fetch *url* and return extracted song text (and any metadata found).

    Raises :class:`ScrapeError` for invalid/blocked URLs or pages with no
    usable text. This function is blocking (uses ``requests``); call it via
    ``asyncio.to_thread`` from async code.
    """
    _validate_url(url)
    html_text = _fetch(url)

    result = _extract_ultimate_guitar(html_text)
    if result is None:
        result = _extract_generic(html_text)

    if not result.text.strip():
        raise ScrapeError("Couldn't find any song text on that page.")

    # Prepend any metadata we found so the parser can identify title/artist
    # even when the body text doesn't repeat them.
    header_parts = [p for p in (result.title, result.artist) if p]
    body = result.text
    if header_parts:
        body = " - ".join(header_parts) + "\n\n" + body

    if len(body) > _MAX_TEXT_CHARS:
        body = body[:_MAX_TEXT_CHARS]

    return ScrapeResult(text=body, title=result.title, artist=result.artist)
