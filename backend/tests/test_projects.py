"""Tests for the ``/api/projects`` CRUD endpoints.

Covers the full happy path and the documented error contracts:

* ``POST /api/projects`` — create, returns ``201`` with the
  server-assigned id and timestamps.
* ``GET  /api/projects`` — paginated list (no ``code`` body,
  prompt truncated to 200 chars), ordered by ``created_at``
  descending with ``id`` as a tiebreaker.
* ``GET  /api/projects/{project_id}`` — full single project;
  ``404`` when the id is unknown.
* ``PATCH /api/projects/{project_id}`` — partial update of
  ``title`` / ``code`` / ``model``; bumps ``updated_at``;
  ``404`` when the id is unknown.
* ``DELETE /api/projects/{project_id}`` — ``204`` on success;
  ``404`` when the id is unknown.
* Pydantic-level validation: an ``opencode-go/``-less ``model``
  is rejected with ``422``.

The ``client`` fixture in :file:`conftest.py` already overrides
the ``get_db`` dependency with a per-test in-memory database, so
no test in this file touches the real ``forge.db`` file.
"""
from __future__ import annotations

from typing import Any

from httpx import AsyncClient

# Valid OpenCode Go model id used by the "happy path" tests.
# Matches the pattern enforced by the Pydantic schemas.
_MODEL = "opencode-go/minimax-m3"

# Cap on the list endpoint's ``prompt`` preview, matching
# ``LIST_PROMPT_TRUNCATE`` in ``app.models.schemas``.
_PROMPT_PREVIEW_MAX = 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sample_payload(**overrides: Any) -> dict[str, Any]:
    """Build a valid ``ProjectCreate`` body for tests.

    The defaults describe a small, plausible project. Tests
    override individual fields (``title``, ``code``, ``model``,
    ``prompt``) to exercise edge cases — the helper is the
    single source of truth for "what a valid request looks like"
    so the test bodies stay focused on the behaviour under test.

    Args:
        **overrides: Field overrides merged into the base payload.

    Returns:
        A dict suitable for ``client.post("/api/projects", json=...)``.
    """
    payload: dict[str, Any] = {
        "title": "Sample Project",
        "prompt": "Build a todo list with localStorage persistence.",
        "code": "<html><body>Hello</body></html>",
        "model": _MODEL,
    }
    payload.update(overrides)
    return payload


async def _create_project(
    client: AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """POST a project and return the parsed response body.

    Asserts the request succeeded (``201``); tests that exercise
    error paths call :func:`client.post` directly so they can
    inspect non-2xx status codes.

    Args:
        client: The ASGI test client (from the ``client`` fixture).
        **overrides: Forwarded to :func:`_sample_payload`.

    Returns:
        The parsed JSON body of the ``201`` response.
    """
    response = await client.post("/api/projects", json=_sample_payload(**overrides))
    assert response.status_code == 201, (
        f"Expected 201 from POST /api/projects, got "
        f"{response.status_code}: {response.text}"
    )
    return response.json()


# ---------------------------------------------------------------------------
# Tests — Create
# ---------------------------------------------------------------------------


async def test_create_project(client: AsyncClient) -> None:
    """``POST /api/projects`` returns ``201`` with the created row.

    Asserts:
        * Status code is ``201``
        * Response body carries the same ``title`` / ``prompt`` /
          ``code`` / ``model`` sent in the request
        * Response body has a positive integer ``id``
        * ``created_at`` and ``updated_at`` are populated strings
          (ISO-8601 timestamps)
    """
    body = await _create_project(
        client,
        title="My Todo App",
        prompt="A simple todo list",
        code="<html><body>todo</body></html>",
    )

    assert body["title"] == "My Todo App"
    assert body["prompt"] == "A simple todo list"
    assert body["code"] == "<html><body>todo</body></html>"
    assert body["model"] == _MODEL

    assert isinstance(body["id"], int) and body["id"] > 0, (
        f"Expected positive integer id, got id={body['id']!r}"
    )
    # Timestamps come back as ISO-8601 strings; we don't pin the
    # exact format beyond "non-empty" so the test stays robust
    # against any pydantic/datetime serialisation tweaks.
    assert isinstance(body["created_at"], str) and body["created_at"]
    assert isinstance(body["updated_at"], str) and body["updated_at"]


# ---------------------------------------------------------------------------
# Tests — List
# ---------------------------------------------------------------------------


async def test_list_projects(client: AsyncClient) -> None:
    """``GET /api/projects`` returns all projects, newest first.

    Two projects are created back-to-back. The list endpoint must
    return them with the most recent first. The route sorts by
    ``created_at DESC, id DESC`` so the ordering is deterministic
    even when the two rows share a ``created_at`` second (which
    is the common case for fast CI machines).

    Asserts:
        * Status code is ``200``
        * Response is a list of length 2
        * The first element is the most recently created project
          (matched by ``prompt`` since ``id`` is opaque)
        * List items carry ``id``, ``title``, ``prompt``,
          ``model``, ``created_at`` — but NOT ``code``
    """
    first = await _create_project(
        client, title="First", prompt="first prompt", code="<html>1</html>"
    )
    second = await _create_project(
        client, title="Second", prompt="second prompt", code="<html>2</html>"
    )

    response = await client.get("/api/projects")
    assert response.status_code == 200, (
        f"Expected 200 from GET /api/projects, got "
        f"{response.status_code}: {response.text}"
    )
    items = response.json()
    assert isinstance(items, list), f"Expected JSON list, got {type(items).__name__}"
    assert len(items) == 2, f"Expected 2 items, got {len(items)}: {items!r}"

    # The second insert must come first (newest first).
    assert items[0]["prompt"] == second["prompt"], (
        f"Expected newest project first. Got items[0]={items[0]!r}, "
        f"expected prompt={second['prompt']!r}"
    )
    assert items[1]["prompt"] == first["prompt"], (
        f"Expected oldest project last. Got items[1]={items[1]!r}, "
        f"expected prompt={first['prompt']!r}"
    )

    # List items must NOT carry the (potentially large) code body.
    assert "code" not in items[0], (
        f"List item should not include 'code'. Got: {items[0]!r}"
    )


async def test_list_projects_pagination(client: AsyncClient) -> None:
    """``?limit=`` and ``?offset=`` work as expected.

    Creates 5 projects, then queries with ``limit=2&offset=1``
    and verifies the response is the 2nd and 3rd items (in
    newest-first order). The test also confirms the boundary
    cases: ``offset`` past the end returns an empty list, and
    ``limit=0`` is rejected at the schema layer.

    Asserts:
        * ``limit=2&offset=1`` returns exactly 2 items: projects
          #4 and #3 (in insertion order) — i.e. the 2nd and 3rd
          newest rows.
        * ``offset`` beyond the table size returns an empty list.
        * ``limit=0`` is rejected with ``422`` (the Query has
          ``ge=1``).
    """
    created_prompts: list[str] = []
    for index in range(5):
        project = await _create_project(
            client,
            title=f"Project {index}",
            prompt=f"prompt {index}",
            code=f"<html>{index}</html>",
        )
        created_prompts.append(project["prompt"])

    # limit=2, offset=1 → skip the newest (#4), return #3 and #2
    # in that order (newest first within the window).
    response = await client.get("/api/projects?limit=2&offset=1")
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 2, f"Expected 2 items, got {len(items)}: {items!r}"
    assert items[0]["prompt"] == created_prompts[3], (
        f"Expected items[0] to be the 2nd newest, got prompt={items[0]['prompt']!r}"
    )
    assert items[1]["prompt"] == created_prompts[2], (
        f"Expected items[1] to be the 3rd newest, got prompt={items[1]['prompt']!r}"
    )

    # offset past the end → empty list, not an error.
    response = await client.get("/api/projects?limit=10&offset=100")
    assert response.status_code == 200
    assert response.json() == [], (
        f"Expected empty list past the end, got {response.json()!r}"
    )

    # limit=0 violates the Query(ge=1) constraint and is rejected
    # at the schema layer. This pins the documented contract.
    response = await client.get("/api/projects?limit=0")
    assert response.status_code == 422, (
        f"Expected 422 for limit=0, got {response.status_code}: {response.text}"
    )


# ---------------------------------------------------------------------------
# Tests — Get single
# ---------------------------------------------------------------------------


async def test_get_project(client: AsyncClient) -> None:
    """``GET /api/projects/{id}`` returns the full project body.

    The full project includes the ``code`` field, which the
    list endpoint strips. This is the endpoint the builder
    calls when opening a project from the dashboard.

    Asserts:
        * Status code is ``200``
        * Response body has every field, including ``code``
        * All fields match the values sent in the create call
    """
    created = await _create_project(
        client,
        title="Coffee Shop Landing",
        prompt="A landing page for a coffee shop",
        code="<html><body>☕</body></html>",
    )

    response = await client.get(f"/api/projects/{created['id']}")
    assert response.status_code == 200, (
        f"Expected 200 from GET /api/projects/{created['id']}, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert body["id"] == created["id"]
    assert body["title"] == "Coffee Shop Landing"
    assert body["prompt"] == "A landing page for a coffee shop"
    assert body["code"] == "<html><body>☕</body></html>"
    assert body["model"] == _MODEL
    assert body["created_at"] == created["created_at"]
    assert body["updated_at"] == created["updated_at"]


async def test_get_project_not_found(client: AsyncClient) -> None:
    """``GET /api/projects/999999`` returns ``404``.

    Uses a deliberately large id that is guaranteed not to
    exist in the test database (which starts empty per
    ``db_session``).

    Asserts:
        * Status code is ``404``
        * Response body is a FastAPI error envelope with
          ``detail == "Project not found"``
    """
    response = await client.get("/api/projects/999999")
    assert response.status_code == 404, (
        f"Expected 404 for missing project, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert body.get("detail") == "Project not found", (
        f"Expected detail='Project not found', got body={body!r}"
    )


# ---------------------------------------------------------------------------
# Tests — Update
# ---------------------------------------------------------------------------


async def test_update_project(client: AsyncClient) -> None:
    """``PATCH /api/projects/{id}`` updates only the supplied fields.

    Sends a PATCH with ``title`` and ``code`` only. The
    ``prompt`` and ``model`` fields are left untouched. The
    response must include the updated values, and the original
    fields must round-trip unchanged.

    Asserts:
        * Status code is ``200``
        * Updated ``title`` and ``code`` reflect the new values
        * ``prompt`` and ``model`` are unchanged
        * ``updated_at`` is a string (pydantic v2 serialises
          ``datetime`` to ISO-8601 by default)
    """
    created = await _create_project(
        client,
        title="Original Title",
        prompt="Original prompt",
        code="<html>original</html>",
    )

    patch = {"title": "Renamed Project", "code": "<html>updated</html>"}
    response = await client.patch(
        f"/api/projects/{created['id']}", json=patch
    )
    assert response.status_code == 200, (
        f"Expected 200 from PATCH, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert body["id"] == created["id"]
    assert body["title"] == "Renamed Project", (
        f"Title should be updated. Got body={body!r}"
    )
    assert body["code"] == "<html>updated</html>", (
        f"Code should be updated. Got body={body!r}"
    )
    # Untouched fields are unchanged.
    assert body["prompt"] == "Original prompt", (
        f"Prompt should be unchanged. Got body={body!r}"
    )
    assert body["model"] == _MODEL, f"Model should be unchanged. Got body={body!r}"
    assert isinstance(body["updated_at"], str) and body["updated_at"]


async def test_update_project_not_found(client: AsyncClient) -> None:
    """``PATCH /api/projects/999999`` returns ``404``.

    The 404 must be returned BEFORE any field-level validation
    on the patch body — a missing project is a 404, not a 422.

    Asserts:
        * Status code is ``404`` (not ``422``)
        * ``detail`` is ``"Project not found"``
    """
    response = await client.patch(
        "/api/projects/999999", json={"title": "x"}
    )
    assert response.status_code == 404, (
        f"Expected 404 for missing project, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert body.get("detail") == "Project not found", (
        f"Expected detail='Project not found', got body={body!r}"
    )


# ---------------------------------------------------------------------------
# Tests — Delete
# ---------------------------------------------------------------------------


async def test_delete_project(client: AsyncClient) -> None:
    """``DELETE /api/projects/{id}`` removes the row and returns ``204``.

    The 204 response has no body. A follow-up ``GET`` confirms
    the row is gone (404).

    Asserts:
        * ``DELETE`` returns ``204`` with an empty body
        * ``GET`` for the same id returns ``404`` after delete
    """
    created = await _create_project(client)

    response = await client.delete(f"/api/projects/{created['id']}")
    assert response.status_code == 204, (
        f"Expected 204 from DELETE, got "
        f"{response.status_code}: {response.text}"
    )
    # 204 No Content must carry an empty body.
    assert response.text == "", (
        f"Expected empty body for 204, got {response.text!r}"
    )

    # Follow-up GET confirms the row is gone.
    response = await client.get(f"/api/projects/{created['id']}")
    assert response.status_code == 404, (
        f"Expected 404 after delete, got {response.status_code}: {response.text}"
    )


async def test_delete_project_not_found(client: AsyncClient) -> None:
    """``DELETE /api/projects/999999`` returns ``404``.

    Deletes are NOT idempotent — a second delete on an already-
    removed row is a 404, matching the convention used by
    ``GET`` and ``PATCH``.

    Asserts:
        * Status code is ``404``
        * ``detail`` is ``"Project not found"``
    """
    response = await client.delete("/api/projects/999999")
    assert response.status_code == 404, (
        f"Expected 404 for missing project, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert body.get("detail") == "Project not found", (
        f"Expected detail='Project not found', got body={body!r}"
    )


# ---------------------------------------------------------------------------
# Tests — List view prompt truncation
# ---------------------------------------------------------------------------


async def test_prompt_truncated_in_list(client: AsyncClient) -> None:
    """The list endpoint truncates ``prompt`` to 200 characters.

    A project is created with a prompt of 500 characters. The
    list response's ``prompt`` field must be at most
    :data:`_PROMPT_PREVIEW_MAX` characters long, and must be a
    prefix of the full prompt (the truncation is a plain
    character slice, not a redaction or word-boundary cut).

    Asserts:
        * Status code is ``200``
        * The list returns exactly one item
        * ``item['prompt']`` has length <= 200
        * ``item['prompt']`` equals the first 200 characters of
          the original prompt
    """
    long_prompt = "x" * 500
    await _create_project(client, prompt=long_prompt)

    response = await client.get("/api/projects")
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1, f"Expected 1 item, got {len(items)}: {items!r}"

    item = items[0]
    assert len(item["prompt"]) <= _PROMPT_PREVIEW_MAX, (
        f"List prompt should be truncated to <= {_PROMPT_PREVIEW_MAX} chars, "
        f"got length={len(item['prompt'])}"
    )
    assert item["prompt"] == long_prompt[:_PROMPT_PREVIEW_MAX], (
        f"Truncated prompt should be a prefix of the original. "
        f"Expected first 200 chars, got: {item['prompt']!r}"
    )


# ---------------------------------------------------------------------------
# Tests — Pydantic validation
# ---------------------------------------------------------------------------


async def test_model_validation(client: AsyncClient) -> None:
    """A model id missing the ``opencode-go/`` prefix is rejected with ``422``.

    The Pydantic schema enforces the
    ``^opencode-go/[a-z0-9._-]+$`` pattern on ``ProjectCreate.model``.
    A request with a bare id (``"minimax-m3"``) is rejected at
    the validation layer; the route never executes.

    Asserts:
        * Status code is ``422`` (FastAPI request validation)
        * Response body is a FastAPI error envelope
    """
    response = await client.post(
        "/api/projects",
        json=_sample_payload(model="minimax-m3"),  # no opencode-go/ prefix
    )
    assert response.status_code == 422, (
        f"Expected 422 for invalid model pattern, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert "detail" in body, (
        f"Expected FastAPI validation error envelope, got body={body!r}"
    )
