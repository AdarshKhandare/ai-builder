/**
 * Tests for `src/components/layout/TopBar.tsx`.
 *
 * The TopBar is a presentational shell — the only behaviour we
 * pin here is the *interactive* surface area introduced in
 * Phase 5:
 *
 *  - The model picker renders the supplied list of models and
 *    surfaces the currently-selected model.
 *  - The download button is disabled when there's no code to
 *    download OR while a generation is in flight.
 *  - The download button is enabled when there is code AND no
 *    stream is running.
 *
 * Rendering every button + tooltip in every state would be
 * expensive; the structural tests in other files (e.g.
 * `PanelLayout.test.tsx`) cover the rest of the chrome.
 *
 * We use `fireEvent` (not `@testing-library/user-event`) because
 * the project does not depend on `user-event`. `fireEvent` is
 * sufficient for the discrete click events the picker and
 * download button need.
 *
 * 2026-07-04 — the `Logo` now renders as a `react-router` `Link`,
 * so we wrap every render in a `MemoryRouter` to provide the
 * routing context.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { TopBar, type TopBarProps } from './TopBar'
import type { ModelInfo } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const MODELS: ModelInfo[] = [
  {
    id: 'opencode-go/minimax-m3',
    name: 'MiniMax M3',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'coder',
    input_price_per_mtok: 0.14,
    output_price_per_mtok: 0.28,
    context_window: 200_000,
    recommended: true,
    description: 'Cheap and fast.',
  },
  {
    id: 'opencode-go/qwen-3.7-plus',
    name: 'Qwen 3.7 Plus',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.4,
    output_price_per_mtok: 1.2,
    context_window: 128_000,
    recommended: false,
    description: 'Mid-cost generalist.',
  },
]

function noopHandlers(): Pick<
  TopBarProps,
  'onModelChange' | 'onDownload' | 'onHistoryOpen' | 'onNewProject'
> {
  return {
    onModelChange: vi.fn(),
    onDownload: vi.fn(),
    onHistoryOpen: vi.fn(),
    onNewProject: vi.fn(),
  }
}

/**
 * Render `<TopBar>` inside a `MemoryRouter` so the `Logo` (which is
 * a `react-router` `Link`) has the routing context it needs. The
 * initial URL is pinned to `/builder` because the TopBar is only
 * ever mounted on the builder page in production.
 */
function renderTopBar(props: TopBarProps): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/builder']}>
      <TopBar {...props} />
    </MemoryRouter>,
  )
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('TopBar() — model picker', () => {
  it('test_renders_picker_trigger — model picker trigger is in the DOM with the correct aria-label', () => {
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: 'Coffee Shop',
      isStreaming: false,
      hasContent: true,
      hasDownload: true,
    })

    expect(screen.getByLabelText('Select model')).toBeInTheDocument()
  })

  it('test_renders_model_options_in_dropdown — both model names are visible in the picker', () => {
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: '',
      isStreaming: false,
      hasContent: false,
      hasDownload: false,
    })

    // Open the dropdown. Radix Select uses a portal; testing-library
    // finds the items by text inside the body.
    fireEvent.click(screen.getByLabelText('Select model'))

    // Both model names should now be in the document. The selected
    // model's name also appears in the trigger button, so we use
    // getAllByText to allow for duplicates.
    expect(screen.getAllByText('MiniMax M3').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Qwen 3.7 Plus')).toBeInTheDocument()
  })

  it('test_calls_onModelChange_when_picking — picking a new model fires the callback', () => {
    const handlers = noopHandlers()
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...handlers,
      projectTitle: '',
      isStreaming: false,
      hasContent: false,
      hasDownload: false,
    })

    fireEvent.click(screen.getByLabelText('Select model'))

    // The Qwen 3.7 Plus label only appears in the dropdown (it is
    // not the selected model), so a single match is enough.
    fireEvent.click(screen.getByText('Qwen 3.7 Plus'))

    expect(handlers.onModelChange).toHaveBeenCalledWith(
      'opencode-go/qwen-3.7-plus',
    )
  })

  it('test_groups_recommended_models — recommended models are surfaced under a "Recommended" label', () => {
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: '',
      isStreaming: false,
      hasContent: false,
      hasDownload: false,
    })

    fireEvent.click(screen.getByLabelText('Select model'))

    // The dropdown should label the recommended group explicitly.
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    // The "All models" group label is shown when there are non-
    // recommended entries.
    expect(screen.getByText('All models')).toBeInTheDocument()
  })

  it('test_no_recommended_group_when_none_recommended — drops the "Recommended" group when no model is flagged', () => {
    const noRecommended = MODELS.map((m) => ({ ...m, recommended: false }))
    renderTopBar({
      models: noRecommended,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: '',
      isStreaming: false,
      hasContent: false,
      hasDownload: false,
    })

    fireEvent.click(screen.getByLabelText('Select model'))

    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    // All models still present. The selected model name also
    // appears in the trigger, so use getAllByText.
    expect(screen.getAllByText('MiniMax M3').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Qwen 3.7 Plus')).toBeInTheDocument()
  })

  it('test_shows_provider_in_dropdown_row — each row renders the provider as a secondary label', () => {
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: '',
      isStreaming: false,
      hasContent: false,
      hasDownload: false,
    })

    fireEvent.click(screen.getByLabelText('Select model'))

    // Both rows show the provider text. The provider may be
    // rendered as part of a longer string like "opencode-go ·
    // coder", so we use a substring matcher rather than an
    // exact match. Each dropdown row contributes one match.
    const providers = screen.getAllByText(/opencode-go/)
    expect(providers.length).toBeGreaterThanOrEqual(2)
  })
})

describe('TopBar() — download button', () => {
  it('test_disabled_when_no_code — download is disabled when hasDownload=false', () => {
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: '',
      isStreaming: false,
      hasContent: false,
      hasDownload: false,
    })

    const button = screen.getByLabelText('Download project as ZIP')
    expect(button).toBeDisabled()
  })

  it('test_disabled_while_streaming — download is disabled even with code, when streaming', () => {
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: 'My App',
      isStreaming: true,
      hasContent: true,
      hasDownload: true,
    })

    const button = screen.getByLabelText('Download project as ZIP')
    expect(button).toBeDisabled()
  })

  it('test_enabled_when_code_and_idle — download is enabled when there is code and no stream is running', () => {
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...noopHandlers(),
      projectTitle: 'My App',
      isStreaming: false,
      hasContent: true,
      hasDownload: true,
    })

    const button = screen.getByLabelText('Download project as ZIP')
    expect(button).not.toBeDisabled()
  })

  it('test_calls_onDownload_on_click — click fires the download callback', () => {
    const handlers = noopHandlers()
    renderTopBar({
      models: MODELS,
      selectedModel: 'opencode-go/minimax-m3',
      ...handlers,
      projectTitle: 'My App',
      isStreaming: false,
      hasContent: true,
      hasDownload: true,
    })

    fireEvent.click(screen.getByLabelText('Download project as ZIP'))
    expect(handlers.onDownload).toHaveBeenCalledTimes(1)
  })
})
