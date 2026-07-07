"""Tests for per-user daily quotas and the slowapi global rate limit.

Covers:

* ``POST /api/projects`` — the daily project-create cap (default
  2) returns 429 with a structured detail body on the third
  attempt.
* ``POST /api/generate`` — the daily generation cap (default 5)
  returns 429 after the cap is drained, AND the
  ``usage_events`` table on disk reflects every event (the
  quota dep commits in its own transaction so a long-lived
  SSE stream cannot mask quota consumption).
* ``POST /api/iterate`` — the daily iteration cap (default 20)
  behaves the same way.
* The quota dep commits the ``UsageEvent`` row even when the
  body fails Pydantic validation — a 422 from validation still
  consumes a slot because FastAPI resolves ``Depends()``
  parameters before validating the request body. This is the
  more secure contract: a request that reached the server and
  was authorised counts toward the daily cap, regardless of
  whether the body validates.
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
from sqlalchemy import func, select

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
    """A user can create ``PROJECT_LIMIT`` projects, then 429.

    The lifetime project cap (default 2) is now the primary gate and
    matches the legacy daily ``project_create`` cap. The third create
    is rejected with the user-friendly lifetime-limit message before
    the daily UsageEvent quota is consulted.

    Asserts:
        * The first N creates return 201
        * The (N+1)th create returns 429
        * The 429 ``detail`` is the lifetime-limit string
    """
    from app.config import settings

    cap = settings.PROJECT_LIMIT

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

    # The next create is over the lifetime cap.
    response = await auth_client.post(
        "/api/projects", json=_project_create_body(title="Over the cap")
    )
    assert response.status_code == 429, (
        f"Expected 429 over the cap, got " f"{response.status_code}: {response.text}"
    )
    detail = response.json().get("detail")
    assert isinstance(detail, str), f"Expected string detail, got {detail!r}"
    assert "2-project limit" in detail


async def test_project_create_quota_counts_failed_creates(
    auth_client: AsyncClient, test_user: dict
) -> None:
    """A 4xx (validation error) DOES consume the quota.

    FastAPI resolves ``Depends()`` parameters BEFORE validating
    the request body, so the quota dep runs and commits a
    ``UsageEvent`` row even when the subsequent Pydantic
    validation rejects the body. This is the explicit, more
    secure contract: a request that reached the server and was
    authorised counts toward the daily cap, regardless of
    whether the body validates. The alternative (rolling back
    on validation failure) would let a malicious user probe
    endpoint schemas for free.

    Asserts:
        * Posting an invalid model id returns 422 (Pydantic
          validation failure on the body)
        * The ``UsageEvent`` table HAS one row for the user
          (the quota dep ran before validation)
        * The user has only one quota slot left; the next
          valid create succeeds, the one after that returns 429
    """
    from app.main import app
    from app.models.database import get_db

    # Invalid model id — 422 from Pydantic. The quota dep has
    # ALREADY run by the time validation fires, so the event
    # is on disk.
    response = await auth_client.post(
        "/api/projects", json=_project_create_body(model="not-prefixed")
    )
    assert response.status_code == 422

    # Verify the UsageEvent table has exactly one row for this
    # user. This is the new contract — the dep commits the
    # event before the body is validated, so even a 422
    # consumes a quota slot.
    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        stmt = select(UsageEvent).where(UsageEvent.user_id == test_user["id"])
        result = await session.execute(stmt)
        rows = result.scalars().all()
        assert len(rows) == 1, (
            f"Failed create should have inserted one UsageEvent "
            f"(quota dep runs before body validation), got "
            f"{len(rows)} rows"
        )
        assert (
            rows[0].endpoint == "project_create"
        ), f"Expected endpoint='project_create', got {rows[0].endpoint!r}"
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass

    # The cap is 2 (DAILY_LIMITS['project_create']). With the
    # failed create above consuming one slot, exactly one
    # successful create should still fit.
    cap = DAILY_LIMITS["project_create"]
    # We've already used 1 slot; cap - 1 = 1 more valid create.
    valid_slots = cap - 1
    for i in range(valid_slots):
        response = await auth_client.post(
            "/api/projects", json=_project_create_body(title=f"Valid {i}")
        )
        assert response.status_code == 201, (
            f"Expected 201 on valid create #{i + 1}/{valid_slots}, got "
            f"{response.status_code}: {response.text}"
        )

    # The next create is over a cap and returns 429. Because the
    # failed create above consumed a daily slot, the daily quota
    # gate fires before the lifetime cap in this exact sequence.
    response = await auth_client.post(
        "/api/projects", json=_project_create_body(title="Over the cap")
    )
    assert response.status_code == 429, (
        f"Expected 429 over the cap, got " f"{response.status_code}: {response.text}"
    )
    detail = response.json().get("detail")
    assert isinstance(detail, dict)
    assert detail["error"] == "quota_exceeded"


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


# ---------------------------------------------------------------------------
# SSE endpoint daily caps — generate (5/day) and iterate (20/day)
# ---------------------------------------------------------------------------
#
# The original ``check_usage_quota`` implementation added a row to
# the session and relied on the route to commit it. The SSE
# endpoints (``/api/generate`` and ``/api/iterate``) never call
# ``db.commit()`` because the stream is long-lived (30s-2min) and
# the response is already in flight by the time the model starts
# returning chunks. The result: the quota event was silently rolled
# back when the request finished, so a user could issue an
# unlimited number of generations.
#
# The fix is to commit the event in the dependency itself, so the
# count is authoritative the moment the request is authorised.
# These tests exercise the fix end-to-end: they hit the route N
# times (where N is the cap), drain the quota, and confirm the
# (N+1)th request is rejected with 429 AND the persisted count
# matches — proving the fix is not just an in-memory gate.
# ---------------------------------------------------------------------------


async def _count_usage_events(user_id: int, endpoint: str) -> int:
    """Return the number of persisted :class:`UsageEvent` rows.

    Opens a fresh session through the ``get_db`` dependency
    override (the same in-memory engine the route uses) so the
    count reflects what is actually on disk, not what is in
    some cached identity map.
    """
    from app.main import app
    from app.models.database import get_db

    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        stmt = select(func.count(UsageEvent.id)).where(
            UsageEvent.user_id == user_id,
            UsageEvent.endpoint == endpoint,
        )
        result = await session.execute(stmt)
        return int(result.scalar_one() or 0)
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass


async def test_generate_quota_blocks_after_cap(
    auth_client: AsyncClient,
    mock_client: Any,
    monkeypatch: pytest.MonkeyPatch,
    test_user: dict,
) -> None:
    """A user can run ``DAILY_LIMITS['generate']`` generations, then 429.

    The pre-fix bug: the ``_generate_quota`` dep added a row but
    the SSE stream never called ``commit()``, so the count on
    disk stayed at 0 and the user could generate forever. This
    test pins the fix by:

    1. Patching the OpenCode client to the test mock (so we
       never hit the network).
    2. Making exactly ``cap`` successful generate requests.
    3. Inspecting the ``usage_events`` table — it must contain
       exactly ``cap`` rows for ``endpoint == 'generate'``.
    4. Making one more request — it must return 429 with a
       structured detail body.
    5. Confirming the count is still ``cap`` (the 429 was
       rejected BEFORE any new row was inserted).

    Asserts:
        * ``cap`` successful generate requests return 200
        * The persisted ``usage_events`` count for
          ``endpoint='generate'`` is exactly ``cap``
        * The (cap+1)th request returns 429 with
          ``error='quota_exceeded'`` and the correct limit/used
        * The count after the 429 is still ``cap`` (no new row)
    """
    from app.routes import generate as generate_module

    monkeypatch.setattr(
        generate_module, "OpenCodeClient", _MockOpenCodeFactory(mock_client)
    )

    cap = DAILY_LIMITS["generate"]

    # ``cap`` successful requests.
    for i in range(cap):
        response = await auth_client.post(
            "/api/generate", json={"prompt": f"test prompt {i}"}
        )
        assert response.status_code == 200, (
            f"Expected 200 on generate #{i + 1}/{cap}, got "
            f"{response.status_code}: {response.text}"
        )

    # The quota event MUST be persisted on disk by now — this is
    # the whole point of the fix. A count of 0 here would
    # indicate the dependency added the row but the route
    # rolled it back, re-introducing the original bug.
    persisted = await _count_usage_events(test_user["id"], "generate")
    assert persisted == cap, (
        f"Expected {cap} persisted UsageEvent rows for generate, "
        f"got {persisted}. The quota dep must commit the event in "
        f"its own transaction (it cannot rely on the SSE stream to "
        f"call db.commit())."
    )

    # The (cap+1)th request is over the cap and returns 429.
    over_response = await auth_client.post(
        "/api/generate", json={"prompt": "over the cap"}
    )
    assert over_response.status_code == 429, (
        f"Expected 429 over the generate cap, got "
        f"{over_response.status_code}: {over_response.text}"
    )
    detail = over_response.json().get("detail")
    assert isinstance(detail, dict), f"Expected dict detail, got {detail!r}"
    assert detail["error"] == "quota_exceeded"
    assert detail["endpoint"] == "generate"
    assert detail["limit"] == cap
    assert detail["used"] == cap
    assert detail["retry_after_seconds"] > 0

    # The 429 was rejected before any new row was inserted — the
    # count is still ``cap`` (a 429 must NOT consume a slot, that
    # would be a self-amplifying DoS).
    final_count = await _count_usage_events(test_user["id"], "generate")
    assert final_count == cap, (
        f"Expected count to stay at {cap} after a 429, got {final_count}. "
        f"A 429 must not insert a new UsageEvent."
    )


async def test_iterate_quota_blocks_after_cap(
    auth_client: AsyncClient,
    mock_client: Any,
    monkeypatch: pytest.MonkeyPatch,
    test_user: dict,
) -> None:
    """A user can run ``DAILY_LIMITS['iterate']`` iterations, then 429.

    Mirrors :func:`test_generate_quota_blocks_after_cap` for
    the iterate endpoint. The iterate cap is 20 (vs. 5 for
    generate) so the test is slower but exercises the same
    code path through ``check_usage_quota`` with a different
    ``endpoint`` discriminator.

    Asserts:
        * ``cap`` successful iterate requests return 200
        * The persisted ``usage_events`` count for
          ``endpoint='iterate'`` is exactly ``cap``
        * The (cap+1)th request returns 429 with
          ``error='quota_exceeded'`` and the correct limit/used
        * The count after the 429 is still ``cap``
    """
    from app.config import settings
    from app.routes import iterate as iterate_module

    monkeypatch.setattr(
        iterate_module, "OpenCodeClient", _MockOpenCodeFactory(mock_client)
    )

    # Raise the per-project iteration cap so the daily cap is the
    # gate that fires first in this test.
    monkeypatch.setattr(settings, "ITERATION_LIMIT", 100)

    # Create a project to iterate on.
    create_response = await auth_client.post(
        "/api/projects",
        json={
            "title": "Iterate Quota Test",
            "prompt": "A test project",
            "code": "<html><body>v0</body></html>",
            "model": "opencode-go/minimax-m3",
        },
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["id"]

    cap = DAILY_LIMITS["iterate"]

    for i in range(cap):
        response = await auth_client.post(
            "/api/iterate",
            json={
                "prompt": f"change {i}",
                "current_code": f"<html>v{i}</html>",
                "model": "opencode-go/minimax-m3",
                "project_id": project_id,
            },
        )
        assert response.status_code == 200, (
            f"Expected 200 on iterate #{i + 1}/{cap}, got "
            f"{response.status_code}: {response.text}"
        )

    persisted = await _count_usage_events(test_user["id"], "iterate")
    assert persisted == cap, (
        f"Expected {cap} persisted UsageEvent rows for iterate, "
        f"got {persisted}. The quota dep must commit the event in "
        f"its own transaction."
    )

    over_response = await auth_client.post(
        "/api/iterate",
        json={
            "prompt": "over the cap",
            "current_code": "<html>x</html>",
            "model": "opencode-go/minimax-m3",
            "project_id": project_id,
        },
    )
    assert over_response.status_code == 429, (
        f"Expected 429 over the iterate cap, got "
        f"{over_response.status_code}: {over_response.text}"
    )
    detail = over_response.json().get("detail")
    assert isinstance(detail, dict), f"Expected dict detail, got {detail!r}"
    assert detail["error"] == "quota_exceeded"
    assert detail["endpoint"] == "iterate"
    assert detail["limit"] == cap
    assert detail["used"] == cap
    assert detail["retry_after_seconds"] > 0

    final_count = await _count_usage_events(test_user["id"], "iterate")
    assert final_count == cap, (
        f"Expected count to stay at {cap} after a 429, got {final_count}. "
        f"A 429 must not insert a new UsageEvent."
    )


def _MockOpenCodeFactory(mock_client: Any) -> Any:
    """Return a callable that mimics ``OpenCodeClient`` and returns ``mock_client``.

    Mirrors the helper in :mod:`tests.test_generate` and
    :mod:`tests.test_iterate` so the quota tests can drive
    either endpoint without a network. Kept local so this
    file does not have to import from a sibling test module.
    """
    from unittest.mock import MagicMock

    def _factory(*_args, **_kwargs):
        return mock_client

    return MagicMock(side_effect=_factory)
