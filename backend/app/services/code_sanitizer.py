"""Streaming sanitizer that strips markdown code fences from LLM output.

Some code-generation models wrap their HTML output in markdown fences
(`` ```html `` ... `` ``` ``) despite explicit prompt instructions
not to. This module provides a stateful filter that removes those fences
from a token stream so the preview iframe never renders them.
"""

from __future__ import annotations

import re

# Matches an opening markdown fence at the very start of the stream:
# optional leading whitespace, three backticks, an optional language tag,
# optional trailing whitespace, and an optional first newline.
_OPENING_FENCE_RE = re.compile(r"^\s*```[a-zA-Z]*\s*\n?", re.IGNORECASE)

# Matches a closing markdown fence at the very end of the stream:
# three backticks followed only by trailing whitespace.
_CLOSING_FENCE_RE = re.compile(r"```\s*$")

# How many characters to hold back from the tail so a closing fence
# split across chunk boundaries is still detected.
_TAIL_HOLDBACK = 4

# Maximum number of characters to buffer while waiting to decide whether
# the stream starts with an opening fence. This prevents stalling the
# stream indefinitely when the first non-whitespace character is a
# backtick but no fence ever materialises.
_OPENING_BUFFER_CAP = 15


class StreamingFenceStripper:
    """Stateful filter that strips markdown code fences from a token stream.

    Handles two cases:

    1. An opening fence (`` ```html `` or bare `` ``` ``) at the very
       start of the stream — detected by buffering initial chunks.
    2. A closing fence (`` ``` ``) at the very end of the stream —
       detected via a small tail-holdback so a fence split across chunk
       boundaries is still caught.

    The opening-fence regex only matches at the start of the stream and
    the closing-fence regex only matches at the end, so mid-code
    backticks (for example JavaScript template literals) are never
    removed.

    Usage:
        stripper = StreamingFenceStripper()
        async for chunk in code_stream:
            clean = stripper.feed(chunk)
            if clean:
                yield clean
        tail = stripper.flush()
        if tail:
            yield tail
    """

    def __init__(self) -> None:
        """Create a fresh stripper with empty buffers."""
        self._open_resolved = False
        self._open_buffer = ""
        self._tail = ""

    def feed(self, chunk: str) -> str:
        """Process one chunk and return the sanitised part to emit now.

        Chunks are held back slightly so that opening and closing fences
        that span chunk boundaries can be detected. If there is nothing
        to emit yet (for example, while buffering the opening fence or
        because the chunk is shorter than the tail holdback), an empty
        string is returned.

        Args:
            chunk: The next token string from the model stream.

        Returns:
            The portion of the stream that is safe to emit now, or an
            empty string if nothing should be emitted yet.
        """
        if not self._open_resolved:
            return self._feed_opening(chunk)
        return self._emit(chunk)

    def flush(self) -> str:
        """Return any remaining buffered content at the end of the stream.

        This should be called once after the upstream generator has been
        fully consumed. It strips a closing fence if the tail holdback
        ends with one.

        Returns:
            The final sanitised tail, or an empty string if the buffer
            contains only a closing fence or is empty.
        """
        if not self._open_resolved:
            # The stream ended before we could resolve the opening fence.
            # Emit whatever we buffered unchanged.
            return self._open_buffer

        return _CLOSING_FENCE_RE.sub("", self._tail)

    def _feed_opening(self, chunk: str) -> str:
        """Buffer initial chunks until the opening fence is resolved."""
        self._open_buffer += chunk

        match = _OPENING_FENCE_RE.match(self._open_buffer)
        if match:
            # If the match consumes the entire buffer and does not end
            # with a newline, the fence line may be incomplete (for
            # example "```htm" waiting for "l\n"). Keep buffering so
            # we don't mistake a partial language tag for a complete
            # fence, unless the cap forces us to give up.
            if match.end() == len(self._open_buffer) and not self._open_buffer.endswith(
                "\n"
            ):
                if len(self._open_buffer) >= _OPENING_BUFFER_CAP:
                    return self._resolve_no_fence()
                return ""

            remainder = self._open_buffer[match.end() :]
            self._open_resolved = True
            self._open_buffer = ""
            return self._emit(remainder)

        stripped = self._open_buffer.lstrip()
        if stripped and stripped[0] != "`":
            # First non-whitespace character is not a backtick, so this
            # stream definitely does not start with a fence.
            return self._resolve_no_fence()

        if len(self._open_buffer) >= _OPENING_BUFFER_CAP:
            # Give up waiting for a fence and pass the buffer through.
            return self._resolve_no_fence()

        return ""

    def _resolve_no_fence(self) -> str:
        """Mark the opening as resolved and emit the buffered text."""
        buffered = self._open_buffer
        self._open_resolved = True
        self._open_buffer = ""
        return self._emit(buffered)

    def _emit(self, chunk: str) -> str:
        """Hold back the last few characters and emit the rest.

        The holdback gives ``flush`` enough context to detect a closing
        fence that ends the stream, even if the fence is split across
        two chunks.
        """
        combined = self._tail + chunk
        self._tail = combined[-_TAIL_HOLDBACK:]
        return combined[:-_TAIL_HOLDBACK] if len(combined) > _TAIL_HOLDBACK else ""
