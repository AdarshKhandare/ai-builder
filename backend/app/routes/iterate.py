"""POST /api/iterate — chat-style iteration on an existing generated app.

Phase 4 of the build plan: the user has a working app (from
``/api/generate`` or a previous ``/api/iterate`` call) and wants a small
change ("add a delete button", "make the background dark", "rename the
title to 'Task Board'"). The route streams the COMPLETE updated HTML
back to the frontend over Server-Sent Events — never a diff, never a
partial — so the code panel can be replaced atomically.

Unlike ``/api/generate`` there is **no planner step** here. The user has
already given an explicit, focused instruction; running the planner
would add latency and tend to rewrite the whole app instead of
applying the requested change. The coder agent is called directly with
the current code + the iteration instruction + (optionally) the prior
chat history.

Output rules (start with ``<!DOCTYPE html>``, no markdown fences, no
explanation) are the same as :mod:`app.agents.coder` — we reuse the
coder's :data:`~app.agents.coder.CODER_SYSTEM_PROMPT` verbatim so the
two endpoints produce interchangeable output that the preview iframe
can render without branching.

SSE event sequence
-----------------

1. ``{"type": "status", "content": "iterating"}`` — emitted before the
   upstream call opens. Tells the frontend to clear the "Done" state
   and show a spinner.
2. ``{"type": "code", "content": "<chunk>"}`` — N frames of streamed
   HTML tokens. Concat them client-side and replace the code panel
   contents on ``done``.
3. ``{"type": "done"}`` — final frame; the assembled ``content`` is a
   complete, valid HTML document.
4. On failure: ``{"type": "error", "message": "<sanitised msg>"}`` —
   the message is intentionally generic (we never leak ``str(exc)``
   to the wire) but specific enough for the frontend to show a
   user-friendly error in place of the code panel.

Safeguards
----------

* ``asyncio.timeout(300)`` caps the entire request at 5 minutes —
  protects the connection pool from a model that hangs indefinitely.
* An SSE comment (``: keepalive\\n\\n``) is emitted if more than
  :data:`_KEEPALIVE_INTERVAL_SECONDS` elapsed since the last yield,
  to defeat idle-timeout proxies (notably Cloudflare's 100 s proxy
  idle limit) when the model is streaming slowly.
* The :class:`OpenCodeClient` is closed in a ``finally`` block so
  the underlying ``httpx.AsyncClient`` connection pool is always
  released, even on client disconnect or exception.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.coder import CODER_MAX_TOKENS, CODER_SYSTEM_PROMPT, CODER_TEMPERATURE
from app.config import settings
from app.models.database import get_db
from app.models.schemas import IterateRequest
from app.routes.deps import (
    DAILY_LIMITS,
    User,
    check_usage_quota,
    get_current_user,
)
from app.routes.projects import _get_owned_project_or_404
from app.services.code_sanitizer import StreamingFenceStripper
from app.services.opencode_client import OpenCodeAPIError, OpenCodeClient

logger = logging.getLogger(__name__)

router = APIRouter()

# Hard upper bound on the total request duration. A complete iteration
# round-trip (network + model + streaming) should not exceed 5 minutes
# under any reasonable load; this is a safety net against a model that
# hangs indefinitely, which would otherwise hold a connection slot
# forever.
_REQUEST_TIMEOUT_SECONDS = 300.0

# Maximum gap between yields before an SSE keepalive comment is
# injected. Cloudflare's free tier closes idle proxy connections
# after ~100 s, so anything longer than ~15 s risks the browser
# never seeing the next chunk. 15 s gives comfortable headroom
# while still being a "no-op" for fast streams.
_KEEPALIVE_INTERVAL_SECONDS = 15.0

# Delimiters wrapping the current code in the user prompt. Picked
# deliberately to be HTML- and Markdown-unambiguous so a model
# never mistakes the embedded code for a code fence or for a
# closing tag of the prompt itself.
_CODE_BLOCK_START = "=== CURRENT CODE START ==="
_CODE_BLOCK_END = "=== CURRENT CODE END ==="

# Recognised model-id prefixes. The Go gateway expects the bare
# model id; the prefix is a CLI / display convention only. Kept
# local to this module so the test suite can assert against the
# exact set without depending on the opencode client's private
# internals.
_MODEL_PREFIXES: tuple[str, ...] = ("opencode-go/", "opencode/")


def _sse(payload: dict[str, Any]) -> str:
    """Format a dict as a single Server-Sent Event frame.

    Each frame is ``data: <json>\\n\\n`` — the trailing blank line is
    the SSE event terminator. Comment frames (e.g. keepalives) do
    not use this helper; they are emitted as raw ``": keepalive\\n\\n"``
    lines.
    """
    return f"data: {json.dumps(payload)}\n\n"


def _strip_model_prefix(model: str) -> str:
    """Strip the ``opencode-go/`` or ``opencode/`` prefix from ``model``.

    The Go gateway expects the bare model id; the prefix is purely
    a CLI / display convention. We strip here (in addition to the
    client's internal stripping) so the value is verifiable in
    tests by inspecting ``stream_chat.call_args``.

    Args:
        model: A model id, with or without the prefix.

    Returns:
        The model id with any recognised prefix removed.
    """
    for prefix in _MODEL_PREFIXES:
        if model.startswith(prefix):
            return model[len(prefix) :]
    return model


def _build_iterate_messages(request: IterateRequest) -> list[dict[str, str]]:
    """Build the OpenAI-format messages list for an iteration call.

    The shape is:

    1. A single system message carrying
       :data:`app.agents.coder.CODER_SYSTEM_PROMPT` (so the
       output rules — ``<!DOCTYPE html>`` start, no fences, full
       file — are identical to a fresh generation).
    2. The history turns in the order received (oldest first).
       Each turn is inserted as-is with the same ``role`` /
       ``content`` keys the frontend sent.
    3. A final user message that contains the current code
       wrapped in unambiguous start/end markers, followed by the
       user's iteration instruction and a reminder that the
       response must be the full updated file.

    Args:
        request: Validated :class:`IterateRequest` body.

    Returns:
        The messages list to pass to
        :meth:`OpenCodeClient.stream_chat`. Always non-empty
        (contains at least the system message and the new user
        message).
    """
    messages: list[dict[str, str]] = [
        {"role": "system", "content": CODER_SYSTEM_PROMPT},
    ]
    for turn in request.history:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append(
        {
            "role": "user",
            "content": (
                f"{_CODE_BLOCK_START}\n"
                f"{request.current_code}\n"
                f"{_CODE_BLOCK_END}\n\n"
                f"User instruction: {request.prompt}\n\n"
                "Return the COMPLETE, updated HTML file. "
                "Start with <!DOCTYPE html> and end with </html>. "
                "Do NOT output a diff, do NOT use markdown fences, "
                "do NOT add any explanation. The output must be the "
                "entire single-page web app, fully functional — every "
                "feature that worked before must still work, plus the "
                "change described in the user instruction."
            ),
        }
    )
    return messages


# Quota dependency — thin wrapper around
# :func:`app.routes.deps.check_usage_quota` that re-declares the
# ``Depends``-injected ``user`` / ``db`` parameters and forwards
# them along with the static ``endpoint`` / ``daily_limit``
# values. A :func:`functools.partial` would be terser but
# FastAPI's dependency introspection cannot see the original
# signature through a ``partial`` object, so the explicit
# wrapper is the working form.
async def _iterate_quota(
    request: IterateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> tuple[User, AsyncSession]:
    """Verify ownership and enforce the daily iteration cap.

    Loads the target project, verifies ownership (404 if not owned),
    and runs the daily UsageEvent quota check before the route handler
    streams the response. The per-project iteration counter is bumped
    atomically inside the route handler so that the daily quota check
    happens first: if the daily cap is reached the request is rejected
    without incrementing the project's iteration count.
    """
    await _get_owned_project_or_404(db, request.project_id, user.id)

    return await check_usage_quota(
        endpoint="iterate",
        daily_limit=DAILY_LIMITS["iterate"],
        user=user,
        db=db,
    )


@router.post("/api/iterate")
async def iterate(
    request: IterateRequest,
    _quota: Annotated[tuple, Depends(_iterate_quota)],
) -> StreamingResponse:
    """Apply a chat-style iteration to the current code and stream the result.

    The dependency resolves ownership and the daily iteration quota
    before streaming starts. The route then performs an atomic SQL
    UPDATE that both checks and increments
    ``project.iteration_count``; concurrent iterates on the same
    project cannot race past ``settings.ITERATION_LIMIT``.

    The event sequence is:

    1. ``{"type": "status", "content": "iterating"}`` — emitted
       immediately after the client is constructed, before the
       upstream call opens.
    2. One or more ``{"type": "code", "content": "<chunk>"}`` —
       streamed HTML tokens from the coder.
    3. ``{"type": "done"}`` — successful completion. The
       concatenated ``content`` of the preceding ``code`` events
       is a complete single-file web app.
    4. On failure: ``{"type": "error", "message": "<msg>"}`` —
       a sanitised message (never ``str(exc)``).

    Args:
        request: Validated :class:`IterateRequest` body carrying
            the user instruction, current code, optional
            history, and target model id.

    Returns:
        A :class:`StreamingResponse` with ``text/event-stream``
        media type and the standard anti-buffering headers
        (``Cache-Control: no-cache``, ``X-Accel-Buffering: no``,
        ``Connection: keep-alive``).
    """
    _user, db = _quota

    # Atomic check-and-increment for the per-project iteration cap.
    # The daily quota has already been checked by the dependency, so
    # if this UPDATE fails the iteration count is NOT bumped. SQLite
    # serializes concurrent writers, preventing two simultaneous
    # requests from both reading the old count and writing the same
    # new value.
    result = await db.execute(
        text(
            "UPDATE projects SET iteration_count = iteration_count + 1 "
            "WHERE id = :pid AND iteration_count < :limit"
        ),
        {"pid": request.project_id, "limit": settings.ITERATION_LIMIT},
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You've reached the 10-iteration limit for this project.",
        )
    await db.commit()

    async def event_generator() -> AsyncGenerator[str, None]:
        """Stream SSE frames for a single ``/api/iterate`` request.

        The :class:`OpenCodeClient` is created per-request and
        always closed in the ``finally`` block — even on client
        disconnect, upstream error, or hard timeout — so the
        underlying ``httpx.AsyncClient`` connection pool is
        always released.

        The entire generator is wrapped in
        :func:`asyncio.timeout` with a 5-minute cap. If the
        model hangs, the timeout fires, the in-flight upstream
        call is cancelled, an error frame is yielded, and the
        client is closed normally.
        """
        client: OpenCodeClient | None = None
        # Track the wall-clock time of the last yield so we can
        # emit SSE keepalive comments during long, slow streams
        # (defeats Cloudflare's 100 s idle proxy limit). Initial
        # value is "now" so the first chunk never triggers a
        # spurious keepalive.
        last_yield_time = time.monotonic()
        try:
            async with asyncio.timeout(_REQUEST_TIMEOUT_SECONDS):
                client = OpenCodeClient(
                    api_key=settings.OPENCODE_API_KEY,
                    base_url=settings.OPENCODE_BASE_URL,
                )
                yield _sse({"type": "status", "content": "iterating"})

                messages = _build_iterate_messages(request)
                # Strip the display prefix here so the value is
                # observable in the call args (and so we don't
                # rely on the client's internal stripping for
                # testability). The client is tolerant of an
                # already-stripped id, so this is a no-op for it.
                bare_model = _strip_model_prefix(request.model)

                stripper = StreamingFenceStripper()
                async for chunk in client.stream_chat(
                    messages=messages,
                    model=bare_model,
                    temperature=CODER_TEMPERATURE,
                    max_tokens=CODER_MAX_TOKENS,
                ):
                    now = time.monotonic()
                    if now - last_yield_time >= _KEEPALIVE_INTERVAL_SECONDS:
                        # SSE comment line — not an event, just a
                        # heartbeat that proxies will forward.
                        yield ": keepalive\n\n"
                        last_yield_time = now
                    clean = stripper.feed(chunk)
                    if clean:
                        yield _sse({"type": "code", "content": clean})
                    last_yield_time = time.monotonic()
                tail = stripper.flush()
                if tail:
                    yield _sse({"type": "code", "content": tail})
                yield _sse({"type": "done"})
        # SSE responses cannot propagate Python exceptions to
        # FastAPI's normal error handler (the response is already
        # streaming), so we convert every failure into an error
        # frame. The messages are intentionally generic so we
        # never leak ``str(exc)`` to the wire.
        except OpenCodeAPIError as exc:
            logger.exception("OpenCode API error during iteration")
            yield _sse(
                {
                    "type": "error",
                    "message": f"AI model error (status {exc.status_code})",
                }
            )
        except asyncio.TimeoutError:
            logger.exception(
                "Iteration exceeded %.0fs hard timeout", _REQUEST_TIMEOUT_SECONDS
            )
            yield _sse(
                {
                    "type": "error",
                    "message": (
                        f"Iteration timed out after "
                        f"{int(_REQUEST_TIMEOUT_SECONDS)}s"
                    ),
                }
            )
        except Exception:  # noqa: BLE001
            logger.exception("Error during iteration")
            yield _sse(
                {
                    "type": "error",
                    "message": "An unexpected error occurred during iteration",
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
            # Disable proxy buffering so chunks reach the browser
            # immediately.
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
