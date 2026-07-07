"""Tests for lifetime project quotas.

Covers the abuse-prevention business rules:

* ``POST /api/projects`` increments ``user.lifetime_project_count``
  atomically and blocks further creates at the configured
  ``PROJECT_LIMIT`` (default 2).
* ``POST /api/generate`` blocks BEFORE streaming when the lifetime
  cap is reached.
* ``DELETE /api/projects/{id}`` does NOT decrement the counter.
* The counter survives deletes (a user who created 2 projects can
  never create a 3rd, even after deleting both).
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient


def _project_payload(**overrides: Any) -> dict[str, Any]:
    """Return a valid ``ProjectCreate`` body for quota tests."""
    body: dict[str, Any] = {
        "title": "Quota Test",
        "prompt": "p" * 20,
        "code": "<html><body>q</body></html>",
        "model": "opencode-go/minimax-m3",
    }
    body.update(overrides)
    return body


async def test_create_project_increments_lifetime_count(
    auth_client: AsyncClient, test_user: dict
) -> None:
    """Each successful create bumps ``lifetime_project_count`` by one."""
    from app.main import app
    from app.models.database import User, get_db

    for i in range(2):
        response = await auth_client.post(
            "/api/projects", json=_project_payload(title=f"Project {i}")
        )
        assert response.status_code == 201

    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        user = await session.get(User, test_user["id"])
        assert user is not None
        assert user.lifetime_project_count == 2
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass


async def test_create_project_blocks_at_lifetime_cap(
    auth_client: AsyncClient,
) -> None:
    """The (PROJECT_LIMIT+1)th create returns 429 with the lifetime message."""
    from app.config import settings

    cap = settings.PROJECT_LIMIT
    for i in range(cap):
        response = await auth_client.post(
            "/api/projects", json=_project_payload(title=f"Project {i}")
        )
        assert response.status_code == 201

    response = await auth_client.post(
        "/api/projects", json=_project_payload(title="Over the cap")
    )
    assert response.status_code == 429
    detail = response.json().get("detail")
    assert isinstance(detail, str)
    assert "2-project limit" in detail


async def test_delete_project_does_not_decrement_counter(
    auth_client: AsyncClient, test_user: dict
) -> None:
    """Deleting a project leaves ``lifetime_project_count`` unchanged."""
    from app.main import app
    from app.models.database import User, get_db

    response = await auth_client.post(
        "/api/projects", json=_project_payload(title="To Delete")
    )
    assert response.status_code == 201
    project_id = response.json()["id"]

    delete_response = await auth_client.delete(f"/api/projects/{project_id}")
    assert delete_response.status_code == 204

    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        user = await session.get(User, test_user["id"])
        assert user is not None
        assert user.lifetime_project_count == 1
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass


async def test_cannot_create_after_deleting_all_projects(
    auth_client: AsyncClient,
) -> None:
    """A user at the lifetime cap cannot create again after deleting."""
    from app.config import settings

    cap = settings.PROJECT_LIMIT
    created_ids: list[int] = []
    for i in range(cap):
        response = await auth_client.post(
            "/api/projects", json=_project_payload(title=f"Project {i}")
        )
        assert response.status_code == 201
        created_ids.append(response.json()["id"])

    for project_id in created_ids:
        response = await auth_client.delete(f"/api/projects/{project_id}")
        assert response.status_code == 204

    response = await auth_client.post(
        "/api/projects", json=_project_payload(title="Still blocked")
    )
    assert response.status_code == 429
    assert "2-project limit" in response.json().get("detail", "")


async def test_generate_blocks_at_lifetime_cap(
    auth_client: AsyncClient,
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``POST /api/generate`` returns JSON 429 before streaming at the cap."""
    from app.config import settings
    from app.routes import generate as generate_module

    monkeypatch.setattr(
        generate_module, "OpenCodeClient", MagicMock(return_value=mock_client)
    )

    cap = settings.PROJECT_LIMIT
    for i in range(cap):
        response = await auth_client.post(
            "/api/projects", json=_project_payload(title=f"Project {i}")
        )
        assert response.status_code == 201

    response = await auth_client.post("/api/generate", json={"prompt": "another app"})
    assert response.status_code == 429, (
        f"Expected 429 from /api/generate at cap, got "
        f"{response.status_code}: {response.text}"
    )
    detail = response.json().get("detail")
    assert isinstance(detail, str)
    assert "2-project limit" in detail


async def test_concurrent_create_projects_respects_lifetime_cap(
    auth_client: AsyncClient,
    test_user: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Concurrent creates cannot race past the lifetime project cap.

    Five requests are fired concurrently against a fresh user whose
    lifetime cap is 2. Without the atomic ``UPDATE ... WHERE count <
    limit`` guard, all five could read ``count=0``, two would pass the
    daily quota, and the counter could end up at 1. With the atomic
    guard exactly two requests succeed and ``lifetime_project_count``
    ends at 2.
    """
    from app.main import app
    from app.models.database import User, get_db
    from app.routes import deps as deps_module

    # Raise the daily project-create quota so the lifetime cap is the
    # only gate being exercised.
    monkeypatch.setitem(deps_module.DAILY_LIMITS, "project_create", 100)

    async def _create(title: str) -> Any:
        return await auth_client.post(
            "/api/projects", json=_project_payload(title=title)
        )

    responses = await asyncio.gather(*(_create(f"Concurrent {i}") for i in range(5)))

    successes = [r for r in responses if r.status_code == 201]
    blocked = [r for r in responses if r.status_code == 429]

    assert (
        len(successes) == 2
    ), f"Expected exactly 2 successful creates, got {len(successes)}"
    assert len(blocked) == 3, f"Expected exactly 3 blocked creates, got {len(blocked)}"
    for response in blocked:
        assert "2-project limit" in response.json().get("detail", "")

    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        user = await session.get(User, test_user["id"])
        assert user is not None
        assert (
            user.lifetime_project_count == 2
        ), f"Expected lifetime_project_count=2, got {user.lifetime_project_count}"
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass
