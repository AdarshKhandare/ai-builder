/**
 * Tests for `src/components/layout/CodePreviewTabs.tsx`.
 *
 * The component has two render modes:
 *  - `showPreview=false` → code-only right column (no tab bar).
 *  - `showPreview=true`  → tab bar with Code + Preview tabs.
 *
 * Tests assert on:
 *  - presence/absence of the tab bar
 *  - role/aria attributes for screen readers
 *  - the click → `onTabChange` callback wiring
 *  - the active/inactive class names (text-foreground vs.
 *    text-muted-foreground)
 */
import { render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodePreviewTabs, type CodePreviewTab } from './CodePreviewTabs'

/* ------------------------------------------------------------------ */
//* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface RenderOpts {
  activeTab?: CodePreviewTab
  showPreview?: boolean
  onTabChange?: (tab: CodePreviewTab) => void
}

function renderTabs(opts: RenderOpts = {}): ReturnType<typeof render> {
  const onTabChange = opts.onTabChange ?? vi.fn()
  return render(
    <CodePreviewTabs
      codePanel={<div data-testid="code-panel">code content</div>}
      previewPanel={<div data-testid="preview-panel">preview content</div>}
      activeTab={opts.activeTab ?? 'code'}
      onTabChange={onTabChange}
      showPreview={opts.showPreview ?? true}
    />,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('CodePreviewTabs() — showPreview=false (code-only mode)', () => {
  it('test_renders_code_tab_always — the code panel is rendered when showPreview=false', () => {
    renderTabs({ showPreview: false })

    // The code panel is always rendered regardless of the tab toggle.
    expect(screen.getByTestId('code-panel')).toBeInTheDocument()
    // Preview panel is never mounted in code-only mode.
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
  })

  it('test_preview_tab_hidden_when_showPreview_false — no tab bar is rendered', () => {
    renderTabs({ showPreview: false })

    // No tablist → no tab buttons at all.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /code/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /preview/i })).not.toBeInTheDocument()
  })
})

describe('CodePreviewTabs() — showPreview=true (tabbed mode)', () => {
  it('test_preview_tab_visible_when_showPreview_true — both Code and Preview tabs are rendered', () => {
    renderTabs({ showPreview: true })

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /code/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /preview/i })).toBeInTheDocument()
  })

  it('test_tab_click_calls_onTabChange — clicking the Preview tab calls onTabChange("preview")', () => {
    const onTabChange = vi.fn()
    renderTabs({ showPreview: true, activeTab: 'code', onTabChange })

    screen.getByRole('tab', { name: /preview/i }).click()

    expect(onTabChange).toHaveBeenCalledTimes(1)
    expect(onTabChange).toHaveBeenCalledWith('preview')
  })

  it('test_tab_click_calls_onTabChange_code — clicking the Code tab calls onTabChange("code")', () => {
    const onTabChange = vi.fn()
    renderTabs({ showPreview: true, activeTab: 'preview', onTabChange })

    screen.getByRole('tab', { name: /code/i }).click()

    expect(onTabChange).toHaveBeenCalledTimes(1)
    expect(onTabChange).toHaveBeenCalledWith('code')
  })

  it('test_active_tab_has_foreground_text — the active tab carries text-foreground', () => {
    renderTabs({ showPreview: true, activeTab: 'code' })

    const codeTab = screen.getByRole('tab', { name: /code/i })
    expect(codeTab).toHaveClass('text-foreground')
    expect(codeTab).toHaveAttribute('aria-selected', 'true')
  })

  it('test_inactive_tab_has_muted_text — the inactive tab carries text-muted-foreground', () => {
    renderTabs({ showPreview: true, activeTab: 'code' })

    const previewTab = screen.getByRole('tab', { name: /preview/i })
    expect(previewTab).toHaveClass('text-muted-foreground')
    expect(previewTab).toHaveAttribute('aria-selected', 'false')
  })
})
