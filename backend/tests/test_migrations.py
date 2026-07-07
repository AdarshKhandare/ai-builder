"""Tests for the lightweight ALTER TABLE migration runner.

The runner is :func:`app.models.database._run_lightweight_migrations`,
invoked by :func:`app.models.database.init_db` after ``create_all``.
It exists because ``create_all`` creates tables that are missing
but does **not** add columns to tables that already exist, so any
ORM change that adds a column to a pre-existing table (e.g.
``Project.owner_id`` in Phase 8) leaves the on-disk schema
out-of-date and breaks every query that references the new column
with ``sqlite3.OperationalError: no such column``.

These tests pin the runner's contract:

* It adds columns that are missing from an existing table.
* It is idempotent — running twice does not duplicate the column
  or raise.
* It is a no-op when the column is already present (the normal
  case on a fresh ``create_all`` DB).
* It is a no-op when the target table does not exist yet
  (``create_all`` handles brand-new tables).
* The exact ``SELECT`` that triggered the production bug succeeds
  against a stale DB after the runner has been applied.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models.database import _run_lightweight_migrations

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


# The Phase 3a ``projects`` schema (i.e. the one baked into
# ``backend/data/forge.db`` before Phase 8 added ``owner_id``).
# Mirrored exactly here so the test exercises the same DDL gap
# that the production bug exposed.
_STALE_PROJECTS_DDL = (
    "CREATE TABLE projects ("
    "id INTEGER PRIMARY KEY,"
    "title TEXT,"
    "prompt TEXT,"
    "code TEXT,"
    "model TEXT,"
    "created_at DATETIME,"
    "updated_at DATETIME"
    ")"
)


async def _run_migrations(connection: Any) -> int:
    """Call :func:`_run_lightweight_migrations` with a clear failure message.

    The migration runner is designed never to raise — a failure
    on a single entry is caught, logged, and skipped — so an
    exception here would be a real bug. The wrapper turns any
    unexpected raise into a pytest failure with the exception
    type in the message, which is friendlier than letting a
    raw ``OperationalError`` bubble out of a follow-up assertion.
    """
    try:
        return await _run_lightweight_migrations(connection)
    except Exception as exc:  # pragma: no cover - defensive only
        pytest.fail(
            f"_run_lightweight_migrations raised on a stable DB: "
            f"{type(exc).__name__}: {exc}"
        )
        # ``pytest.fail`` raises; the return is unreachable but
        # keeps the type checker happy.
        raise


@pytest.fixture
async def stale_engine() -> AsyncGenerator[AsyncEngine, None]:
    """An in-memory SQLite engine with the pre-Phase-8 ``projects`` schema.

    Yields:
        An :class:`AsyncEngine` whose single shared connection
        (via :class:`StaticPool`) holds a ``projects`` table with
        no ``owner_id`` column. Teardown disposes the engine.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.execute(text(_STALE_PROJECTS_DDL))
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
async def empty_engine() -> AsyncGenerator[AsyncEngine, None]:
    """An in-memory SQLite engine with no tables at all.

    Yields:
        An :class:`AsyncEngine` whose database is empty. Used by
        the "table missing" edge-case test.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    try:
        yield engine
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_migration_adds_owner_id_to_stale_table(
    stale_engine: AsyncEngine,
) -> None:
    """Running the migration once adds ``owner_id`` to the projects table.

    This is the regression test for the production bug: a
    deployment whose ``projects`` table predates the Phase 8
    ``owner_id`` column must have the column added on next
    startup. The fixture has a ``projects`` table but no ``users``
    table, so the runner can apply the two ``projects`` migrations
    (``owner_id`` and ``iteration_count``) while skipping the
    ``users.lifetime_project_count`` migration.
    """
    async with stale_engine.begin() as connection:
        applied = await _run_migrations(connection)

        assert applied == 2
        pragma_result = await connection.execute(text("PRAGMA table_info(projects)"))
        column_names = {row[1] for row in pragma_result.fetchall()}
        assert "owner_id" in column_names
        assert "iteration_count" in column_names


async def test_migration_is_idempotent(stale_engine: AsyncEngine) -> None:
    """Running the migration twice adds each column exactly once.

    Re-running the same migration on a freshly-migrated DB is
    the steady state: every subsequent startup hits this code
    path. It must not raise, must not duplicate the column, and
    must report zero applied migrations.
    """
    async with stale_engine.begin() as connection:
        await _run_migrations(connection)

    async with stale_engine.begin() as connection:
        applied = await _run_migrations(connection)
        assert applied == 0

        pragma_result = await connection.execute(text("PRAGMA table_info(projects)"))
        column_names = [row[1] for row in pragma_result.fetchall()]
        # Exactly one of each new column, not duplicated by the
        # second run.
        assert column_names.count("owner_id") == 1
        assert column_names.count("iteration_count") == 1


async def test_migration_is_noop_when_column_already_present(
    stale_engine: AsyncEngine,
) -> None:
    """A migration entry whose target column already exists is a no-op.

    The normal case on a deployment that was bootstrapped
    **after** the columns were added to the ORM: the table already
    has ``owner_id`` and ``iteration_count``, ``create_all`` did
    the right thing, and the migration runner must report zero
    applied changes without touching the table.
    """
    async with stale_engine.begin() as connection:
        await _run_migrations(connection)

    async with stale_engine.begin() as connection:
        applied = await _run_migrations(connection)
        assert applied == 0

        # All original columns are still present (no accidental
        # drops) plus the two new project columns.
        pragma_result = await connection.execute(text("PRAGMA table_info(projects)"))
        column_names = {row[1] for row in pragma_result.fetchall()}
        assert column_names == {
            "id",
            "title",
            "prompt",
            "code",
            "model",
            "created_at",
            "updated_at",
            "owner_id",
            "iteration_count",
        }


async def test_migration_skips_when_table_missing(
    empty_engine: AsyncEngine,
) -> None:
    """A migration entry whose target table does not exist is a no-op.

    ``create_all`` is responsible for creating brand-new tables
    with the current schema. The migration runner only needs to
    bring **existing** tables up to date, so a missing target
    table is not an error.
    """
    async with empty_engine.begin() as connection:
        # The ``projects`` table does not exist in this engine;
        # the migration must detect that and skip the ALTER.
        applied = await _run_migrations(connection)
        assert applied == 0


async def test_select_owner_id_succeeds_after_migration(
    stale_engine: AsyncEngine,
) -> None:
    """The exact query that fails pre-migration works afterwards.

    This pins the user-visible behaviour of the bug fix.
    Pre-migration, this statement raises
    ``sqlite3.OperationalError: no such column: projects.owner_id``
    against the stale ``forge.db``. Post-migration, the same
    statement must succeed (returning zero rows against the
    empty test DB) so that ``GET /api/projects`` stops throwing.
    """
    async with stale_engine.begin() as connection:
        await _run_migrations(connection)

    async with stale_engine.begin() as connection:
        # The select mirrors the production query: ``WHERE
        # owner_id = ?`` plus the same ``ORDER BY`` /
        # ``LIMIT``/``OFFSET`` clauses used by
        # ``list_projects``. With the column present but no
        # matching rows, the result set is empty.
        result = await connection.execute(
            text(
                "SELECT owner_id FROM projects "
                "WHERE owner_id = :owner_id "
                "ORDER BY created_at DESC, id DESC "
                "LIMIT :limit OFFSET :offset"
            ),
            {"owner_id": 1, "limit": 10, "offset": 0},
        )
        rows: list[Any] = result.fetchall()
        assert rows == []


async def test_init_db_applies_pending_migrations(
    stale_engine: AsyncEngine,
) -> None:
    """``init_db`` runs the migration runner after ``create_all``.

    End-to-end test against a fresh DB seeded with the stale
    schema: a real :func:`app.models.database.init_db` call must
    leave the ``projects`` table with ``owner_id`` present.

    The test swaps the module-level ``engine`` global for the
    in-memory test engine so :func:`init_db` operates on the
    same database the fixture created. The original engine is
    restored on teardown regardless of the test outcome.
    """
    import app.models.database as db_module

    original_engine = db_module.engine
    db_module.engine = stale_engine
    try:
        await db_module.init_db()

        async with stale_engine.begin() as connection:
            pragma_result = await connection.execute(
                text("PRAGMA table_info(projects)")
            )
            column_names = {row[1] for row in pragma_result.fetchall()}
            assert "owner_id" in column_names
    finally:
        db_module.engine = original_engine
