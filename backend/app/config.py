"""Application configuration via pydantic-settings."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Forge backend settings loaded from environment / .env file."""

    OPENCODE_API_KEY: str
    OPENCODE_BASE_URL: str = "https://opencode.ai/zen/go/v1"
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/forge.db"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:5173"]
    # Planner model override. Default is the cost-optimised
    # ``deepseek-v4-flash`` documented in ``docs/AI_MODELS.md``; set
    # this env var to any other OpenCode Go model id (e.g.
    # ``opencode-go/kimi-k2.6``) if the upstream planner is unavailable.
    PLANNER_MODEL: str = "opencode-go/deepseek-v4-flash"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
