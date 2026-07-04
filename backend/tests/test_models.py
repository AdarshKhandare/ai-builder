"""Tests for ``GET /api/models`` — model picker metadata endpoint.

These tests pin the public contract of the catalogue:

* The response is a 200 with a ``models`` array.
* The array contains the curated catalogue (9 entries).
* Every entry is priced, has a valid wire-protocol endpoint, and
  carries the prefixed OpenCode Go id the rest of the API uses.

The catalogue is a module-level constant on
:mod:`app.routes.models` and has no external dependencies, so no
mocking is required. The ``client`` fixture from ``conftest.py``
hands us an ``httpx.AsyncClient`` bound to the in-process ASGI app.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

# Expected catalogue size. Update this constant (and the catalogue in
# ``app/routes/models.py``) together when adding or removing a model.
EXPECTED_MODEL_COUNT: int = 9

# Wire protocols the backend knows how to speak. The backend
# ``OpenCodeClient`` keys its request shape off this string.
VALID_ENDPOINTS: frozenset[str] = frozenset({"openai", "anthropic"})

# The mandatory id prefix for every OpenCode Go model the backend
# accepts. Mirrors the regex on ``GenerateRequest.model`` and
# ``IterateRequest.model`` in ``app/models/schemas.py``.
MODEL_ID_PREFIX: str = "opencode-go/"


async def _get_models(client: AsyncClient) -> list[dict[str, Any]]:
    """Fetch ``/api/models`` and return the ``models`` list.

    Centralises the happy-path request shape so each test reads as a
    single assertion. Raises ``AssertionError`` on any deviation from
    the basic contract (status 200, ``models`` is a list); tests that
    care about specific fields add their own assertions on top.

    Args:
        client: The httpx async client bound to the ASGI app.

    Returns:
        The ``models`` list from the JSON response body. Empty if the
        key is present but the array is empty (callers handle that).
    """
    response = await client.get("/api/models")
    assert response.status_code == 200, (
        f"Expected 200 from /api/models, got {response.status_code}: "
        f"{response.text}"
    )
    payload: dict[str, Any] = response.json()
    assert isinstance(
        payload, dict
    ), f"Response body must be a JSON object, got {type(payload).__name__}"
    assert "models" in payload, f"Response missing 'models' key: {payload!r}"
    models = payload["models"]
    assert isinstance(
        models, list
    ), f"Expected 'models' to be a list, got {type(models).__name__}"
    return models


async def test_models_returns_list(client: AsyncClient) -> None:
    """``GET /api/models`` returns HTTP 200 with a ``models`` array.

    Asserts:
        * response status code is 200
        * JSON body is an object containing a ``models`` key
        * ``models`` is a list
    """
    models = await _get_models(client)
    # The list is allowed to be empty in principle (no contract forbids
    # a zero-length catalogue), but the Phase 4 build ships with models
    # so an empty list almost certainly means a regression.
    assert models, "models list should not be empty"


async def test_models_has_recommended(client: AsyncClient) -> None:
    """At least one model is flagged as ``recommended=true``.

    The model picker UI surfaces recommended models as the default
    selection. If none are marked recommended, the picker has no
    default to offer and the UX regresses.
    """
    models = await _get_models(client)

    recommended = [m for m in models if m.get("recommended") is True]
    assert recommended, (
        "Expected at least one model with recommended=true, got none "
        f"in {len(models)} entries"
    )


async def test_models_have_pricing(client: AsyncClient) -> None:
    """Every model has strictly positive input and output pricing.

    The StatusBar component uses these values to render per-generation
    cost estimates; a zero or negative price would either render
    ``$0.00`` or break the math. The schema allows ``>= 0`` (free
    tiers are conceivable), so this test enforces the stricter UI
    contract on top.
    """
    models = await _get_models(client)
    assert models, "models list should not be empty"

    for index, model in enumerate(models):
        model_id = model.get("id", f"<index {index}>")
        input_price = model.get("input_price_per_mtok")
        output_price = model.get("output_price_per_mtok")
        assert isinstance(input_price, (int, float)) and not isinstance(
            input_price, bool
        ), f"Model {model_id!r}: input_price_per_mtok must be numeric, got {input_price!r}"
        assert isinstance(output_price, (int, float)) and not isinstance(
            output_price, bool
        ), f"Model {model_id!r}: output_price_per_mtok must be numeric, got {output_price!r}"
        assert input_price > 0, (
            f"Model {model_id!r}: input_price_per_mtok must be > 0, "
            f"got {input_price!r}"
        )
        assert output_price > 0, (
            f"Model {model_id!r}: output_price_per_mtok must be > 0, "
            f"got {output_price!r}"
        )


async def test_models_have_valid_endpoints(client: AsyncClient) -> None:
    """Every model endpoint is ``"openai"`` or ``"anthropic"``.

    The ``OpenCodeClient`` keys its request shape off this string;
    an unknown endpoint would fall through to the default and fail
    at the HTTP layer. Pinning the vocabulary here means a future
    refactor that adds a third protocol will fail loudly.
    """
    models = await _get_models(client)
    assert models, "models list should not be empty"

    for index, model in enumerate(models):
        model_id = model.get("id", f"<index {index}>")
        endpoint = model.get("endpoint")
        assert endpoint in VALID_ENDPOINTS, (
            f"Model {model_id!r}: endpoint must be one of "
            f"{sorted(VALID_ENDPOINTS)!r}, got {endpoint!r}"
        )


async def test_models_count(client: AsyncClient) -> None:
    """The catalogue returns exactly :data:`EXPECTED_MODEL_COUNT` entries.

    Bumping the catalogue without updating this constant is a way to
    catch accidental drops (a model is removed and the picker silently
    loses an option) and accidental duplicates (a model is added twice
    in the catalogue definition).
    """
    models = await _get_models(client)
    assert len(models) == EXPECTED_MODEL_COUNT, (
        f"Expected {EXPECTED_MODEL_COUNT} models, got {len(models)}: "
        f"{[m.get('id') for m in models]!r}"
    )


async def test_models_ids_prefixed(client: AsyncClient) -> None:
    """Every model id starts with the ``opencode-go/`` prefix.

    The generate/iterate routes validate this prefix on incoming
    requests; a model in the catalogue whose id is missing the prefix
    would be advertised as a choice but rejected when the user
    actually picks it.
    """
    models = await _get_models(client)
    assert models, "models list should not be empty"

    for index, model in enumerate(models):
        model_id = model.get("id")
        assert isinstance(model_id, str) and model_id, (
            f"Model at index {index} has missing or non-string id: " f"{model_id!r}"
        )
        assert model_id.startswith(
            MODEL_ID_PREFIX
        ), f"Model id {model_id!r} must start with {MODEL_ID_PREFIX!r}"
