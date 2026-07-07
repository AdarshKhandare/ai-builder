"""Unit tests for :class:`app.services.code_sanitizer.StreamingFenceStripper`.

The stripper is a stateful filter that removes markdown code fences from
a streaming LLM response. Fences can span chunk boundaries, so these tests
exercise both single-chunk and split-fence scenarios.
"""

from __future__ import annotations

import pytest

from app.services.code_sanitizer import StreamingFenceStripper


def _feed_chunks(stripper: StreamingFenceStripper, chunks: list[str]) -> str:
    """Feed every chunk to ``stripper`` and return all emitted text."""
    return "".join(stripper.feed(chunk) for chunk in chunks)


def _run(stripper: StreamingFenceStripper, chunks: list[str]) -> str:
    """Feed chunks and include the final flush tail."""
    return _feed_chunks(stripper, chunks) + stripper.flush()


class TestStreamingFenceStripper:
    """Opening-fence, closing-fence, and pass-through behaviour."""

    def test_opening_fence_html_stripped(self) -> None:
        """`` ```html\n `` at the start is removed."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["```html\n", "<!DOCTYPE html>", "</html>"])

        assert "```" not in result
        assert result.startswith("<!DOCTYPE html>")

    def test_opening_fence_no_language_stripped(self) -> None:
        """A bare `` ```\n `` opening fence is removed."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["```\n", "<!DOCTYPE html>"])

        assert "```" not in result
        assert result.startswith("<!DOCTYPE html>")

    def test_opening_fence_uppercase_language_stripped(self) -> None:
        """Language tags are matched case-insensitively."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["```HTML\n", "<html></html>"])

        assert "```" not in result
        assert result == "<html></html>"

    def test_no_fence_passthrough_unchanged(self) -> None:
        """Streams without fences are emitted unchanged (minus holdback delay)."""
        stripper = StreamingFenceStripper()
        chunks = ["abc", "def", "ghi"]
        result = _run(stripper, chunks)

        assert result == "abcdefghi"

    def test_closing_fence_at_end_stripped(self) -> None:
        """A trailing `` ``` `` is removed."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["<html></html>", "\n```"])

        assert "```" not in result
        assert result == "<html></html>\n"

    def test_closing_fence_with_trailing_newline_stripped(self) -> None:
        """A trailing `` ```\n `` is removed."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["<html></html>", "\n```\n"])

        assert "```" not in result
        assert result == "<html></html>\n"

    def test_closing_fence_split_across_chunks(self) -> None:
        """A fence split as ``...`` `` + ```\n`` is still detected."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["abc``", "`\n"])

        assert "```" not in result
        assert result == "abc"

    def test_opening_and_closing_fences_stripped(self) -> None:
        """Both fences are removed when they wrap the whole document."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["```html\n<!DOCTYPE html>\n```"])

        assert "```" not in result
        assert result == "<!DOCTYPE html>\n"

    def test_empty_stream(self) -> None:
        """Flush on a never-fed stripper returns an empty string."""
        stripper = StreamingFenceStripper()
        assert stripper.flush() == ""

    def test_stream_that_is_only_a_fence(self) -> None:
        """A stream consisting solely of fences yields nothing."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["```html\n", "```\n"])

        assert result == ""

    def test_mid_code_backticks_preserved(self) -> None:
        """Backticks that are not a trailing fence are left intact."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["`a`", "`b`", "\n</html>\n```"])

        assert "```" not in result
        assert "`a``b`" in result
        assert result.endswith("</html>\n")

    def test_realistic_document_split_into_chunks(self) -> None:
        """A fenced document split across five chunks is fully sanitised."""
        stripper = StreamingFenceStripper()
        chunks = [
            "```htm",
            "l\n<!DO",
            "CTYPE html><ht",
            "ml></html>\n``",
            "`",
        ]
        result = _run(stripper, chunks)

        assert "```" not in result
        assert result == "<!DOCTYPE html><html></html>\n"

    def test_leading_whitespace_preserved_when_no_fence(self) -> None:
        """Leading spaces are kept if the stream does not start with a fence."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, ["  ", "<!DOCTYPE html>"])

        assert result == "  <!DOCTYPE html>"

    @pytest.mark.parametrize(
        "fence",
        [
            "```html\n",
            "```HTML\n",
            "```\n",
            "   \n```html\n",
        ],
    )
    def test_various_opening_fences_stripped(self, fence: str) -> None:
        """Common opening-fence variants are all removed."""
        stripper = StreamingFenceStripper()
        result = _run(stripper, [fence, "<!DOCTYPE html>"])

        assert "```" not in result
        assert result.startswith("<!DOCTYPE html>")
