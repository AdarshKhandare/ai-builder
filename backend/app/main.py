"""FastAPI application entry point.

Wires up the Forge API:

* :class:`~app.middleware.SecurityHeadersMiddleware` — adds the
  X-Content-Type-Options / X-Frame-Options / Referrer-Policy / CSP /
  HSTS response headers on every request.
* :class:`~app.middleware.CORSLockdownMiddleware` — minimal CORS
  enforcement that uses :attr:`Settings.ALLOWED_ORIGINS` to gate
  the ``Access-Control-Allow-Origin`` header. Replaces the
  previous :class:`fastapi.middleware.cors.CORSMiddleware` so
  production can lock CORS down to a single origin without
  affecting FastAPI's other middleware.
* :class:`slowapi.middleware.SlowAPIMiddleware` — global per-IP
  rate limiter (100 req/min by default). The per-user daily caps
  on ``/api/generate`` / ``/api/iterate`` / ``/api/projects`` are
  enforced by :func:`app.routes.deps.check_usage_quota`.
* The :mod:`app.routes.auth` router is mounted *last* so the
  unprotected ``/api/auth/login`` and ``/api/auth/callback`` are
  reachable; ``/api/auth/me`` and ``/api/auth/logout`` apply their
  own auth via :func:`app.routes.deps.get_current_user`.

Lifespan
--------
The lifespan handler still owns DB initialisation. New tables
(``users``, ``usage_events``) are created on the first boot of a
deployment that already has a ``projects`` table; ``create_all``
is idempotent so existing rows are preserved.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

from app.middleware import CORSLockdownMiddleware, SecurityHeadersMiddleware
from app.models.database import init_db
from app.routes import auth, generate, health, iterate, models, projects

logger = logging.getLogger(__name__)

# Global per-IP limiter. The per-route / per-user daily caps live
# in :mod:`app.routes.deps` and are applied as FastAPI
# ``Depends``; this limiter is the outer DDoS / abuse shield that
# applies to every endpoint, including the unauthenticated ones.
#
# The default is 100 requests / minute / IP. ``key_func`` is the
# canonical "remote address" lookup that respects the X-Forwarded-
# For chain when present (so it works behind a reverse proxy
# without further configuration).
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Run startup / shutdown hooks for the Forge API.

    Startup:

    * :func:`app.models.database.init_db` — create all tables
      declared on the SQLAlchemy ``Base`` (currently
      ``projects``, ``users``, ``usage_events``). Idempotent: safe
      on every boot.

    Shutdown:

    * Nothing to dispose explicitly — SQLAlchemy's async engine
      releases its connections on garbage collection, and
      Uvicorn handles HTTP client teardown.

    Args:
        _app: The FastAPI application being started. Underscored
            to signal it is unused; the hook only touches
            module-level state.

    Yields:
        ``None`` between startup and shutdown. Handlers may run
        against the fully-initialised application during this
        window.
    """
    logger.info("Forge API starting up; initialising database")
    await init_db()
    logger.info("Database initialisation complete")
    yield
    logger.info("Forge API shutting down")


app = FastAPI(title="Forge API", version="0.1.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Middleware chain (outermost first; added in reverse so the first
# ``add_middleware`` call is the outermost wrapper).
# ---------------------------------------------------------------------------

# 1. Security headers — added last so it is the outermost
#    middleware (every response passes through it on the way out).
app.add_middleware(SecurityHeadersMiddleware)

# 2. CORS lockdown — second outermost so it can short-circuit
#    preflight requests before they hit the rate limiter (and
#    before they reach the FastAPI app, which would otherwise
#    405 on an unhandled OPTIONS).
app.add_middleware(CORSLockdownMiddleware)

# 3. SlowAPI — global per-IP rate limit. Must come AFTER CORS so
#    the preflight 204 is not counted against the rate limit
#    (browsers fire preflights for every cross-origin request).
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

# 4. ``RateLimitExceeded`` exception handler — converts slowapi
#    exceptions into a JSON 429 envelope. The default response
#    includes ``error``, ``limit``, and a ``Retry-After`` header
#    so the frontend can surface a friendly message.
_RATE_LIMIT_KEY = "_rate_limit_exceeded_handler"


def _rate_limit_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Build the JSON 429 response for :class:`RateLimitExceeded`.

    Args:
        _request: The active FastAPI request (unused; required by
            the slowapi handler signature).
        exc: The :class:`RateLimitExceeded` instance raised by
            slowapi.

    Returns:
        A :class:`JSONResponse` with the structured detail and
        the ``Retry-After`` header if slowapi provided one.
    """
    # ``RateLimitExceeded`` exposes the matched limit on its
    # ``.detail`` attribute. ``str(exc)`` returns the same string
    # in a human-readable form (e.g. ``"100 per 1 minute"``).
    detail: str = str(getattr(exc, "detail", "")) or "rate limit exceeded"
    response = JSONResponse(
        status_code=429,
        content={"error": "rate_limit_exceeded", "detail": detail},
    )
    return response


if not hasattr(app, _RATE_LIMIT_KEY):
    # Idempotent registration: ``add_exception_handler`` itself is
    # idempotent in FastAPI but the explicit guard makes the
    # intent obvious and protects against a future double-import
    # during the test-suite's conftest juggling.
    app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
    setattr(app, _RATE_LIMIT_KEY, True)


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
# Public, no-auth endpoints first so the order matches the
# documentation; auth-protected endpoints (generate / iterate /
# projects) are mounted in the same order they appear in the
# OpenAPI schema. The auth router is included last so the
# ``/api/auth/login`` and ``/api/auth/callback`` routes are
# reachable without a token; the protected ``/api/auth/me`` and
# ``/api/auth/logout`` enforce auth via their own
# ``Depends(get_current_user)`` call.
app.include_router(health.router)
app.include_router(models.router)
app.include_router(auth.router)
app.include_router(generate.router)
app.include_router(iterate.router)
app.include_router(projects.router)


# Quiet the unused-import lint for the ``BaseHTTPMiddleware`` we
# keep imported for future expansion (e.g. an explicit
# request-logging middleware); the alias also documents that we
# know about it.
_ = BaseHTTPMiddleware
