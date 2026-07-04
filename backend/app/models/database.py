"""SQLAlchemy 2.0 async engine, session, and ORM models for Forge.

This module owns:

* the async ``Engine`` and ``async_sessionmaker`` bound to
  ``settings.DATABASE_URL`` (SQLite via aiosqlite in production);
* the ``Project`` ORM model — the single persisted entity in the MVP;
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
  story (Alembic) is out of scope for the MVP; the only table is
  ``projects`` and the schema is small enough to recreate.
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

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models.

    A single shared base lets :func:`init_db` discover every mapped
    class with a single ``Base.metadata.create_all`` call. Adding a
    new table is a matter of subclassing ``Base`` and importing the
    module here (or anywhere that runs before ``init_db``).
    """


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
        created_at: Wall-clock time the row was first written. Set
            by SQLite's ``CURRENT_TIMESTAMP`` default; not touched
            on update.
        updated_at: Wall-clock time of the last write to this row.
            Bumped automatically on every ``UPDATE`` so the
            frontend can sort "recently edited" without storing a
            separate event log.
    """

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="Untitled")
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        """Return a debugging-friendly representation.

        Used by the test suite's failure messages and by any
        future logging that needs to include a project handle.
        """
        return f"Project(id={self.id!r}, title={self.title!r}, model={self.model!r})"


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

    Idempotent: safe to call on every app startup. In production,
    the only table is :class:`Project`; adding a new model is a
    matter of importing it (so the mapper is registered with
    ``Base.metadata``) before this function runs.

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
