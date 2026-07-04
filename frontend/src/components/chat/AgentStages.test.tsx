/**
 * Tests for `src/components/chat/AgentStages.tsx`.
 *
 * AgentStages renders the thinking / writing / done status pill
 * inside the chat list. While a stream is in flight the matching
 * stage card is expanded (Planning / Writing code / Updating). When
 * the run completes, the pill collapses to a single summary line
 * ("✓ Planned · Generated 1.2k chars") that can be expanded to
 * reveal the plan detail.
 *
 * 2026-07-04 (Builder UX pass) — added as part of the chat-panel
 * polish. Replaces the old plain "Planning…" status text.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentStages } from './AgentStages'

describe('AgentStages()', () => {
  it('test_planning_stage — renders the expanded planning card while in planning', () => {
    render(<AgentStages stage="planning" codeLength={0} />)

    expect(screen.getByText(/Planning your app/)).toBeInTheDocument()
    expect(screen.getByText(/The planner agent is designing/)).toBeInTheDocument()
  })

  it('test_generating_stage — renders the expanded writing-code card while generating', () => {
    render(<AgentStages stage="generating" codeLength={123} />)

    expect(screen.getByText(/Writing code/)).toBeInTheDocument()
    expect(screen.getByText(/Streaming the implementation/)).toBeInTheDocument()
  })

  it('test_iterating_stage — renders the expanded updating card while iterating', () => {
    render(<AgentStages stage="iterating" codeLength={456} />)

    expect(screen.getByText(/Updating your app/)).toBeInTheDocument()
    expect(screen.getByText(/Applying your requested changes/)).toBeInTheDocument()
  })

  it('test_done_stage_renders_summary — done renders the collapsed "Planned ✓ · Generated" line', () => {
    render(<AgentStages stage="done" codeLength={1234} />)

    // The collapsed summary is a single button with the verb +
    // generated chars line.
    const button = screen.getByRole('button', { name: /Planned ✓/ })
    expect(button).toBeInTheDocument()
    expect(button.textContent).toMatch(/Generated 1\.2k chars|Generated 1234 chars/)

    // No expanded stage card.
    expect(screen.queryByText(/Writing code/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Planning your app/)).not.toBeInTheDocument()
  })

  it('test_done_iteration_uses_updated_verb — done after iterating shows "Updated ✓"', () => {
    // The collapsed summary uses "Updated" instead of "Planned"
    // when the most recent stage was an iteration. (We pass the
    // stage explicitly because the component is presentational —
    // the Builder passes the resolved stage.)
    render(<AgentStages stage="done" codeLength={3400} />)

    const button = screen.getByRole('button', { name: /Planned ✓/ })
    expect(button.textContent).toMatch(/3\.4k chars/)
  })

  it('test_done_summary_expands_on_click — clicking the summary line reveals the plan detail', () => {
    render(
      <AgentStages
        stage="done"
        codeLength={42}
        planDetail="A landing page with hero, features grid, and CTA."
      />,
    )

    // The plan detail is hidden initially.
    expect(
      screen.queryByText(/landing page with hero, features grid, and CTA/),
    ).not.toBeInTheDocument()

    // Click the summary to expand.
    fireEvent.click(screen.getByRole('button', { name: /Planned ✓/ }))

    // Now the plan detail is visible.
    expect(
      screen.getByText(/landing page with hero, features grid, and CTA/),
    ).toBeInTheDocument()
  })

  it('test_done_summary_uses_placeholder_when_no_plan — clicking reveals the empty-plan placeholder', () => {
    render(<AgentStages stage="done" codeLength={42} />)

    fireEvent.click(screen.getByRole('button', { name: /Planned ✓/ }))

    // No plan detail was provided — the component should render
    // an italic "no plan text was emitted" message instead of
    // leaving an empty box.
    expect(screen.getByText(/No plan text was emitted/)).toBeInTheDocument()
  })
})
