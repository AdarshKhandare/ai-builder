"""Health check endpoint."""

from typing import Any

from fastapi import APIRouter

router = APIRouter()

# Available Go-gateway models — the curated, cost-optimised set of
# 8 cheap models. Mirrors :data:`app.routes.models._MODELS_CATALOGUE`
# (the model picker catalogue); the ``endpoint`` field MUST match the
# value for the same id in :data:`app.routes.models._MODELS_CATALOGUE`.
# Prices are USD per 1M tokens, sourced from the OpenCode Go pricing
# page. ``tier`` groups models into pricing bands the UI can sort by
# (very-cheap / medium / upper-medium). ``is_default`` flags the
# single model the frontend should pre-select (DeepSeek V4 Flash).
AVAILABLE_MODELS: list[dict[str, Any]] = [
    {
        "id": "opencode-go/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "cost_input": 0.14,
        "cost_output": 0.28,
        "endpoint": "openai",
        "tier": "very-cheap",
        "is_default": True,
    },
    {
        "id": "opencode-go/mimo-v2.5",
        "name": "MiMo V2.5",
        "cost_input": 0.14,
        "cost_output": 0.28,
        "endpoint": "openai",
        "tier": "very-cheap",
        "is_default": False,
    },
    {
        "id": "opencode-go/minimax-m2.7",
        "name": "MiniMax M2.7",
        "cost_input": 0.30,
        "cost_output": 1.20,
        "endpoint": "anthropic",
        "tier": "medium",
        "is_default": False,
    },
    {
        "id": "opencode-go/qwen3.6-plus",
        "name": "Qwen3.6 Plus",
        "cost_input": 0.50,
        "cost_output": 3.00,
        "endpoint": "anthropic",
        "tier": "medium",
        "is_default": False,
    },
    {
        "id": "opencode-go/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "cost_input": 1.74,
        "cost_output": 3.48,
        "endpoint": "openai",
        "tier": "medium",
        "is_default": False,
    },
    {
        "id": "opencode-go/minimax-m3",
        "name": "MiniMax M3",
        "cost_input": 0.30,
        "cost_output": 1.20,
        "endpoint": "anthropic",
        "tier": "upper-medium",
        "is_default": False,
    },
    {
        "id": "opencode-go/qwen3.7-plus",
        "name": "Qwen3.7 Plus",
        "cost_input": 0.40,
        "cost_output": 1.60,
        "endpoint": "anthropic",
        "tier": "upper-medium",
        "is_default": False,
    },
    {
        "id": "opencode-go/kimi-k2.6",
        "name": "Kimi K2.6",
        "cost_input": 0.95,
        "cost_output": 4.00,
        "endpoint": "openai",
        "tier": "upper-medium",
        "is_default": False,
    },
]


@router.get("/api/health")
async def health() -> dict:
    """Return service status and available models.

    The response is intentionally static — the catalogue is a
    module-level constant — so the endpoint is safe to call on
    every page load and survives an OpenCode outage.

    Returns:
        A dict with ``status`` (``"ok"``) and ``models`` (the
        curated list of 8 cheap models with ``id``, ``name``,
        ``cost_input``, ``cost_output``, ``endpoint``, ``tier``,
        and ``is_default``).
    """
    return {"status": "ok", "models": AVAILABLE_MODELS}
