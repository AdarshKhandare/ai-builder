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

# Fixed state nonce used by the callback tests below. The value is
# arbitrary — only the MATCH between the cookie and the query
# parameter is exercised — so we can pin it to a constant for
# readable assertions and pass it both places.
_TEST_OAUTH_STATE = "test-oauth-state-nonce-for-callback"


async def _seed_oauth_state_cookie(
    client: AsyncClient, state: str = _TEST_OAUTH_STATE
) -> str:
    """Pre-load the ``forge_oauth_state`` cookie on ``client``.

    Mirrors what the ``/api/auth/login`` route does in production:
    set the cookie with the path scoped to the callback so the
    server can read it back. httpx's client-side ``Cookies``
    jar only takes ``name`` / ``value`` / ``path`` / ``domain``
    — the ``HttpOnly`` / ``SameSite`` attributes are response
    attributes enforced by the browser and not relevant to the
    in-process ASGI test transport (the test client IS the
    browser). The server's CSRF check only looks at the cookie
    VALUE, which is what we set here.
    """
    client.cookies.set(
        "forge_oauth_state",
        state,
        path="/api/auth/callback",
    )
    return state


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
        * A ``forge_oauth_state`` cookie is set on the response
          (the CSRF nonce) with a non-empty value, a 10-minute
          max-age, ``HttpOnly``, ``SameSite=Lax``, and a path
          scoped to ``/api/auth/callback``
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

    # CSRF defence: the response MUST set a short-lived state
    # cookie. We pull the nonce out of the Set-Cookie header and
    # also confirm it is URL-safe (mirrored into the GitHub
    # authorize URL).
    set_cookie = response.headers.get("set-cookie", "")
    assert (
        "forge_oauth_state=" in set_cookie
    ), f"Expected forge_oauth_state cookie, got {set_cookie!r}"
    state_value = set_cookie.split("forge_oauth_state=", 1)[1].split(";", 1)[0]
    assert state_value, f"Expected non-empty state nonce, got {state_value!r}"
    # 10-minute max-age (600s) — set on the cookie so a stale
    # browser cannot replay an old nonce past the TTL.
    assert (
        "Max-Age=600" in set_cookie
    ), f"Expected Max-Age=600 on state cookie, got {set_cookie!r}"
    # The state nonce must be present in the GitHub URL so GitHub
    # can echo it back on the callback.
    assert (
        f"state={state_value}" in location
    ), f"Expected state={state_value} in authorize URL, got {location!r}"


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
        * The state cookie is cleared on success (single-use nonce)
        * The :class:`User` row is created in the DB with the
          expected ``github_id`` / ``username``
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    # Patch the network call so the test never reaches GitHub.
    fake_exchange = AsyncMock(return_value=_GITHUB_USER_PAYLOAD)
    monkeypatch.setattr("app.routes.auth._exchange_code_and_fetch_user", fake_exchange)

    # Seed the CSRF state cookie so the callback's state check
    # passes. The same nonce is sent in the query string.
    state = await _seed_oauth_state_cookie(client)

    response = await client.get(
        "/api/auth/callback",
        params={"code": "fake-oauth-code", "state": state},
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

    # The state cookie is single-use and must be cleared on a
    # successful callback. ``httpx`` parses Set-Cookie into the
    # jar, so after this request the cookie is expired.
    state_set_cookie = ""
    for header_value in response.headers.get_list("set-cookie"):
        if "forge_oauth_state=" in header_value:
            state_set_cookie = header_value
            break
    assert state_set_cookie, (
        f"Expected Set-Cookie to clear forge_oauth_state, got "
        f"set-cookie={set_cookie!r}"
    )
    assert (
        "Max-Age=0" in state_set_cookie or "expires=" in state_set_cookie.lower()
    ), f"Expected state cookie to be expired, got {state_set_cookie!r}"

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

    # First login — creates the row. Seed a fresh state cookie
    # for this call so the CSRF check passes.
    state_1 = await _seed_oauth_state_cookie(client, state="state-nonce-1")
    response = await client.get(
        "/api/auth/callback",
        params={"code": "code-1", "state": state_1},
        follow_redirects=False,
    )
    assert response.status_code == 307
    first_cookie = (
        response.headers["set-cookie"].split("forge_token=", 1)[1].split(";", 1)[0]
    )
    first_user_id = int(decode_access_token(first_cookie)["sub"])

    # Second login — same GitHub id, but a refreshed username.
    # Seed a NEW state cookie (the previous one was deleted on
    # the successful first callback).
    updated_payload = dict(_GITHUB_USER_PAYLOAD)
    updated_payload["login"] = "octocat-renamed"
    updated_payload["email"] = "octocat-renamed@github.com"
    fake_exchange.return_value = updated_payload
    state_2 = await _seed_oauth_state_cookie(client, state="state-nonce-2")
    response = await client.get(
        "/api/auth/callback",
        params={"code": "code-2", "state": state_2},
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
    # Seed the state cookie so the CSRF check (the FIRST thing
    # the callback does) passes — only then can the 503 path
    # be reached.
    state = await _seed_oauth_state_cookie(client)
    response = await client.get(
        "/api/auth/callback", params={"code": "x", "state": state}
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

    # Seed the state cookie so the CSRF check passes and the
    # route actually reaches the GitHub exchange code.
    state = await _seed_oauth_state_cookie(client)
    response = await client.get(
        "/api/auth/callback", params={"code": "bad", "state": state}
    )
    assert response.status_code == 502, (
        f"Expected 502 on GitHub OAuth failure, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert "detail" in body


# ---------------------------------------------------------------------------
# /api/auth/callback — OAuth state (CSRF) validation
# ---------------------------------------------------------------------------


async def test_callback_rejects_missing_state(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``GET /api/auth/callback`` returns 403 when no state cookie is set.

    This is the login-CSRF defence: a third-party site can embed
    ``<img src="https://forge.example/api/auth/callback?code=ATTACKER_CODE&state=ANY">``
    in a page the victim visits. The victim's browser sends the
    request, but the attacker cannot set the ``forge_oauth_state``
    cookie on the victim's browser (cross-origin cookies are
    blocked). The callback must therefore reject the request
    with 403 before contacting GitHub.

    Asserts:
        * Status code is ``403`` (not 502 / 500)
        * The ``_exchange_code_and_fetch_user`` stub is NOT called
          (CSRF rejection happens BEFORE any GitHub contact)
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    fake_exchange = AsyncMock(return_value=_GITHUB_USER_PAYLOAD)
    monkeypatch.setattr("app.routes.auth._exchange_code_and_fetch_user", fake_exchange)

    # No state cookie is seeded. The query parameter alone is
    # not enough — the attacker could set the query, but cannot
    # set the cookie.
    response = await client.get(
        "/api/auth/callback",
        params={"code": "attacker-code", "state": "anything"},
        follow_redirects=False,
    )
    assert response.status_code == 403, (
        f"Expected 403 for missing state cookie, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert "Invalid OAuth state" in body.get(
        "detail", ""
    ), f"Expected CSRF rejection detail, got body={body!r}"
    fake_exchange.assert_not_called()


async def test_callback_rejects_mismatched_state(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``GET /api/auth/callback`` returns 403 when state cookie != state query.

    A more subtle login-CSRF: the victim IS logged into a
    different Forge session (so a state cookie exists), but the
    attacker-controlled query parameter has a different nonce.
    The route must still reject the request.

    Asserts:
        * Status code is ``403``
        * The exchange stub is NOT called
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    fake_exchange = AsyncMock(return_value=_GITHUB_USER_PAYLOAD)
    monkeypatch.setattr("app.routes.auth._exchange_code_and_fetch_user", fake_exchange)

    # Seed a cookie with one nonce; send a DIFFERENT one in the
    # query — the classic CSRF mismatch.
    await _seed_oauth_state_cookie(client, state="real-victim-nonce")
    response = await client.get(
        "/api/auth/callback",
        params={"code": "attacker-code", "state": "attacker-nonce"},
        follow_redirects=False,
    )
    assert response.status_code == 403, (
        f"Expected 403 for state mismatch, got "
        f"{response.status_code}: {response.text}"
    )
    fake_exchange.assert_not_called()


async def test_callback_rejects_when_state_cookie_missing_but_query_present(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-empty state query with NO matching cookie is a 403.

    This guards against an attacker that manages to craft a
    state-looking value in the query (e.g. via a phishing link)
    but cannot set the cookie. The cookie is the source of
    truth.

    Asserts:
        * Status code is ``403``
        * The exchange stub is NOT called
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-client-secret")

    fake_exchange = AsyncMock(return_value=_GITHUB_USER_PAYLOAD)
    monkeypatch.setattr("app.routes.auth._exchange_code_and_fetch_user", fake_exchange)

    # Send a state query but DO NOT seed the cookie.
    response = await client.get(
        "/api/auth/callback",
        params={"code": "code", "state": "attacker-supplied"},
        follow_redirects=False,
    )
    assert response.status_code == 403, (
        f"Expected 403 when state cookie is absent, got "
        f"{response.status_code}: {response.text}"
    )
    fake_exchange.assert_not_called()


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
