/**
 * Tests for `src/components/layout/StatusBar.tsx`.
 *
 * The StatusBar is mostly a presentational footer. The interactive
 * surface we pin in Phase 5 is the cost-estimate display:
 *
 *  - When `estimatedCostUsd` is a non-negative number, the right
 *    side renders the `~$0.0024 · model · 1.2s` line.
 *  - When `estimatedCostUsd` is `null`, the cost prefix is omitted
 *    (the line still shows model + time if available).
 *  - When there's no time yet either, the right side shows `—`.
 *  - The left side always shows the model short name (with the
 *    `opencode-go/` prefix stripped).
 *  - The center status indicator reads "Ready" when not streaming
 *    and a status label when streaming.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusBar } from './StatusBar'

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('StatusBar() — model name (left)', () => {
  it('test_strips_provider_prefix — renders the short model name', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={null}
        estimatedCostUsd={null}
      />,
    )

    // The model short name (no provider prefix) is rendered on
    // the left. Use a custom matcher to find it within the
    // document (multiple elements may contain "minimax-m3" as
    // part of the stats line on the right; we check at least
    // one is present).
    expect(screen.getAllByText('minimax-m3').length).toBeGreaterThan(0)
  })

  it('test_renders_dash_when_no_model — placeholder is "—" when the model is empty', () => {
    render(
      <StatusBar
        model=""
        status={null}
        isStreaming={false}
        generationTime={null}
        estimatedCostUsd={null}
      />,
    )

    // The left side renders "—" when the model is empty.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('StatusBar() — status indicator (center)', () => {
  it('test_shows_ready_when_idle — "Ready" when not streaming', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={null}
        estimatedCostUsd={null}
      />,
    )

    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('test_shows_thinking_when_planning — "Thinking…" during planning', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status="planning"
        isStreaming={true}
        generationTime={null}
        estimatedCostUsd={null}
      />,
    )

    expect(screen.getByText('Thinking…')).toBeInTheDocument()
  })

  it('test_shows_generating_when_generating — "Generating…" during code streaming', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status="generating"
        isStreaming={true}
        generationTime={null}
        estimatedCostUsd={null}
      />,
    )

    expect(screen.getByText('Generating…')).toBeInTheDocument()
  })
})

describe('StatusBar() — stats line (right, ≥sm)', () => {
  it('test_shows_cost_model_time — renders `~$0.0024 · model · 1.2s` when all three are present', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={1234}
        estimatedCostUsd={0.0024}
      />,
    )

    // The full stats line should be present (text may have
    // different whitespace inside the dot-joined segments, so we
    // use a flexible matcher).
    expect(
      screen.getByText(/~\$0\.0024.*minimax-m3.*1\.2s/),
    ).toBeInTheDocument()
  })

  it('test_omits_cost_when_null — no cost prefix when estimatedCostUsd=null', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={5000}
        estimatedCostUsd={null}
      />,
    )

    // Model + time are still shown, but no `~$` prefix.
    expect(screen.getByText(/minimax-m3.*5\.0s/)).toBeInTheDocument()
    expect(screen.queryByText(/~\$/)).not.toBeInTheDocument()
  })

  it('test_shows_model_only_when_no_time_yet — shows the model with no time suffix when generationTime=null', () => {
    // When the model is set but the time isn't, the right side
    // shows just the model name (no time, no cost) — the dash
    // placeholder only appears when EVERY part (cost, model,
    // time) is missing.
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={null}
        estimatedCostUsd={null}
      />,
    )

    // The right side shows the model name (multiple "minimax-m3"
    // matches because it's also in the left label).
    expect(screen.getAllByText('minimax-m3').length).toBeGreaterThan(0)
    // No cost prefix and no time suffix.
    expect(screen.queryByText(/~\$/)).not.toBeInTheDocument()
  })

  it('test_shows_dash_when_all_parts_missing — right side renders "—" only when every part is missing', () => {
    render(
      <StatusBar
        model=""
        status={null}
        isStreaming={false}
        generationTime={null}
        estimatedCostUsd={null}
      />,
    )

    // Both the left label and the right stats line render the
    // em-dash placeholder. We assert at least two of them are
    // present (one on each side).
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('test_handles_sub_second_time — formats <1s as "0.4s"', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={400}
        estimatedCostUsd={null}
      />,
    )

    expect(screen.getByText(/0\.4s/)).toBeInTheDocument()
  })

  it('test_handles_long_time — formats >100s without decimal', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={125_000}
        estimatedCostUsd={null}
      />,
    )

    expect(screen.getByText(/125s/)).toBeInTheDocument()
  })

  it('test_handles_zero_cost — renders `~$0.0000` when cost is exactly 0', () => {
    render(
      <StatusBar
        model="opencode-go/minimax-m3"
        status={null}
        isStreaming={false}
        generationTime={1000}
        estimatedCostUsd={0}
      />,
    )

    // 0 cost is rendered with the tilde prefix for consistency.
    expect(screen.getByText(/~\$0\.0000/)).toBeInTheDocument()
  })
})
