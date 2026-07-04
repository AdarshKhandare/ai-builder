"""``GET /api/models`` — model picker metadata for the Forge builder UI.

Returns the full catalogue of OpenCode Go models the backend can route
to, along with the pricing and metadata the frontend model picker needs
to show cost estimates and highlight the default selection. This is a
read-only, static endpoint — it does not call the OpenCode Go API; the
catalogue is a module-level constant so the response is deterministic
and survives an OpenCode outage.

Relationship to :mod:`app.routes.health`
----------------------------------------
``/api/health`` also exposes a ``models`` array, but its entries are
deliberately minimal (id, name, cost_input, cost_output, endpoint,
tier, is_default) and its pricing data predates the model's richer
picker metadata. The two endpoints are intentionally separate so the
health payload can stay small and stable while ``/api/models`` evolves
with the picker. The ``endpoint`` and ``id`` fields are the shared
contract — they MUST match the values in
:data:`app.routes.health.AVAILABLE_MODELS` for any given id.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

# Closed vocabularies for the ``endpoint``, ``role``, and ``tier``
# fields. Exposed as module-level ``Literal`` aliases so the same
# set is used by the schema and by any future consumer (e.g. a
# typed client in another service).
EndpointType = Literal["openai", "anthropic"]
RoleType = Literal["coder", "planner", "both"]
TierType = Literal["very-cheap", "medium", "upper-medium"]


class ModelInfo(BaseModel):
    """Metadata for a single AI model surfaced by ``GET /api/models``.

    The shape is the public wire format the frontend model picker
    consumes. Every field is required; the schema rejects partial
    entries at validation time so the catalogue cannot drift into an
    inconsistent state.

    Attributes:
        id: OpenCode Go model identifier in prefixed form
            (e.g. ``opencode-go/deepseek-v4-flash``). Matches the
            values accepted by ``POST /api/generate`` and
            ``POST /api/iterate`` and the ``id`` field in
            :data:`app.routes.health.AVAILABLE_MODELS`.
        name: Human-readable model name shown in the picker header.
        provider: Vendor name in lowercase (e.g. ``"deepseek"``,
            ``"minimax"``, ``"kimi"``, ``"qwen"``, ``"mimo"``).
            Drives grouping/filtering in the UI.
        endpoint: Wire protocol the backend uses when calling this
            model. ``"openai"`` for OpenAI-compatible chat
            completions, ``"anthropic"`` for the Anthropic Messages
            API. MUST match the ``endpoint`` field for the same id
            in :data:`app.routes.health.AVAILABLE_MODELS`.
        role: Intended use in the planner->coder pipeline.
            ``"coder"`` for code generation only, ``"planner"`` for
            planning/reviewing only, ``"both"`` for models suited to
            either step.
        tier: Pricing band. ``"very-cheap"`` ($0.14 / $0.28 per 1M),
            ``"medium"`` ($0.30-$1.74 / $1.20-$3.48 per 1M), or
            ``"upper-medium"`` ($0.30-$0.95 / $1.20-$4.00 per 1M).
            Drives sort order in the picker (cheap to expensive).
        input_price_per_mtok: Cost in USD per 1 000 000 input
            tokens. Bounded below by zero.
        output_price_per_mtok: Cost in USD per 1 000 000 output
            tokens. Same lower bound as ``input_price_per_mtok``.
        context_window: Maximum context length in tokens. Must be
            strictly positive.
        recommended: ``True`` for models the UI should surface as a
            default. The catalogue is expected to mark at least one
            model recommended.
        is_default: ``True`` for exactly one model — the
            pre-selected default in the picker. Currently
            ``opencode-go/deepseek-v4-flash`` (the cheapest capable
            model on the catalogue).
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
        description="Lowercase vendor name (e.g. 'deepseek', 'minimax').",
    )
    endpoint: EndpointType = Field(
        description='Wire protocol: "openai" or "anthropic".',
    )
    role: RoleType = Field(
        description='Pipeline role: "coder", "planner", or "both".',
    )
    tier: TierType = Field(
        description=('Pricing band: "very-cheap", "medium", or "upper-medium".'),
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
    is_default: bool = Field(
        description=("True for exactly one model — the pre-selected default."),
    )
    description: str = Field(
        min_length=1,
        description="One-line description for the model picker.",
    )


class ModelsResponse(BaseModel):
    """Response body for ``GET /api/models``.

    Wraps the model list in an object (rather than returning a bare
    JSON array) so the response can grow new top-level fields — e.g.
    a default-model pointer or a generation-time-stamp — without
    breaking the public contract.

    Attributes:
        models: Ordered list of all models available to the backend.
            The order is stable across calls: cheapest tier first
            (preserving the relative order within a tier), then
            medium, then upper-medium. Frontends can rely on the
            index to default-select the entry with
            ``is_default == True``.
        default_model_id: Convenience pointer to the id of the
            catalogue's default model. Always equal to
            ``models[i].id`` for the entry with ``is_default=True``.
            Exposed at the top level so the frontend can read the
            default without scanning the list.
    """

    models: list[ModelInfo] = Field(
        description="All models available to /api/generate and /api/iterate.",
    )
    default_model_id: str = Field(
        description=(
            "Id of the catalogue's default model "
            "(models[i].id where is_default == True)."
        ),
    )


# Source of truth for the model picker catalogue — the curated set
# of 8 cheap OpenCode Go models. Order matters: the list is
# pre-sorted cheap-to-expensive, and exactly one entry has
# ``is_default=True``. Pricing in USD per 1M tokens, sourced from
# the OpenCode Go pricing page. Endpoint types cross-checked
# against :data:`app.routes.health.AVAILABLE_MODELS` — they MUST
# match for any given id.
_MODELS_CATALOGUE: tuple[ModelInfo, ...] = (
    ModelInfo(
        id="opencode-go/deepseek-v4-flash",
        name="DeepSeek V4 Flash",
        provider="deepseek",
        endpoint="openai",
        role="both",
        tier="very-cheap",
        input_price_per_mtok=0.14,
        output_price_per_mtok=0.28,
        context_window=128000,
        recommended=True,
        is_default=True,
        description="Cheapest capable — default planner & coder",
    ),
    ModelInfo(
        id="opencode-go/mimo-v2.5",
        name="MiMo V2.5",
        provider="mimo",
        endpoint="openai",
        role="both",
        tier="very-cheap",
        input_price_per_mtok=0.14,
        output_price_per_mtok=0.28,
        context_window=128000,
        recommended=True,
        is_default=False,
        description="Cheapest — fast low-cost generation",
    ),
    ModelInfo(
        id="opencode-go/minimax-m2.7",
        name="MiniMax M2.7",
        provider="minimax",
        endpoint="anthropic",
        role="coder",
        tier="medium",
        input_price_per_mtok=0.30,
        output_price_per_mtok=1.20,
        context_window=200000,
        recommended=False,
        is_default=False,
        description="Cost-effective Anthropic coder",
    ),
    ModelInfo(
        id="opencode-go/qwen3.6-plus",
        name="Qwen3.6 Plus",
        provider="qwen",
        endpoint="anthropic",
        role="both",
        tier="medium",
        input_price_per_mtok=0.50,
        output_price_per_mtok=3.00,
        context_window=131072,
        recommended=False,
        is_default=False,
        description="Versatile mid-cost Anthropic reasoning",
    ),
    ModelInfo(
        id="opencode-go/deepseek-v4-pro",
        name="DeepSeek V4 Pro",
        provider="deepseek",
        endpoint="openai",
        role="both",
        tier="medium",
        input_price_per_mtok=1.74,
        output_price_per_mtok=3.48,
        context_window=128000,
        recommended=False,
        is_default=False,
        description="Higher quality, higher cost",
    ),
    ModelInfo(
        id="opencode-go/minimax-m3",
        name="MiniMax M3",
        provider="minimax",
        endpoint="anthropic",
        role="coder",
        tier="upper-medium",
        input_price_per_mtok=0.30,
        output_price_per_mtok=1.20,
        context_window=200000,
        recommended=False,
        is_default=False,
        description="Best cost/quality — primary coder",
    ),
    ModelInfo(
        id="opencode-go/qwen3.7-plus",
        name="Qwen3.7 Plus",
        provider="qwen",
        endpoint="anthropic",
        role="both",
        tier="upper-medium",
        input_price_per_mtok=0.40,
        output_price_per_mtok=1.60,
        context_window=131072,
        recommended=False,
        is_default=False,
        description="Versatile mid-cost reasoning",
    ),
    ModelInfo(
        id="opencode-go/kimi-k2.6",
        name="Kimi K2.6",
        provider="kimi",
        endpoint="openai",
        role="both",
        tier="upper-medium",
        input_price_per_mtok=0.95,
        output_price_per_mtok=4.00,
        context_window=256000,
        recommended=False,
        is_default=False,
        description="Strong reasoning, long context",
    ),
)


def _resolve_default_id(catalogue: tuple[ModelInfo, ...]) -> str:
    """Return the id of the catalogue entry with ``is_default=True``.

    Defensive lookup: there must be exactly one such entry. The
    catalogue is constructed at import time and pinned by tests, so
    a violation is a programming error — we raise ``ValueError``
    with a clear message rather than silently picking the first
    match.

    Args:
        catalogue: The catalogue tuple to scan.

    Returns:
        The ``id`` of the entry with ``is_default=True``.

    Raises:
        ValueError: If zero or multiple entries have
            ``is_default=True``.
    """
    defaults = [m for m in catalogue if m.is_default]
    if len(defaults) != 1:
        raise ValueError(f"Expected exactly one default model, found {len(defaults)}")
    return defaults[0].id


# Resolved at import time so the wire contract is consistent across
# requests. Raises on a broken catalogue — fail fast at startup.
_DEFAULT_MODEL_ID: str = _resolve_default_id(_MODELS_CATALOGUE)


@router.get("/api/models", response_model=ModelsResponse)
async def list_models() -> ModelsResponse:
    """Return the catalogue of AI models available to the backend.

    Powers the model picker in the Forge builder UI. The response is
    static for the lifetime of the process — the catalogue is a
    module-level constant — so the endpoint is safe to call on every
    page load with no caching concerns beyond the standard CDN layer.

    The response includes pricing (USD per 1M input/output tokens),
    a ``tier`` band, an ``is_default`` flag, a ``recommended`` flag,
    and a one-line ``description`` for each model so the picker can
    render cost estimates and default selections without a second
    round-trip.

    Returns:
        :class:`ModelsResponse` wrapping the ordered list of
        :class:`ModelInfo` entries plus a top-level
        ``default_model_id`` pointer. The list is pre-sorted
        cheap-to-expensive; ``deepseek-v4-flash`` is the default.
    """
    return ModelsResponse(
        models=list(_MODELS_CATALOGUE),
        default_model_id=_DEFAULT_MODEL_ID,
    )
