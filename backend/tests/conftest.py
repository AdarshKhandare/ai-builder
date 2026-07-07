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
# A stable secret for the test suite. ``_resolve_secret`` accepts
# any non-empty string; a stable value lets tests round-trip tokens
# without a per-process random key.
os.environ.setdefault("JWT_SECRET", "test-suite-jwt-secret-not-for-prod-xxx")
# Disable the production-only sanity check during tests so the
# default secret (which is shorter than 32 chars is NOT what we
# have here, but the check is ENVIRONMENT-driven and we set it
# to development below) is enough.
os.environ.setdefault("ENVIRONMENT", "development")
# Disable GitHub OAuth during tests by default; auth tests that
# exercise the OAuth flow set these explicitly.
os.environ.setdefault("GITHUB_CLIENT_ID", "")
os.environ.setdefault("GITHUB_CLIENT_SECRET", "")

# ---------------------------------------------------------------------------
# Third-party imports (after env setup).
# ---------------------------------------------------------------------------
from typing import Any, AsyncGenerator  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool  # noqa: E402

# Importing the app also imports `app.config`, which builds `settings`.
# This is safe now that the env vars above are set.
from app.main import app, limiter  # noqa: E402
from app.models.database import Base, get_db  # noqa: E402
from app.routes.deps import create_access_token  # noqa: E402

# ---------------------------------------------------------------------------
# Test-suite-wide rate-limit bypass
# ---------------------------------------------------------------------------
# The global SlowAPI limiter (100 req/min per IP) is intentionally
# high so it never fires during a normal pytest run, but a test
# that hits the same IP from the in-process ASGI transport more
# than 100 times would trip it. Reset the limiter to "no default
# limit" so the suite is not order-dependent and individual quota
# tests can still attach per-route limits as needed.
limiter._default_limits = []  # type: ignore[attr-defined]  # noqa: SLF001


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_client() -> "MagicMock":  # noqa: F821
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
       the ``projects``, ``users``, and ``usage_events`` tables
       exist. Production tables are created by
       :func:`app.models.database.init_db` in ``lifespan``; the
       test ASGI transport does not trigger lifespan, so the
       schema is bootstrapped here.
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


@pytest.fixture
async def client(db_session: None) -> AsyncGenerator[AsyncClient, None]:
    """An ``httpx.AsyncClient`` bound to the FastAPI app via ``ASGITransport``.

    We deliberately use ``ASGITransport`` instead of FastAPI's sync
    ``TestClient`` so that SSE streaming responses can be consumed
    with ``response.aiter_lines()`` from inside an async test. The
    sync ``TestClient`` buffers the entire stream and would defeat
    the point of testing a streaming endpoint.

    The fixture is an async generator so the underlying httpx
    client is cleanly closed even when a test fails mid-iteration.

    Depends on the ``db_session`` fixture so that the ``get_db``
    dependency is overridden with a per-test in-memory database
    before any request is made.

    The fixture is **unauthenticated** — requests issued through
    this client have no JWT cookie. Routes that require
    authentication will return ``401``. For authenticated calls,
    depend on :func:`auth_client` instead, or set the cookie
    yourself via ``client.cookies["forge_token"] = "..."``.

    Args:
        db_session: Side-effect fixture. Pytest injects this
            even though we never reference the value; the
            fixture's body registers the ``get_db`` override on
            the app.

    Yields:
        AsyncClient pointed at the in-process ASGI app.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


@pytest.fixture
async def test_user(
    db_session: None,
) -> AsyncGenerator[dict, None]:
    """Insert a single test :class:`User` and return a context dict.

    Creates a User row with a stable ``github_id`` and returns
    ``{"user": User, "id": <int>, "username": str, "token": str}``
    so individual tests can drive the API as that user.

    The token is a signed JWT built with
    :func:`app.routes.deps.create_access_token` — the same code
    path the auth callback uses, so the cookie is round-trip
    valid.

    Args:
        db_session: Side-effect fixture. The user row is written
            through the same in-memory engine the route layer
            uses (via the ``get_db`` override).

    Yields:
        A dict with the ``User`` ORM instance, its id, username,
        and a freshly-issued JWT.
    """
    from app.models.database import User  # local import keeps top tidy

    # Reuse the factory the ``db_session`` fixture installed on
    # the app. We grab it back out of the dependency override so
    # we share the same in-memory engine — touching the engine
    # directly here would silently fork the database.
    factory = app.dependency_overrides[get_db]
    # ``factory`` is a coroutine, not a sessionmaker; pull the
    # sessionmaker out of the closure that ``_override_get_db``
    # captured. The simplest portable path is to just open a new
    # connection through the override and use it.
    gen = factory()
    session = await gen.__anext__()

    try:
        user = User(
            github_id=12345,
            username="test-user",
            avatar_url="https://avatars.example/test-user",
            email="test@example.com",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        token = create_access_token(
            sub=str(user.id), extra_claims={"username": user.username}
        )
        yield {
            "user": user,
            "id": user.id,
            "username": user.username,
            "token": token,
        }
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass


@pytest.fixture
async def auth_client(
    test_user: dict, client: AsyncClient
) -> AsyncGenerator[AsyncClient, None]:
    """Return the ``client`` with the test user's JWT cookie pre-set.

    The :class:`User` row is created by the ``test_user``
    fixture. The JWT is then set on the ``httpx`` cookie jar so
    every request through the returned client is authenticated
    as that user.

    Args:
        test_user: The user context from :func:`test_user`.
        client: The unauthenticated client from :func:`client`.

    Yields:
        The same :class:`AsyncClient`, with ``client.cookies``
        containing a valid ``forge_token`` entry.
    """
    client.cookies.set("forge_token", test_user["token"])
    yield client


@pytest.fixture
async def test_project(auth_client: AsyncClient) -> dict[str, Any]:
    """Create a single project for the authenticated test user.

    Used by iteration tests that now require a ``project_id`` in
    the request body. Each test gets a fresh in-memory database, so
    creating one project here never collides with lifetime/daily caps.

    Args:
        auth_client: The authenticated ASGI test client.

    Returns:
        The parsed JSON body of the ``201`` create response.
    """
    response = await auth_client.post(
        "/api/projects",
        json={
            "title": "Test Project",
            "prompt": "A test project for iteration",
            "code": "<html><body>Test</body></html>",
            "model": "opencode-go/minimax-m3",
        },
    )
    assert (
        response.status_code == 201
    ), f"test_project fixture failed: {response.status_code}: {response.text}"
    return response.json()
