"""SQLAlchemy 2.0 async engine, session, and ORM models for Forge.

This module owns:

* the async ``Engine`` and ``async_sessionmaker`` bound to
  ``settings.DATABASE_URL`` (SQLite via aiosqlite in production);
* the ORM models: :class:`Project` (history of generated apps),
  :class:`User` (GitHub OAuth identities), and
  :class:`UsageEvent` (per-user daily-quota accounting);
* :func:`init_db` to create tables on app startup;
* :func:`get_db` for use as a FastAPI ``Depends`` in routes.

Design notes
------------

* **Module-level engine** — :func:`create_async_engine` is cheap to
  construct but maintains a connection pool. Keeping the engine at
  module scope (singleton) matches the documented SQLAlchemy async
  pattern and means the pool is shared across requests.
* **Async-only** — every public function in this module is ``async
  def``. There is no sync escape hatch; routes that touch the DB
  MUST use ``Depends(get_db)`` and ``await`` the session.
* **No schema migrations yet** — :func:`init_db` uses
  ``Base.metadata.create_all`` which is idempotent. A real migration
  story (Alembic) is out of scope for the MVP.
* **``expire_on_commit=False``** — without this, accessing attributes
  on a freshly-committed ORM instance triggers a lazy reload, which
  is not allowed outside the session context. Pydantic v2's
  ``from_attributes`` mode (used in :mod:`app.models.schemas`) would
  then need a fresh query. Disabling the auto-expire avoids that and
  is the standard pattern for ``async_sessionmaker`` in FastAPI.
* **SQLite + aiosqlite caveats** — the production engine URL is
  ``sqlite+aiosqlite:///./data/forge.db``. The :file:`./data`
  directory is created by the deployment guide and is gitignored.
  For tests, see the ``client`` fixture in ``tests/conftest.py``,
  which overrides :func:`get_db` with a session bound to an
  in-memory engine using ``StaticPool`` so that all sessions in a
  test share the same database.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.config import settings

if TYPE_CHECKING:
    pass


class Base(DeclarativeBase):
    """Declarative base for all ORM models.

    A single shared base lets :func:`init_db` discover every mapped
    class with a single ``Base.metadata.create_all`` call. Adding a
    new table is a matter of subclassing ``Base`` and importing the
    module here (or anywhere that runs before ``init_db``).
    """


class User(Base):
    """A GitHub-authenticated user.

    A row is created (or updated) by :mod:`app.routes.auth` after a
    successful GitHub OAuth callback. The ``github_id`` column is the
    canonical join key from GitHub's ``/user`` response; it is unique
    so a re-login by the same user upserts in place.

    Attributes:
        id: Auto-incrementing primary key. Stable across re-logins.
        github_id: GitHub numeric user id. Unique, not null. Comes
            from ``https://api.github.com/user`` ``id`` field.
        username: GitHub login at the time of the last login.
            Updated on every successful login so a rename propagates.
        avatar_url: GitHub avatar URL at the time of the last login,
            or ``None`` if the user has no avatar.
        email: Primary email from GitHub. ``None`` if the user has no
            public email (the ``read:user`` scope does not grant
            access to private emails).
        created_at: Wall-clock time the row was first written.
        projects: SQLAlchemy relationship to the user's
            :class:`Project` rows (one-to-many).
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    github_id: Mapped[int] = mapped_column(
        Integer, unique=True, nullable=False, index=True
    )
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    projects: Mapped[list[Project]] = relationship(
        "Project",
        back_populates="owner",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        """Return a debugging-friendly representation."""
        return f"User(id={self.id!r}, github_id={self.github_id!r}, username={self.username!r})"


class Project(Base):
    """A generated project saved to the user's history.

    A row is created by :func:`app.routes.projects.create_project`
    after a successful ``POST /api/generate`` stream. The frontend
    lists these on the landing/dashboard page and opens them in the
    builder to continue iterating.

    Attributes:
        id: Auto-incrementing primary key. Stable across edits.
        title: Human-readable project name. Defaults to ``"Untitled"``
            so a row with no explicit title still renders sensibly.
            Capped at 200 characters at the Pydantic layer.
        prompt: The user's original natural-language prompt. Stored
            verbatim (TEXT, no length cap at the DB layer; the
            Pydantic layer caps at 10 000 chars).
        code: The generated HTML/CSS/JS body. Stored verbatim; can
            be large (tens of KB for a non-trivial single-page app).
        model: The OpenCode Go model id that produced ``code``
            (e.g. ``opencode-go/minimax-m3``). Used by the
            history list to show which model was used.
        owner_id: Foreign key to :class:`User.id`. Nullable for
            backward compatibility with pre-auth rows; new projects
            MUST set this (the route enforces it on insert). When
            set, the project is owned by that user and visible only
            to them.
        created_at: Wall-clock time the row was first written. Set
            by SQLite's ``CURRENT_TIMESTAMP`` default; not touched
            on update.
        updated_at: Wall-clock time of the last write to this row.
            Bumped automatically on every ``UPDATE`` so the
            frontend can sort "recently edited" without storing a
            separate event log.
        owner: SQLAlchemy relationship to the owning :class:`User`.
            May be ``None`` for legacy rows.
    """

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="Untitled")
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    owner: Mapped[User | None] = relationship("User", back_populates="projects")

    def __repr__(self) -> str:
        """Return a debugging-friendly representation.

        Used by the test suite's failure messages and by any
        future logging that needs to include a project handle.
        """
        return (
            f"Project(id={self.id!r}, title={self.title!r}, "
            f"model={self.model!r}, owner_id={self.owner_id!r})"
        )


class UsageEvent(Base):
    """A single per-user rate-limit event.

    One row is inserted on every successful ``/api/generate``,
    ``/api/iterate``, or project-create call. The
    :func:`app.routes.deps.check_usage_quota` dependency counts
    rows for the current UTC day and raises ``429`` if the
    per-endpoint daily cap is exceeded.

    The :attr:`created_at` column is indexed because every quota
    check runs a ``WHERE user_id = ? AND endpoint = ? AND
    created_at >= today`` query against the table — without the
    index the check would degrade to a full scan under load.

    Attributes:
        id: Auto-incrementing primary key.
        user_id: Foreign key to :class:`User.id`. ``CASCADE`` on
            delete so removing a user cleans up their quota log.
        endpoint: Logical endpoint name. One of
            ``"generate"``, ``"iterate"``, ``"project_create"``.
            The check in :mod:`app.routes.deps` keys its
            per-endpoint daily cap off this string.
        created_at: Wall-clock time the event was recorded. Set
            by the ORM at flush time so it always reflects the
            server clock, not the client.
    """

    __tablename__ = "usage_events"
    __table_args__ = (
        Index(
            "ix_usage_events_user_endpoint_created",
            "user_id",
            "endpoint",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    endpoint: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )

    def __repr__(self) -> str:
        """Return a debugging-friendly representation."""
        return (
            f"UsageEvent(id={self.id!r}, user_id={self.user_id!r}, "
            f"endpoint={self.endpoint!r})"
        )


# Module-level async engine. A single ``AsyncEngine`` is shared
# across the process; SQLAlchemy manages the connection pool
# internally. Re-creating the engine on every request would defeat
# the pool and would be a major footgun under load.
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
)

# Session factory. ``expire_on_commit=False`` keeps ORM attributes
# usable after ``session.commit()`` so Pydantic v2's
# ``from_attributes=True`` can serialise a committed instance
# without triggering a lazy reload (which would need a fresh
# transaction and is fragile in async code).
async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def init_db() -> None:
    """Create all tables defined on :class:`Base`.

    Idempotent: safe to call on every app startup. Production tables
    are :class:`Project`, :class:`User`, and :class:`UsageEvent`;
    adding a new model is a matter of importing it (so the mapper
    is registered with ``Base.metadata``) before this function runs.

    The engine must be importable at the time of the call, which
    is guaranteed by the module-level ``engine`` definition above.
    A missing :file:`./data` directory will cause aiosqlite to
    raise; the deployment guide creates the directory before the
    first start.

    Raises:
        sqlalchemy.exc.SQLAlchemyError: If the DDL cannot be
            applied (corrupt file, permission denied, etc.).
    """
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a per-request :class:`AsyncSession` and close it cleanly.

    Used as a FastAPI ``Depends``:

    .. code-block:: python

        @router.get("/api/projects")
        async def list_projects(db: AsyncSession = Depends(get_db)):
            ...

    The session is closed in the ``finally`` block so the connection
    is always returned to the pool, even if the route raises
    mid-transaction. The session is not committed automatically;
    route handlers are responsible for calling ``db.commit()`` on
    the writes they want to persist.

    For tests, ``app.dependency_overrides[get_db]`` is set to a
    test-local generator backed by an in-memory engine; see
    :file:`tests/conftest.py`.

    Yields:
        An :class:`AsyncSession` bound to the module-level
        :data:`engine`. The session is closed when the request
        handler returns (or raises).
    """
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
