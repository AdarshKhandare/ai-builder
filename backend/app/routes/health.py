"""Health check endpoint."""
from fastapi import APIRouter

router = APIRouter()

# Available Go-gateway models. The `endpoint` field tells the frontend
# which wire protocol each model uses ("openai" or "anthropic"); it is
# advisory and the backend client does the actual routing on the
# server. Prices are USD per 1M tokens, sourced from the OpenCode Go
# pricing page.
AVAILABLE_MODELS = [
    {
        "id": "opencode-go/minimax-m3",
        "name": "MiniMax M3",
        "cost_input": 0.30,
        "cost_output": 1.20,
        "endpoint": "anthropic",
    },
    {
        "id": "opencode-go/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "cost_input": 0.14,
        "cost_output": 0.28,
        "endpoint": "openai",
    },
    {
        "id": "opencode-go/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "cost_input": 1.74,
        "cost_output": 3.48,
        "endpoint": "openai",
    },
    {
        "id": "opencode-go/kimi-k2.6",
        "name": "Kimi K2.6",
        "cost_input": 0.95,
        "cost_output": 4.00,
        "endpoint": "openai",
    },
    {
        "id": "opencode-go/kimi-k2.7-code",
        "name": "Kimi K2.7 Code",
        "cost_input": 0.95,
        "cost_output": 4.00,
        "endpoint": "openai",
    },
    {
        "id": "opencode-go/qwen3.7-plus",
        "name": "Qwen3.7 Plus",
        "cost_input": 0.40,
        "cost_output": 1.60,
        "endpoint": "anthropic",
    },
    {
        "id": "opencode-go/qwen3.7-max",
        "name": "Qwen3.7 Max",
        "cost_input": 2.50,
        "cost_output": 7.50,
        "endpoint": "anthropic",
    },
    {
        "id": "opencode-go/glm-5.2",
        "name": "GLM 5.2",
        "cost_input": 1.40,
        "cost_output": 4.40,
        "endpoint": "openai",
    },
    {
        "id": "opencode-go/mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro",
        "cost_input": 1.74,
        "cost_output": 3.48,
        "endpoint": "openai",
    },
]


@router.get("/api/health")
async def health() -> dict:
    """Return service status and available models."""
    return {"status": "ok", "models": AVAILABLE_MODELS}
