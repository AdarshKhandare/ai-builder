"""Pydantic v2 request/response models for the projects API.

These schemas are the public wire format. The ORM class
(:class:`app.models.database.Project`) is internal — a future
schema change (rename, split, add column) should be absorbed here
first, with the ORM following once the frontend has shipped.

Response models use :class:`ConfigDict(from_attributes=True)` so
that an ORM instance can be passed directly to
``Model.model_validate(instance)`` (Pydantic v2's replacement for
the v1 ``orm_mode`` flag).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.config import settings

# Maximum number of characters surfaced in the list view's
# ``prompt`` field. Implemented in the route (not the schema) so
# the database column is still the full prompt and a
# ``GET /api/projects/{id}`` can return it in full.
LIST_PROMPT_TRUNCATE: int = 200

# Pattern for OpenCode Go model ids accepted by the API. The
# prefix ``opencode-go/`` is mandatory; the suffix is the bare
# model id used by the gateway. Mirrors the regex on
# ``GenerateRequest.model`` in :mod:`app.routes.generate`.
_MODEL_ID_PATTERN = r"^opencode-go/[a-z0-9._-]+$"


class ProjectCreate(BaseModel):
    """Request body for ``POST /api/projects``.

    Attributes:
        title: Human-readable project name. Capped at 200 chars
            to match the ``String(200)`` column on
            :class:`~app.models.database.Project`. Empty strings
            are accepted — the ORM default of ``"Untitled"`` only
            applies when the column is omitted entirely, not when
            the caller explicitly sends ``""``.
        prompt: The user's original natural-language prompt.
            Required, between 1 and 10 000 characters. The upper
            bound matches :class:`GenerateRequest.prompt` so a
            prompt that the generator accepted can also be
            persisted.
        code: The generated HTML/CSS/JS body. Required, at least
            one character, capped at 1 000 000 (1 MB). The DB
            column is ``TEXT`` and accepts the full body produced
            by the coder (typically tens of KB). The 1 MB cap is
            a defence against a malicious client sending a
            multi-gigabyte JSON body and exhausting server RAM
            during Pydantic validation — see
            :class:`ProjectUpdate.code` for the matching
            constraint on PATCH.
        model: OpenCode Go model id that produced ``code``. The
            pattern matches the values exposed by
            :data:`app.routes.health.AVAILABLE_MODELS`.
    """

    title: str = Field(
        default="Untitled",
        max_length=200,
        description="Human-readable project name (max 200 chars).",
    )
    prompt: str = Field(
        min_length=1,
        max_length=10000,
        description="User's original natural-language prompt.",
    )
    code: str = Field(
        min_length=1,
        max_length=1_000_000,
        description=(
            "Generated HTML/CSS/JS body. Capped at 1 MB to "
            "prevent oversized payloads from exhausting server "
            "memory."
        ),
    )
    model: str = Field(
        pattern=_MODEL_ID_PATTERN,
        description="OpenCode Go model id that produced ``code``.",
    )


class ProjectUpdate(BaseModel):
    """Request body for ``PATCH /api/projects/{project_id}``.

    All fields are optional. A request with an empty body is a
    no-op that still returns the current project row. Sending
    ``null`` for an optional field is rejected by the schema (the
    type is ``<T> | None`` only to express the optional nature;
    Pydantic v2 distinguishes "absent" from "null" by default and
    nulls are not valid for these fields). The :attr:`updated_at`
    column is bumped server-side via the ``onupdate`` hook on the
    ORM model — clients never set it.

    Attributes:
        title: New project name. Capped at 200 chars; mirrors
            :class:`ProjectCreate.title`.
        code: New generated body. Must be non-empty and capped at
            1 MB; mirrors :class:`ProjectCreate.code`. The cap
            is the same as on create to prevent a PATCH with a
            multi-gigabyte body from exhausting server RAM during
            Pydantic validation.
        model: New OpenCode Go model id. Same pattern as
            :class:`ProjectCreate.model`.
    """

    title: str | None = Field(
        default=None,
        max_length=200,
        description="New project name (max 200 chars).",
    )
    code: str | None = Field(
        default=None,
        min_length=1,
        max_length=1_000_000,
        description=(
            "New generated body. Capped at 1 MB to prevent "
            "oversized payloads from exhausting server memory."
        ),
    )
    model: str | None = Field(
        default=None,
        pattern=_MODEL_ID_PATTERN,
        description="New OpenCode Go model id.",
    )


class ProjectResponse(BaseModel):
    """Full project row returned by ``GET``/``POST``/``PATCH``.

    Carries the full ``code`` body. Used for:

    * ``GET /api/projects/{project_id}`` — load a single project
      into the builder.
    * ``POST /api/projects`` — return the newly-created row to the
      frontend so it can navigate to the new project id without a
      second ``GET``.
    * ``PATCH /api/projects/{project_id}`` — return the updated
      row.

    Attributes:
        id: Primary key. Stable across edits.
        title: Human-readable name (defaults to ``"Untitled"``).
        prompt: Full original prompt.
        code: Full generated body.
        model: OpenCode Go model id.
        iteration_count: Number of ``POST /api/iterate`` attempts
            made against this project.
        iteration_limit: Product cap on iterations per project
            (from config; currently 10).
        created_at: First-write timestamp (UTC, server-set).
        updated_at: Last-write timestamp (UTC, server-set, bumped
            by the ORM's ``onupdate`` hook).
    """

    id: int
    title: str
    prompt: str
    code: str
    model: str
    iteration_count: int
    iteration_limit: int = settings.ITERATION_LIMIT
    created_at: datetime
    updated_at: datetime

    # ``from_attributes=True`` replaces the v1 ``orm_mode`` flag:
    # Pydantic v2 will read fields off an ORM instance directly
    # when validating. Required so the route can do
    # ``ProjectResponse.model_validate(project)``.
    model_config = ConfigDict(from_attributes=True)


class ProjectListItem(BaseModel):
    """Lightweight project row for ``GET /api/projects``.

    Excludes the (potentially large) ``code`` body so the list
    endpoint stays fast even with thousands of rows. The
    frontend loads the code on demand via
    ``GET /api/projects/{project_id}``.

    The ``prompt`` field is truncated to
    :data:`LIST_PROMPT_TRUNCATE` characters by the route — the
    schema accepts a full prompt so the truncation logic lives in
    one place and is easy to tweak.

    Attributes:
        id: Primary key.
        title: Human-readable name.
        prompt: Truncated original prompt (see route).
        model: OpenCode Go model id.
        iteration_count: Number of ``POST /api/iterate`` attempts
            made against this project.
        iteration_limit: Product cap on iterations per project
            (from config; currently 10).
        created_at: First-write timestamp.
    """

    id: int
    title: str
    prompt: str
    model: str
    iteration_count: int
    iteration_limit: int = settings.ITERATION_LIMIT
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatMessage(BaseModel):
    """A single turn in the chat-iteration history.

    Used by :class:`IterateRequest.history` to give the coder
    agent the full conversation context of an in-progress
    iteration session. The frontend sends back every prior
    user/assistant exchange (in order) so the model can refer
    back to earlier decisions.

    Attributes:
        role: ``"user"`` for user instructions, ``"assistant"``
            for prior model responses (e.g. a previously-streamed
            code body). Any other value is rejected by the
            schema — only these two roles are valid in a chat
            history.
        content: The raw text of the message. For an
            ``"assistant"`` message this is the full concatenated
            code that the coder produced on that turn.
    """

    role: str = Field(
        pattern=r"^(user|assistant)$",
        description="Speaker of the message (user or assistant).",
    )
    content: str = Field(
        min_length=1,
        max_length=50000,
        description="Raw text of the message.",
    )


class IterateRequest(BaseModel):
    """Request body for ``POST /api/iterate``.

    Drives the chat-style iteration flow (Phase 4): the user has
    an already-generated app and asks for a small change
    ("make the buttons blue", "add a delete button", etc.). The
    route streams the COMPLETE updated HTML file back — never a
    diff, never a partial — so the frontend can replace the code
    panel atomically.

    Attributes:
        prompt: The user's natural-language instruction for this
            iteration (e.g. "add a dark mode toggle"). Bounded
            to 10 000 chars to match :class:`GenerateRequest.prompt`.
        current_code: The full HTML body the user is iterating on
            (the latest version of the file). Bounded to 500 000
            chars; a fully-featured single-page app is typically
            10-50 KB, so this leaves comfortable headroom for
            unusually large apps.
        history: Prior ``(user, assistant)`` message pairs from
            the same session, oldest first. Optional (defaults
            to empty); capped at 50 messages to bound the prompt
            size and protect against runaway history payloads.
        model: OpenCode Go model id used for the iteration
            coder call. Same pattern as
            :class:`GenerateRequest.model`.
        project_id: The id of the project being iterated on.
            Required so the backend can enforce the per-project
            iteration cap and verify ownership.
    """

    prompt: str = Field(
        min_length=1,
        max_length=10000,
        description="Natural-language iteration instruction.",
    )
    current_code: str = Field(
        min_length=1,
        max_length=500000,
        description="Full current HTML body the user is iterating on.",
    )
    history: list[ChatMessage] = Field(
        default_factory=list,
        max_length=50,
        description="Prior (user, assistant) turns from the same session.",
    )
    model: str = Field(
        pattern=_MODEL_ID_PATTERN,
        description="OpenCode Go model identifier to use for the iteration.",
    )
    project_id: int = Field(
        ge=1,
        description="Project id being iterated on.",
    )
