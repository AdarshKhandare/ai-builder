"""FastAPI application entry point."""
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models.database import init_db
from app.routes import generate, health, iterate, projects

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Run startup / shutdown hooks for the Forge API.

    Startup:

    * :func:`app.models.database.init_db` — create all tables
      declared on the SQLAlchemy ``Base`` (currently just
      ``projects``). Idempotent: safe on every boot.

    Shutdown:

    * Nothing to dispose explicitly — SQLAlchemy's async engine
      releases its connections on garbage collection, and
      Uvicorn handles HTTP client teardown.

    Args:
        _app: The FastAPI application being started. Underscored
            to signal it is unused; the hook only touches
            module-level state.

    Yields:
        ``None`` between startup and shutdown. Handlers may run
        against the fully-initialised application during this
        window.
    """
    logger.info("Forge API starting up; initialising database")
    await init_db()
    logger.info("Database initialisation complete")
    yield
    logger.info("Forge API shutting down")


app = FastAPI(title="Forge API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(generate.router)
app.include_router(iterate.router)
app.include_router(projects.router)
