"""Tests for project ownership enforcement.

The ``/api/projects`` family enforces a strict ownership
contract: every project belongs to the user who created it,
and no other user can see, modify, or delete it. These tests
pin that contract end-to-end by creating two users in the
same in-memory database and exercising the cross-user paths.

Endpoints covered:

* ``GET    /api/projects``              — list filter excludes
  the other user's projects.
* ``GET    /api/projects/{id}``         — returns 404 (not
  403) for projects owned by a different user.
* ``PATCH  /api/projects/{id}``         — returns 404 for
  cross-user patches.
* ``DELETE /api/projects/{id}``         — returns 404 for
  cross-user deletes.

The 404-on-cross-user pattern is intentional — it avoids
leaking the existence of project ids the requester does not
own. See :func:`app.routes.projects._get_owned_project_or_404`
for the rationale.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from app.models.database import User, get_db
from app.routes.deps import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _payload(**overrides: Any) -> dict[str, Any]:
    """Return a valid ``ProjectCreate`` body for ownership tests."""
    body: dict[str, Any] = {
        "title": "Sample",
        "prompt": "p" * 20,
        "code": "<html><body>o</body></html>",
        "model": "opencode-go/minimax-m3",
    }
    body.update(overrides)
    return body


async def _create_user(github_id: int, username: str) -> tuple[User, str]:
    """Create a :class:`User` row and return ``(user, jwt)``.

    The user is created through the same in-memory engine the
    route layer uses (via the ``get_db`` dependency override
    installed by the ``db_session`` fixture). The JWT is
    signed with the configured secret so the cookie round-trips
    through the auth middleware.
    """
    from app.main import app

    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        user = User(github_id=github_id, username=username)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = create_access_token(
            sub=str(user.id), extra_claims={"username": user.username}
        )
        return user, token
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass


# ---------------------------------------------------------------------------
# List filtering
# ---------------------------------------------------------------------------


async def test_list_only_returns_calling_user_projects(
    auth_client: AsyncClient,
    test_user: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``GET /api/projects`` does not return another user's projects.

    Asserts:
        * User A (the ``test_user`` fixture) creates one project
        * User B (created inline) creates one project
        * User A's list response contains only their own project
        * User B's list response contains only their own project

    Note: ``auth_client`` is the same ``AsyncClient`` as the
    ``client`` fixture (see :file:`conftest.py`), so switching
    cookies on it changes who subsequent requests are
    authenticated as. The test saves and restores the original
    ``forge_token`` so user A's later ``GET`` still resolves to
    user A.
    """
    # Bump the quota so we can create one project for each user.
    from app.routes import deps as deps_module
    from app.routes import projects as projects_module

    monkeypatch.setitem(projects_module.DAILY_LIMITS, "project_create", 100)
    monkeypatch.setitem(deps_module.DAILY_LIMITS, "project_create", 100)

    # User A creates a project.
    response = await auth_client.post(
        "/api/projects", json=_payload(title="A's project", prompt="prompt-a")
    )
    assert response.status_code == 201
    a_project = response.json()

    # User B is created and signs in. Save the original cookie
    # so we can restore user A's session later.
    original_token = auth_client.cookies.get("forge_token")
    _user_b, token_b = await _create_user(github_id=22222, username="user-b")
    auth_client.cookies.set("forge_token", token_b)

    # User B creates a project.
    response = await auth_client.post(
        "/api/projects", json=_payload(title="B's project", prompt="prompt-b")
    )
    assert response.status_code == 201
    b_project = response.json()

    # User B's list has only B's project (still on user B's cookie).
    response = await auth_client.get("/api/projects")
    assert response.status_code == 200
    b_items = response.json()
    b_ids = {item["id"] for item in b_items}
    assert b_project["id"] in b_ids
    assert (
        a_project["id"] not in b_ids
    ), f"User B should not see User A's project, got {b_ids!r}"

    # Restore user A's cookie and re-fetch the list.
    assert original_token is not None
    auth_client.cookies.set("forge_token", original_token)

    response = await auth_client.get("/api/projects")
    assert response.status_code == 200
    a_items = response.json()
    a_ids = {item["id"] for item in a_items}
    assert a_project["id"] in a_ids
    assert (
        b_project["id"] not in a_ids
    ), f"User A should not see User B's project, got {a_ids!r}"


# ---------------------------------------------------------------------------
# Single-project endpoints — cross-user requests return 404
# ---------------------------------------------------------------------------


async def test_get_other_users_project_returns_404(
    auth_client: AsyncClient,
    test_user: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``GET /api/projects/{id}`` returns 404 for a project owned by another user.

    The 404 is intentional — see the module docstring for the
    rationale (no leakage of id existence).
    """
    from app.routes import deps as deps_module
    from app.routes import projects as projects_module

    monkeypatch.setitem(projects_module.DAILY_LIMITS, "project_create", 100)
    monkeypatch.setitem(deps_module.DAILY_LIMITS, "project_create", 100)

    # User A creates a project.
    response = await auth_client.post("/api/projects", json=_payload(title="A only"))
    assert response.status_code == 201
    a_project = response.json()

    # Switch to user B's cookie.
    original_token = auth_client.cookies.get("forge_token")
    _user_b, token_b = await _create_user(github_id=33333, username="user-c")
    auth_client.cookies.set("forge_token", token_b)

    response = await auth_client.get(f"/api/projects/{a_project['id']}")
    assert response.status_code == 404, (
        f"Expected 404 for cross-user GET, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert (
        body.get("detail") == "Project not found"
    ), f"Expected 'Project not found' detail, got {body!r}"

    # Restore user A's cookie for any subsequent assertions.
    assert original_token is not None
    auth_client.cookies.set("forge_token", original_token)


async def test_patch_other_users_project_returns_404(
    auth_client: AsyncClient,
    test_user: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``PATCH /api/projects/{id}`` returns 404 for a project owned by another user."""
    from app.routes import deps as deps_module
    from app.routes import projects as projects_module

    monkeypatch.setitem(projects_module.DAILY_LIMITS, "project_create", 100)
    monkeypatch.setitem(deps_module.DAILY_LIMITS, "project_create", 100)

    # User A creates a project.
    response = await auth_client.post("/api/projects", json=_payload(title="A only"))
    assert response.status_code == 201
    a_project = response.json()

    # Switch to user B's cookie.
    original_token = auth_client.cookies.get("forge_token")
    _user_b, token_b = await _create_user(github_id=44444, username="user-d")
    auth_client.cookies.set("forge_token", token_b)

    response = await auth_client.patch(
        f"/api/projects/{a_project['id']}", json={"title": "Hijacked"}
    )
    assert response.status_code == 404, (
        f"Expected 404 for cross-user PATCH, got "
        f"{response.status_code}: {response.text}"
    )

    # Restore user A's cookie and verify the patch did not apply.
    assert original_token is not None
    auth_client.cookies.set("forge_token", original_token)

    response = await auth_client.get(f"/api/projects/{a_project['id']}")
    assert response.status_code == 200
    assert response.json()["title"] == "A only", (
        f"Cross-user PATCH must not modify the project, got "
        f"title={response.json().get('title')!r}"
    )


async def test_delete_other_users_project_returns_404(
    auth_client: AsyncClient,
    test_user: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``DELETE /api/projects/{id}`` returns 404 for a project owned by another user.

    Asserts:
        * The 404 response is returned
        * The project is still readable by its owner after the
          failed delete (i.e. the cross-user attempt did not
          mutate the row)
    """
    from app.routes import deps as deps_module
    from app.routes import projects as projects_module

    monkeypatch.setitem(projects_module.DAILY_LIMITS, "project_create", 100)
    monkeypatch.setitem(deps_module.DAILY_LIMITS, "project_create", 100)

    # User A creates a project.
    response = await auth_client.post("/api/projects", json=_payload(title="A only"))
    assert response.status_code == 201
    a_project = response.json()

    # Switch to user B's cookie.
    original_token = auth_client.cookies.get("forge_token")
    _user_b, token_b = await _create_user(github_id=55555, username="user-e")
    auth_client.cookies.set("forge_token", token_b)

    response = await auth_client.delete(f"/api/projects/{a_project['id']}")
    assert response.status_code == 404, (
        f"Expected 404 for cross-user DELETE, got "
        f"{response.status_code}: {response.text}"
    )

    # Restore user A's cookie and verify the project still exists.
    assert original_token is not None
    auth_client.cookies.set("forge_token", original_token)

    response = await auth_client.get(f"/api/projects/{a_project['id']}")
    assert response.status_code == 200, (
        f"Cross-user DELETE must not have removed the project, "
        f"got status={response.status_code}"
    )
