import logging
import re
from importlib.metadata import version as pkg_version
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import settings
from .database import get_db
from .routers import auth, follow, profiles, rewrite, songs
from .schemas import HealthResponse

load_dotenv()

logger = logging.getLogger(__name__)

try:
    __version__ = pkg_version("porchsongs")
except Exception:
    __version__ = "0.0.0-dev"

app = FastAPI(title="porchsongs", version=__version__)

# Vite names the entry chunk `assets/index-<hash>.js`; the hash changes on every
# rebuild. Lazy chunks get their own names, so the first match is the entry.
_ENTRY_BUNDLE_RE = re.compile(r"assets/(index-[A-Za-z0-9_-]+\.js)")


def _extract_web_build_id(html: str) -> str | None:
    """Pull the content-hashed entry bundle name out of the built index.html.

    This is the frontend's build identity: the client compares its own entry
    script's filename against this value (via GET /api/web-build-id) and offers
    a reload when they differ, so a long-lived page (especially an installed
    PWA, which iOS resumes for weeks with no refresh affordance) does not keep
    running a stale bundle after a deploy. Returns None for an unbuilt shell
    (Vite dev server entry is /src/main.tsx), which disables the check there.
    """
    match = _ENTRY_BUNDLE_RE.search(html)
    return match.group(1) if match else None


app.add_middleware(
    CORSMiddleware,  # type: ignore[arg-type]
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(songs.router, prefix="/api")
app.include_router(rewrite.router, prefix="/api")
app.include_router(follow.router, prefix="/api")


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health(db: Session = Depends(get_db)) -> HealthResponse | JSONResponse:
    """Public health-check endpoint for container orchestration."""
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        logger.warning("Health check failed: database unreachable")
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "version": __version__},
        )
    return HealthResponse(status="ok", version=__version__)


# Files that decide which build everything else comes from, and so must never be
# answered from a cache.
#
# `/sw.js` is the important one and the reason this set exists. It is not under
# `/assets/`, it is not `text/html`, and it is not hash-named, so it used to fall
# through this middleware with no Cache-Control at all. A CDN in front of the origin
# then applies its own default, and Cloudflare's is a 4 hour browser TTL. That is
# enough to wedge an installed PWA completely: the stale worker keeps precaching the
# previous entry bundle, `registration.update()` re-fetches the same bytes and finds
# nothing new, so no worker ever reaches `waiting` while `/api/web-build-id` (which
# is `no-store`) correctly reports the new build. The update banner appears, has
# nothing to activate, and cannot be dismissed by reloading, because reloading is
# answered from the old worker's precache. Observed in production on 2026-08-04 with
# `cf-cache-status: HIT`, `age: 2587`, and a live `sw.js` still naming the previous
# bundle.
#
# `workbox-*.js` is deliberately absent: it is content-hashed, so a long cache is
# correct and a new build simply requests a new URL.
_NEVER_CACHE_PATHS = frozenset(
    {
        "/sw.js",
        # Emitted only when vite-plugin-pwa's `injectRegister` is set to 'script'.
        # Listed so turning that on cannot quietly reintroduce the same wedge.
        "/registerSW.js",
        # The PWA's identity: name, icons, start_url. Stale copies survive reinstalls.
        "/manifest.json",
    }
)


class CacheHeadersMiddleware:
    """Tune Cache-Control so deploys are picked up without serving stale code.

    Hashed assets (Vite ``/assets/*``) are immutable and cached for a year; the
    HTML shell (index.html / SPA fallback) and the service worker are served
    ``no-cache`` so the browser always revalidates and learns about a new entry
    bundle after a deploy.

    Every response gets an explicit Cache-Control. Saying nothing is not neutral:
    it hands the decision to whatever CDN is in front, which is how the service
    worker came to be cached for four hours.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        is_hashed_asset = path.startswith("/assets/")
        never_cache = path in _NEVER_CACHE_PATHS

        async def send_with_cache(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if never_cache:
                    headers = [(k, v) for (k, v) in headers if k.lower() != b"cache-control"]
                    headers.append((b"cache-control", b"no-cache"))
                    message = {**message, "headers": headers}
                elif is_hashed_asset:
                    headers.append((b"cache-control", b"public, max-age=31536000, immutable"))
                    message = {**message, "headers": headers}
                else:
                    content_type = next(
                        (v for (k, v) in headers if k.lower() == b"content-type"), b""
                    )
                    if content_type.startswith(b"text/html"):
                        headers = [(k, v) for (k, v) in headers if k.lower() != b"cache-control"]
                        headers.append((b"cache-control", b"no-cache"))
                        message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cache)


app.add_middleware(CacheHeadersMiddleware)  # type: ignore[arg-type]

# Serve the React build output (frontend/dist) if it exists, otherwise serve frontend/ directly.
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
_static_dir = (
    frontend_dist if frontend_dist.exists() else (frontend_dir if frontend_dir.exists() else None)
)

_index_html_content = ""
if _static_dir is not None:
    _index_html_path = _static_dir / "index.html"
    _index_html_content = _index_html_path.read_text() if _index_html_path.exists() else ""

_web_build_id = _extract_web_build_id(_index_html_content)


@app.get("/api/web-build-id", include_in_schema=False)
async def web_build_id() -> JSONResponse:
    """Report the deployed entry-bundle hash so clients can detect a stale page.

    Intentionally DB-free and unauthenticated: the reload prompt must work on
    every route (marketing, login, app) and even when the database is degraded.
    `no-store` so the staleness check is never answered from a cache.
    """
    return JSONResponse({"web_build_id": _web_build_id}, headers={"Cache-Control": "no-store"})


if _static_dir is not None:

    @app.get("/app")
    @app.get("/app/{rest:path}")
    @app.get("/rewrite")
    @app.get("/library")
    @app.get("/library/{rest:path}")
    @app.get("/settings")
    @app.get("/settings/{rest:path}")
    async def _spa_fallback() -> HTMLResponse:
        """Serve index.html for SPA client-side routes."""
        return HTMLResponse(_index_html_content)

    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="frontend")
