"""Planner agent: user prompt -> structured build plan.

Uses DeepSeek V4 Flash (the cheapest reasoning model in our routing
table) by default to analyse the user's natural-language description
and produce a concise, actionable build plan for the coder agent. Runs
in non-streaming mode because the plan is short (~300 words) and must
be fully available before the coder starts.

The planner model is configurable via the ``PLANNER_MODEL`` env var
(see ``app.config.Settings``). This is useful as an operational
fallback: if the upstream default (``deepseek-v4-flash``) is degraded
or returning 5xx, the operator can switch to a working model (e.g.
``opencode-go/kimi-k2.6``) without a code change.
"""

from __future__ import annotations

from app.config import settings
from app.services.opencode_client import OpenCodeClient

# Default planner model id used in the production routing table
# (``docs/AI_MODELS.md``). Read at call time from ``settings.PLANNER_MODEL``
# so an env-var override is honoured without restarting the process for
# the import-time constants.
PLANNER_MODEL = "opencode-go/deepseek-v4-flash"
"""Default model used for planning. Cheap, fast, and good enough for short specs."""

PLANNER_TEMPERATURE = 0.3
"""Low temperature for deterministic, consistent plans."""

PLANNER_MAX_TOKENS = 2048
"""Token budget large enough for a title line + a ~400-word functional spec.

A real, working single-page app needs every interaction spelled out in the
plan (add, delete, persist, filter, etc.) — 1024 tokens trimmed that down
to "make it nice" and the coder had no idea what to implement.
"""

PLANNER_SYSTEM_PROMPT = (
    "You are an expert web app planner. Given a user's description, produce a "
    "concise but detailed build plan for a fully functional single-page web app.\n\n"
    "CRITICAL: Your response MUST start with EXACTLY this line and nothing before it:\n"
    "Title: <a short, descriptive project title (2-5 words)>\n\n"
    "Rules for the title line:\n"
    "- It must be the VERY FIRST line of your response.\n"
    "- It must begin with the literal text 'Title: ' (capital T, colon, single space).\n"
    "- Do not add quotes around the title.\n"
    "- Do not add any markdown, headings, or preamble before the title line.\n"
    "- Example of a correct first line: Title: Task Board App\n\n"
    "After the title line, provide the build plan. The plan must include:\n"
    "1. SECTIONS: What sections/components the page needs (header, hero, list, form, etc.)\n"
    "2. FUNCTIONALITY: What the app must DO — every feature must be listed. "
    "Example: 'add task', 'mark complete', 'delete task', 'persist to localStorage', "
    "'filter by status'. Be specific about every interaction.\n"
    "3. DATA: What data the app manages (tasks, items, notes, etc.) and how it's stored "
    "(localStorage keys, data structure)\n"
    "4. VISUAL STYLE: Color palette (with hex codes), typography, spacing, visual mood\n"
    "5. INTERACTIONS: Every user interaction — clicks, form submits, keyboard shortcuts, "
    "drag-and-drop, filtering, sorting\n\n"
    "Keep the plan under 400 words. Do NOT write code. Do NOT include HTML/CSS/JS."
)


async def create_plan(prompt: str, client: OpenCodeClient) -> str:
    """Generate a structured build plan from a user prompt.

    Calls DeepSeek V4 Flash via the OpenCode Go gateway in non-streaming
    mode and returns the plan text. The plan is consumed by
    ``generate_code`` to drive code generation.

    Args:
        prompt: Raw natural-language description from the user.
        client: Shared :class:`OpenCodeClient` instance used to call
            the API.

    Returns:
        The planner's structured plan as a single string.

    Raises:
        app.services.opencode_client.OpenCodeAPIError: If the underlying
            API call fails or returns a malformed payload.
    """
    messages: list[dict[str, str]] = [
        {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    return await client.chat(
        messages=messages,
        model=settings.PLANNER_MODEL,
        temperature=PLANNER_TEMPERATURE,
        max_tokens=PLANNER_MAX_TOKENS,
    )
