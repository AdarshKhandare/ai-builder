/**
 * Tests for `src/components/chat/MessageBubble.tsx`.
 *
 * The MessageBubble renders a single chat message with three
 * rendering paths:
 *  1. User bubble — always full content, no collapse affordance.
 *  2. Assistant bubble that looks like HTML code — renders a
 *     "Code generated — see the Code panel" placeholder instead of
 *     dumping the raw markup into the chat thread.
 *  3. Long assistant bubble — collapsed by default with a
 *     "Show more" button that reveals the full content.
 *  4. Short assistant bubble — rendered in full (no collapse).
 *
 * 2026-07-04 (Builder UX pass) — added collapsible-message
 * behaviour. Long assistant messages (≥ 140 chars OR > 2 lines) get
 * a Show more / Show less affordance.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MessageBubble } from './MessageBubble'

describe('MessageBubble()', () => {
  it('test_user_renders_full_content — user messages render verbatim, no Show more', () => {
    const longContent = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n')
    render(<MessageBubble role="user" content={longContent} />)

    // User messages always render the full content.
    expect(screen.getByText(/line 1/)).toBeInTheDocument()
    expect(screen.getByText(/line 8/)).toBeInTheDocument()
    // No "Show more" affordance on user bubbles.
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })

  it('test_assistant_html_code_renders_placeholder — assistant HTML code renders the "Code generated" label', () => {
    // Looks like HTML: starts with `<`, > 80 chars, has both opening
    // and closing tags. The MessageBubble heuristic should detect
    // this and render the compact label.
    const html = '<div class="container"><h1>Hello</h1><p>This is a paragraph of generated markup.</p></div>'
    render(<MessageBubble role="assistant" content={html} />)

    expect(screen.getByText('Code generated')).toBeInTheDocument()
    // The raw markup should NOT be in the document.
    expect(screen.queryByText(/class="container"/)).not.toBeInTheDocument()
  })

  it('test_assistant_short_message_renders_full — short assistant messages render without collapse', () => {
    render(
      <MessageBubble
        role="assistant"
        content="Updated the app — changes are live in the panel."
      />,
    )

    expect(
      screen.getByText(/Updated the app/),
    ).toBeInTheDocument()
    // No "Show more" button on a short message.
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })

  it('test_assistant_long_message_collapsed_by_default — long messages show first 2 lines + Show more', () => {
    // Build a long assistant message (>140 chars, >2 lines).
    const longContent = [
      'Here is the plan for the coffee shop landing page:',
      '1. Hero section with warm imagery and tagline',
      '2. Featured menu with three items and prices',
      '3. About the owner block with a personal note',
      '4. Contact form with email and phone fields',
    ].join('\n')
    render(<MessageBubble role="assistant" content={longContent} />)

    // The first two lines should be visible.
    expect(screen.getByText(/Here is the plan/)).toBeInTheDocument()
    // The later lines should be hidden by the preview.
    expect(screen.queryByText(/4\. Contact form/)).not.toBeInTheDocument()
    // The "Show more" button is present.
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument()
  })

  it('test_show_more_expands_message — clicking Show more reveals the full content', () => {
    const longContent = [
      'Here is the plan for the coffee shop landing page:',
      '1. Hero section with warm imagery and tagline',
      '2. Featured menu with three items and prices',
      '3. About the owner block with a personal note',
      '4. Contact form with email and phone fields',
    ].join('\n')
    render(<MessageBubble role="assistant" content={longContent} />)

    fireEvent.click(screen.getByRole('button', { name: /show more/i }))

    // After expansion, the previously hidden lines are visible.
    expect(screen.getByText(/4\. Contact form/)).toBeInTheDocument()
    // The button label flips to "Show less".
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument()
  })
})
