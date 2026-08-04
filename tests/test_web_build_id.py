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


def test_web_build_id_is_not_cached(client: TestClient) -> None:
    # The staleness check must never be answered from a cache, or it could miss
    # the deploy it exists to detect. Never the year-long immutable asset cache.
    resp = client.get("/api/web-build-id")
    cache_control = resp.headers.get("cache-control", "")
    assert "no-store" in cache_control
    assert "immutable" not in cache_control


def _cache_control_for(path: str) -> str:
    """Run one request through the real middleware stack and read Cache-Control.

    Goes through `CacheHeadersMiddleware` on a route that exists, rather than
    constructing the middleware by hand, so the assertion covers the wiring too.
    """
    from app.main import app

    with TestClient(app) as c:
        return c.get(path).headers.get("cache-control", "")


def test_service_worker_is_never_cached() -> None:
    # The wedge this prevents: with no Cache-Control from the origin, a CDN applies
    # its own default. Cloudflare used 4 hours, so an installed PWA kept fetching a
    # stale sw.js that precached the previous entry bundle. registration.update()
    # found nothing new, no worker reached `waiting`, and the update banner had
    # nothing to activate while /api/web-build-id correctly reported a new build.
    # Reloading could not escape it either, because the reload was answered from the
    # stale worker's precache.
    cache_control = _cache_control_for("/sw.js")
    assert "no-cache" in cache_control
    assert "immutable" not in cache_control
    assert "max-age=31536000" not in cache_control


def test_manifest_is_never_cached() -> None:
    # A stale manifest survives an uninstall/reinstall of the PWA, so the icons and
    # name can outlive the build that changed them.
    assert "no-cache" in _cache_control_for("/manifest.json")


def test_hashed_assets_are_still_immutable() -> None:
    # The other half of the rule: content-hashed files must keep the year-long
    # cache, or every deploy would re-download the whole bundle.
    cache_control = _cache_control_for("/assets/index-abc123.js")
    assert "immutable" in cache_control
    assert "max-age=31536000" in cache_control
