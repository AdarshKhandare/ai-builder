/**
 * Tests for `src/components/layout/PanelLayout.tsx`.
 *
 * Progressive disclosure for the new 2-column layout:
 *   - showCode=false                  → only chat rendered visibly;
 *                                       the right panel is collapsed
 *                                       to 0% via the imperative
 *                                       `PanelImperativeHandle` but
 *                                       its content is unmounted by
 *                                       AnimatePresence
 *   - showCode=true,  showPreview=false, activeTab='code'
 *                                     → chat + code (Preview tab hidden)
 *   - showCode=true,  showPreview=true,  activeTab='code'
 *                                     → chat + code (Preview tab exists,
 *                                       content hidden)
 *   - showCode=true,  showPreview=true,  activeTab='preview'
 *                                     → chat + preview (code content
 *                                       hidden by AnimatePresence)
 *
 * 2026-07-04 (Builder UX pass) — the Group is now always mounted
 * (was unmounted on `showCode=false`). The chat panel is
 * `data-testid="chat-panel"` and remains visible across the
 * showCode toggle; the code/preview panels are gated by the
 * `AnimatePresence` inside the (always-mounted) right Panel.
 *
 * We force the desktop breakpoint via a `matchMedia` override so the
 * layout is deterministic.
 */
import { render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelLayout } from './PanelLayout'
import type { CodePreviewTab } from './CodePreviewTabs'
import type { MobileTab } from './MobileTabBar'

/* ------------------------------------------------------------------ */
/* matchMedia stub                                                     */
/* ------------------------------------------------------------------ */

let originalMatchMedia: typeof window.matchMedia | undefined

function setMatchMedia(matches: Record<string, boolean>): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

beforeEach(() => {
  originalMatchMedia = window.matchMedia
  // Force the desktop breakpoint: >= 1024px matches, the tablet band does not.
  setMatchMedia({
    '(min-width: 1024px)': true,
    '(min-width: 640px) and (max-width: 1023.98px)': false,
  })
})

afterEach(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    })
  } else {
    // jsdom didn't have it originally; delete the stub.
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
  }
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ */
//* Fixtures                                                            */
/* ------------------------------------------------------------------ */

interface RenderOpts {
  showCode: boolean
  showPreview: boolean
  activeTab?: CodePreviewTab
  mobileTab?: MobileTab
}

function renderPanels(opts: RenderOpts): ReturnType<typeof render> {
  return render(
    <PanelLayout
      showCode={opts.showCode}
      showPreview={opts.showPreview}
      activeTab={opts.activeTab ?? 'code'}
      onActiveTabChange={() => undefined}
      mobileTab={opts.mobileTab ?? 'chat'}
      onMobileTabChange={() => undefined}
      chatPanel={<div data-testid="chat-panel">chat</div>}
      codePanel={<div data-testid="code-panel">code</div>}
      previewPanel={<div data-testid="preview-panel">preview</div>}
    />,
  )
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('PanelLayout() — progressive disclosure (desktop)', () => {
  it('test_renders_chat_only_initially — only the chat panel is visible before the first prompt', () => {
    renderPanels({ showCode: false, showPreview: false })

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    // When showCode=false the right panel is collapsed (size 0) and
    // its content is unmounted by AnimatePresence. The code/preview
    // content is therefore NOT in the DOM.
    expect(screen.queryByTestId('code-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
  })

  it('test_shows_code_panel_when_showCode — chat + code appear, preview tab hidden', () => {
    renderPanels({ showCode: true, showPreview: false, activeTab: 'code' })

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    expect(screen.getByTestId('code-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
  })

  it('test_code_active_after_done — code panel remains in DOM when preview tab is enabled', () => {
    renderPanels({ showCode: true, showPreview: true, activeTab: 'code' })

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    expect(screen.getByTestId('code-panel')).toBeInTheDocument()
    // Preview tab is enabled but its content is hidden by AnimatePresence
    // (active tab is 'code'). We don't assert preview content is here.
  })

  it('test_switches_to_preview_when_activeTab_preview — preview content shows when active', () => {
    renderPanels({ showCode: true, showPreview: true, activeTab: 'preview' })

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
  })

  it('test_chat_always_present_across_toggle — chat panel stays in DOM when showCode flips', () => {
    // Regression: previously the entire Group unmounted on
    // showCode=false, which reset panel sizes and produced the
    // "chat shrinks to 35% the moment the user sends the first
    // prompt" glitch. The Group is now always mounted; the chat
    // panel should be present across the toggle.
    const { rerender } = render(
      <PanelLayout
        showCode={false}
        showPreview={false}
        activeTab="code"
        onActiveTabChange={() => undefined}
        mobileTab="chat"
        onMobileTabChange={() => undefined}
        chatPanel={<div data-testid="chat-panel">chat</div>}
        codePanel={<div data-testid="code-panel">code</div>}
        previewPanel={<div data-testid="preview-panel">preview</div>}
      />,
    )
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()

    rerender(
      <PanelLayout
        showCode={true}
        showPreview={false}
        activeTab="code"
        onActiveTabChange={() => undefined}
        mobileTab="chat"
        onMobileTabChange={() => undefined}
        chatPanel={<div data-testid="chat-panel">chat</div>}
        codePanel={<div data-testid="code-panel">code</div>}
        previewPanel={<div data-testid="preview-panel">preview</div>}
      />,
    )
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    expect(screen.getByTestId('code-panel')).toBeInTheDocument()
  })
})
