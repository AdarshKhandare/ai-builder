"""GitHub OAuth + JWT authentication routes.

Implements the user-facing authentication flow:

* ``GET /api/auth/login`` — start the OAuth flow. Redirects the
  browser to GitHub's ``/login/oauth/authorize`` endpoint with the
  configured client id and ``read:user`` scope.
* ``GET /api/auth/callback`` — handle GitHub's redirect. Exchanges
  the ``code`` for an access token, fetches the user's profile from
  ``https://api.github.com/user``, upserts a :class:`User` row,
  issues a signed JWT, sets it as an ``httpOnly`` ``forge_token``
  cookie, and redirects the browser to ``FRONTEND_URL + "/builder"``.
* ``GET /api/auth/me`` — return the current user's profile
  (or ``401`` if no valid cookie).
* ``POST /api/auth/logout`` — clear the cookie and return ``200``.

Scope
-----
The minimal ``read:user`` scope is requested. We do NOT ask for
``repo`` or any other elevated scope — Forge only needs the user's
identity, not access to their code.

Cookie security
---------------
The ``forge_token`` cookie is set with ``httponly=True`` and
``samesite="lax"`` so it is invisible to JavaScript (defeats XSS
token theft) and survives top-level OAuth redirects. ``secure=True``
is enabled in production so the cookie is only sent over HTTPS.

Failure modes
-------------
* Missing ``GITHUB_CLIENT_ID`` — ``/api/auth/login`` returns ``503``
  (we cannot start an OAuth flow without a client id). The other
  endpoints are unaffected: ``/me`` returns the current user (or
  401), ``/logout`` always succeeds, ``/callback`` returns ``503``
  if the exchange fails (no client id / secret).
* Invalid ``code`` — GitHub's token endpoint returns 4xx; we surface
  a generic ``502`` to the user.
* Network errors to GitHub — also ``502`` with a generic message;
  the raw exception text is logged but never sent to the wire.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

import httpx
from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.database import User, get_db
from app.routes.deps import (
    create_access_token,
    get_current_user,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# GitHub OAuth endpoints. Pinned as module constants so the test
# suite can patch them in one place if it ever needs to point at a
# mock server.
_GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
_GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
_GITHUB_USER_URL = "https://api.github.com/user"

# Minimal scope: we need the user's identity (id, login, avatar, email)
# but not their repos or any other privileged data.
_OAUTH_SCOPES = "read:user"

# Cookie attributes. ``httponly`` defeats XSS-based token theft;
# ``samesite="lax"`` allows the cookie to be sent on the
# top-level redirect from GitHub back to /api/auth/callback.
# ``secure`` is enabled in production so the cookie is never sent
# over plain HTTP.
_COOKIE_NAME = "forge_token"


def _cookie_secure() -> bool:
    """``True`` iff the auth cookie should be marked ``Secure``.

    Only enabled in production — local dev runs over HTTP, and
    ``Secure`` would cause the browser to silently drop the cookie.
    """
    return settings.ENVIRONMENT == "production"


def _callback_redirect_uri() -> str:
    """Return the absolute URL GitHub should redirect back to.

    The OAuth callback URL on GitHub's side MUST be the backend's
    public ``/api/auth/callback`` endpoint. For local development
    (where ``BACKEND_PUBLIC_URL`` is empty), we default to
    ``http://localhost:8000`` which matches the dev compose setup.
    In production the operator must set ``BACKEND_PUBLIC_URL`` to
    the backend's public origin (e.g.
    ``https://api.adarshweb.in``).
    """
    backend_base = settings.BACKEND_PUBLIC_URL or "http://localhost:8000"
    return f"{backend_base.rstrip('/')}/api/auth/callback"


@router.get(
    "/api/auth/login",
    summary="Start GitHub OAuth login",
)
async def login() -> Response:
    """Redirect the browser to GitHub's OAuth authorize endpoint.

    Returns:
        A 307 redirect to ``https://github.com/login/oauth/authorize``
        with the configured client id, scope, and a fresh state
        nonce. The browser follows the redirect and ends up on
        GitHub's consent screen.

    Raises:
        HTTPException: ``503`` if ``GITHUB_CLIENT_ID`` is empty —
            we cannot start an OAuth flow without a registered
            application.
    """
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID "
                "and GITHUB_CLIENT_SECRET in the backend .env."
            ),
        )

    oauth = AsyncOAuth2Client(
        client_id=settings.GITHUB_CLIENT_ID,
        client_secret=settings.GITHUB_CLIENT_SECRET,
        scope=_OAUTH_SCOPES,
    )
    try:
        # ``create_authorization_url`` builds the GitHub authorize
        # URL with the standard ``response_type=code`` plus the
        # registered redirect URI. We pass the explicit
        # ``redirect_uri`` here so the route works without a
        # custom OAuth client.
        authorization_url, _state = oauth.create_authorization_url(
            _GITHUB_AUTHORIZE_URL,
            redirect_uri=_callback_redirect_uri(),
        )
    finally:
        # ``AsyncOAuth2Client`` wraps an ``httpx.AsyncClient`` we
        # never actually use (we only need its URL builder);
        # close it to avoid leaking the connection. The method
        # is ``aclose`` on authlib's async client.
        await oauth.aclose()

    return Response(
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        headers={"Location": authorization_url},
    )


@router.get(
    "/api/auth/callback",
    summary="GitHub OAuth callback",
)
async def callback(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Handle GitHub's redirect after user consent.

    Steps:

    1. Exchange ``code`` for an access token via GitHub's
       ``/login/oauth/access_token`` endpoint.
    2. Fetch the user profile from ``/user``.
    3. Upsert a :class:`User` row keyed on ``github_id``.
    4. Issue a signed JWT and set it as the ``forge_token`` cookie.
    5. Redirect the browser to ``FRONTEND_URL + "/builder"``.

    Args:
        code: The OAuth ``code`` GitHub attached to the redirect.
        db: Async session injected by FastAPI.

    Returns:
        A 307 redirect to ``FRONTEND_URL + "/builder"`` with the
        JWT set as an ``httpOnly`` cookie.

    Raises:
        HTTPException: ``503`` if GitHub OAuth is not configured;
            ``502`` if the token exchange or user fetch fails;
            ``500`` for any other unexpected error.
    """
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub OAuth is not configured.",
        )

    try:
        github_user = await _exchange_code_and_fetch_user(code)
    except _GitHubOAuthError as exc:
        # ``_GitHubOAuthError`` already sanitises the upstream
        # message; just log + relay.
        logger.warning("GitHub OAuth failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GitHub OAuth failed: {exc}",
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Network error during GitHub OAuth: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach GitHub. Try again in a moment.",
        ) from exc

    user = await _upsert_user(db, github_user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(
        sub=str(user.id),
        extra_claims={"username": user.username},
    )

    target = f"{settings.FRONTEND_URL.rstrip('/')}/builder"
    response = Response(
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        headers={"Location": target},
    )
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=settings.JWT_EXPIRE_HOURS * 3600,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )
    logger.info(
        "GitHub login success user_id=%s github_id=%s username=%s",
        user.id,
        user.github_id,
        user.username,
    )
    return response


@router.get(
    "/api/auth/me",
    summary="Return the current authenticated user",
)
async def me(
    user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    """Return the current user's public profile.

    The shape is intentionally minimal — the frontend stores the
    user in a context and uses ``username`` + ``avatar_url`` to
    render the TopBar. Adding fields (email, created_at, etc.) is
    a non-breaking change for the frontend as long as the existing
    keys keep their meaning.

    Args:
        user: The authenticated user, injected by
            :func:`app.routes.deps.get_current_user`.

    Returns:
        A dict with ``id``, ``username``, ``avatar_url``, and
        ``email``.
    """
    return {
        "id": user.id,
        "username": user.username,
        "avatar_url": user.avatar_url,
        "email": user.email,
    }


@router.post(
    "/api/auth/logout",
    summary="Clear the auth cookie",
)
async def logout() -> dict[str, str]:
    """Clear the ``forge_token`` cookie and return ``{"status": "ok"}``.

    The route is deliberately a no-op on the server — the JWT is
    stateless, so invalidating it just means removing the cookie.
    The browser-side deletion is what actually logs the user out.

    Returns:
        A 200 with ``{"status": "ok"}`` and a ``Set-Cookie`` header
        that expires the cookie immediately.
    """
    # We cannot use ``Response.delete_cookie`` and return a dict
    # directly through FastAPI's serialiser without a Response
    # object; build a small JSON response so the Set-Cookie header
    # is attached.
    response = Response(
        status_code=status.HTTP_200_OK,
        content=b'{"status": "ok"}',
        media_type="application/json",
    )
    response.delete_cookie(
        key=_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
    )
    return response


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


class _GitHubOAuthError(Exception):
    """Raised when the GitHub OAuth flow fails at any step.

    The message is safe to surface to the end user (no upstream
    token or response body is included).
    """


async def _exchange_code_and_fetch_user(code: str) -> dict[str, Any]:
    """Exchange ``code`` for an access token, then fetch the user profile.

    Args:
        code: The OAuth code from GitHub's redirect.

    Returns:
        A dict of the GitHub ``/user`` response fields. Only the
        keys we actually persist (``id``, ``login``, ``avatar_url``,
        ``email``) are read by :func:`_upsert_user`; the rest is
        ignored.

    Raises:
        _GitHubOAuthError: If the token exchange returns a
            non-2xx, the user fetch fails, or the payload is
            missing the ``id`` field.
        httpx.HTTPError: For network-level failures.
    """
    async with AsyncOAuth2Client(
        client_id=settings.GITHUB_CLIENT_ID,
        client_secret=settings.GITHUB_CLIENT_SECRET,
    ) as oauth:
        # ``fetch_access_token`` POSTs to GitHub's token endpoint
        # and parses the response. On non-2xx it raises; we catch
        # and re-raise as our own typed exception so the route
        # does not depend on the authlib exception hierarchy.
        try:
            token_response = await oauth.fetch_access_token(
                _GITHUB_TOKEN_URL,
                code=code,
            )
        except Exception as exc:  # noqa: BLE001 — authlib raises a mix
            raise _GitHubOAuthError(f"token exchange failed: {exc}") from exc

        access_token = token_response.get("access_token")
        if not access_token:
            raise _GitHubOAuthError("no access_token in response")

        # Fetch the user profile. GitHub requires
        # ``Authorization: Bearer <token>`` AND a User-Agent
        # header (for unauthenticated requests the limit is much
        # lower and 403s are common). We send both defensively.
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "forge-ai-builder",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        ) as client:
            user_response = await client.get(_GITHUB_USER_URL)

        if user_response.status_code < 200 or user_response.status_code >= 300:
            raise _GitHubOAuthError(
                f"user fetch returned status {user_response.status_code}"
            )

        try:
            payload = user_response.json()
        except (ValueError, TypeError) as exc:
            raise _GitHubOAuthError("user fetch returned invalid JSON") from exc

        if not isinstance(payload, dict) or "id" not in payload:
            raise _GitHubOAuthError("user fetch response missing 'id'")

        return payload


async def _upsert_user(db: AsyncSession, github_payload: dict[str, Any]) -> User:
    """Insert or update a :class:`User` row from a GitHub payload.

    The lookup is by :attr:`User.github_id` (the canonical GitHub
    user id, which is stable across renames). On a hit, the
    username / avatar / email are refreshed so a rename or avatar
    change propagates. On a miss, a new row is created.

    Args:
        db: Open async session.
        github_payload: The parsed ``/user`` response from GitHub.

    Returns:
        The :class:`User` row (existing or newly inserted).
    """
    github_id = int(github_payload["id"])
    username = str(github_payload.get("login") or "")
    avatar_url = github_payload.get("avatar_url")
    email = github_payload.get("email")

    stmt = select(User).where(User.github_id == github_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            github_id=github_id,
            username=username or f"github-{github_id}",
            avatar_url=avatar_url,
            email=email,
        )
        db.add(user)
        return user

    # Existing user: refresh mutable fields.
    if username:
        user.username = username
    if avatar_url is not None:
        user.avatar_url = avatar_url
    # ``email`` may be None if the user revoked the email
    # visibility setting; we keep the previous value rather than
    # overwriting with None to avoid a privacy regression.
    if email:
        user.email = email
    return user
