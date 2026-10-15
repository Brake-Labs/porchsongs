"""The app factory's plugin hooks: routers, auth, configure, and their order."""

from collections.abc import Generator, Sequence
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from starlette.routing import Mount
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import main
from app.auth.base import AuthBackend
from app.database import get_db
from app.main import create_app
from app.models import User
from app.plugin import AppPlugin, Authenticate

plugin_router = APIRouter()


@plugin_router.get("/plugin/ping")
def _ping() -> dict[str, str]:
    return {"pong": "yes"}


class _HeaderMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def _send(message: Message) -> None:
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], (b"x-plugin", b"1")]}
            await send(message)

        await self.app(scope, receive, _send)


class _Backend(AuthBackend):
    def get_auth_config(self) -> dict[str, Any]:
        return {"method": "plugin", "required": True}

    def authenticate_login(self, db: Session, credentials: dict[str, str]) -> User:
        raise NotImplementedError


class _Plugin(AppPlugin):
    def __init__(self, user: User | None = None) -> None:
        self.user = user

    def routers(self) -> Sequence[APIRouter]:
        return [plugin_router]

    def authenticator(self) -> Authenticate | None:
        def _authenticate(request: Request, db: Session) -> User:
            if request.headers.get("authorization") != "Bearer ok" or self.user is None:
                raise HTTPException(status_code=401, detail="nope")
            return db.merge(self.user)

        return _authenticate

    def auth_backend(self) -> AuthBackend | None:
        return _Backend()

    def configure(self, app: FastAPI) -> None:
        @app.get("/")
        async def _home() -> PlainTextResponse:
            return PlainTextResponse("plugin home")

        app.add_middleware(_HeaderMiddleware)  # type: ignore[arg-type]


@pytest.fixture()
def plugin_client(db_session: Session, test_user: User) -> Generator[TestClient]:
    app = create_app(_Plugin(test_user))

    def _db() -> Generator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as c:
        yield c


def test_plugin_router_is_mounted_under_api(plugin_client: TestClient) -> None:
    assert plugin_client.get("/api/plugin/ping").json() == {"pong": "yes"}


def test_authenticator_replaces_the_local_user(plugin_client: TestClient) -> None:
    assert plugin_client.get("/api/profiles").status_code == 401
    resp = plugin_client.get("/api/profiles", headers={"Authorization": "Bearer ok"})
    assert resp.status_code == 200


def test_authenticator_survives_cleared_dependency_overrides(
    plugin_client: TestClient,
) -> None:
    """Auth is not a dependency override, so clearing overrides cannot fall back
    to the OSS local admin user."""
    app = plugin_client.app
    assert isinstance(app, FastAPI)
    app.dependency_overrides.clear()
    assert plugin_client.get("/api/profiles").status_code == 401


def test_auth_backend_answers_auth_config(plugin_client: TestClient) -> None:
    assert plugin_client.get("/api/auth/config").json() == {"method": "plugin", "required": True}


def test_configure_routes_win_over_the_static_catch_all(plugin_client: TestClient) -> None:
    resp = plugin_client.get("/")
    assert resp.text == "plugin home"
    assert resp.headers["x-plugin"] == "1"


def test_static_mount_stays_last() -> None:
    app = create_app(_Plugin())
    if main._static_dir is None:
        pytest.skip("no frontend directory to mount")
    assert isinstance(app.routes[-1], Mount)
    assert app.routes[-1].name == "frontend"


def test_plugin_does_not_leak_into_other_apps() -> None:
    create_app(_Plugin())
    with TestClient(main.app) as c:
        assert c.get("/api/plugin/ping").status_code != 200
        assert c.get("/api/auth/config").json() == {"method": "none", "required": False}
    assert main.app.state.authenticate is None


def _route_paths(app: FastAPI) -> list[str | None]:
    return [getattr(r, "path", None) for r in app.routes]


def test_default_plugin_builds_the_oss_app() -> None:
    # Order matters, not just membership: Starlette matches routes in order.
    assert _route_paths(create_app(AppPlugin())) == _route_paths(main.app)


def test_plugin_routers_follow_every_oss_api_route() -> None:
    """A plugin router cannot shadow an OSS route such as /api/health."""
    oss = [p for p in _route_paths(main.app) if p and p.startswith("/api/")]
    paths = _route_paths(create_app(_Plugin()))
    assert paths.index("/api/plugin/ping") > max(paths.index(p) for p in oss)
