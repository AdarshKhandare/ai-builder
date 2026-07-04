"""``GET /api/models`` — model picker metadata for the Forge builder UI.

Returns the full catalogue of OpenCode Go models the backend can route
to, along with the pricing and metadata the frontend model picker needs
to show cost estimates and highlight recommended choices. This is a
read-only, static endpoint — it does not call the OpenCode Go API; the
catalogue is a module-level constant so the response is deterministic
and survives an OpenCode outage.

Relationship to :mod:`app.routes.health`
----------------------------------------
``/api/health`` also exposes a ``models`` array, but its entries are
deliberately minimal (id, name, cost_input, cost_output, endpoint) and
its pricing data predates the model's richer picker metadata. The two
endpoints are intentionally separate so the health payload can stay
small and stable while ``/api/models`` evolves with the picker. The
``endpoint`` field is the single shared contract — it MUST match the
value in :data:`app.routes.health.AVAILABLE_MODELS` for any given id.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

# Closed vocabularies for the ``endpoint`` and ``role`` fields. Exposed
# as module-level ``Literal`` aliases so the same set is used by the
# schema and by any future consumer (e.g. a typed client in another
# service).
EndpointType = Literal["openai", "anthropic"]
RoleType = Literal["coder", "planner", "both"]


class ModelInfo(BaseModel):
    """Metadata for a single AI model surfaced by ``GET /api/models``.

    The shape is the public wire format the frontend model picker
    consumes. Every field is required; the schema rejects partial
    entries at validation time so the catalogue cannot drift into an
    inconsistent state.

    Attributes:
        id: OpenCode Go model identifier in prefixed form
            (e.g. ``opencode-go/minimax-m3``). Matches the values
            accepted by ``POST /api/generate`` and ``POST /api/iterate``
            and the ``id`` field in
            :data:`app.routes.health.AVAILABLE_MODELS`.
        name: Human-readable model name shown in the picker header.
        provider: Vendor name in lowercase (e.g. ``"minimax"``,
            ``"deepseek"``, ``"kimi"``, ``"qwen"``, ``"mimo"``,
            ``"glm"``). Drives grouping/filtering in the UI.
        endpoint: Wire protocol the backend uses when calling this
            model. ``"openai"`` for OpenAI-compatible chat completions,
            ``"anthropic"`` for the Anthropic Messages API. MUST match
            the ``endpoint`` field for the same id in
            :data:`app.routes.health.AVAILABLE_MODELS`.
        role: Intended use in the planner->coder pipeline.
            ``"coder"`` for code generation only, ``"planner"`` for
            planning/reviewing only, ``"both"`` for models suited to
            either step.
        input_price_per_mtok: Cost in USD per 1 000 000 input tokens.
            Bounded below by zero (free tiers are permitted by the
            schema; the picker itself filters on ``> 0``).
        output_price_per_mtok: Cost in USD per 1 000 000 output
            tokens. Same lower bound as ``input_price_per_mtok``.
        context_window: Maximum context length in tokens. Must be
            strictly positive.
        recommended: ``True`` for models the UI should surface as a
            default. The catalogue is expected to mark at least one
            model recommended — see
            :func:`list_models` for the order contract.
        description: One-line tagline shown beneath the model name
            in the picker. Non-empty.
    """

    id: str = Field(
        pattern=r"^opencode-go/[a-z0-9._-]+$",
        description="OpenCode Go model id in prefixed form.",
    )
    name: str = Field(
        min_length=1,
        description="Human-readable model name.",
    )
    provider: str = Field(
        min_length=1,
        description="Lowercase vendor name (e.g. 'minimax', 'deepseek').",
    )
    endpoint: EndpointType = Field(
        description='Wire protocol: "openai" or "anthropic".',
    )
    role: RoleType = Field(
        description='Pipeline role: "coder", "planner", or "both".',
    )
    input_price_per_mtok: float = Field(
        ge=0,
        description="USD per 1M input tokens.",
    )
    output_price_per_mtok: float = Field(
        ge=0,
        description="USD per 1M output tokens.",
    )
    context_window: int = Field(
        gt=0,
        description="Maximum context length in tokens.",
    )
    recommended: bool = Field(
        description="True for the default/recommended models.",
    )
    description: str = Field(
        min_length=1,
        description="One-line description for the model picker.",
    )


class ModelsResponse(BaseModel):
    """Response body for ``GET /api/models``.

    Wraps the model list in an object (rather than returning a bare
    JSON array) so the response can grow new top-level fields — e.g. a
    default-model pointer or a generation-time-stamp — without breaking
    the public contract.

    Attributes:
        models: Ordered list of all models available to the backend.
            The order is stable across calls: recommended models
            first (preserving their relative order), then the rest
            in catalogue order. Frontends can rely on the index to
            default-select the first recommended entry.
    """

    models: list[ModelInfo] = Field(
        description="All models available to /api/generate and /api/iterate.",
    )


# Source of truth for the model picker catalogue. Order matters: the
# first two entries are the recommended defaults (the picker
# default-selects the first entry) and the rest follow in a fixed,
# human-curated order. Pricing in USD per 1M tokens, sourced from the
# OpenCode Go pricing page. Endpoint types cross-checked against
# :data:`app.routes.health.AVAILABLE_MODELS` — they MUST match.
_MODELS_CATALOGUE: tuple[ModelInfo, ...] = (
    ModelInfo(
        id="opencode-go/minimax-m3",
        name="MiniMax M3",
        provider="minimax",
        endpoint="anthropic",
        role="coder",
        input_price_per_mtok=0.30,
        output_price_per_mtok=1.20,
        context_window=200000,
        recommended=True,
        description="Best cost/quality — primary coder",
    ),
    ModelInfo(
        id="opencode-go/deepseek-v4-flash",
        name="DeepSeek V4 Flash",
        provider="deepseek",
        endpoint="openai",
        role="planner",
        input_price_per_mtok=0.14,
        output_price_per_mtok=0.28,
        context_window=128000,
        recommended=True,
        description="Cheapest — planner & reviewer",
    ),
    ModelInfo(
        id="opencode-go/deepseek-v4-pro",
        name="DeepSeek V4 Pro",
        provider="deepseek",
        endpoint="openai",
        role="both",
        input_price_per_mtok=1.74,
        output_price_per_mtok=3.48,
        context_window=128000,
        recommended=False,
        description="Highest quality, higher cost",
    ),
    ModelInfo(
        id="opencode-go/kimi-k2.6",
        name="Kimi K2.6",
        provider="kimi",
        endpoint="openai",
        role="both",
        input_price_per_mtok=1.20,
        output_price_per_mtok=4.80,
        context_window=256000,
        recommended=False,
        description="Strong reasoning, long context",
    ),
    ModelInfo(
        id="opencode-go/qwen3.7-plus",
        name="Qwen3.7 Plus",
        provider="qwen",
        endpoint="anthropic",
        role="both",
        input_price_per_mtok=0.60,
        output_price_per_mtok=2.40,
        context_window=131072,
        recommended=False,
        description="Versatile mid-cost reasoning",
    ),
    ModelInfo(
        id="opencode-go/mimo-v2.5-pro",
        name="MiMo V2.5 Pro",
        provider="mimo",
        endpoint="openai",
        role="both",
        input_price_per_mtok=1.74,
        output_price_per_mtok=3.48,
        context_window=128000,
        recommended=False,
        description="Cost-effective maintenance",
    ),
    ModelInfo(
        id="opencode-go/glm-5.2",
        name="GLM-5.2",
        provider="glm",
        endpoint="openai",
        role="both",
        input_price_per_mtok=0.50,
        output_price_per_mtok=2.00,
        context_window=128000,
        recommended=False,
        description="Strong general reasoning",
    ),
    ModelInfo(
        id="opencode-go/mimo-v2.5",
        name="MiMo V2.5",
        provider="mimo",
        endpoint="openai",
        role="both",
        input_price_per_mtok=0.20,
        output_price_per_mtok=0.80,
        context_window=128000,
        recommended=False,
        description="Lowest cost generation",
    ),
    ModelInfo(
        id="opencode-go/qwen3.7-max",
        name="Qwen3.7 Max",
        provider="qwen",
        endpoint="anthropic",
        role="both",
        input_price_per_mtok=2.50,
        output_price_per_mtok=10.00,
        context_window=131072,
        recommended=False,
        description="Highest reasoning, premium cost",
    ),
)


@router.get("/api/models", response_model=ModelsResponse)
async def list_models() -> ModelsResponse:
    """Return the catalogue of AI models available to the backend.

    Powers the model picker in the Forge builder UI. The response is
    static for the lifetime of the process — the catalogue is a
    module-level constant — so the endpoint is safe to call on every
    page load with no caching concerns beyond the standard CDN layer.

    The response includes pricing (USD per 1M input/output tokens),
    a ``recommended`` flag, and a one-line ``description`` for each
    model so the picker can render cost estimates and default
    selections without a second round-trip.

    Returns:
        :class:`ModelsResponse` wrapping the ordered list of
        :class:`ModelInfo` entries. The first two entries are the
        recommended defaults (MiniMax M3, DeepSeek V4 Flash).
    """
    # ``_MODELS_CATALOGUE`` is already a tuple of validated
    # ``ModelInfo`` instances (validated at import time). We materialise
    # a list for the response model so the tuple is not exposed
    # directly to callers.
    return ModelsResponse(models=list(_MODELS_CATALOGUE))
