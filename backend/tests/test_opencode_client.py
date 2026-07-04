"""Unit tests for ``app.services.opencode_client.OpenCodeClient``.

These tests target the OpenCode Go gateway client in isolation — no
FastAPI app, no SSE — by patching ``httpx.AsyncClient`` at the
``app.services.opencode_client`` module boundary.

The Go gateway exposes two different wire protocols depending on the
model family, so the suite covers both:

* **OpenAI-compatible** ``/chat/completions`` (DeepSeek, GLM, Kimi,
  MiMo). Standard ``data: {"choices":[{"delta":{"content":"..."}}]}``
  lines plus a ``data: [DONE]`` terminator.
* **Anthropic Messages** ``/messages`` (MiniMax M3, Qwen3.7, etc).
  ``event:`` and ``data:`` lines; only ``content_block_delta`` events
  with ``delta.text`` carry visible text, and ``message_stop`` ends
  the stream.

Coverage:

* ``stream_chat`` correctly parses an OpenAI-style SSE response and
  yields the concatenated ``choices[].delta.content`` fragments.
* ``stream_chat`` correctly parses an Anthropic-style SSE response
  and yields ``delta.text`` only from ``content_block_delta`` events.
* ``stream_chat`` strips the ``opencode-go/`` prefix from the model
  id before sending the request and routes to the correct endpoint
  based on the bare id.
* ``chat`` returns ``choices[0].message.content`` (OpenAI) and
  ``content[0].text`` (Anthropic) from non-streaming responses.
* ``chat`` and ``stream_chat`` raise ``OpenCodeAPIError`` with the
  original ``status_code`` preserved on non-2xx responses.
* The system message is hoisted to the top-level ``system`` field for
  Anthropic-format requests.
"""

from __future__ import annotations

from typing import Any, AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.opencode_client import OpenCodeAPIError, OpenCodeClient

# The patch path is shared across all tests; keep it as a constant.
_HTTPX_PATH = "app.services.opencode_client.httpx.AsyncClient"


# ---------------------------------------------------------------------------
# Helpers for building mock httpx responses
# ---------------------------------------------------------------------------


def _async_iter(items: list[str]) -> AsyncIterator[str]:
    """Return an async generator that yields each item in ``items``.

    Used to stand in for ``httpx.Response.aiter_lines()``.
    """

    async def _gen() -> AsyncIterator[str]:
        for item in items:
            yield item

    return _gen()


def _make_streaming_response(lines: list[str], status_code: int = 200) -> MagicMock:
    """Build a mock httpx response whose ``aiter_lines()`` yields ``lines``.

    Args:
        lines: The newline-separated SSE lines (each line is a string
            like ``'data: {"choices":[...]}'``).
        status_code: The HTTP status the mock will report. The real
            ``OpenCodeClient.stream_chat`` checks ``status_code`` for
            2xx before reading the body, so a 2xx default is required
            to reach the SSE parsing branch.

    Returns:
        A ``MagicMock`` duck-typed as an ``httpx.Response`` for the
        streaming code path.
    """
    response = MagicMock(name=f"httpx_response_streaming_{status_code}")
    response.status_code = status_code
    # `return_value` is evaluated once at MagicMock construction; the
    # async iterator returned is then reused by `async for` in the
    # OpenCodeClient. That matches the production pattern where a
    # single response is consumed in a single `async for` block.
    response.aiter_lines = MagicMock(return_value=_async_iter(lines))
    return response


def _make_stream_context_manager(response: MagicMock) -> MagicMock:
    """Wrap ``response`` in a mock async context manager.

    Matches the ``async with client.stream(...) as response:`` pattern.
    """
    cm = MagicMock(name="stream_context_manager")
    cm.__aenter__ = AsyncMock(return_value=response)
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm


def _make_json_response(payload: dict[str, Any], status_code: int = 200) -> MagicMock:
    """Build a mock httpx response for a non-streaming JSON call.

    Args:
        payload: The dict that ``response.json()`` will return.
        status_code: The HTTP status the mock will report.

    Returns:
        A ``MagicMock`` duck-typed as an ``httpx.Response`` for the
        non-streaming code path.
    """
    response = MagicMock(name=f"httpx_response_{status_code}")
    response.status_code = status_code
    response.json = MagicMock(return_value=payload)
    return response


# ---------------------------------------------------------------------------
# Tests — OpenAI-compatible protocol
# ---------------------------------------------------------------------------


async def test_openai_stream_chat_parses_sse() -> None:
    """OpenAI ``stream_chat`` yields the deltas from an SSE chunked response.

    Mocks an httpx stream that emits two OpenAI-style delta chunks
    followed by the ``[DONE]`` sentinel. Asserts that ``stream_chat``
    produces exactly the two content fragments in order and ignores
    the sentinel.

    Asserts:
        * Returned chunks equal ``["hello", " world"]`` in order
        * ``[DONE]`` is filtered out (it is an SSE terminator, not data)
        * ``client.stream(...)`` was called with ``stream=True``
        * The bare model id (no prefix) was sent to the server
    """
    sse_lines = [
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        "data: [DONE]",
    ]
    mock_response = _make_streaming_response(sse_lines)
    mock_stream_cm = _make_stream_context_manager(mock_response)

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.stream = MagicMock(
            return_value=mock_stream_cm, name="stream"
        )
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="test-key")
        chunks: list[str] = []
        async for chunk in client.stream_chat(
            messages=[{"role": "user", "content": "say hi"}],
            model="opencode-go/deepseek-v4-flash",
        ):
            chunks.append(chunk)

    assert chunks == [
        "hello",
        " world",
    ], f"Expected ['hello', ' world'], got {chunks!r}"

    # The client must have been asked to open a stream against the
    # chat/completions endpoint with stream=True.
    stream_call = mock_client_instance.stream.call_args
    assert stream_call is not None, "client.stream(...) was not called"
    # Accept either kwargs or positional args for the JSON body.
    body = stream_call.kwargs.get("json") or (
        stream_call.args[2] if len(stream_call.args) >= 3 else None
    )
    assert (
        body is not None
    ), f"stream() was not called with a JSON body: {stream_call!r}"
    assert (
        body.get("stream") is True
    ), f"stream() body should set stream=True, got body={body!r}"
    # The prefix must be stripped before sending.
    assert (
        body.get("model") == "deepseek-v4-flash"
    ), f"stream() body should send the bare model id, got body={body!r}"
    # The URL path should be the OpenAI-compatible endpoint.
    # httpx.AsyncClient.stream is called as stream(method, url, ...),
    # so args[0] is the method and args[1] is the URL.
    method = (
        stream_call.args[0] if stream_call.args else stream_call.kwargs.get("method")
    )
    url = (
        stream_call.args[1]
        if len(stream_call.args) >= 2
        else stream_call.kwargs.get("url")
    )
    assert method == "POST", f"Expected POST, got {method!r}"
    assert (
        url == "/chat/completions"
    ), f"OpenAI models should hit /chat/completions, got url={url!r}"


async def test_openai_chat_returns_full_string() -> None:
    """OpenAI ``chat`` returns the full ``choices[0].message.content`` string.

    Asserts:
        * Returned value equals the ``content`` of the first choice
        * The non-streaming request sets ``stream=False``
    """
    payload = {
        "choices": [{"message": {"role": "assistant", "content": "the full response"}}]
    }
    mock_response = _make_json_response(payload)

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.post = AsyncMock(return_value=mock_response, name="post")
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="test-key")
        result = await client.chat(
            messages=[{"role": "user", "content": "say hi"}],
            model="opencode-go/deepseek-v4-flash",
        )

    assert (
        result == "the full response"
    ), f"Expected 'the full response', got {result!r}"

    # Verify the request shape: stream=False on a non-streaming call.
    post_call = mock_client_instance.post.call_args
    assert post_call is not None, "client.post(...) was not called"
    body = post_call.kwargs.get("json") or (
        post_call.args[1] if len(post_call.args) >= 2 else None
    )
    assert body is not None, f"post() was not called with a JSON body: {post_call!r}"
    assert (
        body.get("stream") is False
    ), f"chat() body should set stream=False, got body={body!r}"
    assert (
        body.get("model") == "deepseek-v4-flash"
    ), f"chat() should send the bare model id, got body={body!r}"


# ---------------------------------------------------------------------------
# Tests — Anthropic Messages protocol
# ---------------------------------------------------------------------------


async def test_anthropic_stream_chat_parses_sse() -> None:
    """Anthropic ``stream_chat`` yields text from ``content_block_delta`` events.

    Mocks an httpx stream that emits a realistic sequence of Anthropic
    SSE events: ``message_start`` (no text), ``content_block_start``
    (no text), a series of ``content_block_delta`` events with
    ``delta.text``, ``content_block_stop`` (no text), ``message_delta``
    (no text), and finally ``message_stop`` (terminator).

    Asserts:
        * The generator yields exactly the concatenated text fragments
        * Only ``content_block_delta`` events contribute text
        * ``message_stop`` ends the stream cleanly
    """
    sse_lines = [
        "event: message_start\r",
        'data: {"type":"message_start","message":{"id":"msg_01"}}',
        "",
        "event: content_block_start\r",
        'data: {"type":"content_block_start","index":0,'
        '"content_block":{"type":"text","text":""}}',
        "",
        "event: content_block_delta\r",
        'data: {"type":"content_block_delta","index":0,'
        '"delta":{"type":"text_delta","text":"Hello"}}',
        "",
        "event: content_block_delta\r",
        'data: {"type":"content_block_delta","index":0,'
        '"delta":{"type":"text_delta","text":", world"}}',
        "",
        "event: content_block_stop\r",
        'data: {"type":"content_block_stop","index":0}',
        "",
        "event: message_delta\r",
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
        "",
        "event: message_stop\r",
        'data: {"type":"message_stop"}',
        "",
    ]
    mock_response = _make_streaming_response(sse_lines)
    mock_stream_cm = _make_stream_context_manager(mock_response)

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.stream = MagicMock(
            return_value=mock_stream_cm, name="stream"
        )
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="test-key")
        chunks: list[str] = []
        async for chunk in client.stream_chat(
            messages=[
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "say hi"},
            ],
            model="opencode-go/minimax-m3",
        ):
            chunks.append(chunk)

    assert chunks == [
        "Hello",
        ", world",
    ], f"Expected ['Hello', ', world'], got {chunks!r}"

    # Verify the request shape: hits /messages with system hoisted out.
    stream_call = mock_client_instance.stream.call_args
    assert stream_call is not None
    body = stream_call.kwargs.get("json") or (
        stream_call.args[2] if len(stream_call.args) >= 3 else None
    )
    assert body is not None
    assert body.get("stream") is True
    assert (
        body.get("model") == "minimax-m3"
    ), f"Should send bare model id, got body={body!r}"
    # System message must be a top-level field, not a messages entry.
    assert (
        body.get("system") == "You are helpful."
    ), f"System content should be hoisted to top-level, got body={body!r}"
    messages = body.get("messages", [])
    assert all(
        m.get("role") != "system" for m in messages
    ), f"System must be removed from messages, got messages={messages!r}"
    # URL must be the Anthropic endpoint. stream() is called as
    # stream(method, url, ...), so args[0] is the method and args[1] is
    # the URL.
    url = (
        stream_call.args[1]
        if len(stream_call.args) >= 2
        else stream_call.kwargs.get("url")
    )
    assert url == "/messages", f"Anthropic models should hit /messages, got url={url!r}"


async def test_anthropic_chat_returns_full_string() -> None:
    """Anthropic ``chat`` returns ``content[0].text`` from a non-streaming response.

    Asserts:
        * Returned value equals the ``text`` of the first content block
        * The system message is hoisted to the top-level ``system`` field
    """
    payload = {
        "id": "msg_01",
        "content": [{"type": "text", "text": "the full response"}],
    }
    mock_response = _make_json_response(payload)

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.post = AsyncMock(return_value=mock_response, name="post")
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="test-key")
        result = await client.chat(
            messages=[
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "say hi"},
            ],
            model="opencode-go/minimax-m3",
        )

    assert (
        result == "the full response"
    ), f"Expected 'the full response', got {result!r}"

    # Verify the request shape: system hoisted, /messages endpoint used.
    post_call = mock_client_instance.post.call_args
    assert post_call is not None
    body = post_call.kwargs.get("json") or (
        post_call.args[1] if len(post_call.args) >= 2 else None
    )
    assert body is not None
    assert (
        body.get("system") == "You are helpful."
    ), f"System should be hoisted, got body={body!r}"
    assert body.get("model") == "minimax-m3"
    url = post_call.args[0] if post_call.args else post_call.kwargs.get("url")
    assert url == "/messages", f"Anthropic models should hit /messages, got url={url!r}"


# ---------------------------------------------------------------------------
# Tests — error handling (shared between protocols)
# ---------------------------------------------------------------------------


async def test_openai_chat_raises_on_error() -> None:
    """A 401 from the gateway causes OpenAI ``chat`` to raise ``OpenCodeAPIError``.

    Asserts:
        * ``chat`` raises ``OpenCodeAPIError`` (a subclass of ``Exception``)
        * The raised ``OpenCodeAPIError`` carries ``status_code == 401``
    """
    error_response = MagicMock(name="httpx_response_401")
    error_response.status_code = 401
    error_response.text = "Unauthorized"

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.post = AsyncMock(return_value=error_response, name="post")
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="invalid-key")
        with pytest.raises(OpenCodeAPIError) as exc_info:
            await client.chat(
                messages=[{"role": "user", "content": "say hi"}],
                model="opencode-go/deepseek-v4-flash",
            )

    assert exc_info.value.status_code == 401, (
        f"Expected status_code=401 on OpenCodeAPIError, "
        f"got status_code={exc_info.value.status_code!r} "
        f"message={str(exc_info.value)!r}"
    )


async def test_anthropic_chat_raises_on_error() -> None:
    """A 401 from the gateway causes Anthropic ``chat`` to raise ``OpenCodeAPIError``.

    Asserts:
        * ``chat`` raises ``OpenCodeAPIError``
        * The raised ``OpenCodeAPIError`` carries ``status_code == 401``
    """
    error_response = MagicMock(name="httpx_response_401_anthropic")
    error_response.status_code = 401
    error_response.text = "Unauthorized"

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.post = AsyncMock(return_value=error_response, name="post")
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="invalid-key")
        with pytest.raises(OpenCodeAPIError) as exc_info:
            await client.chat(
                messages=[{"role": "user", "content": "say hi"}],
                model="opencode-go/minimax-m3",
            )

    assert exc_info.value.status_code == 401, (
        f"Expected status_code=401 on OpenCodeAPIError, "
        f"got status_code={exc_info.value.status_code!r} "
        f"message={str(exc_info.value)!r}"
    )


async def test_openai_stream_chat_raises_on_error() -> None:
    """A 401 from the gateway causes OpenAI ``stream_chat`` to raise ``OpenCodeAPIError``.

    The streaming path checks ``response.status_code`` before reading
    the body. A non-2xx status must raise :class:`OpenCodeAPIError`
    carrying the original ``status_code``.

    Asserts:
        * ``stream_chat`` raises ``OpenCodeAPIError``
        * The raised ``OpenCodeAPIError`` carries ``status_code == 401``
    """
    error_response = MagicMock(name="httpx_response_401_stream")
    error_response.status_code = 401
    error_response.aread = AsyncMock(return_value=b"Unauthorized", name="aread")

    mock_stream_cm = _make_stream_context_manager(error_response)

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.stream = MagicMock(
            return_value=mock_stream_cm, name="stream"
        )
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="invalid-key")
        with pytest.raises(OpenCodeAPIError) as exc_info:
            chunks: list[str] = []
            async for chunk in client.stream_chat(
                messages=[{"role": "user", "content": "say hi"}],
                model="opencode-go/deepseek-v4-flash",
            ):
                chunks.append(chunk)

    assert exc_info.value.status_code == 401, (
        f"Expected status_code=401 on OpenCodeAPIError, "
        f"got status_code={exc_info.value.status_code!r} "
        f"message={str(exc_info.value)!r}"
    )


async def test_anthropic_stream_chat_raises_on_error() -> None:
    """A 401 from the gateway causes Anthropic ``stream_chat`` to raise ``OpenCodeAPIError``.

    Asserts:
        * ``stream_chat`` raises ``OpenCodeAPIError``
        * The raised ``OpenCodeAPIError`` carries ``status_code == 401``
    """
    error_response = MagicMock(name="httpx_response_401_anthropic_stream")
    error_response.status_code = 401
    error_response.aread = AsyncMock(return_value=b"Unauthorized", name="aread")

    mock_stream_cm = _make_stream_context_manager(error_response)

    with patch(_HTTPX_PATH) as MockAsyncClient:
        mock_client_instance = MagicMock(name="httpx_async_client")
        mock_client_instance.stream = MagicMock(
            return_value=mock_stream_cm, name="stream"
        )
        MockAsyncClient.return_value = mock_client_instance

        client = OpenCodeClient(api_key="invalid-key")
        with pytest.raises(OpenCodeAPIError) as exc_info:
            chunks: list[str] = []
            async for chunk in client.stream_chat(
                messages=[{"role": "user", "content": "say hi"}],
                model="opencode-go/minimax-m3",
            ):
                chunks.append(chunk)

    assert exc_info.value.status_code == 401, (
        f"Expected status_code=401 on OpenCodeAPIError, "
        f"got status_code={exc_info.value.status_code!r} "
        f"message={str(exc_info.value)!r}"
    )


# ---------------------------------------------------------------------------
# Tests — prefix stripping and protocol routing
# ---------------------------------------------------------------------------


def test_strip_prefix_handles_both_prefixes() -> None:
    """``_strip_prefix`` removes both ``opencode-go/`` and ``opencode/``."""
    assert OpenCodeClient._strip_prefix("opencode-go/minimax-m3") == "minimax-m3"
    assert OpenCodeClient._strip_prefix("opencode/minimax-m3") == "minimax-m3"
    assert OpenCodeClient._strip_prefix("minimax-m3") == "minimax-m3"
    # Unrelated prefixes should be left alone.
    assert (
        OpenCodeClient._strip_prefix("anthropic/claude-3-5-sonnet")
        == "anthropic/claude-3-5-sonnet"
    )


def test_is_anthropic_model_routes_correctly() -> None:
    """``_is_anthropic_model`` returns True only for Anthropic-protocol models.

    The check is performed on the bare id (prefix stripped), so both
    ``minimax-m3`` and ``opencode-go/minimax-m3`` are recognised.
    """
    # Anthropic-protocol models (true).
    assert OpenCodeClient._is_anthropic_model("minimax-m3") is True
    assert OpenCodeClient._is_anthropic_model("opencode-go/minimax-m3") is True
    assert OpenCodeClient._is_anthropic_model("qwen3.7-plus") is True
    assert OpenCodeClient._is_anthropic_model("opencode-go/qwen3.7-max") is True

    # OpenAI-protocol models (false).
    assert OpenCodeClient._is_anthropic_model("deepseek-v4-flash") is False
    assert OpenCodeClient._is_anthropic_model("opencode-go/deepseek-v4-flash") is False
    assert OpenCodeClient._is_anthropic_model("kimi-k2.6") is False
    assert OpenCodeClient._is_anthropic_model("glm-5.2") is False


def test_split_system_message_extracts_and_removes() -> None:
    """``_split_system_message`` returns the system content and remaining messages."""
    system, remaining = OpenCodeClient._split_system_message(
        [
            {"role": "system", "content": "be brief"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
    )
    assert system == "be brief"
    assert remaining == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]


def test_split_system_message_joins_multiple() -> None:
    """Multiple system messages are joined with newlines; non-system entries pass through."""
    system, remaining = OpenCodeClient._split_system_message(
        [
            {"role": "system", "content": "be brief"},
            {"role": "system", "content": "use markdown"},
            {"role": "user", "content": "hi"},
        ]
    )
    assert system == "be brief\nuse markdown"
    assert remaining == [{"role": "user", "content": "hi"}]


def test_split_system_message_handles_missing() -> None:
    """No system message yields ``None`` and the original list unchanged."""
    system, remaining = OpenCodeClient._split_system_message(
        [{"role": "user", "content": "hi"}]
    )
    assert system is None
    assert remaining == [{"role": "user", "content": "hi"}]


def test_split_system_message_handles_empty_string() -> None:
    """An empty / whitespace system content is dropped."""
    system, remaining = OpenCodeClient._split_system_message(
        [
            {"role": "system", "content": ""},
            {"role": "user", "content": "hi"},
        ]
    )
    assert system is None
    assert remaining == [{"role": "user", "content": "hi"}]
