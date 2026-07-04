"""Shared pytest fixtures for the Forge backend test suite.

Environment variable ordering
-----------------------------
`app.config.settings` is instantiated at module import time (it is a
module-level singleton). If `OPENCODE_API_KEY` is missing, importing
`app.main` raises a `ValidationError` from pydantic-settings. The two
import-time side effects we depend on (Settings validation, FastAPI
app construction) must therefore see a populated environment BEFORE
this conftest imports `app.main`. We set the env vars at the top of
this file, before any `from app ...` import. The `setdefault` calls
preserve any value the developer has exported in their shell.
"""

# ---------------------------------------------------------------------------
# Environment defaults — must run BEFORE any `from app ...` import below.
# ---------------------------------------------------------------------------
import os

os.environ.setdefault("OPENCODE_API_KEY", "test-key")
os.environ.setdefault("OPENCODE_BASE_URL", "https://opencode.ai/zen/go/v1")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./data/test_forge.db")
# pydantic-settings v2 parses list[str] from JSON by default.
os.environ.setdefault("ALLOWED_ORIGINS", '["http://localhost:5173"]')

# ---------------------------------------------------------------------------
# Third-party imports (after env setup).
# ---------------------------------------------------------------------------
from typing import AsyncGenerator  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

# Importing the app also imports `app.config`, which builds `settings`.
# This is safe now that the env vars above are set.
from app.main import app  # noqa: E402
from app.models.database import Base, get_db  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_client() -> "MagicMock":  # type: ignore[name-defined]
    """A MagicMock that quacks like ``app.services.opencode_client.OpenCodeClient``.

    Behaviour:

    * ``stream_chat(...)`` is an async generator yielding three HTML
      chunks: ``"<html>"``, ``"<body>"``, ``"</body></html>"``.
    * ``chat(...)`` returns ``"Mock plan for: <prompt>"`` (the prompt is
      ignored — tests that care about it inspect ``call_args`` themselves).
    * ``close()`` is an awaitable no-op.

    The mock is a plain ``MagicMock`` with hand-wired attributes rather
    than an ``AsyncMock`` at the top level because ``stream_chat`` is an
    *async generator function* (it uses ``yield`` inside an ``async def``),
    not a plain coroutine — a top-level ``AsyncMock`` would return a
    coroutine that needs ``await``ing, which is incompatible with
    ``async for chunk in client.stream_chat(...):``.

    Yields:
        A ``MagicMock`` instance usable as a drop-in ``OpenCodeClient``.
    """
    from unittest.mock import AsyncMock, MagicMock

    async def _stream_chat(*_args, **_kwargs):
        for chunk in ("<html>", "<body>", "</body></html>"):
            yield chunk

    mock = MagicMock(name="mock_client")
    # side_effect on a MagicMock makes it a callable that delegates to the
    # side_effect and returns its result. For an async generator function
    # the result IS the async generator, so `async for` over the call
    # works correctly.
    mock.stream_chat = MagicMock(side_effect=_stream_chat, name="stream_chat")
    mock.chat = AsyncMock(return_value="Mock plan for: test prompt", name="chat")
    mock.close = AsyncMock(return_value=None, name="close")
    return mock


@pytest.fixture
async def client(db_session: None) -> AsyncGenerator[AsyncClient, None]:
    """An ``httpx.AsyncClient`` bound to the FastAPI app via ``ASGITransport``.

    We deliberately use ``ASGITransport`` instead of FastAPI's sync
    ``TestClient`` so that SSE streaming responses can be consumed with
    ``response.aiter_lines()`` from inside an async test. The sync
    ``TestClient`` buffers the entire stream and would defeat the point
    of testing a streaming endpoint.

    The fixture is an async generator so the underlying httpx client is
    cleanly closed even when a test fails mid-iteration.

    Depends on the ``db_session`` fixture so that the ``get_db``
    dependency is overridden with a per-test in-memory database
    before any request is made. Existing tests that do not touch
    the DB (``test_health``, ``test_generate``) are unaffected —
    the override is a no-op for them.

    Args:
        db_session: Side-effect fixture. Pytest injects this even
            though we never reference the value; the fixture's
            body registers the ``get_db`` override on the app.

    Yields:
        AsyncClient pointed at the in-process ASGI app.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


@pytest.fixture
async def db_session() -> AsyncGenerator[None, None]:
    """Provide a fresh in-memory SQLite database for one test.

    Every test that ends up talking to the persistence layer gets
    a clean, isolated database. The fixture:

    1. Spins up an ``AsyncEngine`` against ``sqlite+aiosqlite:///:memory:``
       with a ``StaticPool`` — the latter is required so that
       every ``AsyncSession`` reuses the single in-memory
       connection; without it, each new session would see an
       empty database (SQLite's :file:`:memory:` is per-connection).
    2. Runs ``Base.metadata.create_all`` on the test engine so
       the ``projects`` table exists. Production tables are
       created by :func:`app.models.database.init_db` in
       ``lifespan``; the test ASGI transport does not trigger
       lifespan, so the schema is bootstrapped here.
    3. Overrides :func:`app.models.database.get_db` on the FastAPI
       app with a generator that yields sessions from a
       sessionmaker bound to the in-memory engine.
    4. Tears down: pops the override and disposes the engine.

    The fixture is function-scoped (default for pytest async
    fixtures under ``asyncio_mode = auto``) so every test gets
    its own database.

    Yields:
        ``None`` — the side effect is the ``dependency_overrides``
        registration, which is consumed implicitly by the route
        handlers via :func:`get_db`.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # ``run_sync`` is the standard pattern for invoking a sync
    # DDL helper on an async connection. ``create_all`` is
    # idempotent — safe to call even if the table somehow
    # already exists.
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_get_db() -> AsyncGenerator:
        async with factory() as session:
            try:
                yield session
            finally:
                await session.close()

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
