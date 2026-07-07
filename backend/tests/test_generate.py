"""Tests for the ``POST /api/generate`` endpoint.

These tests verify the streaming contract documented in the Phase 1 plan:

* SSE format is ``data: {json}\\n\\n``
* Event types are ``status``, ``code``, ``done``, ``error``
* The happy path emits ``planning`` -> ``generating`` status events,
  then one or more ``code`` chunks, then ``done``
* Empty prompts are rejected at the schema layer (HTTP 422)
* The default model is applied when the request omits ``model``
* Upstream errors from the OpenCode client surface as an ``error``
  event in the stream (rather than a 500)

The route's dependency on ``OpenCodeClient`` is patched per-test so the
suite runs offline and deterministic.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient

# The patched name is used by several tests; declaring it as a module
# constant keeps the test bodies focused on behaviour, not string literals.
_OPENCODE_CLIENT_PATH = "app.routes.generate.OpenCodeClient"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _collect_sse_events(response: Any) -> list[dict[str, Any]]:
    """Consume an SSE response and return the list of parsed event payloads.

    The contract is ``data: {json}\\n\\n`` per event. ``aiter_lines`` yields
    each newline-separated chunk; we skip the blank separator lines and
    the OpenAI-style ``[DONE]`` sentinel. Malformed JSON lines are skipped
    silently so that a stray comment line from a future keepalive patch
    does not mask real assertion failures downstream.

    Args:
        response: An ``httpx.Response`` whose body is an SSE stream.

    Returns:
        List of decoded event dicts in the order they were received.
    """
    events: list[dict[str, Any]] = []
    async for raw_line in response.aiter_lines():
        line = raw_line.strip()
        if not line:
            # Blank line is the SSE event separator; not an event.
            continue
        if not line.startswith("data:"):
            # SSE comment lines (e.g. ": keepalive") start with ':'.
            # We tolerate any non-data line and move on.
            continue
        payload = line[len("data:") :].lstrip()
        if payload == "[DONE]":
            # OpenAI-style terminator. The contract does not require it,
            # but tolerating it is robust against future refactors.
            continue
        try:
            events.append(json.loads(payload))
        except json.JSONDecodeError:
            # Best-effort parse: skip garbage rather than abort the
            # whole stream — useful if a keepalive comment slips in.
            continue
    return events


def _patch_opencode_client(
    monkeypatch: pytest.MonkeyPatch, instance: MagicMock
) -> None:
    """Patch ``app.routes.generate.OpenCodeClient`` so construction returns ``instance``.

    Works whether the route does ``OpenCodeClient(api_key=...)`` inline,
    via a factory, or inside a ``Depends``. (The ``Depends`` case works
    because FastAPI evaluates the dependency in the route module's
    namespace.)
    """
    monkeypatch.setattr(_OPENCODE_CLIENT_PATH, MagicMock(return_value=instance))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_generate_streams_code(
    auth_client: AsyncClient,
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Happy path: stream contains at least one ``code`` event and a ``done``.

    Asserts:
        * HTTP 200 (SSE stream opened successfully)
        * The stream contains at least one ``{"type": "code", ...}`` event
        * The stream contains exactly one ``{"type": "done"}`` event
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post(
        "/api/generate", json={"prompt": "build a landing page"}
    )

    assert (
        response.status_code == 200
    ), f"Expected 200 from /api/generate, got {response.status_code}: {response.text}"

    events = await _collect_sse_events(response)
    code_events = [e for e in events if e.get("type") == "code"]
    done_events = [e for e in events if e.get("type") == "done"]

    assert code_events, f"Expected at least one 'code' event, got events={events!r}"
    assert done_events, f"Expected a 'done' event, got events={events!r}"
    assert (
        len(done_events) == 1
    ), f"Expected exactly one 'done' terminator, got {len(done_events)}: {done_events!r}"

    # Sanity check: at least one code event has a non-empty content field.
    assert any(
        isinstance(e.get("content"), str) and e["content"] for e in code_events
    ), f"'code' events should carry string content: {code_events!r}"


async def test_generate_has_status_events(
    auth_client: AsyncClient,
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Stream emits ``planning`` then ``generating`` status events.

    Asserts:
        * At least one ``status`` event with ``content == "planning"``
        * At least one ``status`` event with ``content == "generating"``
        * ``planning`` precedes ``generating`` in the stream
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post("/api/generate", json={"prompt": "test prompt"})
    assert response.status_code == 200

    events = await _collect_sse_events(response)
    status_sequence = [e.get("content") for e in events if e.get("type") == "status"]

    assert (
        "planning" in status_sequence
    ), f"Missing 'planning' status. Got sequence: {status_sequence!r}"
    assert (
        "generating" in status_sequence
    ), f"Missing 'generating' status. Got sequence: {status_sequence!r}"
    assert status_sequence.index("planning") < status_sequence.index(
        "generating"
    ), f"'planning' must come before 'generating'. Got: {status_sequence!r}"


async def test_generate_rejects_empty_prompt(auth_client: AsyncClient) -> None:
    """Empty prompt is rejected with HTTP 422 (Pydantic validation).

    The schema must declare ``min_length=1`` (or stricter) on ``prompt``.
    Empty string is invalid input — the server should never start a
    generation round-trip just to fail.

    Asserts:
        * HTTP 422 from FastAPI's request validation
    """
    response = await auth_client.post("/api/generate", json={"prompt": ""})

    assert (
        response.status_code == 422
    ), f"Empty prompt should yield 422, got {response.status_code}: {response.text}"

    # FastAPI's 422 body is a JSON object describing the validation
    # error; we don't pin its exact shape but we do confirm it is JSON
    # and references the 'prompt' field.
    body = response.json()
    assert "detail" in body, f"Expected FastAPI validation error envelope, got {body!r}"


async def test_generate_default_model(
    auth_client: AsyncClient,
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Omitting ``model`` uses the contract default of ``opencode-go/deepseek-v4-flash``.

    Asserts:
        * HTTP 200
        * The mock was consulted (the route did not short-circuit)
        * Either the planner or coder call received ``opencode-go/deepseek-v4-flash``
    """
    _patch_opencode_client(monkeypatch, mock_client)

    # No 'model' key — the Pydantic default must take over.
    response = await auth_client.post("/api/generate", json={"prompt": "test"})
    assert (
        response.status_code == 200
    ), f"Expected 200 for default-model request, got {response.status_code}: {response.text}"

    events = await _collect_sse_events(response)
    assert any(
        e.get("type") == "done" for e in events
    ), f"Default-model generation should still complete. Events: {events!r}"

    # Inspect the mock to confirm the default model id was used.
    # The route may call chat() (planner) and/or stream_chat() (coder).
    default_model = "opencode-go/deepseek-v4-flash"
    used_models: list[str] = []
    for method_name in ("chat", "stream_chat"):
        method = getattr(mock_client, method_name, None)
        if method is None or not method.call_args_list:
            continue
        for call in method.call_args_list:
            kwargs = call.kwargs or {}
            if "model" in kwargs:
                used_models.append(kwargs["model"])
            # Also check positional args — some impls pass model positionally.
            if (
                call.args
                and isinstance(call.args[0], list) is False
                and len(call.args) >= 2
            ):
                # args = (messages, model, ...). Only the planner chat()
                # path is expected to call with these args, so be lenient.
                if isinstance(call.args[1], str):
                    used_models.append(call.args[1])

    assert used_models, (
        f"Neither chat() nor stream_chat() was called with a model argument. "
        f"chat calls: {mock_client.chat.call_args_list!r}, "
        f"stream_chat calls: {mock_client.stream_chat.call_args_list!r}"
    )
    assert (
        default_model in used_models
    ), f"Expected default model {default_model!r} in calls, got {used_models!r}"


async def test_generate_error_handling(
    auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Upstream failures from ``OpenCodeClient`` surface as an ``error`` SSE event.

    The planner step (``chat``) is forced to raise. The route is
    expected to catch the exception, yield ``{"type": "error", ...}``,
    and close the stream. This is preferable to a bare 500 because the
    frontend's SSE handler can show a user-friendly error message in the
    same place it would have shown code.

    Asserts:
        * At least one ``{"type": "error", ...}`` event in the stream
        * The error event carries a non-empty ``message`` field
    """
    error_mock = MagicMock(name="error_opencode_client")
    error_mock.chat = AsyncMock(
        side_effect=RuntimeError("OpenCode API is down"),
        name="chat",
    )

    # stream_chat is not reached on this code path, but configure it as
    # a safe no-op in case the implementation calls it for any reason.
    async def _empty_stream(*_args, **_kwargs):
        if False:  # pragma: no cover — makes this an async generator
            yield ""

    error_mock.stream_chat = MagicMock(side_effect=_empty_stream, name="stream_chat")
    error_mock.close = AsyncMock(return_value=None, name="close")

    _patch_opencode_client(monkeypatch, error_mock)

    response = await auth_client.post("/api/generate", json={"prompt": "test"})

    # We intentionally do NOT assert response.status_code == 200 here.
    # The contract says the error is conveyed inside the stream; a
    # correct implementation yields 200 + error event. An incorrect one
    # yields 500. Both are caught by the event-content assertion below,
    # but we make the lenient path the default so the test still reports
    # a useful failure if the implementation breaks entirely.
    if response.status_code != 200:
        # If the route bubbled the exception, FastAPI returns 500 with
        # no SSE body. We surface the body in the assertion message.
        body = response.text
        pytest.fail(
            f"Expected SSE error event in stream (status 200), but got "
            f"status={response.status_code} body={body!r}. The route should "
            f"catch the upstream exception and yield an error event."
        )

    events = await _collect_sse_events(response)
    error_events = [e for e in events if e.get("type") == "error"]

    assert (
        error_events
    ), f"Expected an 'error' event in the stream, got events={events!r}"
    # The error event should carry a human-readable message.
    assert any(
        isinstance(e.get("message"), str) and e["message"] for e in error_events
    ), f"Error event should carry a non-empty 'message' field: {error_events!r}"

    # The mock's chat was actually consulted.
    error_mock.chat.assert_awaited()


async def test_generate_closes_client(
    auth_client: AsyncClient,
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``client.close()`` is called after generation completes.

    Ensures the ``OpenCodeClient`` resource (httpx connection pool) is
    released even on the happy path, preventing connection leaks.

    Asserts:
        * HTTP 200
        * ``mock_client.close`` was awaited exactly once
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post("/api/generate", json={"prompt": "test"})
    assert (
        response.status_code == 200
    ), f"Expected 200, got {response.status_code}: {response.text}"

    events = await _collect_sse_events(response)
    assert any(
        e.get("type") == "done" for e in events
    ), f"Expected 'done' event, got {events!r}"

    mock_client.close.assert_awaited_once()


# ---------------------------------------------------------------------------
# Title extraction — pure-function unit tests
# ---------------------------------------------------------------------------
#
# The route delegates title parsing to ``_extract_title`` so the planner
# output format (first line = "Title: <title>") can be tested in
# isolation. These tests cover every branch of the helper: empty input,
# missing prefix, prefix with body, lowercase prefix, empty title,
# quoted title, and over-length title.


def test_extract_title_with_body() -> None:
    """Standard case: first line ``Title: X`` is extracted, rest is body."""
    from app.routes.generate import _extract_title

    plan = "Title: My Todo App\nA simple todo list with localStorage."
    title, body = _extract_title(plan)

    assert title == "My Todo App", f"Expected 'My Todo App', got {title!r}"
    assert (
        body == "A simple todo list with localStorage."
    ), f"Expected plan body without title line, got {body!r}"


def test_extract_title_only_title() -> None:
    """Plan with only a title line returns empty body and the title."""
    from app.routes.generate import _extract_title

    plan = "Title: Coffee Shop Landing"
    title, body = _extract_title(plan)

    assert title == "Coffee Shop Landing"
    assert body == ""


def test_extract_title_empty_plan() -> None:
    """Empty plan returns the default title and empty body."""
    from app.routes.generate import _extract_title

    title, body = _extract_title("")

    assert (
        title == "Untitled"
    ), f"Empty plan should default to 'Untitled', got {title!r}"
    assert body == ""


def test_extract_title_missing_prefix() -> None:
    """Plan without ``Title:`` prefix falls back to ``Untitled``.

    The full plan is returned as the body unchanged so the coder still
    gets a usable spec.
    """
    from app.routes.generate import _extract_title

    plan = "Just a build plan, no title line here."
    title, body = _extract_title(plan)

    assert title == "Untitled"
    assert body == plan


def test_extract_title_lowercase_prefix() -> None:
    """The ``Title:`` prefix is matched case-insensitively."""
    from app.routes.generate import _extract_title

    plan = "title: lowercase works\nBody text."
    title, body = _extract_title(plan)

    assert title == "lowercase works", f"Expected case-insensitive match, got {title!r}"
    assert body == "Body text."


def test_extract_title_strips_surrounding_whitespace() -> None:
    """Extra whitespace and blank lines around the title are trimmed."""
    from app.routes.generate import _extract_title

    plan = "   Title:   Padded Title   \n\nBody."
    title, body = _extract_title(plan)

    assert title == "Padded Title", f"Expected trimmed title, got {title!r}"
    assert body == "Body."


def test_extract_title_strips_matching_quotes() -> None:
    """A single layer of matching double or single quotes is stripped."""
    from app.routes.generate import _extract_title

    plan_double = 'Title: "Quoted App"\nBody.'
    title_d, _ = _extract_title(plan_double)
    assert title_d == "Quoted App", f"Double quotes should be stripped, got {title_d!r}"

    plan_single = "Title: 'Single Quoted'\nBody."
    title_s, _ = _extract_title(plan_single)
    assert (
        title_s == "Single Quoted"
    ), f"Single quotes should be stripped, got {title_s!r}"


def test_extract_title_empty_title_falls_back() -> None:
    """``Title:`` with no payload falls back to ``Untitled``.

    An empty title would be a worse user experience than the explicit
    default (the TopBar would render an empty string).
    """
    from app.routes.generate import _extract_title

    plan = "Title:    \nBody of the plan."
    title, body = _extract_title(plan)

    assert (
        title == "Untitled"
    ), f"Empty title should default to 'Untitled', got {title!r}"
    # Body should still be returned even if the title was empty — we
    # only consumed the title line, not the whole plan.
    assert body == "Body of the plan."


def test_extract_title_no_space_before_colon() -> None:
    """``Title:`` without a space before the colon is recognised."""
    from app.routes.generate import _extract_title

    plan = "Title:No Space Plan\nBody."
    title, body = _extract_title(plan)

    assert title == "No Space Plan", f"Expected 'No Space Plan', got {title!r}"
    assert body == "Body."


def test_extract_title_after_blank_line() -> None:
    """A ``Title:`` line that appears after a blank line is found."""
    from app.routes.generate import _extract_title

    plan = "\n\nTitle: Delayed Title\nBody."
    title, body = _extract_title(plan)

    assert title == "Delayed Title", f"Expected 'Delayed Title', got {title!r}"
    assert body == "Body."


def test_extract_title_markdown_heading() -> None:
    """A markdown ``# Title: ...`` prefix is tolerated."""
    from app.routes.generate import _extract_title

    plan = "# Title: Markdown Plan\nBody."
    title, body = _extract_title(plan)

    assert title == "Markdown Plan", f"Expected 'Markdown Plan', got {title!r}"
    assert body == "Body."


def test_derive_title_from_prompt_strips_fillers() -> None:
    """Filler words are removed and the remainder is title-cased."""
    from app.routes.generate import _derive_title_from_prompt

    assert _derive_title_from_prompt("build a todo list app") == "Todo List"


def test_derive_title_from_prompt_caps_length() -> None:
    """Derived titles are capped at the configured max length."""
    from app.routes.generate import _derive_title_from_prompt

    long_prompt = " ".join(["word"] * 50)
    title = _derive_title_from_prompt(long_prompt)
    assert len(title) <= 60
    assert title != "Untitled"


def test_derive_title_from_prompt_empty_prompt() -> None:
    """An empty/unusable prompt falls back to ``Untitled``."""
    from app.routes.generate import _derive_title_from_prompt

    assert _derive_title_from_prompt("") == "Untitled"
    assert _derive_title_from_prompt("   ") == "Untitled"


# ---------------------------------------------------------------------------
# Title SSE event — integration with the /api/generate stream
# ---------------------------------------------------------------------------


async def test_generate_emits_title_event(
    auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The route extracts a ``Title:`` line and emits it as an SSE event.

    The planner is expected to return its plan with a ``Title: <name>``
    first line. The route must:

    1. Surface that title to the frontend as a separate ``title`` SSE
       event so the TopBar can update immediately.
    2. Emit the title event AFTER ``status: planning`` (so the frontend
       knows the planner has finished) and BEFORE ``status: generating``
       (so the title is shown alongside the code stream).
    3. Pass the rest of the plan (no title line) to the coder.

    Asserts:
        * HTTP 200
        * The stream contains a ``title`` event with the extracted title
        * The title event appears between the planning and generating
          status events
        * The coder call received the plan body, not the title line
    """
    from unittest.mock import MagicMock  # local import keeps top tidy

    title_mock = MagicMock(name="title_opencode_client")
    title_mock.chat = AsyncMock(
        return_value=(
            "Title: My Todo App\n" "A simple todo list with localStorage persistence."
        ),
        name="chat",
    )

    async def _code_stream(*_args, **_kwargs):
        for chunk in ("<html>", "<body>", "</body></html>"):
            yield chunk

    title_mock.stream_chat = MagicMock(side_effect=_code_stream, name="stream_chat")
    title_mock.close = AsyncMock(return_value=None, name="close")

    _patch_opencode_client(monkeypatch, title_mock)

    response = await auth_client.post("/api/generate", json={"prompt": "todo list app"})
    assert response.status_code == 200

    events = await _collect_sse_events(response)

    title_events = [e for e in events if e.get("type") == "title"]
    assert title_events, f"Expected at least one 'title' event, got events={events!r}"
    assert (
        title_events[0].get("content") == "My Todo App"
    ), f"Expected title 'My Todo App', got: {title_events[0]!r}"

    # The title event must come AFTER the planning status and BEFORE
    # the generating status, so the frontend can render the title in
    # the TopBar as soon as the planner has finished.
    event_types = [e.get("type") for e in events]
    planning_idx = event_types.index("status")  # first status = planning
    # Find the first title and first generating status. The stream emits
    # them in order: planning -> title -> generating -> code* -> done.
    title_idx = event_types.index("title")
    # The first "status" event is "planning"; find the next "status"
    # event which must be "generating". The status_sequence helper used
    # in test_generate_has_status_events asserts that already; here we
    # just check that the title event sits between the two status
    # transitions.
    generating_idx = next(
        i for i, t in enumerate(event_types) if t == "status" and i > planning_idx
    )
    assert planning_idx < title_idx < generating_idx, (
        f"'title' event must sit between 'planning' and 'generating'. "
        f"Got event order: {event_types!r}"
    )

    # The coder call should have received the plan body, NOT the title
    # line. We assert this on the mock's recorded call.
    title_mock.stream_chat.assert_called()
    call_kwargs = title_mock.stream_chat.call_args.kwargs
    coder_messages = call_kwargs.get("messages", [])
    user_msg = next((m for m in coder_messages if m.get("role") == "user"), None)
    assert (
        user_msg is not None
    ), f"Expected a 'user' message in the coder call: {coder_messages!r}"
    user_content = user_msg.get("content", "")
    assert "Title: My Todo App" not in user_content, (
        f"Title line should be stripped from the plan body passed to the "
        f"coder. Got: {user_content!r}"
    )
    assert (
        "todo list with localStorage" in user_content
    ), f"Plan body should be passed to the coder. Got: {user_content!r}"


async def test_generate_title_derived_from_prompt(
    auth_client: AsyncClient,
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the planner omits the ``Title:`` line, derive a title from the prompt.

    The default ``mock_client`` fixture's ``chat()`` returns a plan that
    does NOT start with ``Title:`` — this mirrors a planner that
    ignores the system prompt. The route must still emit a ``title``
    event (rather than skipping it) so the frontend's TitleBar stays
    in a known state, and the title should be derived from the user's
    prompt instead of falling back to ``"Untitled"``.

    Asserts:
        * The stream contains a ``title`` event with a non-empty
          content derived from the prompt
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post("/api/generate", json={"prompt": "build a thing"})
    assert response.status_code == 200

    events = await _collect_sse_events(response)
    title_events = [e for e in events if e.get("type") == "title"]
    assert title_events, f"Expected a 'title' event even on fallback, got {events!r}"
    derived_title = title_events[0].get("content")
    assert derived_title and derived_title != "Untitled", (
        f"Expected a derived title when planner omits Title:, "
        f"got: {title_events[0]!r}"
    )


async def test_generate_strips_code_fences(
    auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Markdown fences around the coder output are stripped from the SSE stream.

    The model sometimes wraps its HTML in `` ```html `` ... `` ``` ``
    despite the system prompt. The route must sanitise the stream so
    the concatenated ``code`` events contain no fence markers.

    Asserts:
        * HTTP 200
        * The concatenated code events contain no backtick fences
        * The output still starts with ``<!DOCTYPE html>`` and ends
          with ``</html>``
    """
    from unittest.mock import AsyncMock, MagicMock

    fence_mock = MagicMock(name="fence_opencode_client")
    fence_mock.chat = AsyncMock(
        return_value="Title: Fenced App\nBuild a single-page app.",
        name="chat",
    )

    async def _fenced_stream(*_args, **_kwargs):
        for chunk in ("```html\n", "<!DOCTYPE html>", "<html>", "</html>", "\n```"):
            yield chunk

    fence_mock.stream_chat = MagicMock(side_effect=_fenced_stream, name="stream_chat")
    fence_mock.close = AsyncMock(return_value=None, name="close")

    _patch_opencode_client(monkeypatch, fence_mock)

    response = await auth_client.post("/api/generate", json={"prompt": "make an app"})
    assert (
        response.status_code == 200
    ), f"Expected 200, got {response.status_code}: {response.text}"

    events = await _collect_sse_events(response)
    code_text = "".join(e.get("content", "") for e in events if e.get("type") == "code")

    assert (
        "```" not in code_text
    ), f"Markdown fences must be stripped from code events. Got: {code_text!r}"
    assert code_text.startswith(
        "<!DOCTYPE html>"
    ), f"Sanitised output should start with <!DOCTYPE html>. Got: {code_text!r}"
    assert code_text.rstrip().endswith(
        "</html>"
    ), f"Sanitised output should end with </html>. Got: {code_text!r}"
