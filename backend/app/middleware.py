"""Security middleware for the Forge API.

Two pieces of security plumbing live here, both as plain ASGI
middleware classes:

* :class:`SecurityHeadersMiddleware` — adds the standard
  security-oriented response headers (X-Content-Type-Options,
  X-Frame-Options, Referrer-Policy, and a CSP that is permissive
  enough for the SPA frontend to talk to the API).
* :class:`CORSLockdownMiddleware` — minimal CORS enforcement that
  uses :attr:`Settings.ALLOWED_ORIGINS` to gate the
  ``Access-Control-Allow-Origin`` header. Kept separate from
  FastAPI's :class:`fastapi.middleware.cors.CORSMiddleware` so
  production deployments can swap the CORS strategy without
  dragging in the rest of FastAPI's CORS behaviour (notably its
  handling of ``allow_credentials`` which is global, not per-
  origin).

Why middleware classes instead of a Starlette ``BaseHTTPMiddleware``
-------------------------------------------------------------------
Starlette's ``BaseHTTPMiddleware`` is convenient but it has known
issues with streaming responses (the response body is buffered in
memory, which would break the SSE endpoints). The plain ASGI form
below streams the response body through unchanged so
``/api/generate`` and ``/api/iterate`` keep their byte-for-byte
SSE contract.
"""

from __future__ import annotations

import logging
from typing import Iterable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Security headers (Task 4)
# ---------------------------------------------------------------------------

# Content-Security-Policy for an API-only backend. The frontend is
# a separate SPA; this CSP applies only to responses served by the
# API (which never returns HTML that the browser would render, but
# setting a CSP here is defence-in-depth — if a future route
# accidentally returns HTML, the browser will refuse to execute
# inline scripts).
#
# The directives are deliberately strict:
#
# * ``default-src 'self'`` — only the API's own origin by default.
# * ``connect-src 'self'`` — fetch / XHR may only talk to the API
#   origin. The SPA on a different origin (e.g. ``ai-builder.adarshweb.in``
#   calling ``api.adarshweb.in``) hits CORS first; ``connect-src``
#   in the *response* CSP is the second line of defence.
# * ``frame-ancestors 'none'`` — equivalent to X-Frame-Options:
#   DENY at the CSP level.
# * ``base-uri 'self'`` — prevents ``<base href>`` injection.
# * ``form-action 'self'`` — keeps form submissions on-origin.
#
# The :class:`Settings.ALLOWED_ORIGINS` list is merged into
# ``connect-src`` at startup so the SPA's dev / prod origins are
# permitted to call the API from a CSP perspective too.
_BASE_CSP_DIRECTIVES: tuple[str, ...] = (
    "default-src 'self'",
    "connect-src {extra_origins}",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
)


def _build_csp() -> str:
    """Build the ``Content-Security-Policy`` header value.

    The list of ``connect-src`` origins is the union of the
    configured :attr:`Settings.ALLOWED_ORIGINS`. ``'self'`` is
    always present so the API can serve requests from a same-
    origin context (e.g. a future internal dashboard).

    Returns:
        A semicolon-separated CSP string suitable for the
        ``Content-Security-Policy`` response header.
    """
    origins: list[str] = ["'self'"]
    for origin in settings.ALLOWED_ORIGINS:
        # CSP source list values must not contain spaces; raw
        # origin strings from settings are URLs without spaces so
        # we pass them through verbatim. ``*`` is a valid CSP
        # wildcard.
        cleaned = origin.strip()
        if cleaned:
            origins.append(cleaned)
    extra = " ".join(origins)
    return "; ".join(
        directive.format(extra_origins=extra) for directive in _BASE_CSP_DIRECTIVES
    )


def _security_headers() -> dict[str, str]:
    """Return the static security headers added to every response.

    The ``Strict-Transport-Security`` header is only included in
    production — emitting it in dev would lock the browser into
    HTTPS for the origin and break the local Vite/HTTP workflow.

    Returns:
        A dict of ``header-name -> value`` ready to be sent on
        the ``start`` message.
    """
    headers: dict[str, str] = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy": _build_csp(),
    }
    if settings.ENVIRONMENT == "production":
        # 1-year HSTS with subdomains. Operators should ensure
        # every subdomain serves HTTPS before flipping
        # ``ENVIRONMENT=production``.
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return headers


class SecurityHeadersMiddleware:
    """ASGI middleware that injects security headers on every response.

    The headers are added to the ``start`` message so they are
    applied to all response statuses (200, 204, 4xx, 5xx) without
    buffering the body. Streaming responses (SSE) keep their
    chunked framing.

    The header dict is rebuilt on every request rather than
    cached at construction time. This is the trade-off: the
    build is O(n) in the number of headers (a handful), which
    is dwarfed by any I/O the request itself does, and it lets
    the test suite toggle :attr:`Settings.ENVIRONMENT` (e.g.
    from ``"development"`` to ``"production"``) without
    rebuilding the app. In production the values never change
    so the lookup is a no-op.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Store the wrapped app.

        Args:
            app: The next ASGI application in the chain.
        """
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Run the middleware.

        Args:
            scope: ASGI scope.
            receive: ASGI receive callable.
            send: ASGI send callable.
        """
        if scope["type"] != "http":
            # Lifespan / websocket: no HTTP headers to set.
            await self.app(scope, receive, send)
            return

        # Per-request header lookup so the test suite (and any
        # future operator that flips ENVIRONMENT at runtime) gets
        # the right values without a restart.
        current_headers: list[tuple[bytes, bytes]] = [
            (name.lower().encode("latin-1"), value.encode("latin-1"))
            for name, value in _security_headers().items()
        ]

        async def send_with_headers(message: Message) -> None:
            """Inject security headers into the response ``start``.

            Args:
                message: An ASGI ``http.response.start`` message or
                    a body / trailing-message chunk.
            """
            if message["type"] == "http.response.start":
                # Merge with whatever headers the downstream app
                # already set; the middleware's headers take
                # precedence on conflict (defence in depth — we
                # do not want a downstream route accidentally
                # turning off X-Frame-Options).
                raw_headers: list[tuple[bytes, bytes]] = list(
                    message.get("headers", [])
                )
                for name, value in current_headers:
                    raw_headers = [(n, v) for n, v in raw_headers if n.lower() != name]
                    raw_headers.append((name, value))
                message["headers"] = raw_headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


# ---------------------------------------------------------------------------
# CORS lockdown (Task 5)
# ---------------------------------------------------------------------------


def _is_origin_allowed(origin: str, allowed: Iterable[str]) -> bool:
    """Return ``True`` if ``origin`` is in the allow-list.

    Wildcard ``"*"`` in the allow-list matches any origin. The
    match is exact — a trailing-slash mismatch (e.g.
    ``http://x/`` vs ``http://x``) is *not* silently ignored; the
    operator should add both forms to the allow-list if needed.

    Args:
        origin: The ``Origin`` request header value (may be empty).
        allowed: The configured :attr:`Settings.ALLOWED_ORIGINS`.

    Returns:
        ``True`` if the origin is permitted, ``False`` otherwise.
    """
    for entry in allowed:
        if entry == "*" or entry == origin:
            return True
    return False


class CORSLockdownMiddleware:
    """Minimal CORS enforcement using :attr:`Settings.ALLOWED_ORIGINS`.

    This middleware is intentionally narrower than Starlette's
    built-in :class:`fastapi.middleware.cors.CORSMiddleware`: it
    only handles the three CORS cases the Forge API actually
    exercises:

    * Preflight ``OPTIONS`` requests — answered with a 204 and
      the right CORS headers.
    * Actual cross-origin requests — the response gets an
      ``Access-Control-Allow-Origin`` header if and only if the
      request ``Origin`` is in the allow-list.
    * Same-origin requests — pass through unchanged.

    ``Access-Control-Allow-Credentials`` is set when the origin is
    allowed (the frontend sends cookies, so this must be true).

    Args:
        app: The next ASGI application in the chain.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Store the wrapped app and snapshot the allowed origins.

        Args:
            app: The next ASGI application in the chain.
        """
        self.app = app
        self._allowed: tuple[str, ...] = tuple(settings.ALLOWED_ORIGINS)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Run the middleware.

        Args:
            scope: ASGI scope.
            receive: ASGI receive callable.
            send: ASGI send callable.
        """
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method: str = scope.get("method", "GET").upper()
        # The Origin header is delivered as bytes; decode to a
        # string for the comparison.
        origin_bytes: bytes = _get_header(scope, b"origin")
        origin: str = origin_bytes.decode("latin-1") if origin_bytes else ""

        if method == "OPTIONS" and origin:
            # Preflight: answer directly with the CORS headers.
            # We do not pass OPTIONS to the wrapped app; FastAPI's
            # default CORS middleware is a thin wrapper that
            # does the same, and skipping the inner call avoids
            # spurious 405s for routes the developer has not
            # registered an OPTIONS handler for.
            if not _is_origin_allowed(origin, self._allowed):
                # Reject the preflight with a 403. The browser
                # shows a CORS error to JS either way, but a
                # clean 403 is easier to debug than a 200 with
                # no Allow-Origin.
                await _send_status(
                    send, 403, [(b"content-type", b"text/plain")], b"Forbidden"
                )
                return
            await _send_preflight(send, origin)
            return

        if not origin or not _is_origin_allowed(origin, self._allowed):
            # Either same-origin (no Origin header) or a denied
            # cross-origin request — pass through. The downstream
            # app decides the response status.
            await self.app(scope, receive, send)
            return

        # Cross-origin and allowed: append the CORS response
        # headers on top of whatever the inner app returns.
        async def send_with_cors(message: Message) -> None:
            """Add the CORS response headers on the response start.

            Args:
                message: An ASGI ``http.response.start`` or
                    body / trailing message.
            """
            if message["type"] == "http.response.start":
                raw: list[tuple[bytes, bytes]] = list(message.get("headers", []))
                # Replace any existing ACAO so we never end up
                # with two conflicting values.
                raw = [
                    (n, v)
                    for n, v in raw
                    if n.lower() != b"access-control-allow-origin"
                ]
                raw.append((b"access-control-allow-origin", origin.encode("latin-1")))
                raw.append((b"access-control-allow-credentials", b"true"))
                raw.append((b"vary", b"Origin"))
                message["headers"] = raw
            await send(message)

        await self.app(scope, receive, send_with_cors)


def _get_header(scope: Scope, name: bytes) -> bytes:
    """Return the value of an HTTP header from an ASGI scope.

    Args:
        scope: The active ASGI scope.
        name: The lower-cased header name as bytes.

    Returns:
        The header value as bytes, or ``b""`` if not present.
    """
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            return value
    return b""


async def _send_status(
    send: Send,
    status_code: int,
    extra_headers: list[tuple[bytes, bytes]],
    body: bytes,
) -> None:
    """Send a complete (non-streaming) HTTP response.

    Args:
        send: The ASGI send callable.
        status_code: HTTP status code.
        extra_headers: Headers to include on the response.
        body: Response body bytes.
    """
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-length", str(len(body)).encode("latin-1")),
                *extra_headers,
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def _send_preflight(send: Send, origin: str) -> None:
    """Answer a CORS preflight with 204 and the right headers.

    Args:
        send: The ASGI send callable.
        origin: The request ``Origin`` header value.
    """
    await send(
        {
            "type": "http.response.start",
            "status": 204,
            "headers": [
                (b"access-control-allow-origin", origin.encode("latin-1")),
                (b"access-control-allow-credentials", b"true"),
                (b"access-control-allow-methods", b"GET, POST, PATCH, DELETE, OPTIONS"),
                (
                    b"access-control-allow-headers",
                    b"authorization, content-type, x-requested-with",
                ),
                (b"access-control-max-age", b"600"),
                (
                    b"vary",
                    b"Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
                ),
                (b"content-length", b"0"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": b""})
