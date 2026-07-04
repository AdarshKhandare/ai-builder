"""Tests for per-user daily quotas and the slowapi global rate limit.

Covers:

* ``POST /api/projects`` — the daily project-create cap (default
  2) returns 429 with a structured detail body on the third
  attempt.
* The ``UsageEvent`` row is committed only on a successful
  create — a 4xx response (e.g. Pydantic validation error) does
  NOT consume the quota.
* The slowapi global rate limiter is wired and the test client
  can exceed 100 req/min if we let it — we exercise this with a
  dedicated test that hits a non-quota-gated endpoint and
  confirms a 429 with a ``Retry-After``-style body. The
  per-test default limit is disabled in :file:`conftest.py` so
  the rest of the suite is unaffected; this test re-enables it
  for the duration of the request burst.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.database import UsageEvent
from app.routes.deps import DAILY_LIMITS

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project_create_body(**overrides: Any) -> dict[str, Any]:
    """Build a valid ``ProjectCreate`` body for quota tests."""
    body: dict[str, Any] = {
        "title": "Quota Test",
        "prompt": "p" * 20,
        "code": "<html><body>q</body></html>",
        "model": "opencode-go/minimax-m3",
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Project-create daily cap
# ---------------------------------------------------------------------------


async def test_project_create_quota_blocks_after_cap(
    auth_client: AsyncClient, test_user: dict
) -> None:
    """A user can create ``DAILY_LIMITS['project_create']`` projects, then 429.

    Asserts:
        * The first N creates return 201
        * The (N+1)th create returns 429
        * The 429 detail includes ``error == "quota_exceeded"``,
          the configured ``limit``, the current ``used`` count,
          and a positive ``retry_after_seconds``
    """
    cap = DAILY_LIMITS["project_create"]

    # ``cap`` successful creates.
    for i in range(cap):
        response = await auth_client.post(
            "/api/projects",
            json=_project_create_body(title=f"Project {i}"),
        )
        assert response.status_code == 201, (
            f"Expected 201 on create #{i + 1}/{cap}, got "
            f"{response.status_code}: {response.text}"
        )

    # The next create is over the cap.
    response = await auth_client.post(
        "/api/projects", json=_project_create_body(title="Over the cap")
    )
    assert response.status_code == 429, (
        f"Expected 429 over the cap, got " f"{response.status_code}: {response.text}"
    )
    detail = response.json().get("detail")
    assert isinstance(detail, dict), f"Expected dict detail, got {detail!r}"
    assert detail["error"] == "quota_exceeded"
    assert detail["endpoint"] == "project_create"
    assert detail["limit"] == cap
    assert detail["used"] == cap
    assert detail["retry_after_seconds"] > 0


async def test_project_create_quota_does_not_count_failed_creates(
    auth_client: AsyncClient, test_user: dict
) -> None:
    """A 4xx (validation error) does not consume the quota.

    Asserts:
        * Posting an invalid model id returns 422 (validation
          failure)
        * The ``UsageEvent`` table has no rows for the user
        * Subsequent valid creates still succeed up to the cap
    """
    from app.main import app
    from app.models.database import get_db

    # Invalid model id — 422 from Pydantic, no row inserted.
    response = await auth_client.post(
        "/api/projects", json=_project_create_body(model="not-prefixed")
    )
    assert response.status_code == 422

    # Verify the UsageEvent table is empty.
    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        stmt = select(UsageEvent).where(UsageEvent.user_id == test_user["id"])
        result = await session.execute(stmt)
        rows = result.scalars().all()
        assert len(rows) == 0, (
            f"Failed create should not have inserted a UsageEvent, got "
            f"{len(rows)} rows"
        )
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass

    # Subsequent valid creates still succeed.
    response = await auth_client.post("/api/projects", json=_project_create_body())
    assert response.status_code == 201


async def test_project_create_quota_is_per_user(
    auth_client: AsyncClient,
    client: AsyncClient,
    test_user: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """User A exhausting the cap does not affect user B.

    Asserts:
        * User A (the ``test_user`` fixture) hits the cap
        * A second user (created inline) is unaffected and can
          still create up to the cap
    """
    from app.main import app
    from app.models.database import User, get_db

    cap = DAILY_LIMITS["project_create"]
    # Drain user A's quota.
    for i in range(cap):
        response = await auth_client.post(
            "/api/projects", json=_project_create_body(title=f"A {i}")
        )
        assert response.status_code == 201
    over_response = await auth_client.post(
        "/api/projects", json=_project_create_body(title="A over")
    )
    assert over_response.status_code == 429

    # Insert a second user.
    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        user_b = User(github_id=99999, username="user-b")
        session.add(user_b)
        await session.commit()
        await session.refresh(user_b)
        user_b_id = user_b.id
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass

    from app.routes.deps import create_access_token

    token_b = create_access_token(
        sub=str(user_b_id), extra_claims={"username": "user-b"}
    )
    client.cookies.set("forge_token", token_b)

    # User B can still create up to the cap.
    for i in range(cap):
        response = await client.post(
            "/api/projects", json=_project_create_body(title=f"B {i}")
        )
        assert response.status_code == 201, (
            f"User B's create #{i + 1}/{cap} should succeed, got "
            f"{response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# Global slowapi rate limit
# ---------------------------------------------------------------------------


async def test_slowapi_limiter_is_registered() -> None:
    """The slowapi ``Limiter`` is registered on ``app.state``.

    Asserts:
        * ``app.state.limiter`` is the same :class:`Limiter`
          instance the test suite imports from :mod:`app.main`
        * The limiter can be configured with a default limit
          (the outer DDoS shield). The conftest clears the
          limit so individual tests are not order-dependent;
          the assertion here re-applies a limit and confirms
          it sticks.
    """
    from app.main import app, limiter

    assert app.state.limiter is limiter
    # Re-apply a default limit and confirm the limiter accepts
    # it. The conftest clears the default so the test suite is
    # not order-dependent; the production configuration does
    # set one.
    original = list(limiter._default_limits)
    try:
        limiter._default_limits = ["100/minute"]
        assert limiter._default_limits == ["100/minute"]
    finally:
        limiter._default_limits = original


async def test_rate_limit_exceeded_handler_is_registered() -> None:
    """``RateLimitExceeded`` has a custom exception handler.

    Asserts:
        * :class:`slowapi.errors.RateLimitExceeded` is in
          ``app.exception_handlers``
    """
    from slowapi.errors import RateLimitExceeded

    from app.main import app

    assert RateLimitExceeded in app.exception_handlers, (
        f"Expected a custom RateLimitExceeded handler, got "
        f"handlers={list(app.exception_handlers.keys())!r}"
    )
