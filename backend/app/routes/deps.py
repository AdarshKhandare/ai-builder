"""Shared route dependencies: auth + quota checks.

This module centralises the FastAPI ``Depends`` callables used to:

* Resolve the current :class:`~app.models.database.User` from a
  signed JWT cookie (:func:`get_current_user`,
  :func:`get_optional_user`).
* Enforce per-user daily quotas on quota-gated endpoints
  (:func:`check_usage_quota`).

The quota check is a *side-effectful* dependency: it inserts a
:class:`~app.models.database.UsageEvent` row on success and
**commits immediately** so the count is persisted before the route
handler starts running. This is critical for the SSE streaming
endpoints (``/api/generate`` and ``/api/iterate``): their response
is a long-lived stream (30s-2min) and we cannot afford to wait for
the route to finish before the quota is recorded — the user must
NOT be able to issue more requests than the cap within the same
window just because the previous stream is still in flight. The
:func:`get_db` dependency's ``async with`` block keeps the session
open and usable for reads after the commit
(``expire_on_commit=False`` is set on the sessionmaker).

Why this lives in ``app/routes/`` and not ``app/services/``
----------------------------------------------------------------
The dependencies are *route-level* plumbing — they are imported by
``app.routes.auth``, ``app.routes.generate``, ``app.routes.iterate``,
and ``app.routes.projects`` — so keeping them in the ``routes``
package avoids a circular import between ``services/`` (which
imports ``models/``) and ``routes/`` (which imports both).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.database import UsageEvent, User, get_db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

# Name of the cookie that carries the JWT. Pinned as a module constant
# so :mod:`app.routes.auth` writes the same key on login and
# :mod:`app.routes.deps` reads it on every protected request. Changing
# this name is a breaking change for any logged-in browser (the old
# cookie would be silently ignored).
_COOKIE_NAME = "forge_token"

# Minimum length for ``settings.JWT_SECRET`` in production. A 32-
# character HS256 key is 256 bits of entropy — the smallest value
# considered safe against offline brute force (NIST SP 800-117).
_MIN_SECRET_LENGTH = 32

# A stable, *test-only* fallback secret. Only used when
# ``settings.JWT_SECRET`` is empty AND the call site is not flagged
# as a production environment. The constant is intentionally not
# random — tests need a stable secret to encode and verify tokens
# within a single process.
_DEV_FALLBACK_SECRET = "forge-dev-fallback-secret-do-not-use-in-prod-xxx"


def _resolve_secret() -> str:
    """Return the active JWT secret, enforcing a production sanity check.

    Returns:
        The configured :attr:`app.config.Settings.JWT_SECRET`.

    Raises:
        RuntimeError: If the secret is shorter than
            :data:`_MIN_SECRET_LENGTH` and the environment is
            production. This refuses to start rather than silently
            issuing tokens with a weak key.
    """
    secret = settings.JWT_SECRET.strip()
    if secret:
        if settings.ENVIRONMENT == "production" and len(secret) < _MIN_SECRET_LENGTH:
            raise RuntimeError(
                f"JWT_SECRET is too short for production "
                f"({len(secret)} < {_MIN_SECRET_LENGTH}). Generate one "
                f"with: python -c 'import secrets; "
                f"print(secrets.token_urlsafe(64))'"
            )
        return secret
    # Empty secret — fall back to a dev constant so the test suite
    # (and a developer who forgot to set the env var) still works.
    if settings.ENVIRONMENT == "production":
        raise RuntimeError("JWT_SECRET is empty in production. Refusing to start.")
    logger.warning(
        "JWT_SECRET is empty; using a development-only fallback. "
        "Set JWT_SECRET in your .env for any non-local deployment."
    )
    return _DEV_FALLBACK_SECRET


def create_access_token(*, sub: str, extra_claims: dict[str, Any] | None = None) -> str:
    """Issue a signed JWT for the given subject.

    The token is signed with :func:`_resolve_secret` and the
    algorithm from :attr:`Settings.JWT_ALGORITHM` (default
    ``HS256``). Expiration is :attr:`Settings.JWT_EXPIRE_HOURS`
    from now (UTC).

    Args:
        sub: The JWT ``sub`` (subject) claim. For Forge this is the
            user's :class:`~app.models.database.User.id` as a string.
        extra_claims: Optional extra JWT claims to embed (e.g.
            ``{"username": "octocat"}``). They are merged into the
            base payload and must be JSON-serialisable.

    Returns:
        A signed, URL-safe JWT string.
    """
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.JWT_EXPIRE_HOURS)).timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, _resolve_secret(), algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Verify a JWT and return its claims.

    Args:
        token: The encoded JWT string.

    Returns:
        The decoded claims dict (always includes ``sub``, ``iat``,
        ``exp``).

    Raises:
        ValueError: If the token is invalid, expired, or signed
            with a different secret. The message is intentionally
            generic to avoid leaking which check failed.
    """
    try:
        return jwt.decode(
            token,
            _resolve_secret(),
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as exc:
        # Normalise every jose error to a single ``ValueError`` so
        # the route can return one consistent 401 message.
        raise ValueError("invalid or expired token") from exc


# ---------------------------------------------------------------------------
# FastAPI dependencies — current user
# ---------------------------------------------------------------------------


def _extract_token(request: Request) -> str | None:
    """Read the JWT from the request cookie, if present.

    Args:
        request: The active FastAPI request.

    Returns:
        The raw JWT string, or ``None`` if the cookie is missing
        or empty. The token is not verified here — see
        :func:`_verify_token`.
    """
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        return None
    return token


def _verify_token(token: str) -> int:
    """Decode ``token`` and return the user id from its ``sub`` claim.

    Args:
        token: The encoded JWT.

    Returns:
        The user id parsed from ``sub`` (always a positive ``int``).

    Raises:
        ValueError: If the token is invalid or its ``sub`` claim is
            not a parseable positive integer.
    """
    claims = decode_access_token(token)
    sub = claims.get("sub")
    # ``sub`` is a string in our scheme (``create_access_token``
    # uses ``str(user.id)``); only digits are accepted so the
    # parsed int is a primary key.
    if not isinstance(sub, str) or not sub.isdigit():
        raise ValueError("invalid subject claim")
    user_id = int(sub)
    if user_id <= 0:
        raise ValueError("invalid subject claim")
    return user_id


async def _load_user(db: AsyncSession, user_id: int) -> User | None:
    """Fetch a user row by id, returning ``None`` if missing.

    Args:
        db: Open async session.
        user_id: Primary key to look up.

    Returns:
        The :class:`User` row, or ``None`` if no such user exists
        (e.g. the JWT references a user that has been deleted).
    """
    return await db.get(User, user_id)


async def get_optional_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User | None:
    """Return the current user if a valid JWT cookie is present.

    Used by endpoints that work for both authenticated and anonymous
    callers (e.g. the landing page can show different UI based on
    ``/api/auth/me`` without forcing a 401 on a logged-out visitor).
    Never raises — a missing or invalid token simply yields
    ``None``.

    Args:
        request: The active FastAPI request (cookie source).
        db: Async session injected by FastAPI.

    Returns:
        The :class:`User` row for the current request, or ``None``
        if no valid JWT cookie is present.
    """
    token = _extract_token(request)
    if token is None:
        return None
    try:
        user_id = _verify_token(token)
    except ValueError:
        return None
    return await _load_user(db, user_id)


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Return the current authenticated user or raise ``401``.

    This is the dependency that protects ``/api/generate``,
    ``/api/iterate``, and ``/api/projects``. A request without a
    valid ``forge_token`` cookie is rejected with HTTP 401 — the
    frontend should bounce the user to the GitHub OAuth flow in
    response.

    The 401 response carries a ``detail`` field so the frontend can
    distinguish a missing cookie (redirect to /login) from an
    expired one (re-auth).

    Args:
        request: The active FastAPI request (cookie source).
        db: Async session injected by FastAPI.

    Returns:
        The :class:`User` row for the current request.

    Raises:
        HTTPException: ``401`` if the cookie is missing, the token
            is invalid or expired, or the referenced user no
            longer exists.
    """
    token = _extract_token(request)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user_id = _verify_token(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    user = await _load_user(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        ) from None
    return user


# ---------------------------------------------------------------------------
# Per-endpoint daily quota (Task 3)
# ---------------------------------------------------------------------------

# Per-endpoint daily caps. The keys are the canonical
# ``UsageEvent.endpoint`` values used by :mod:`app.routes.generate`,
# :mod:`app.routes.iterate`, and :mod:`app.routes.projects`. The
# numeric values are the maximum events permitted for a single user
# in a 24-hour UTC window. These match the documented operational
# caps (5 generations / 20 iterations / 2 project creates per user
# per day) so the backend cannot accidentally allow more than the
# product spec permits.
DAILY_LIMITS: dict[str, int] = {
    "generate": 5,
    "iterate": 20,
    "project_create": 2,
}

# Error message used when a user has reached the lifetime project
# creation cap. Shared by ``/api/generate`` (blocks new generations)
# and ``POST /api/projects`` (defense-in-depth on explicit create).
_PROJECT_LIMIT_REACHED_DETAIL = (
    "You've reached the 2-project limit for your account. "
    "You can still iterate on your existing projects, but you cannot create new ones."
)


def _start_of_today_utc() -> datetime:
    """Return midnight (00:00:00) of today in UTC, as a naive datetime.

    The :class:`UsageEvent.created_at` column is stored by SQLite's
    ``CURRENT_TIMESTAMP`` which yields a UTC string without a
    timezone marker. Comparing with a naive UTC midnight is the
    simplest portable check across SQLite / Postgres.
    """
    now_utc = datetime.now(timezone.utc)
    return now_utc.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)


async def check_lifetime_project_limit(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Block project-generating endpoints when the lifetime cap is reached.

    The primary abuse-prevention rule is 2 projects per user for the
    lifetime of the account. This dependency runs **before** the daily
    UsageEvent quota check so that a capped user does not consume a
    daily slot just to be told they cannot create projects.

    Args:
        user: The current authenticated user.

    Returns:
        The same :class:`User` row when the cap has not been reached.

    Raises:
        HTTPException: ``429`` with a user-friendly ``detail`` when
            ``user.lifetime_project_count >= settings.PROJECT_LIMIT``.
    """
    if user.lifetime_project_count >= settings.PROJECT_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_PROJECT_LIMIT_REACHED_DETAIL,
        )
    return user


async def check_usage_quota(
    endpoint: str,
    daily_limit: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> tuple[User, AsyncSession]:
    """Enforce a per-user daily cap and record the event on success.

    Counts :class:`UsageEvent` rows for ``user`` on ``endpoint``
    with ``created_at >= start_of_today_utc``. If the count is
    already at or above ``daily_limit`` the request is rejected
    with HTTP 429. Otherwise a new row is inserted, **committed
    in its own transaction**, and the request continues.

    Why we commit here (not in the route)
    -------------------------------------
    The two quota-gated SSE endpoints (``/api/generate`` and
    ``/api/iterate``) are long-lived streams (30s-2min). If the
    quota event were committed only when the route returns, a
    user could open N parallel requests, drain the cap, and the
    actual count on disk would lag behind for the entire duration
    of the streams. By committing the event in the dependency
    we make the count authoritative the moment the request is
    authorised — the next request that arrives sees an up-to-date
    count and is correctly rejected.

    The route handlers still receive ``(user, db)`` so they can
    append additional writes (e.g. a new :class:`Project` row) to
    the same session. Those writes commit in their own
    transaction at the end of the route; the quota event has
    already been persisted by the time they start, so a route
    failure does NOT roll the quota back. The session is
    ``expire_on_commit=False`` so attribute access on committed
    instances works without a refresh.

    Args:
        endpoint: Logical endpoint key (must be a key of
            :data:`DAILY_LIMITS`).
        daily_limit: Maximum events for the user in the current
            UTC day. Usually the value from :data:`DAILY_LIMITS`,
            but exposed as a parameter so tests can inject a
            custom cap.
        user: The current authenticated user (from
            :func:`get_current_user`).
        db: Async session injected by FastAPI.

    Returns:
        The ``(user, db)`` tuple — passed through to the route
        unchanged so the route can keep using the same session
        (for reads and for additional writes).

    Raises:
        HTTPException: ``429`` with a structured detail payload
            (current usage, limit, retry-after) when the cap is
            already reached.
    """
    start_of_today = _start_of_today_utc()

    count_stmt = select(func.count(UsageEvent.id)).where(
        UsageEvent.user_id == user.id,
        UsageEvent.endpoint == endpoint,
        UsageEvent.created_at >= start_of_today,
    )
    count_result = await db.execute(count_stmt)
    current_count = int(count_result.scalar_one() or 0)

    if current_count >= daily_limit:
        # Retry-after is fixed at the number of seconds until UTC
        # midnight — coarse but correct, and avoids storing per-
        # user state in the limiter.
        now_utc = datetime.now(timezone.utc)
        next_midnight = now_utc.replace(
            hour=23, minute=59, second=59, microsecond=0
        ) + timedelta(seconds=1)
        retry_after = max(int((next_midnight - now_utc).total_seconds()), 1)
        logger.info(
            "Quota exceeded endpoint=%s user_id=%s count=%s limit=%s",
            endpoint,
            user.id,
            current_count,
            daily_limit,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "quota_exceeded",
                "endpoint": endpoint,
                "limit": daily_limit,
                "used": current_count,
                "retry_after_seconds": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )

    # Append AND commit the new event. The commit is essential:
    # we need the count on disk to be authoritative the moment
    # the request is authorised, so a parallel request that
    # arrives a millisecond later sees the updated count and
    # is correctly rejected. The route may still use ``db`` to
    # append additional writes; those commit in their own
    # transaction when the route returns.
    db.add(UsageEvent(user_id=user.id, endpoint=endpoint))
    await db.commit()
    return user, db
