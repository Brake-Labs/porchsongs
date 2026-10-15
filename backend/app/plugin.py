"""The extension point a hosted build uses to add to the OSS app.

Pass an ``AppPlugin`` to ``app.main.create_app``. Every hook is optional; the
defaults contribute nothing, so ``create_app(AppPlugin())`` is the OSS app.

``create_app`` applies the hooks in a fixed order, which is the contract:

1. OSS middleware and the OSS API routers.
2. ``routers()``, each mounted under ``/api``.
3. ``authenticator()`` and ``auth_backend()`` are attached to the app.
4. ``configure(app)``: add page routes or middleware here. It runs before the
   SPA fallback routes and the static-files catch-all are mounted, so routes
   added here are matched first, and middleware added here wraps the OSS
   middleware.
5. The SPA fallback and the static mount at ``/``.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import APIRouter, FastAPI, Request
    from sqlalchemy.orm import Session

    from .auth.base import AuthBackend
    from .models import User

# Resolves the user for a request, or raises an ``HTTPException`` (e.g. 401).
Authenticate = Callable[["Request", "Session"], "User"]


class AppPlugin:
    """Base class for app plugins. Override only the hooks you need."""

    def authenticator(self) -> Authenticate | None:
        """How to resolve the user for a request.

        The returned callable replaces the OSS single local user for every route
        that depends on ``get_current_user``. ``None`` keeps the OSS behaviour.
        """
        return None

    def auth_backend(self) -> AuthBackend | None:
        """What ``GET /api/auth/config`` reports.

        ``None`` falls back to the ``PREMIUM_PLUGIN`` loader, then to the OSS
        "no auth" config.
        """
        return None

    def routers(self) -> Sequence[APIRouter]:
        """Extra API routers, each mounted under ``/api``."""
        return ()

    def configure(self, app: FastAPI) -> None:
        """Add routes or middleware before the static catch-all is mounted."""
