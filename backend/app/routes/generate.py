"""POST /api/generate — streaming SSE endpoint for the builder.

Orchestrates the planner -> coder pipeline and streams the result back
to the frontend over Server-Sent Events (SSE). The response is
``text/event-stream`` with a sequence of JSON-encoded event frames; see
:func:`_sse` and the module docstring of ``app.services.opencode_client``
for the on-the-wire format.

The frontend parses each ``data:`` line as JSON and dispatches on the
``type`` field. See ``docs/PHASES.md`` Phase 3 for the consumer
contract.

Authentication
--------------
The endpoint is gated by :func:`app.routes.deps.get_current_user`
(must have a valid ``forge_token`` JWT cookie) and the
per-user daily generation cap is enforced by
:func:`app.routes.deps.check_usage_quota` (default: 5
generations per user per UTC day).
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.coder import generate_code
from app.agents.planner import create_plan
from app.config import settings
from app.models.database import get_db
from app.routes.deps import (
    DAILY_LIMITS,
    User,
    check_usage_quota,
    get_current_user,
)
from app.services.opencode_client import OpenCodeAPIError, OpenCodeClient

logger = logging.getLogger(__name__)

router = APIRouter()


# Maximum length of an extracted project title. The planner is instructed
# to produce 2-5 word titles, but we cap defensively in case the model
# returns a longer string.
_MAX_TITLE_LENGTH = 100

# Fallback title used when the planner's response does not start with the
# expected ``Title: <title>`` line. The frontend (TopBar) treats this as
# the "no title yet" state.
_DEFAULT_TITLE = "Untitled"


class GenerateRequest(BaseModel):
    """Request body for ``POST /api/generate``.

    Attributes:
        prompt: Natural-language description of the app the user wants.
        model: OpenCode Go model identifier used for the code-generation
            step. Defaults to ``opencode-go/deepseek-v4-flash`` — the
            cheapest capable model on the curated catalogue, also the
            default in the model picker.
    """

    prompt: str = Field(
        min_length=1,
        max_length=10000,
        description="Natural-language app description from the user.",
    )
    model: str = Field(
        default="opencode-go/deepseek-v4-flash",
        pattern=r"^opencode-go/[a-z0-9._-]+$",
        description="OpenCode Go model identifier to use for code generation.",
    )


def _sse(payload: dict[str, Any]) -> str:
    """Format a dict as a single Server-Sent Event frame.

    Each frame is ``data: <json>\\n\\n`` — the trailing blank line is the
    SSE event terminator.
    """
    return f"data: {json.dumps(payload)}\n\n"


# Quota dependency — thin wrapper around
# :func:`app.routes.deps.check_usage_quota` that re-declares the
# ``Depends``-injected ``user`` / ``db`` parameters and forwards
# them along with the static ``endpoint`` / ``daily_limit``
# values. A :func:`functools.partial` would be terser but
# FastAPI's dependency introspection cannot see the original
# signature through a ``partial`` object, so the explicit
# wrapper is the working form.
async def _generate_quota(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> tuple[User, AsyncSession]:
    """Enforce the per-user generation daily cap."""
    return await check_usage_quota(
        endpoint="generate",
        daily_limit=DAILY_LIMITS["generate"],
        user=user,
        db=db,
    )


def _extract_title(plan: str) -> tuple[str, str]:
    """Extract the project title from the first line of ``plan``.

    The planner is instructed to start its response with
    ``"Title: <title>"`` on line 1, followed by the rest of the build
    plan on subsequent lines. This function parses that format and
    returns the title and plan body separately so the route can emit
    the title as its own SSE event and pass only the plan body to the
    coder.

    Behaviour:

    * If the first non-empty line starts with ``"Title:"`` (case
      insensitive), everything after that prefix is taken as the title.
      Surrounding whitespace and a single layer of matching quote
      characters is stripped, and the result is capped at
      :data:`_MAX_TITLE_LENGTH` characters.
    * If the prefix is missing or the title is empty, ``_DEFAULT_TITLE``
      (``"Untitled"``) is returned. The full plan text is returned as
      the plan body unchanged so the coder still gets a usable spec.
    * If the plan is empty, the title defaults to ``_DEFAULT_TITLE`` and
      the plan body is the empty string.

    Args:
        plan: Raw planner output, possibly starting with a
            ``"Title: ..."`` line.

    Returns:
        A ``(title, plan_body)`` tuple. ``title`` is always a non-empty
        string (capped, trimmed, default when missing). ``plan_body`` is
        the planner output with the title line removed and the
        surrounding whitespace stripped; if the title line was the only
        content, this is the empty string.
    """
    title = _DEFAULT_TITLE
    plan_body = plan

    if not plan:
        return title, ""

    lines = plan.strip().split("\n", 1)
    first_line = lines[0].strip() if lines else ""
    if first_line.lower().startswith("title:"):
        candidate = first_line[len("title:") :].strip()
        # Strip a single layer of matching quotes some models add
        # ("Title: \"My App\""). We deliberately don't strip mixed
        # quotes — a leading quote with no matching close is treated as
        # part of the title.
        if (
            len(candidate) >= 2
            and candidate[0] == candidate[-1]
            and candidate[0] in ('"', "'")
        ):
            candidate = candidate[1:-1].strip()
        candidate = candidate[:_MAX_TITLE_LENGTH].strip()
        if candidate:
            title = candidate
        plan_body = lines[1].strip() if len(lines) > 1 else ""

    return title, plan_body


@router.post("/api/generate")
async def generate(
    request: GenerateRequest,
    _quota: Annotated[tuple, Depends(_generate_quota)],
) -> StreamingResponse:
    """Run the planner -> coder pipeline and stream the result as SSE.

    The event sequence is:

    1. ``{"type": "status", "content": "planning"}`` — planner started.
    2. ``{"type": "title", "content": "<project title>"}`` — extracted
       from the first line of the planner's output. The frontend uses
       this to populate the TopBar's project title. Falls back to
       ``"Untitled"`` if the planner did not emit a ``Title:`` line.
    3. ``{"type": "status", "content": "generating"}`` — coder started.
    4. One or more ``{"type": "code", "content": "<chunk>"}`` — streamed
       HTML tokens from the coder.
    5. ``{"type": "done"}`` — successful completion.
    6. On failure: ``{"type": "error", "message": "<msg>"}`` — any
       uncaught exception is converted to an error event so the frontend
       can render a meaningful error message.

    The endpoint requires a valid ``forge_token`` cookie (via
    :func:`app.routes.deps.get_current_user`) and is rate-limited
    to 5 generations per user per UTC day (via
    :func:`app.routes.deps.check_usage_quota`). The quota event is
    inserted on dependency resolution, before the SSE response
    starts, so a 429 from the quota gate is the only
    non-streaming error the caller sees — every failure past
    that point arrives inside the stream as an ``error`` event.
    """

    async def event_generator() -> AsyncGenerator[str, None]:
        """Stream SSE frames for a single ``/api/generate`` request.

        The ``OpenCodeClient`` is created per-request and always closed
        in the ``finally`` block — even on client disconnect or
        exceptions — so that the underlying ``httpx.AsyncClient``
        connection pool is always released.
        """
        client: OpenCodeClient | None = None
        try:
            client = OpenCodeClient(
                api_key=settings.OPENCODE_API_KEY,
                base_url=settings.OPENCODE_BASE_URL,
            )
            yield _sse({"type": "status", "content": "planning"})
            plan = await create_plan(request.prompt, client)

            # Extract the project title from the first line of the plan
            # and pass only the plan body to the coder. The title is
            # surfaced to the frontend as its own SSE event so the
            # TopBar can update immediately, well before the (much
            # larger) code stream finishes.
            title, plan_body = _extract_title(plan)
            yield _sse({"type": "title", "content": title})
            yield _sse({"type": "status", "content": "generating"})
            async for chunk in generate_code(plan_body, client, request.model):
                yield _sse({"type": "code", "content": chunk})
            yield _sse({"type": "done"})
        # Catch broadly: SSE responses can't propagate exceptions to
        # FastAPI's normal error handler (the response is already
        # streaming), so we convert any failure into an error frame.
        except OpenCodeAPIError as exc:
            logger.exception("OpenCode API error during generation")
            yield _sse(
                {
                    "type": "error",
                    "message": f"AI model error (status {exc.status_code})",
                }
            )
        except Exception:  # noqa: BLE001
            logger.exception("Error during generation")
            yield _sse(
                {
                    "type": "error",
                    "message": "An unexpected error occurred during generation",
                }
            )
        finally:
            if client is not None:
                try:
                    await client.close()
                except Exception:
                    logger.warning("Failed to close OpenCodeClient", exc_info=True)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            # Disable proxy buffering so chunks reach the browser immediately.
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
