"""CRUD routes for the ``/api/projects`` resource.

Exposes the "history of works" feature: the frontend saves every
generated app as a :class:`~app.models.database.Project` row, lists
them on the dashboard, opens one in the builder to continue
iterating, and deletes the ones the user no longer wants.

Endpoints
---------

* ``GET    /api/projects``              — paginated list (no
  ``code`` body, prompts truncated).
* ``GET    /api/projects/{project_id}`` — full single project.
* ``POST   /api/projects``              — create a new project.
* ``PATCH  /api/projects/{project_id}`` — partial update of
  ``title`` / ``code`` / ``model``.
* ``DELETE /api/projects/{project_id}`` — delete; ``204`` on
  success, ``404`` if the id is unknown.

All handlers are ``async def`` and obtain a session via
``Depends(get_db)``. The session is closed by the dependency
itself; handlers MUST ``commit()`` their own writes.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Project, get_db
from app.models.schemas import (
    LIST_PROMPT_TRUNCATE,
    ProjectCreate,
    ProjectListItem,
    ProjectResponse,
    ProjectUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Default and hard upper bound for the list endpoint's ``limit``
# query param. The default matches a typical "first page" of the
# user's history; the cap prevents an accidental ``?limit=1000000``
# from dragging the entire table over the wire.
_DEFAULT_LIMIT: int = 50
_MAX_LIMIT: int = 200


def _truncate_prompt(prompt: str, max_length: int = LIST_PROMPT_TRUNCATE) -> str:
    """Return ``prompt`` trimmed to at most ``max_length`` characters.

    The list endpoint surfaces only the first
    :data:`LIST_PROMPT_TRUNCATE` characters of the prompt so that a
    long request does not blow up the dashboard payload. The full
    prompt is still available via ``GET /api/projects/{id}``.

    The cut is naive (no word-boundary awareness) — the dashboard
    uses the value as a tooltip / preview, not as canonical text,
    so a mid-word break is fine and keeps the logic O(1).

    Args:
        prompt: Full prompt text from the DB.
        max_length: Maximum number of characters to return.
            Defaults to :data:`LIST_PROMPT_TRUNCATE` (200).

    Returns:
        ``prompt`` if it is at most ``max_length`` characters,
        otherwise the first ``max_length`` characters.
    """
    if len(prompt) <= max_length:
        return prompt
    return prompt[:max_length]


async def _get_or_404(db: AsyncSession, project_id: int) -> Project:
    """Fetch a project by id or raise ``404``.

    Centralises the not-found error message so every endpoint
    returns the same string. ``AsyncSession.get`` is the
    primary-key lookup shortcut — it is a coroutine in
    SQLAlchemy's async API, so it must be ``await``ed. ``get``
    short-circuits to ``None`` if the row is missing, avoiding
    a full ``SELECT`` round-trip on the not-found case.

    Args:
        db: Open async session.
        project_id: Primary key to look up.

    Returns:
        The :class:`Project` row matching ``project_id``.

    Raises:
        HTTPException: ``404`` with detail ``"Project not found"``
            if no row matches.
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return project


@router.get(
    "/api/projects",
    response_model=list[ProjectListItem],
    summary="List projects (paginated)",
)
async def list_projects(
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = _DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ProjectListItem]:
    """Return the most recent projects, newest first.

    The response is a flat list of
    :class:`~app.models.schemas.ProjectListItem` — no
    ``code`` body, prompts truncated to
    :data:`~app.models.schemas.LIST_PROMPT_TRUNCATE` characters.
    The frontend uses this endpoint to render the dashboard
    "history" panel; the full project is loaded on demand via
    :func:`get_project`.

    Args:
        db: Async session injected by FastAPI.
        limit: Maximum number of rows to return. Bounded between
            1 and :data:`_MAX_LIMIT`; defaults to
            :data:`_DEFAULT_LIMIT`.
        offset: Number of rows to skip from the start of the
            result set. Defaults to ``0``.

    Returns:
        A list of :class:`ProjectListItem` ordered by
        ``created_at`` descending. Empty list if the table is
        empty.
    """
    stmt = (
        select(Project)
        .order_by(Project.created_at.desc(), Project.id.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    projects = result.scalars().all()

    items: list[ProjectListItem] = []
    for project in projects:
        # Pydantic v2's ``from_attributes`` reads fields off the
        # ORM instance; truncating the prompt requires going
        # through ``model_validate`` with an explicit dict so the
        # list view's prompt cap is applied in one place.
        items.append(
            ProjectListItem.model_validate(
                {
                    "id": project.id,
                    "title": project.title,
                    "prompt": _truncate_prompt(project.prompt),
                    "model": project.model,
                    "created_at": project.created_at,
                }
            )
        )
    return items


@router.get(
    "/api/projects/{project_id}",
    response_model=ProjectResponse,
    summary="Get a single project",
)
async def get_project(
    project_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProjectResponse:
    """Return the full :class:`Project` row for ``project_id``.

    This is the endpoint the builder calls when the user opens a
    project from the dashboard — it returns the full ``code``
    body that :func:`list_projects` omits.

    Args:
        project_id: Primary key from the URL path.
        db: Async session injected by FastAPI.

    Returns:
        The :class:`ProjectResponse` for the matching project.

    Raises:
        HTTPException: ``404`` if no row has the given id.
    """
    project = await _get_or_404(db, project_id)
    return ProjectResponse.model_validate(project)


@router.post(
    "/api/projects",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new project",
)
async def create_project(
    payload: ProjectCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProjectResponse:
    """Persist a new :class:`Project` row.

    Called by the frontend after a successful
    ``POST /api/generate`` stream. The route returns the
    freshly-created row so the frontend can navigate to the new
    ``id`` without an extra round-trip.

    The ``title`` default of ``"Untitled"`` is applied at the
    column level (``mapped_column(default="Untitled")``); the
    schema's default of the same name is a safety net for
    clients that omit the field entirely.

    Args:
        payload: Validated :class:`ProjectCreate` body. Pydantic
            v2 has already enforced the size and pattern
            constraints (see :class:`ProjectCreate`).
        db: Async session injected by FastAPI.

    Returns:
        The :class:`ProjectResponse` for the new row, including
        the server-assigned ``id`` and ``created_at``.
    """
    project = Project(
        title=payload.title,
        prompt=payload.prompt,
        code=payload.code,
        model=payload.model,
    )
    db.add(project)
    await db.commit()
    # ``refresh`` populates server-defaults (id, created_at,
    # updated_at) on the in-memory instance. Without it the
    # Pydantic serialiser below would emit ``None`` for those
    # fields.
    await db.refresh(project)
    logger.info("Created project id=%s title=%r", project.id, project.title)
    return ProjectResponse.model_validate(project)


@router.patch(
    "/api/projects/{project_id}",
    response_model=ProjectResponse,
    summary="Partially update a project",
)
async def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProjectResponse:
    """Apply a partial update to ``project_id``.

    Only fields explicitly set on ``payload`` are written; an
    empty body is a no-op (returns the current row). The
    :attr:`~app.models.database.Project.updated_at` column is
    bumped automatically by the ORM's ``onupdate`` hook whenever
    any field is actually changed.

    The frontend uses this endpoint to:

    * Rename a project from the dashboard (``title`` only).
    * Save an in-progress edit from the builder (``code`` only).
    * Record a model switch on an existing project (``model``
      only).

    Args:
        project_id: Primary key from the URL path.
        payload: Validated :class:`ProjectUpdate` body. All
            fields are optional; ``None`` means "do not change".
        db: Async session injected by FastAPI.

    Returns:
        The :class:`ProjectResponse` for the updated row,
        including the bumped ``updated_at``.

    Raises:
        HTTPException: ``404`` if no row has the given id.
    """
    project = await _get_or_404(db, project_id)

    # Pydantic v2's ``model_fields_set`` reports the fields the
    # caller actually sent (distinguishing "absent" from "null").
    # This is the right way to honour the PATCH contract — we
    # never overwrite a field the client did not mention.
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(project, field, value)

    if updates:
        # ``commit`` flushes the changes; the ``onupdate`` hook
        # bumps ``updated_at``. ``refresh`` then re-reads the row
        # so the returned DTO carries the new timestamp.
        await db.commit()
        await db.refresh(project)
        logger.info(
            "Updated project id=%s fields=%s", project_id, sorted(updates.keys())
        )
    else:
        # No-op PATCH: avoid an unnecessary round-trip to SQLite.
        # Return the row as-is.
        logger.debug("No-op PATCH on project id=%s", project_id)

    return ProjectResponse.model_validate(project)


@router.delete(
    "/api/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,  # 204 must not have a response body
    summary="Delete a project",
)
async def delete_project(
    project_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Remove ``project_id`` from the table.

    Returns ``204 No Content`` on success. Idempotency is
    **not** assumed — a missing row yields ``404`` (matches the
    convention used by ``GET`` and ``PATCH``).

    Args:
        project_id: Primary key from the URL path.
        db: Async session injected by FastAPI.

    Raises:
        HTTPException: ``404`` if no row has the given id.
    """
    project = await _get_or_404(db, project_id)
    await db.delete(project)
    await db.commit()
    logger.info("Deleted project id=%s", project_id)
    # No return body — FastAPI serialises ``None`` to an empty
    # 204 response.
