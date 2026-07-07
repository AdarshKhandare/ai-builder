"""Application configuration via pydantic-settings."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Forge backend settings loaded from environment / .env file."""

    # OpenCode Go API (existing)
    OPENCODE_API_KEY: str
    OPENCODE_BASE_URL: str = "https://opencode.ai/zen/go/v1"
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/forge.db"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:5173"]

    # Environment flag. Drives production-only behaviour such as the
    # ``Strict-Transport-Security`` header. Defaults to ``"development"``
    # so a dev server never emits an HSTS header that the local
    # browser would then lock in for ``adarshweb.in`` and friends.
    ENVIRONMENT: str = "development"

    # Planner model override. Default is the cost-optimised
    # ``deepseek-v4-flash`` documented in ``docs/AI_MODELS.md``; set
    # this env var to any other OpenCode Go model id (e.g.
    # ``opencode-go/kimi-k2.6``) if the upstream planner is unavailable.
    PLANNER_MODEL: str = "opencode-go/deepseek-v4-flash"

    # ------------------------------------------------------------------
    # GitHub OAuth (Task 2)
    # ------------------------------------------------------------------
    # When ``GITHUB_CLIENT_ID`` is empty the auth routes refuse to
    # start (we log a startup warning and the /api/auth/login route
    # returns 503). In development it is fine to leave these blank
    # as long as you do not exercise the OAuth flow.
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""

    # ------------------------------------------------------------------
    # JWT (Task 2)
    # ------------------------------------------------------------------
    # ``JWT_SECRET`` MUST be a long random string in production. The
    # ``auth`` module refuses to issue tokens if it is empty or shorter
    # than 32 characters — a development fallback is provided by
    # ``_DEV_FALLBACK_SECRET`` in :mod:`app.routes.deps` so the test
    # suite can run without a real secret, but production will hard-
    # fail to start. Use ``python -c "import secrets;
    # print(secrets.token_urlsafe(64))"`` to generate one.
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24 * 7  # 1 week

    # Where to redirect after a successful GitHub OAuth login. The
    # ``/builder`` path on the frontend hosts the authenticated
    # builder UI.
    FRONTEND_URL: str = "http://localhost:5173"

    # Public origin of the backend (used to build the GitHub OAuth
    # callback URL). For local dev the default of
    # ``http://localhost:8000`` is correct; in production set this
    # to the API's public origin (e.g.
    # ``https://api.adarshweb.in``). Falls back to a localhost
    # default so the dev experience is zero-config.
    BACKEND_PUBLIC_URL: str = "http://localhost:8000"

    # ------------------------------------------------------------------
    # Abuse-prevention / business-rule caps (lifetime + per-project)
    # ------------------------------------------------------------------
    # These are tunable via env vars so operational adjustments (e.g.
    # raising the limit for a trusted beta cohort) do not require a
    # code change. Defaults are the documented product caps: 2 projects
    # per user lifetime, 10 iterations per project.
    PROJECT_LIMIT: int = 2
    ITERATION_LIMIT: int = 10

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
