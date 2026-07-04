"""Tests for the GitHub OAuth + JWT authentication flow.

Covers the four user-facing auth routes plus the JWT helpers in
:mod:`app.routes.deps`:

* ``GET /api/auth/login`` — redirects to GitHub (and refuses to
  redirect if ``GITHUB_CLIENT_ID`` is empty).
* ``GET /api/auth/callback`` — exchanges the OAuth code, upserts
  the user, sets the cookie, and redirects to the builder.
* ``GET /api/auth/me`` — returns the current user, or ``401``
  when unauthenticated.
* ``POST /api/auth/logout`` — clears the cookie.
* JWT helpers — round-trip encode/decode, expired token, invalid
  signature, garbage input.
* Security headers — every response carries the hardening
  headers from :class:`app.middleware.SecurityHeadersMiddleware`.

The OAuth flow is exercised by patching
:func:`app.routes.auth._exchange_code_and_fetch_user` to a stub
that returns a canned GitHub payload — the test suite has no
network access and does not need to talk to the real GitHub.
"""

from __future__ import annotations

import time
from typing import Any
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from jose import jwt

from app.config import settings
from app.routes.deps import (
    _resolve_secret,
    _verify_token,
    create_access_token,
    decode_access_token,
)

# A canned GitHub user payload that ``_upsert_user`` will accept.
# Mirrors the real ``https://api.github.com/user`` shape; the
# fields the auth route reads are ``id``, ``login``, ``avatar_url``,
# and ``email``.
_GITHUB_USER_PAYLOAD: dict[str, Any] = {
    "id": 67890,
    "login": "octocat",
    "avatar_url": "https://avatars.githubusercontent.com/u/67890",
    "email": "octocat@github.com",
}


# ---------------------------------------------------------------------------
# JWT helpers — pure-function unit tests
# ---------------------------------------------------------------------------


def test_jwt_round_trip() -> None:
    """``create_access_token`` / ``decode_access_token`` round-trip.

    Asserts:
        * A token created with a known ``sub`` decodes back to
          the same ``sub`` plus the configured ``iat`` / ``exp``
          claims.
    """
    token = create_access_token(sub="42", extra_claims={"username": "octocat"})
    claims = decode_access_token(token)
    assert claims["sub"] == "42"
    assert claims["username"] == "octocat"
    assert isinstance(claims["iat"], int)
    assert isinstance(claims["exp"], int)
    assert claims["exp"] > claims["iat"]


def test_decode_access_token_rejects_garbage() -> None:
    """Non-JWT strings raise :class:`ValueError`."""
    with pytest.raises(ValueError, match="invalid or expired token"):
        decode_access_token("not-a-jwt")


def test_decode_access_token_rejects_wrong_secret() -> None:
    """A token signed with a different secret fails verification.

    Asserts:
        * :func:`decode_access_token` raises :class:`ValueError`
          when the token's signature does not match the
          configured secret.
    """
    forged = jwt.encode(
        {"sub": "1", "iat": int(time.time()), "exp": int(time.time()) + 60},
        "a-totally-different-secret",
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(ValueError, match="invalid or expired token"):
        decode_access_token(forged)


def test_decode_access_token_rejects_expired() -> None:
    """A token whose ``exp`` is in the past raises :class:`ValueError`."""
    secret = _resolve_secret()
    expired = jwt.encode(
        {
            "sub": "1",
            "iat": int(time.time()) - 7200,
            "exp": int(time.time()) - 3600,
        },
        secret,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(ValueError, match="invalid or expired token"):
        decode_access_token(expired)


def test_verify_token_rejects_non_integer_sub() -> None:
    """A token with a non-numeric ``sub`` raises :class:`ValueError`.

    The check is enforced by :func:`app.routes.deps._verify_token`,
    not by :func:`app.routes.deps.decode_access_token` — the
    former is the *application-level* check that translates the
    JWT into a user id; the latter is the pure JWT verification
    helper that does not know what shape ``sub`` is supposed
    to take.
    """
    secret = _resolve_secret()
    bad_sub = jwt.encode(
        {
            "sub": "not-a-number",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        secret,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(ValueError, match="invalid subject claim"):
        _verify_token(bad_sub)


# ---------------------------------------------------------------------------
# /api/auth/me — current user
# ---------------------------------------------------------------------------


async def test_me_unauthenticated_returns_401(client: AsyncClient) -> None:
    """``GET /api/auth/me`` returns 401 with no cookie.

    Asserts:
        * Status code is ``401``
        * Response body has a ``detail`` field with an
          authentication-related message
    """
    response = await client.get("/api/auth/me")
    assert response.status_code == 401, (
        f"Expected 401 for unauthenticated /me, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert "detail" in body


async def test_me_with_valid_token_returns_user(
    auth_client: AsyncClient, test_user: dict
) -> None:
    """``GET /api/auth/me`` returns the current user's profile.

    Asserts:
        * Status code is ``200``
        * Response body has ``id``, ``username``, ``avatar_url``,
          ``email`` matching the fixture user
    """
    response = await auth_client.get("/api/auth/me")
    assert (
        response.status_code == 200
    ), f"Expected 200, got {response.status_code}: {response.text}"
    body = response.json()
    assert body["id"] == test_user["id"]
    assert body["username"] == test_user["username"]
    assert body["avatar_url"] == "https://avatars.example/test-user"
    assert body["email"] == "test@example.com"


async def test_me_with_expired_token_returns_401(client: AsyncClient) -> None:
    """``GET /api/auth/me`` returns 401 for an expired JWT cookie.

    Asserts:
        * The endpoint rejects a forged-but-valid signature whose
          ``exp`` is in the past.
    """
    secret = _resolve_secret()
    expired = jwt.encode(
        {
            "sub": "1",
            "iat": int(time.time()) - 7200,
            "exp": int(time.time()) - 3600,
        },
        secret,
        algorithm=settings.JWT_ALGORITHM,
    )
    client.cookies.set("forge_token", expired)
    response = await client.get("/api/auth/me")
    assert response.status_code == 401, (
        f"Expected 401 for expired token, got "
        f"{response.status_code}: {response.text}"
    )


async def test_me_with_invalid_signature_returns_401(client: AsyncClient) -> None:
    """``GET /api/auth/me`` returns 401 for a token signed with a wrong key."""
    forged = jwt.encode(
        {"sub": "1", "iat": int(time.time()), "exp": int(time.time()) + 60},
        "wrong-secret",
        algorithm=settings.JWT_ALGORITHM,
    )
    client.cookies.set("forge_token", forged)
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/auth/logout
# ---------------------------------------------------------------------------


async def test_logout_clears_cookie(auth_client: AsyncClient, test_user: dict) -> None:
    """``POST /api/auth/logout`` returns 200 and clears the cookie.

    Asserts:
        * Status code is ``200``
        * Response body is ``{"status": "ok"}``
        * A subsequent ``/api/auth/me`` call returns ``401`` because
          the cookie was cleared by the Set-Cookie response header
    """
    response = await auth_client.post("/api/auth/logout")
    assert (
        response.status_code == 200
    ), f"Expected 200 from logout, got {response.status_code}: {response.text}"
    assert response.json() == {"status": "ok"}

    # The Set-Cookie header should expire the cookie. ``httpx``
    # applies Set-Cookie to the client jar in-band, so a follow-up
    # request would not see the cookie.
    set_cookie = response.headers.get("set-cookie", "")
    assert (
        "forge_token" in set_cookie
    ), f"Expected Set-Cookie to clear forge_token, got {set_cookie!r}"
    assert (
        "Max-Age=0" in set_cookie or "expires=" in set_cookie.lower()
    ), f"Expected cookie to be expired, got Set-Cookie: {set_cookie!r}"


# ---------------------------------------------------------------------------
# GET /api/auth/login — redirect to GitHub
# ---------------------------------------------------------------------------


async def test_login_without_client_id_returns_503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``GET /api/auth/login`` returns 503 when GitHub OAuth is not configured.

    Asserts:
        * The endpoint refuses to start an OAuth flow with an
          empty ``GITHUB_CLIENT_ID``.
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "")
    response = await client.get("/api/auth/login", follow_redirects=False)
    assert (
        response.status_code == 503
    ), f"Expected 503, got {response.status_code}: {response.text}"


async def test_login_redirects_to_github(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``GET /api/auth/login`` issues a 307 to GitHub's authorize URL.

    Asserts:
        * Status code is ``307``
        * ``Location`` header points at
          ``https://github.com/login/oauth/authorize``
        * The redirect URL includes the configured ``client_id``
          and the ``read:user`` scope
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id-12345")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    response = await client.get("/api/auth/login", follow_redirects=False)
    assert (
        response.status_code == 307
    ), f"Expected 307, got {response.status_code}: {response.text}"
    location = response.headers.get("location", "")
    assert (
        "github.com/login/oauth/authorize" in location
    ), f"Expected GitHub authorize URL, got {location!r}"
    assert (
        "client_id=test-client-id-12345" in location
    ), f"Expected client_id in URL, got {location!r}"
    assert (
        "read%3Auser" in location or "read:user" in location
    ), f"Expected read:user scope in URL, got {location!r}"


# ---------------------------------------------------------------------------
# GET /api/auth/callback — full OAuth round-trip (mocked)
# ---------------------------------------------------------------------------


async def test_callback_creates_user_and_sets_cookie(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Successful callback creates a :class:`User` row and sets the cookie.

    Asserts:
        * Status code is ``307``
        * ``Location`` header points at ``<FRONTEND_URL>/builder``
        * ``Set-Cookie`` header includes a non-empty ``forge_token``
        * The :class:`User` row is created in the DB with the
          expected ``github_id`` / ``username``
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    # Patch the network call so the test never reaches GitHub.
    fake_exchange = AsyncMock(return_value=_GITHUB_USER_PAYLOAD)
    monkeypatch.setattr("app.routes.auth._exchange_code_and_fetch_user", fake_exchange)

    response = await client.get(
        "/api/auth/callback",
        params={"code": "fake-oauth-code", "state": "any"},
        follow_redirects=False,
    )
    assert response.status_code == 307, (
        f"Expected 307 from callback, got " f"{response.status_code}: {response.text}"
    )
    location = response.headers.get("location", "")
    assert location.endswith(
        "/builder"
    ), f"Expected redirect to /builder, got {location!r}"

    set_cookie = response.headers.get("set-cookie", "")
    assert (
        "forge_token=" in set_cookie
    ), f"Expected forge_token cookie, got {set_cookie!r}"
    # Pull the JWT out of the Set-Cookie header.
    cookie_value = set_cookie.split("forge_token=", 1)[1].split(";", 1)[0]
    assert cookie_value, "Expected a non-empty JWT in the cookie"

    # The token must verify back to a real user.
    claims = decode_access_token(cookie_value)
    assert claims["username"] == "octocat"
    assert int(claims["sub"]) > 0

    # A follow-up /me with the issued cookie should return the
    # user that was just created.
    client.cookies.set("forge_token", cookie_value)
    me_response = await client.get("/api/auth/me")
    assert me_response.status_code == 200, (
        f"Expected 200 from /me after callback, got "
        f"{me_response.status_code}: {me_response.text}"
    )
    body = me_response.json()
    assert body["username"] == "octocat"
    assert body["email"] == "octocat@github.com"


async def test_callback_upserts_existing_user(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A second login by the same GitHub user updates the existing row.

    Asserts:
        * Two callbacks with the same ``github_id`` create one
          row (not two) and the second login refreshes the
          username / email from the new payload.
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    fake_exchange = AsyncMock(return_value=_GITHUB_USER_PAYLOAD)
    monkeypatch.setattr("app.routes.auth._exchange_code_and_fetch_user", fake_exchange)

    # First login — creates the row.
    response = await client.get(
        "/api/auth/callback",
        params={"code": "code-1", "state": "x"},
        follow_redirects=False,
    )
    assert response.status_code == 307
    first_cookie = (
        response.headers["set-cookie"].split("forge_token=", 1)[1].split(";", 1)[0]
    )
    first_user_id = int(decode_access_token(first_cookie)["sub"])

    # Second login — same GitHub id, but a refreshed username.
    updated_payload = dict(_GITHUB_USER_PAYLOAD)
    updated_payload["login"] = "octocat-renamed"
    updated_payload["email"] = "octocat-renamed@github.com"
    fake_exchange.return_value = updated_payload
    response = await client.get(
        "/api/auth/callback",
        params={"code": "code-2", "state": "y"},
        follow_redirects=False,
    )
    assert response.status_code == 307
    second_cookie = (
        response.headers["set-cookie"].split("forge_token=", 1)[1].split(";", 1)[0]
    )
    second_user_id = int(decode_access_token(second_cookie)["sub"])

    # Same User row, same id.
    assert second_user_id == first_user_id, (
        f"Expected same user id on second login, got "
        f"{first_user_id} vs {second_user_id}"
    )

    client.cookies.set("forge_token", second_cookie)
    me_response = await client.get("/api/auth/me")
    body = me_response.json()
    assert body["username"] == "octocat-renamed"
    assert body["email"] == "octocat-renamed@github.com"


async def test_callback_without_client_id_returns_503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``GET /api/auth/callback`` returns 503 if GitHub is not configured.

    Asserts:
        * Even when the GitHub exchange would succeed, the
          endpoint refuses to issue a token without
          ``GITHUB_CLIENT_ID`` / ``GITHUB_CLIENT_SECRET``.
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "")
    response = await client.get(
        "/api/auth/callback", params={"code": "x", "state": "y"}
    )
    assert response.status_code == 503


async def test_callback_github_exchange_failure_returns_502(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``GET /api/auth/callback`` returns 502 on a failed exchange.

    Asserts:
        * A failure inside ``_exchange_code_and_fetch_user`` is
          surfaced as a 502 (bad gateway) — the front-end
          sees a single status code, not a stack trace.
    """
    from app.routes.auth import _GitHubOAuthError

    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    fake_exchange = AsyncMock(side_effect=_GitHubOAuthError("token exchange failed"))
    monkeypatch.setattr("app.routes.auth._exchange_code_and_fetch_user", fake_exchange)

    response = await client.get(
        "/api/auth/callback", params={"code": "bad", "state": "x"}
    )
    assert response.status_code == 502, (
        f"Expected 502 on GitHub OAuth failure, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert "detail" in body


# ---------------------------------------------------------------------------
# Security headers — applied to every response (Task 4)
# ---------------------------------------------------------------------------


async def test_security_headers_on_unprotected_route(
    client: AsyncClient,
) -> None:
    """The ``/api/health`` response carries the security headers.

    Asserts:
        * ``X-Content-Type-Options: nosniff`` is set
        * ``X-Frame-Options: DENY`` is set
        * ``Referrer-Policy`` matches the documented value
        * ``Content-Security-Policy`` is set and contains
          ``default-src 'self'``
        * ``Strict-Transport-Security`` is NOT set in dev mode
          (it would lock the browser into HTTPS for the local
          origin and break the Vite dev workflow)
    """
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    csp = response.headers.get("content-security-policy", "")
    assert "default-src 'self'" in csp, f"Expected default-src 'self' in CSP: {csp!r}"
    assert (
        "frame-ancestors 'none'" in csp
    ), f"Expected frame-ancestors 'none' in CSP: {csp!r}"
    # HSTS is dev-disabled by default.
    assert "strict-transport-security" not in {
        k.lower() for k in response.headers.keys()
    }


async def test_security_headers_hsts_in_production(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``Strict-Transport-Security`` is set when ``ENVIRONMENT=production``.

    Asserts:
        * Flipping ``ENVIRONMENT`` to ``production`` adds the
          HSTS header with ``includeSubDomains`` and a 1-year
          max-age.
    """
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    response = await client.get("/api/health")
    hsts = response.headers.get("strict-transport-security", "")
    assert "max-age=31536000" in hsts, f"Expected 1-year HSTS, got {hsts!r}"
    assert "includeSubDomains" in hsts
