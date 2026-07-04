"""Tests for ``GET /api/models`` — model picker metadata endpoint.

These tests pin the public contract of the catalogue:

* The response is a 200 with a ``models`` array.
* The array contains the curated catalogue of 8 cheap models
  (deepseek-v4-flash, mimo-v2.5, minimax-m2.7, qwen3.6-plus,
  deepseek-v4-pro, minimax-m3, qwen3.7-plus, kimi-k2.6).
* Exactly one entry has ``is_default=True`` and it is
  ``opencode-go/deepseek-v4-flash`` — the cheapest capable model.
* Every entry is priced, has a valid wire-protocol endpoint, has a
  ``tier`` band (``"very-cheap"`` / ``"medium"`` / ``"upper-medium"``),
  and carries the prefixed OpenCode Go id the rest of the API uses.
* The response includes a top-level ``default_model_id`` pointer.

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
EXPECTED_MODEL_COUNT: int = 8

# The single model the frontend should pre-select. Mirrors
# ``_MODELS_CATALOGUE`` in ``app/routes/models.py``.
EXPECTED_DEFAULT_MODEL_ID: str = "opencode-go/deepseek-v4-flash"

# Wire protocols the backend knows how to speak. The backend
# ``OpenCodeClient`` keys its request shape off this string.
VALID_ENDPOINTS: frozenset[str] = frozenset({"openai", "anthropic"})

# Pricing bands the picker groups models into.
VALID_TIERS: frozenset[str] = frozenset({"very-cheap", "medium", "upper-medium"})

# The mandatory id prefix for every OpenCode Go model the backend
# accepts. Mirrors the regex on ``GenerateRequest.model`` and
# ``IterateRequest.model`` in ``app/models/schemas.py``.
MODEL_ID_PREFIX: str = "opencode-go/"


async def _get_response(client: AsyncClient) -> dict[str, Any]:
    """Fetch ``/api/models`` and return the parsed JSON body.

    Centralises the happy-path request shape so each test reads as a
    single assertion. Raises ``AssertionError`` on any deviation
    from the basic contract (status 200, body is an object); tests
    that care about specific fields add their own assertions on top.

    Args:
        client: The httpx async client bound to the ASGI app.

    Returns:
        The parsed JSON body of the response.
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
    return payload


async def _get_models(client: AsyncClient) -> list[dict[str, Any]]:
    """Return the ``models`` list from ``/api/models``.

    Args:
        client: The httpx async client bound to the ASGI app.

    Returns:
        The ``models`` list from the JSON response body. Empty if
        the key is present but the array is empty.
    """
    payload = await _get_response(client)
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
    # The list is allowed to be empty in principle (no contract
    # forbids a zero-length catalogue), but the Phase 4 build ships
    # with models so an empty list almost certainly means a
    # regression.
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

    The StatusBar component uses these values to render per-
    generation cost estimates; a zero or negative price would
    either render ``$0.00`` or break the math. The schema allows
    ``>= 0`` (free tiers are conceivable), so this test enforces
    the stricter UI contract on top.
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
    catch accidental drops (a model is removed and the picker
    silently loses an option) and accidental duplicates (a model
    is added twice in the catalogue definition).
    """
    models = await _get_models(client)
    assert len(models) == EXPECTED_MODEL_COUNT, (
        f"Expected {EXPECTED_MODEL_COUNT} models, got {len(models)}: "
        f"{[m.get('id') for m in models]!r}"
    )


async def test_models_ids_prefixed(client: AsyncClient) -> None:
    """Every model id starts with the ``opencode-go/`` prefix.

    The generate/iterate routes validate this prefix on incoming
    requests; a model in the catalogue whose id is missing the
    prefix would be advertised as a choice but rejected when the
    user actually picks it.
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


async def test_models_have_tier(client: AsyncClient) -> None:
    """Every model has a ``tier`` field in the closed vocabulary.

    The picker groups and sorts models by tier (``"very-cheap"`` /
    ``"medium"`` / ``"upper-medium"``). An entry with a missing or
    unknown tier would break the sort. Mirrors the
    :class:`~app.routes.models.TierType` literal.
    """
    models = await _get_models(client)
    assert models, "models list should not be empty"

    for index, model in enumerate(models):
        model_id = model.get("id", f"<index {index}>")
        tier = model.get("tier")
        assert tier in VALID_TIERS, (
            f"Model {model_id!r}: tier must be one of "
            f"{sorted(VALID_TIERS)!r}, got {tier!r}"
        )


async def test_models_exactly_one_default(client: AsyncClient) -> None:
    """Exactly one model has ``is_default=True`` and it is the V4 Flash.

    The frontend pre-selects this model on first load. Multiple
    defaults would break the picker; zero defaults would leave
    the user with no selection.
    """
    models = await _get_models(client)
    assert models, "models list should not be empty"

    defaults = [m for m in models if m.get("is_default") is True]
    assert len(defaults) == 1, (
        f"Expected exactly one model with is_default=true, found "
        f"{len(defaults)}: {[m.get('id') for m in defaults]!r}"
    )
    assert defaults[0].get("id") == EXPECTED_DEFAULT_MODEL_ID, (
        f"Expected default model id {EXPECTED_DEFAULT_MODEL_ID!r}, "
        f"got {defaults[0].get('id')!r}"
    )


async def test_models_response_includes_default_model_id(
    client: AsyncClient,
) -> None:
    """The top-level ``default_model_id`` matches the is_default entry.

    The frontend can read the default directly off the response
    envelope without scanning the array.
    """
    payload = await _get_response(client)
    assert (
        "default_model_id" in payload
    ), f"Response missing top-level 'default_model_id': {payload!r}"
    assert payload["default_model_id"] == EXPECTED_DEFAULT_MODEL_ID, (
        f"Expected default_model_id={EXPECTED_DEFAULT_MODEL_ID!r}, "
        f"got {payload['default_model_id']!r}"
    )
