"""Tests for the frontend staleness mechanism: build-id endpoint + cache headers."""

from fastapi.testclient import TestClient

from app.main import _extract_web_build_id


def test_extract_web_build_id_finds_entry_bundle() -> None:
    html = (
        '<head><script type="module" crossorigin src="/assets/index-DKenwdW0.js"></script>'
        '<link rel="modulepreload" href="/assets/vendor-Bx91yz.js"></head>'
    )
    assert _extract_web_build_id(html) == "index-DKenwdW0.js"


def test_extract_web_build_id_none_without_entry() -> None:
    # Vite dev server shell points at /src/main.tsx, not a hashed bundle.
    assert _extract_web_build_id('<script type="module" src="/src/main.tsx"></script>') is None
    assert _extract_web_build_id("<html><body>hi</body></html>") is None


def test_web_build_id_endpoint_is_public_and_dbless(client: TestClient) -> None:
    resp = client.get("/api/web-build-id")
    assert resp.status_code == 200
    assert "web_build_id" in resp.json()


def test_api_responses_are_not_immutably_cached(client: TestClient) -> None:
    # Only hashed /assets/* should get the year-long immutable cache.
    resp = client.get("/api/web-build-id")
    assert "immutable" not in resp.headers.get("cache-control", "")
