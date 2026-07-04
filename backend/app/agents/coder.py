"""Coder agent: build plan -> complete single-page web app source.

Uses MiniMax M3 (the primary coder model in our routing table) to turn
the planner's structured plan into a self-contained single-page web app.
Streams the generated code token-by-token for low-latency UX — the
frontend appends each chunk to the code panel as it arrives and can
also stream it into the preview iframe.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from app.services.opencode_client import OpenCodeClient

DEFAULT_CODER_MODEL = "opencode-go/deepseek-v4-flash"
"""Default model used for code generation.

Matches the catalogue default in
:data:`app.routes.models._MODELS_CATALOGUE` and the default
declared in :class:`app.routes.generate.GenerateRequest`. Kept
as a module constant for code paths that need to know the
default without re-parsing the Pydantic model (e.g. the
``coder`` agent itself when called directly in tests).
"""

CODER_TEMPERATURE = 0.7
"""Moderate temperature: enough variety for creative styling, not chaotic."""

CODER_MAX_TOKENS = 16384
"""Token budget for a complete HTML/CSS/JS single-file app with real features.

A complex app (todo list with edit + filter + sort + persistence, or a
multi-section landing page with interactive elements) easily runs 8-12k
tokens of source. 8192 was truncating half-built apps. 16384 gives the
coder comfortable headroom while staying within the model's limits.
"""

CODER_SYSTEM_PROMPT = (
    "You are an expert front-end developer. Generate a COMPLETE, FULLY FUNCTIONAL, "
    "self-contained single-page web app as ONE HTML file with inline CSS and JavaScript.\n\n"
    "CRITICAL REQUIREMENTS:\n"
    "1. The app must be 100% functional — every button, form, link, and interaction "
    "must work. No placeholder text, no 'TODO' comments, no fake functionality.\n"
    "2. ALL JavaScript logic must be inline in a <script> tag at the end of <body>. "
    "Do NOT use external JS files.\n"
    "3. Use event listeners (addEventListener) for all interactive elements. "
    "Do NOT use inline onclick= attributes — use proper event listeners.\n"
    "4. For apps that manage data (todo lists, notes, carts, etc.): use localStorage "
    "to persist data across page reloads. Implement full CRUD: create, read, update, delete.\n"
    "5. Forms must have proper validation and submission handling.\n"
    "6. Dynamic content must be generated via JavaScript DOM manipulation (createElement, "
    "innerHTML, template literals) — not hardcoded HTML.\n"
    "7. Include loading states, empty states, and error handling in the JavaScript.\n"
    "8. Make it visually polished with modern CSS: gradients, shadows, transitions, "
    "responsive design with media queries, CSS custom properties for theming.\n"
    "9. Use semantic HTML5 elements (header, nav, main, section, article, footer).\n"
    "10. The app must work standalone — no build tools, no npm, no frameworks. "
    "Only vanilla HTML/CSS/JS. CDN links for fonts/icons are OK.\n\n"
    "OUTPUT FORMAT:\n"
    "- Start with <!DOCTYPE html>\n"
    "- End with </html>\n"
    "- Output ONLY the HTML code — no explanations, no markdown fences, no comments "
    "before or after the code.\n"
    "- The <script> tag must contain ALL JavaScript logic, fully implemented."
)


async def generate_code(
    plan: str,
    client: OpenCodeClient,
    model: str = DEFAULT_CODER_MODEL,
) -> AsyncGenerator[str, None]:
    """Generate HTML code from a build plan, streaming the output.

    Calls the OpenCode Go gateway with ``stream=True`` and yields each
    content chunk as it arrives. The chunks, when concatenated, form a
    complete single-file web app (HTML + inline CSS + inline JS).

    Args:
        plan: Structured build plan produced by the planner agent.
        client: Shared :class:`OpenCodeClient` instance used to call
            the API.
        model: Model identifier (with or without the ``opencode-go/``
            prefix). Defaults to :data:`DEFAULT_CODER_MODEL`
            (``opencode-go/minimax-m3``).

    Yields:
        Successive content string fragments of the generated HTML.

    Raises:
        app.services.opencode_client.OpenCodeAPIError: If the underlying
            API call fails or returns a malformed payload.
    """
    messages: list[dict[str, str]] = [
        {"role": "system", "content": CODER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Build plan:\n{plan}\n\n"
                "Generate the complete, WORKING HTML file now. The app must be fully functional — "
                "every feature described in the plan must actually work. Include all JavaScript "
                "logic inline. Use localStorage for data persistence. No placeholder functionality."
            ),
        },
    ]
    async for chunk in client.stream_chat(
        messages=messages,
        model=model,
        temperature=CODER_TEMPERATURE,
        max_tokens=CODER_MAX_TOKENS,
    ):
        yield chunk
