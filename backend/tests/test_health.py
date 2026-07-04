"""Tests for the ``GET /api/health`` endpoint.

These tests verify Phase 1 acceptance criteria:

* ``GET /api/health`` returns 200 with ``{"status": "ok", "models": [...]}``.
* The ``models`` list advertises the two primary models documented in
  ``docs/AI_MODELS.md``: MiniMax M3 (primary coder) and DeepSeek V4 Flash
  (planner/reviewer).
* Every entry in ``models`` carries the pricing fields the frontend
  StatusBar needs to display cost estimates, plus the ``endpoint``
  field that tells the UI which wire protocol the model uses.

The endpoint has no external dependencies, so no mocking is required.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_health_returns_ok(client: AsyncClient) -> None:
    """``GET /api/health`` returns HTTP 200 and ``status == "ok"``.

    Asserts:
        * response status code is 200
        * JSON body has ``status == "ok"``
    """
    response = await client.get("/api/health")

    assert (
        response.status_code == 200
    ), f"Expected 200 from /api/health, got {response.status_code}: {response.text}"
    payload: dict[str, Any] = response.json()
    assert payload.get("status") == "ok", f"Expected status 'ok', got {payload!r}"


async def test_health_returns_models(client: AsyncClient) -> None:
    """``GET /api/health`` advertises the primary coder and planner models.

    Asserts:
        * ``models`` key exists and is a non-empty list
        * MiniMax M3 (primary coder) is present
        * DeepSeek V4 Flash (primary planner/reviewer) is present
    """
    response = await client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()

    assert "models" in payload, f"Response missing 'models' key: {payload!r}"
    models = payload["models"]
    assert isinstance(models, list), f"Expected list, got {type(models).__name__}"
    assert len(models) > 0, "models list should not be empty"

    model_ids = {m.get("id") for m in models if isinstance(m, dict)}
    # Primary coder and primary planner/reviewer per docs/AI_MODELS.md.
    assert (
        "opencode-go/minimax-m3" in model_ids
    ), f"MiniMax M3 (primary coder) missing from models: {model_ids}"
    assert (
        "opencode-go/deepseek-v4-flash" in model_ids
    ), f"DeepSeek V4 Flash (primary planner) missing from models: {model_ids}"


async def test_health_model_fields(client: AsyncClient) -> None:
    """Every entry in ``models`` has the pricing + endpoint fields the UI needs.

    Asserts (per model):
        * ``id`` — non-empty string used as the OpenCode Go model id
        * ``name`` — non-empty human-readable name
        * ``cost_input`` — numeric (int or float) USD per 1M input tokens
        * ``cost_output`` — numeric (int or float) USD per 1M output tokens
        * ``endpoint`` — one of ``"openai"`` or ``"anthropic"``; tells
          the UI which wire protocol the backend uses for this model
    """
    response = await client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    models = payload.get("models", [])

    assert models, "models list should not be empty"

    required_keys = {"id", "name", "cost_input", "cost_output", "endpoint"}
    valid_endpoints = {"openai", "anthropic"}
    for index, model in enumerate(models):
        assert isinstance(
            model, dict
        ), f"Model at index {index} is not a dict: {model!r}"
        missing = required_keys - model.keys()
        assert not missing, f"Model at index {index} missing keys {missing}: {model!r}"
        assert (
            isinstance(model["id"], str) and model["id"]
        ), f"Model id must be a non-empty string, got {model['id']!r}"
        assert (
            isinstance(model["name"], str) and model["name"]
        ), f"Model name must be a non-empty string, got {model['name']!r}"
        # isdigit/bool excluded; allow int or float. Negative cost would
        # also be wrong but the type check is the contract requirement.
        assert isinstance(model["cost_input"], (int, float)) and not isinstance(
            model["cost_input"], bool
        ), f"cost_input must be numeric, got {model['cost_input']!r}"
        assert isinstance(model["cost_output"], (int, float)) and not isinstance(
            model["cost_output"], bool
        ), f"cost_output must be numeric, got {model['cost_output']!r}"
        assert model["endpoint"] in valid_endpoints, (
            f"Model {model['id']!r} endpoint must be one of {valid_endpoints!r}, "
            f"got {model['endpoint']!r}"
        )
