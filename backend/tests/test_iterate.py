"""Tests for the ``POST /api/iterate`` endpoint.

These tests verify the streaming contract documented in Phase 4 of
the build plan:

* SSE format is ``data: {json}\\n\\n``
* Event types are ``status``, ``code``, ``done``, ``error``
* The happy path emits ``iterating`` status event, then one or more
  ``code`` chunks, then ``done``
* Empty ``prompt`` / empty ``current_code`` / bad ``model`` pattern
  are rejected at the schema layer (HTTP 422)
* Upstream errors from the OpenCode client surface as an ``error``
  event in the stream (rather than a 500)
* The ``OpenCodeClient`` is closed exactly once per request
* Conversation ``history`` is forwarded to the client
* The ``opencode-go/`` prefix is stripped from the model id before
  the upstream call

The route's dependency on ``OpenCodeClient`` is patched per-test so
the suite runs offline and deterministic. Mirrors the conventions in
``tests/test_generate.py``.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient

# The patched name is used by several tests; declaring it as a module
# constant keeps the test bodies focused on behaviour, not string
# literals. The route imports ``OpenCodeClient`` directly (no factory,
# no ``Depends``), so a module-level patch on the route's namespace
# is sufficient.
_OPENCODE_CLIENT_PATH = "app.routes.iterate.OpenCodeClient"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _collect_sse_events(response: Any) -> list[dict[str, Any]]:
    """Consume an SSE response and return the list of parsed event payloads.

    The contract is ``data: {json}\\n\\n`` per event. ``aiter_lines``
    yields each newline-separated chunk; we skip the blank separator
    lines and the OpenAI-style ``[DONE]`` sentinel. SSE comment lines
    (e.g. ``": keepalive"``) start with ``:`` and are silently
    dropped — they are an anti-idle-timeout heartbeat, not an event
    the frontend acts on.

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
            # OpenAI-style terminator. The contract does not require
            # it, but tolerating it is robust against future
            # refactors.
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
    """Patch ``app.routes.iterate.OpenCodeClient`` so construction returns ``instance``.

    Mirrors the helper in ``test_generate.py``. Works whether the
    route calls ``OpenCodeClient(api_key=...)`` inline or via a
    factory; for the iterate route it's inline, so the direct
    module-level patch is sufficient.
    """
    monkeypatch.setattr(_OPENCODE_CLIENT_PATH, MagicMock(return_value=instance))


def _iterate_payload(
    project_id: int,
    prompt: str = "add a dark mode toggle",
    current_code: str = "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>",
    model: str = "opencode-go/minimax-m3",
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Return a baseline valid iterate request body.

    Centralised so each test only specifies the field it actually
    exercises. ``history`` is ``None`` (omitted) by default — the
    schema applies an empty-list default.

    Args:
        project_id: The id of the project being iterated on. Required
            since the iteration endpoint enforces a per-project cap.
    """
    body: dict[str, Any] = {
        "prompt": prompt,
        "current_code": current_code,
        "model": model,
        "project_id": project_id,
    }
    if history is not None:
        body["history"] = history
    return body


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_iterate_streams_code(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Happy path: stream contains at least one ``code`` event and a ``done``.

    The default ``mock_client`` fixture yields three HTML chunks
    (see ``conftest.py``); the iterate route must surface them as
    ``{"type": "code", ...}`` events and terminate with a
    ``{"type": "done"}`` event.

    Asserts:
        * HTTP 200 (SSE stream opened successfully)
        * At least one ``code`` event with non-empty string content
        * Exactly one ``done`` event
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post(
        "/api/iterate", json=_iterate_payload(project_id=test_project["id"])
    )

    assert (
        response.status_code == 200
    ), f"Expected 200 from /api/iterate, got {response.status_code}: {response.text}"

    events = await _collect_sse_events(response)
    code_events = [e for e in events if e.get("type") == "code"]
    done_events = [e for e in events if e.get("type") == "done"]

    assert code_events, f"Expected at least one 'code' event, got events={events!r}"
    assert done_events, f"Expected a 'done' event, got events={events!r}"
    assert (
        len(done_events) == 1
    ), f"Expected exactly one 'done' terminator, got {len(done_events)}: {done_events!r}"

    # Sanity check: at least one code event has a non-empty content
    # field.
    assert any(
        isinstance(e.get("content"), str) and e["content"] for e in code_events
    ), f"'code' events should carry string content: {code_events!r}"


async def test_iterate_emits_iterating_status(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The stream begins with a ``status: iterating`` event.

    The frontend uses this event to switch the code panel into a
    "thinking" state. Unlike ``/api/generate``, there is no
    planner phase — the first status event is the only one.

    Asserts:
        * Exactly one ``status`` event in the stream
        * Its content is ``"iterating"``
        * It appears before the first ``code`` event
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post(
        "/api/iterate", json=_iterate_payload(project_id=test_project["id"])
    )
    assert response.status_code == 200

    events = await _collect_sse_events(response)
    status_events = [e for e in events if e.get("type") == "status"]

    assert len(status_events) == 1, (
        f"Expected exactly one 'status' event for /api/iterate "
        f"(no planner phase), got {status_events!r}"
    )
    assert (
        status_events[0].get("content") == "iterating"
    ), f"Expected 'iterating' status, got {status_events[0]!r}"

    # And the status must precede the code stream.
    event_types = [e.get("type") for e in events]
    assert event_types.index("status") < event_types.index("code"), (
        f"'status' must precede the first 'code' event. "
        f"Got event order: {event_types!r}"
    )


async def test_iterate_validates_prompt(
    auth_client: AsyncClient, test_project: dict[str, Any]
) -> None:
    """Empty ``prompt`` is rejected with HTTP 422 (Pydantic validation).

    The schema declares ``min_length=1`` on ``prompt`` (mirroring
    ``GenerateRequest``). Sending an empty string should fail
    validation before any upstream call is opened.

    Asserts:
        * HTTP 422 from FastAPI's request validation
        * The error body references the ``prompt`` field
    """
    response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(project_id=test_project["id"], prompt=""),
    )

    assert (
        response.status_code == 422
    ), f"Empty prompt should yield 422, got {response.status_code}: {response.text}"

    body = response.json()
    assert "detail" in body, f"Expected FastAPI validation error envelope, got {body!r}"
    # The 422 detail mentions the offending field; we don't pin
    # the exact text but at least one entry should reference
    # 'prompt'.
    detail_blob = json.dumps(body["detail"])
    assert "prompt" in detail_blob, (
        f"Expected the validation error to reference 'prompt', "
        f"got detail={body['detail']!r}"
    )


async def test_iterate_validates_model(
    auth_client: AsyncClient, test_project: dict[str, Any]
) -> None:
    """Invalid model pattern is rejected with HTTP 422.

    The schema enforces ``r"^opencode-go/[a-z0-9._-]+$"`` on
    ``model``. A bare id (``"minimax-m3"``) or an unknown prefix
    (``"gpt-4"``) must both fail validation before the route
    runs.

    Asserts:
        * HTTP 422 for an invalid model id
    """
    response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(project_id=test_project["id"], model="minimax-m3"),
    )

    assert response.status_code == 422, (
        f"Invalid model id should yield 422, got "
        f"{response.status_code}: {response.text}"
    )

    body = response.json()
    detail_blob = json.dumps(body["detail"])
    assert "model" in detail_blob, (
        f"Expected the validation error to reference 'model', "
        f"got detail={body['detail']!r}"
    )


async def test_iterate_validates_current_code(
    auth_client: AsyncClient, test_project: dict[str, Any]
) -> None:
    """Empty ``current_code`` is rejected with HTTP 422.

    Iteration without any code to iterate on is meaningless; the
    schema enforces ``min_length=1`` on ``current_code`` to catch
    the bug at the wire boundary rather than mid-stream.

    Asserts:
        * HTTP 422 from FastAPI's request validation
    """
    response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(project_id=test_project["id"], current_code=""),
    )

    assert response.status_code == 422, (
        f"Empty current_code should yield 422, got "
        f"{response.status_code}: {response.text}"
    )

    body = response.json()
    detail_blob = json.dumps(body["detail"])
    assert "current_code" in detail_blob, (
        f"Expected the validation error to reference 'current_code', "
        f"got detail={body['detail']!r}"
    )


async def test_iterate_error_handling(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Upstream failures surface as a sanitised ``error`` SSE event.

    The ``stream_chat`` async generator is forced to raise a
    generic :class:`RuntimeError` on its first ``__anext__``. The
    route must:

    1. Convert the exception into a ``{"type": "error", ...}``
       frame.
    2. Use a sanitised, generic message — never leak
       ``str(exc)`` to the wire.
    3. Still close the client (verified by the next test; here we
       just confirm the error frame shape).
    4. Return HTTP 200 (the stream is open, the error is
       in-band).

    Asserts:
        * HTTP 200 (error is in-band, not a transport-level 500)
        * At least one ``error`` event with a non-empty message
        * The error message does NOT contain the raw exception
          text — security: the original message may include
          upstream-internal details.
    """
    raw_message = "OpenCode API is down (token expired at 0xdeadbeef)"

    error_mock = MagicMock(name="error_opencode_client")

    async def _failing_stream(*_args, **_kwargs):
        # First ``__anext__`` raises — the route must catch this
        # and yield an error frame.
        raise RuntimeError(raw_message)
        # Make this an async generator function (never reached).
        if False:  # pragma: no cover
            yield ""

    error_mock.stream_chat = MagicMock(side_effect=_failing_stream, name="stream_chat")
    error_mock.chat = AsyncMock(return_value="unused", name="chat")
    error_mock.close = AsyncMock(return_value=None, name="close")

    _patch_opencode_client(monkeypatch, error_mock)

    response = await auth_client.post(
        "/api/iterate", json=_iterate_payload(project_id=test_project["id"])
    )

    # In-band error: status 200, error frame inside the stream.
    if response.status_code != 200:
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
    assert any(
        isinstance(e.get("message"), str) and e["message"] for e in error_events
    ), f"Error event should carry a non-empty 'message' field: {error_events!r}"

    # The raw exception text must not leak to the wire.
    for ev in error_events:
        assert raw_message not in ev.get("message", ""), (
            f"Error message must be sanitised and not leak the raw "
            f"exception text. Got: {ev!r}"
        )

    error_mock.stream_chat.assert_called()


async def test_iterate_closes_client(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``client.close()`` is awaited exactly once after iteration.

    Mirrors the corresponding guard in
    ``test_generate.py::test_generate_closes_client``. Ensures
    the ``OpenCodeClient`` (and its underlying ``httpx``
    connection pool) is released even on the happy path.

    Asserts:
        * HTTP 200
        * ``done`` event present
        * ``mock_client.close`` awaited exactly once
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post(
        "/api/iterate", json=_iterate_payload(project_id=test_project["id"])
    )
    assert (
        response.status_code == 200
    ), f"Expected 200, got {response.status_code}: {response.text}"

    events = await _collect_sse_events(response)
    assert any(
        e.get("type") == "done" for e in events
    ), f"Expected 'done' event, got {events!r}"

    mock_client.close.assert_awaited_once()


async def test_iterate_includes_history(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Conversation ``history`` is forwarded to ``stream_chat``.

    The schema-level ``history`` field is the only mechanism by
    which the model retains context of prior iterations. The
    route must:

    1. Place the system message at index 0.
    2. Insert each history turn (in order) right after the system
       message and before the new user message.
    3. Append the new user message (containing the current code
       + instruction) as the final entry.

    Asserts:
        * HTTP 200
        * The ``messages`` list passed to ``stream_chat`` has the
          system message first
        * History turns appear next, in order
        * The final message is the new user instruction (it
          contains both the current code delimiter and the user's
          prompt text)
    """
    _patch_opencode_client(monkeypatch, mock_client)

    history = [
        {"role": "user", "content": "previous turn 1"},
        {"role": "assistant", "content": "<html>previous output</html>"},
        {"role": "user", "content": "previous turn 2"},
    ]

    response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(project_id=test_project["id"], history=history),
    )
    assert response.status_code == 200

    events = await _collect_sse_events(response)
    assert any(
        e.get("type") == "done" for e in events
    ), f"Expected 'done' event, got {events!r}"

    # Inspect the recorded call.
    mock_client.stream_chat.assert_called()
    call_kwargs = mock_client.stream_chat.call_args.kwargs
    sent_messages = call_kwargs.get("messages", [])

    # 1. System message first.
    assert sent_messages, "stream_chat was called with no messages"
    assert (
        sent_messages[0]["role"] == "system"
    ), f"First message should be 'system', got {sent_messages[0]!r}"

    # 2. History turns next, in order.
    history_as_system = sent_messages[1 : 1 + len(history)]
    for idx, (sent, expected) in enumerate(
        zip(history_as_system, history, strict=True)
    ):
        assert sent["role"] == expected["role"], (
            f"History turn {idx} has wrong role: "
            f"expected {expected['role']!r}, got {sent['role']!r}"
        )
        assert sent["content"] == expected["content"], (
            f"History turn {idx} content mismatch: "
            f"expected {expected['content']!r}, got {sent['content']!r}"
        )

    # 3. The new user message is the last entry and contains the
    # current code + the user's prompt.
    final_message = sent_messages[-1]
    assert final_message["role"] == "user", (
        f"Last message should be the new 'user' message, " f"got {final_message!r}"
    )
    final_content = final_message["content"]
    assert "=== CURRENT CODE START ===" in final_content, (
        f"Final user message should contain the current-code "
        f"delimiter. Got: {final_content!r}"
    )
    assert "add a dark mode toggle" in final_content, (
        f"Final user message should contain the user's prompt. "
        f"Got: {final_content!r}"
    )

    # 4. Sanity check: total length = 1 system + len(history) + 1 user.
    assert len(sent_messages) == 1 + len(history) + 1, (
        f"Expected {1 + len(history) + 1} messages "
        f"(system + history + new user), got {len(sent_messages)}: "
        f"{sent_messages!r}"
    )


async def test_iterate_strips_model_prefix(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ``opencode-go/`` prefix is stripped before the upstream call.

    The Go gateway expects the bare model id; the prefix is a
    CLI / display convention only. The route strips it
    explicitly so the value is observable in the call args
    (and so the route does not depend on the client's internal
    stripping for correctness).

    Asserts:
        * HTTP 200
        * The ``model`` kwarg passed to ``stream_chat`` is the
          bare id (``"minimax-m3"``), not the prefixed form.
    """
    _patch_opencode_client(monkeypatch, mock_client)

    response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(
            project_id=test_project["id"], model="opencode-go/minimax-m3"
        ),
    )
    assert response.status_code == 200

    events = await _collect_sse_events(response)
    assert any(
        e.get("type") == "done" for e in events
    ), f"Expected 'done' event, got {events!r}"

    mock_client.stream_chat.assert_called()
    call_kwargs = mock_client.stream_chat.call_args.kwargs
    sent_model = call_kwargs.get("model", "")

    assert sent_model == "minimax-m3", (
        f"Expected the bare model id 'minimax-m3' in the stream_chat "
        f"call, got {sent_model!r} — the opencode-go/ prefix must be "
        f"stripped before the upstream call."
    )
    assert "opencode-go/" not in sent_model, (
        f"Prefix should be stripped from the model passed to "
        f"stream_chat, got {sent_model!r}"
    )


async def test_iterate_strips_code_fences(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Markdown fences around the iteration output are stripped from SSE code events.

    Mirrors ``test_generate_strips_code_fences`` for the iterate route:
    the model may wrap the updated HTML in fences, and the route must
    remove them before streaming the code to the frontend.

    Asserts:
        * HTTP 200
        * The concatenated code events contain no backtick fences
        * The sanitised output starts with ``<!DOCTYPE html>`` and ends
          with ``</html>``
    """
    from unittest.mock import AsyncMock, MagicMock

    fence_mock = MagicMock(name="fence_iterate_client")

    async def _fenced_stream(*_args, **_kwargs):
        for chunk in ("```html\n", "<!DOCTYPE html>", "<html>", "</html>", "\n```"):
            yield chunk

    fence_mock.stream_chat = MagicMock(side_effect=_fenced_stream, name="stream_chat")
    fence_mock.chat = AsyncMock(return_value="unused", name="chat")
    fence_mock.close = AsyncMock(return_value=None, name="close")

    _patch_opencode_client(monkeypatch, fence_mock)

    response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(project_id=test_project["id"]),
    )
    assert (
        response.status_code == 200
    ), f"Expected 200, got {response.status_code}: {response.text}"

    events = await _collect_sse_events(response)
    code_text = "".join(e.get("content", "") for e in events if e.get("type") == "code")

    assert (
        "```" not in code_text
    ), f"Markdown fences must be stripped from iterate code events. Got: {code_text!r}"
    assert code_text.startswith(
        "<!DOCTYPE html>"
    ), f"Sanitised output should start with <!DOCTYPE html>. Got: {code_text!r}"
    assert code_text.rstrip().endswith(
        "</html>"
    ), f"Sanitised output should end with </html>. Got: {code_text!r}"


# ---------------------------------------------------------------------------
# Schema-level unit tests (no HTTP)
# ---------------------------------------------------------------------------
#
# The Pydantic v2 schemas are the wire contract. A handful of
# in-process tests catch regressions in validation that would
# otherwise be hidden behind a 422 from the route.


def test_chat_message_rejects_invalid_role() -> None:
    """``ChatMessage.role`` only accepts ``"user"`` or ``"assistant"``."""
    from pydantic import ValidationError

    from app.models.schemas import ChatMessage

    with pytest.raises(ValidationError):
        ChatMessage(role="system", content="x")
    with pytest.raises(ValidationError):
        ChatMessage(role="", content="x")


def test_chat_message_accepts_user_and_assistant() -> None:
    """``ChatMessage`` accepts both valid roles."""
    from app.models.schemas import ChatMessage

    user_msg = ChatMessage(role="user", content="hi")
    assert user_msg.role == "user"
    assert user_msg.content == "hi"

    assistant_msg = ChatMessage(role="assistant", content="<html/>")
    assert assistant_msg.role == "assistant"


def test_iterate_request_history_defaults_to_empty() -> None:
    """Omitting ``history`` applies an empty-list default."""
    from app.models.schemas import IterateRequest

    req = IterateRequest(
        prompt="add a button",
        current_code="<!DOCTYPE html><html></html>",
        model="opencode-go/minimax-m3",
        project_id=1,
    )
    assert req.history == []


def test_iterate_request_rejects_too_long_prompt() -> None:
    """``prompt`` above 10 000 chars is rejected."""
    from pydantic import ValidationError

    from app.models.schemas import IterateRequest

    with pytest.raises(ValidationError):
        IterateRequest(
            prompt="x" * 10001,
            current_code="<!DOCTYPE html><html></html>",
            model="opencode-go/minimax-m3",
            project_id=1,
        )


def test_iterate_request_rejects_too_long_history() -> None:
    """``history`` above 50 messages is rejected."""
    from pydantic import ValidationError

    from app.models.schemas import ChatMessage, IterateRequest

    too_many = [ChatMessage(role="user", content=f"turn {i}") for i in range(51)]
    with pytest.raises(ValidationError):
        IterateRequest(
            prompt="x",
            current_code="<!DOCTYPE html><html></html>",
            model="opencode-go/minimax-m3",
            history=too_many,
            project_id=1,
        )


async def test_iterate_requires_project_id(auth_client: AsyncClient) -> None:
    """Omitting ``project_id`` returns HTTP 422."""
    response = await auth_client.post(
        "/api/iterate",
        json={
            "prompt": "change color",
            "current_code": "<html></html>",
            "model": "opencode-go/minimax-m3",
        },
    )
    assert response.status_code == 422, (
        f"Expected 422 for missing project_id, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert "detail" in body
    detail_blob = str(body["detail"])
    assert "project_id" in detail_blob


async def test_iterate_404_for_other_users_project(
    auth_client: AsyncClient,
    test_user: dict,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Iterating on a project owned by another user returns 404."""
    from app.main import app
    from app.models.database import User, get_db
    from app.routes.deps import create_access_token

    # Create a project as the test user.
    create_response = await auth_client.post(
        "/api/projects",
        json={
            "title": "Owned Project",
            "prompt": "mine",
            "code": "<html></html>",
            "model": "opencode-go/minimax-m3",
        },
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["id"]

    # Create a second user and authenticate the client as them.
    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        other = User(github_id=99999, username="other-user")
        session.add(other)
        await session.commit()
        await session.refresh(other)
        other_token = create_access_token(
            sub=str(other.id), extra_claims={"username": other.username}
        )
    finally:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass

    client.cookies.set("forge_token", other_token)
    response = await client.post(
        "/api/iterate",
        json=_iterate_payload(project_id=project_id),
    )
    assert response.status_code == 404, (
        f"Expected 404 for cross-user iterate, got "
        f"{response.status_code}: {response.text}"
    )
    body = response.json()
    assert body.get("detail") == "Project not found"


async def test_iterate_per_project_cap_blocks_after_cap(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A project allows ``ITERATION_LIMIT`` iterations, then 429."""
    from app.config import settings

    _patch_opencode_client(monkeypatch, mock_client)

    cap = settings.ITERATION_LIMIT
    project_id = test_project["id"]

    for i in range(cap):
        response = await auth_client.post(
            "/api/iterate",
            json=_iterate_payload(
                project_id=project_id,
                prompt=f"change {i}",
                current_code=f"<html>v{i}</html>",
            ),
        )
        assert response.status_code == 200, (
            f"Expected 200 on iterate #{i + 1}/{cap}, got "
            f"{response.status_code}: {response.text}"
        )

    # The (cap+1)th request is blocked by the per-project cap.
    over_response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(
            project_id=project_id,
            prompt="over the cap",
            current_code="<html>x</html>",
        ),
    )
    assert over_response.status_code == 429, (
        f"Expected 429 over per-project cap, got "
        f"{over_response.status_code}: {over_response.text}"
    )
    detail = over_response.json().get("detail")
    assert (
        "10-iteration limit" in detail
    ), f"Expected per-project cap message, got {detail!r}"


async def test_iterate_per_project_cap_independent_between_projects(
    auth_client: AsyncClient,
    test_project: dict[str, Any],
    mock_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hitting the cap on one project does not block iterations on another."""
    from app.config import settings

    _patch_opencode_client(monkeypatch, mock_client)

    # Push the first project to its cap.
    project_id = test_project["id"]
    for i in range(settings.ITERATION_LIMIT):
        response = await auth_client.post(
            "/api/iterate",
            json=_iterate_payload(
                project_id=project_id,
                prompt=f"change {i}",
                current_code=f"<html>v{i}</html>",
            ),
        )
        assert response.status_code == 200

    # Create a second project.
    create_response = await auth_client.post(
        "/api/projects",
        json={
            "title": "Second Project",
            "prompt": "another project",
            "code": "<html></html>",
            "model": "opencode-go/minimax-m3",
        },
    )
    assert create_response.status_code == 201
    second_project_id = create_response.json()["id"]

    # Iterating on the second project should succeed.
    response = await auth_client.post(
        "/api/iterate",
        json=_iterate_payload(
            project_id=second_project_id,
            prompt="first change on second project",
        ),
    )
    assert response.status_code == 200, (
        f"Expected 200 iterating on second project, got "
        f"{response.status_code}: {response.text}"
    )
