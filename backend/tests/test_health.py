"""Tests for the ``GET /api/health`` endpoint.

These tests verify Phase 1 acceptance criteria plus the Phase 3
hardening:

* ``GET /api/health`` returns 200 with ``{"status": "ok", "models": [...]}``.
* The ``models`` list advertises the curated 8 cheap models.
* Every entry in ``models`` carries the pricing fields, the
  ``endpoint`` field, the ``tier`` band, and the ``is_default``
  boolean the UI needs to render the picker.

The endpoint has no external dependencies, so no mocking is required.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

# Pricing bands the picker groups models into. Mirrors
# ``TierType`` in ``app/routes/models.py``.
_VALID_TIERS: frozenset[str] = frozenset({"very-cheap", "medium", "upper-medium"})

# The single model the frontend should pre-select.
_DEFAULT_MODEL_ID: str = "opencode-go/deepseek-v4-flash"

# Number of cheap models in the curated catalogue.
_EXPECTED_MODEL_COUNT: int = 8


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
    """``GET /api/health`` advertises the curated 8 cheap models.

    Asserts:
        * ``models`` key exists and is a non-empty list
        * The catalogue contains exactly 8 entries
        * DeepSeek V4 Flash is the pre-selected default
        * MiniMax M3 (primary coder) is present
    """
    response = await client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()

    assert "models" in payload, f"Response missing 'models' key: {payload!r}"
    models = payload["models"]
    assert isinstance(models, list), f"Expected list, got {type(models).__name__}"
    assert len(models) == _EXPECTED_MODEL_COUNT, (
        f"Expected {_EXPECTED_MODEL_COUNT} models, got {len(models)}: "
        f"{[m.get('id') for m in models]!r}"
    )

    model_ids = {m.get("id") for m in models if isinstance(m, dict)}
    # Primary coder and the default model.
    assert (
        "opencode-go/minimax-m3" in model_ids
    ), f"MiniMax M3 (primary coder) missing from models: {model_ids}"
    assert (
        _DEFAULT_MODEL_ID in model_ids
    ), f"Default model {_DEFAULT_MODEL_ID!r} missing from models: {model_ids}"

    defaults = [m for m in models if m.get("is_default") is True]
    assert len(defaults) == 1, (
        f"Expected exactly one model with is_default=true, found "
        f"{len(defaults)}: {[m.get('id') for m in defaults]!r}"
    )
    assert defaults[0].get("id") == _DEFAULT_MODEL_ID, (
        f"Expected default model {_DEFAULT_MODEL_ID!r}, "
        f"got {defaults[0].get('id')!r}"
    )


async def test_health_model_fields(client: AsyncClient) -> None:
    """Every entry in ``models`` has the required wire-format fields.

    Asserts (per model):
        * ``id`` — non-empty string used as the OpenCode Go model id
        * ``name`` — non-empty human-readable name
        * ``cost_input`` — numeric (int or float) USD per 1M input
          tokens
        * ``cost_output`` — numeric (int or float) USD per 1M output
          tokens
        * ``endpoint`` — one of ``"openai"`` or ``"anthropic"``
        * ``tier`` — one of the closed ``_VALID_TIERS`` vocabulary
        * ``is_default`` — boolean
    """
    response = await client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    models = payload.get("models", [])

    assert models, "models list should not be empty"

    required_keys = {
        "id",
        "name",
        "cost_input",
        "cost_output",
        "endpoint",
        "tier",
        "is_default",
    }
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
        # isdigit/bool excluded; allow int or float. Negative cost
        # would also be wrong but the type check is the contract
        # requirement.
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
        assert model["tier"] in _VALID_TIERS, (
            f"Model {model['id']!r} tier must be one of "
            f"{sorted(_VALID_TIERS)!r}, got {model['tier']!r}"
        )
        assert isinstance(model["is_default"], bool), (
            f"Model {model['id']!r} is_default must be a bool, "
            f"got {type(model['is_default']).__name__}"
        )
