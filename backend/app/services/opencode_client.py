"""Async client for the OpenCode Go chat APIs.

The OpenCode Go gateway (https://opencode.ai/zen/go/v1) exposes two
different wire protocols depending on the model family. This client
handles both transparently and routes by model id:

* **OpenAI-compatible** ``/chat/completions`` for
  deepseek-v4-flash, deepseek-v4-pro, kimi-k2.6, kimi-k2.7-code,
  glm-5.1, glm-5.2, mimo-v2.5, mimo-v2.5-pro. Standard OpenAI SSE:
  ``data: {"choices":[{"delta":{"content":"text"}}]}`` and a
  ``data: [DONE]`` terminator.
* **Anthropic Messages** ``/messages`` for
  minimax-m3, minimax-m2.7, qwen3.7-plus, qwen3.7-max, qwen3.6-plus.
  The ``system`` prompt is a top-level field, the Anthropic version
  header is required, and the SSE stream emits ``event:`` lines plus
  ``data:`` lines. Only ``content_block_delta`` events carry text
  (``delta.text``); the stream ends with ``message_stop``.

Model ids are accepted with or without the ``opencode-go/`` /
``opencode/`` prefix — the prefix is stripped before the API call
because the Go gateway expects the bare id. The prefix is purely a
CLI / display convention.

Typical usage::

    async with OpenCodeClient(
        api_key=settings.OPENCODE_API_KEY,
    ) as client:
        text = await client.chat(
            messages,
            model="opencode-go/deepseek-v4-flash",
        )
        async for chunk in client.stream_chat(
            messages,
            model="opencode-go/minimax-m3",
        ):
            print(chunk, end="")
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any

import httpx

# Models served by the Anthropic Messages endpoint on the Go gateway.
# Bare ids (no prefix) — the prefix is stripped before lookup.
_ANTHROPIC_MODELS: frozenset[str] = frozenset(
    {
        "minimax-m3",
        "minimax-m2.7",
        "qwen3.7-plus",
        "qwen3.7-max",
        "qwen3.6-plus",
    }
)


class OpenCodeAPIError(Exception):
    """Raised on non-2xx responses or malformed payloads from the OpenCode API.

    Attributes:
        status_code: HTTP status code returned by the API, if available.
        response_text: Raw response body text, if available.
    """

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_text: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text


class OpenCodeClient:
    """Async client for the OpenCode Go chat APIs (OpenAI + Anthropic protocols).

    Wraps a single ``httpx.AsyncClient`` configured with the Go base URL,
    a Bearer-token auth header, and a generous read timeout suitable for
    streaming code generation (often 30-120s per response). The
    Anthropic version header is also added at construction time; it is
    ignored by the OpenAI endpoint.

    The client is intended to be created once per request and explicitly
    closed via :meth:`close` (or used as an async context manager).
    """

    DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"
    """Default OpenCode Go gateway base URL (no trailing path)."""

    ANTHROPIC_VERSION = "2023-06-01"
    """Anthropic API version header required by the ``/messages`` endpoint."""

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
    ) -> None:
        """Initialise the client.

        Args:
            api_key: Bearer token for the OpenCode Go API. The same key
                works for both protocols.
            base_url: OpenCode Go gateway base URL. Defaults to the public
                production URL. Trailing slashes are tolerated but
                unnecessary; the client appends ``/chat/completions`` or
                ``/messages`` directly.
        """
        self.api_key = api_key
        self.base_url = base_url
        self.client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(120.0, connect=10.0),
            headers={
                # OpenAI-compatible endpoint uses Bearer auth.
                "Authorization": f"Bearer {api_key}",
                # Anthropic Messages endpoint requires x-api-key (standard
                # Anthropic auth). The OpenAI endpoint ignores it, so setting
                # both globally keeps both protocols working without branching.
                "x-api-key": api_key,
                "Content-Type": "application/json",
                # The Anthropic endpoint requires this; the OpenAI endpoint
                # silently ignores it. Setting it globally is the simplest
                # way to keep both protocols working without branching.
                "anthropic-version": self.ANTHROPIC_VERSION,
            },
        )

    async def close(self) -> None:
        """Close the underlying ``httpx.AsyncClient`` and release its connections.

        Safe to call multiple times.
        """
        await self.client.aclose()

    async def __aenter__(self) -> OpenCodeClient:
        """Enter the async context, returning the client itself."""
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        """Exit the async context, closing the underlying client."""
        await self.close()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_prefix(model: str) -> str:
        """Strip the ``opencode-go/`` or ``opencode/`` prefix from a model id.

        The Go gateway expects the bare model id; the prefix is a CLI
        / display convention only.

        Args:
            model: A model id, with or without the prefix.

        Returns:
            The model id without any recognised prefix.
        """
        for prefix in ("opencode-go/", "opencode/"):
            if model.startswith(prefix):
                return model[len(prefix) :]
        return model

    @classmethod
    def _is_anthropic_model(cls, model: str) -> bool:
        """Return True if ``model`` is served by the Anthropic ``/messages`` endpoint.

        The check operates on the bare model id (after prefix stripping).
        """
        return cls._strip_prefix(model) in _ANTHROPIC_MODELS

    @staticmethod
    def _split_system_message(
        messages: list[dict[str, str]],
    ) -> tuple[str | None, list[dict[str, str]]]:
        """Extract the system message for Anthropic-format requests.

        Anthropic's ``/messages`` endpoint takes the system prompt as a
        top-level field rather than as a message in the messages array,
        so we pull it out and return the remaining messages.

        Args:
            messages: OpenAI-style messages, which may include a
                ``{"role": "system", "content": "..."}`` entry.

        Returns:
            A ``(system, remaining)`` tuple. ``system`` is the system
            content (or ``None`` if absent), and ``remaining`` is the
            messages list with any system entry removed. Multiple system
            entries are concatenated with ``"\n"``; the function is
            tolerant of empty / missing entries.
        """
        system_parts: list[str] = []
        remaining: list[dict[str, str]] = []
        for message in messages:
            if message.get("role") == "system":
                content = message.get("content")
                if isinstance(content, str) and content:
                    system_parts.append(content)
            else:
                remaining.append(message)
        system = "\n".join(system_parts) if system_parts else None
        return system, remaining

    @staticmethod
    def _check_status(response: httpx.Response) -> None:
        """Raise :class:`OpenCodeAPIError` if ``response`` is not a 2xx status."""
        if response.status_code < 200 or response.status_code >= 300:
            raise OpenCodeAPIError(
                f"OpenCode API returned status {response.status_code}: {response.text}",
                status_code=response.status_code,
                response_text=response.text,
            )

    # ------------------------------------------------------------------
    # Non-streaming
    # ------------------------------------------------------------------

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 8192,
    ) -> str:
        """Call the Go gateway without streaming and return the full reply.

        Routes to the Anthropic ``/messages`` endpoint or the OpenAI
        ``/chat/completions`` endpoint based on the model id. Used by
        agents that need the entire output at once (e.g. the planner).

        Args:
            messages: OpenAI-style chat messages, each with ``role`` and
                ``content`` keys. May include a single ``system`` entry,
                which is moved to the top-level ``system`` field for
                Anthropic-format requests.
            model: Model identifier with or without the
                ``opencode-go/`` prefix.
            temperature: Sampling temperature in the model's valid range.
            max_tokens: Maximum number of tokens to generate.

        Returns:
            The assistant's full reply as a single string.

        Raises:
            OpenCodeAPIError: If the API returns a non-2xx status or the
                response payload is missing the expected content field
                (``content[0].text`` for Anthropic, ``choices[0].message.content``
                for OpenAI).
        """
        bare_model = self._strip_prefix(model)

        if self._is_anthropic_model(bare_model):
            return await self._chat_anthropic(
                messages=messages,
                model=bare_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        return await self._chat_openai(
            messages=messages,
            model=bare_model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def _chat_anthropic(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Non-streaming Anthropic Messages call."""
        system, remaining = self._split_system_message(messages)
        payload: dict[str, Any] = {
            "model": model,
            "messages": remaining,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system is not None:
            payload["system"] = system

        try:
            response = await self.client.post("/messages", json=payload)
        except httpx.HTTPError as exc:
            raise OpenCodeAPIError(
                f"Network error calling OpenCode API: {exc}"
            ) from exc

        self._check_status(response)

        try:
            data = response.json()
            content = data["content"][0]["text"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise OpenCodeAPIError(
                f"Malformed OpenCode API response: {response.text[:500]}"
            ) from exc
        return str(content)

    async def _chat_openai(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Non-streaming OpenAI-completions call."""
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        try:
            response = await self.client.post("/chat/completions", json=payload)
        except httpx.HTTPError as exc:
            raise OpenCodeAPIError(
                f"Network error calling OpenCode API: {exc}"
            ) from exc

        self._check_status(response)

        try:
            data = response.json()
            return str(data["choices"][0]["message"]["content"])
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise OpenCodeAPIError(
                f"Malformed OpenCode API response: {response.text[:500]}"
            ) from exc

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 8192,
    ) -> AsyncGenerator[str, None]:
        """Call the Go gateway and stream the response.

        Routes to the Anthropic ``/messages`` endpoint or the OpenAI
        ``/chat/completions`` endpoint based on the model id.

        For OpenAI: parses ``choices[].delta.content`` from each
        ``data:`` SSE line and stops at ``data: [DONE]``.

        For Anthropic: only yields text from ``content_block_delta``
        events (``delta.text``). Other events (``message_start``,
        ``content_block_start``, ``content_block_stop``,
        ``message_delta``, ``message_stop``) carry metadata only and
        are silently ignored — except ``message_stop`` which terminates
        the generator.

        Args:
            messages: OpenAI-style chat messages, each with ``role`` and
                ``content`` keys. May include a single ``system`` entry,
                which is moved to the top-level ``system`` field for
                Anthropic-format requests.
            model: Model identifier with or without the
                ``opencode-go/`` prefix.
            temperature: Sampling temperature in the model's valid range.
            max_tokens: Maximum number of tokens to generate.

        Yields:
            Successive content string fragments from the assistant's
            reply.

        Raises:
            OpenCodeAPIError: If the API returns a non-2xx status, the
                network drops mid-stream, or a stream chunk is
                unparseable in a way that prevents continued streaming.
        """
        bare_model = self._strip_prefix(model)

        if self._is_anthropic_model(bare_model):
            async for chunk in self._stream_anthropic(
                messages=messages,
                model=bare_model,
                temperature=temperature,
                max_tokens=max_tokens,
            ):
                yield chunk
        else:
            async for chunk in self._stream_openai(
                messages=messages,
                model=bare_model,
                temperature=temperature,
                max_tokens=max_tokens,
            ):
                yield chunk

    async def _stream_openai(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        """Streaming OpenAI-completions call.

        Parses ``data: {"choices":[{"delta":{"content":"..."}}]}`` lines
        and stops at ``data: [DONE]``. Lines that fail to parse or that
        lack a ``content`` field are skipped (tolerate keepalive noise
        and first-chunk role-only frames).
        """
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        try:
            async with self.client.stream(
                "POST", "/chat/completions", json=payload
            ) as response:
                if response.status_code < 200 or response.status_code >= 300:
                    body = await response.aread()
                    text = body.decode("utf-8", errors="replace")
                    raise OpenCodeAPIError(
                        f"OpenCode API returned status "
                        f"{response.status_code}: {text}",
                        status_code=response.status_code,
                        response_text=text,
                    )

                async for line in response.aiter_lines():
                    # Empty lines are SSE event separators; ignore.
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].lstrip()  # tolerate "data:" vs "data: "
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        # Skip malformed lines (e.g. keepalive noise).
                        continue
                    try:
                        delta = chunk["choices"][0]["delta"]
                    except (KeyError, IndexError, TypeError):
                        # Malformed chunk envelope; skip.
                        continue
                    content = delta.get("content") if isinstance(delta, dict) else None
                    if content:
                        yield content
        except httpx.HTTPError as exc:
            raise OpenCodeAPIError(
                f"Network error streaming from OpenCode API: {exc}"
            ) from exc

    async def _stream_anthropic(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        """Streaming Anthropic Messages call.

        Anthropic SSE has ``event:`` lines and ``data:`` lines; we only
        look at ``data:`` lines. Each line's JSON has a ``type`` field.
        Only ``content_block_delta`` carries text, exposed as
        ``delta.text``. ``message_stop`` ends the stream.
        """
        system, remaining = self._split_system_message(messages)
        payload: dict[str, Any] = {
            "model": model,
            "messages": remaining,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if system is not None:
            payload["system"] = system

        try:
            async with self.client.stream(
                "POST", "/messages", json=payload
            ) as response:
                if response.status_code < 200 or response.status_code >= 300:
                    body = await response.aread()
                    text = body.decode("utf-8", errors="replace")
                    raise OpenCodeAPIError(
                        f"OpenCode API returned status "
                        f"{response.status_code}: {text}",
                        status_code=response.status_code,
                        response_text=text,
                    )

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        # Skip blank separators and `event:` lines.
                        continue
                    data = line[5:].lstrip()
                    if not data:
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        # Skip malformed lines (keepalive noise etc.).
                        continue
                    if not isinstance(event, dict):
                        continue
                    event_type = event.get("type")
                    if event_type == "message_stop":
                        break
                    if event_type == "content_block_delta":
                        delta = event.get("delta")
                        if not isinstance(delta, dict):
                            continue
                        # Only text_delta carries user-visible text.
                        if delta.get("type") != "text_delta":
                            continue
                        text = delta.get("text")
                        if text:
                            yield text
                    # All other event types (message_start, ping,
                    # content_block_start, content_block_stop,
                    # message_delta, error) carry no incremental text
                    # and are intentionally ignored.
        except httpx.HTTPError as exc:
            raise OpenCodeAPIError(
                f"Network error streaming from OpenCode API: {exc}"
            ) from exc
