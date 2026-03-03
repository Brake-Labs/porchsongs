import logging
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
from .routers import auth, profiles, rewrite, songs
from .schemas import HealthResponse

load_dotenv()

logger = logging.getLogger(__name__)

try:
    __version__ = pkg_version("porchsongs")
except Exception:
    __version__ = "0.0.0-dev"

app = FastAPI(title="porchsongs", version=__version__)

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


class CacheHeadersMiddleware:
    """Add Cache-Control headers for hashed static assets (Vite /assets/*)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        is_hashed_asset = path.startswith("/assets/")

        async def send_with_cache(message: Message) -> None:
            if message["type"] == "http.response.start" and is_hashed_asset:
                headers = list(message.get("headers", []))
                headers.append((b"cache-control", b"public, max-age=31536000, immutable"))
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

if _static_dir is not None:
    _index_html_path = _static_dir / "index.html"
    _index_html_content = _index_html_path.read_text() if _index_html_path.exists() else ""

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
