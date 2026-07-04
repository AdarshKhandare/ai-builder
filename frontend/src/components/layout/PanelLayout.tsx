/**
 * PanelLayout — the responsive builder shell.
 *
 * Implements the 2-column resizable layout from
 * `docs/BUILDER_REDESIGN_SPEC.md` §7.7 — "Calm Precision" light theme:
 *
 *   Desktop / Tablet (≥ 640px):
 *     - 2-column Group from `react-resizable-panels`:
 *         Panel 1: Chat (resizable, default 35% desktop / 40% tablet)
 *         Separator: 4px drag handle, indigo on hover/active/focus
 *         Panel 2: Right column (CodePreviewTabs — Code/Preview tabs)
 *     - Before the first prompt (`showCode=false`) the right column
 *       is NOT rendered; the chat fills the shell.
 *
 *   Mobile (< 640px):
 *     - Single panel at a time + `MobileTabBar` at the bottom
 *
 * Progressive disclosure: the right column is conditionally rendered.
 * We use the "simpler alternative" from spec §2.3 (render-only-when-
 * visible) instead of imperative `collapse()` / `expand()`. The spec
 * notes the imperative approach preserves the user's resize position
 * across disclosure transitions; within a single project the layout
 * is persistent so that position memory is implicit, and on "New
 * Project" we deliberately want a fresh start with no remembered
 * layout anyway.
 *
 * 2026-07-04 (Phase 6 redesign) — white bg, subtle border separators,
 * indigo on hover/active. Kept 2-column resizable layout.
 */
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from 'react-resizable-panels'
import type { ReactNode } from 'react'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  CodePreviewTabs,
  type CodePreviewTab,
} from './CodePreviewTabs'
import {
  MobileTabBar,
  type MobileTab,
} from './MobileTabBar'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface PanelLayoutProps {
  chatPanel: ReactNode
  codePanel: ReactNode
  previewPanel: ReactNode
  /** Show the right column with the code panel (set on send). */
  showCode: boolean
  /** Show the Preview tab (set on `done`). */
  showPreview: boolean
  /** Active tab in the right column (desktop/tablet). */
  activeTab: CodePreviewTab
  /** Change the active tab (desktop/tablet). */
  onActiveTabChange: (tab: CodePreviewTab) => void
  /** Active tab on mobile (chat | code | preview). */
  mobileTab: MobileTab
  /** Change the mobile tab. */
  onMobileTabChange: (tab: MobileTab) => void
}

/* ------------------------------------------------------------------ */
/* Layout presets                                                      */
/* ------------------------------------------------------------------ */

const DESKTOP_DEFAULTS = {
  chat: 35,
  chatMin: 25,
  chatMax: 50,
  right: 65,
  rightMin: 50,
} as const

const TABLET_DEFAULTS = {
  chat: 40,
  chatMin: 30,
  chatMax: 50,
  right: 60,
  rightMin: 50,
} as const

const SEPARATOR_HIT_TARGET = { coarse: 16, fine: 12 } as const

/* ------------------------------------------------------------------ */
/* Desktop / Tablet layout                                             */
/* ------------------------------------------------------------------ */

interface TwoColumnDefaults {
  readonly chat: number
  readonly chatMin: number
  readonly chatMax: number
  readonly right: number
  readonly rightMin: number
}

interface TwoColumnLayoutProps {
  defaults: TwoColumnDefaults
  showPreview: boolean
  activeTab: CodePreviewTab
  onActiveTabChange: (tab: CodePreviewTab) => void
  chatPanel: ReactNode
  codePanel: ReactNode
  previewPanel: ReactNode
}

/**
 * The 2-column layout used on desktop and tablet. Caller is
 * responsible for only rendering this when `showCode` is `true`.
 */
function TwoColumnLayout({
  defaults,
  showPreview,
  activeTab,
  onActiveTabChange,
  chatPanel,
  codePanel,
  previewPanel,
}: TwoColumnLayoutProps) {
  return (
    <Group
      orientation="horizontal"
      className="h-full w-full"
      // Generous hit target on the drag handle for both mouse and touch.
      resizeTargetMinimumSize={SEPARATOR_HIT_TARGET}
    >
      <Panel
        id="chat"
        defaultSize={defaults.chat}
        minSize={defaults.chatMin}
        maxSize={defaults.chatMax}
        className="h-full min-w-0"
      >
        {chatPanel}
      </Panel>

      <Separator
        className="
          group relative w-1 cursor-col-resize
          bg-border transition-colors duration-150 ease-out
          hover:bg-primary
          data-[separator=hover]:bg-primary
          data-[separator=active]:bg-primary
          data-[separator=active]:shadow-sm
          data-[separator=focus]:bg-primary
          data-[separator=focus]:outline data-[separator=focus]:outline-2
          data-[separator=focus]:outline-ring
        "
      />

      <Panel
        id="right"
        defaultSize={defaults.right}
        minSize={defaults.rightMin}
        className="h-full min-w-0"
      >
        <CodePreviewTabs
          activeTab={activeTab}
          onTabChange={onActiveTabChange}
          showPreview={showPreview}
          codePanel={codePanel}
          previewPanel={previewPanel}
        />
      </Panel>
    </Group>
  )
}

/* ------------------------------------------------------------------ */
/* Mobile layout                                                       */
/* ------------------------------------------------------------------ */

interface MobileLayoutProps {
  showCode: boolean
  showPreview: boolean
  active: MobileTab
  onChange: (tab: MobileTab) => void
  chatPanel: ReactNode
  codePanel: ReactNode
  previewPanel: ReactNode
}

function MobileLayout({
  showCode,
  showPreview,
  active,
  onChange,
  chatPanel,
  codePanel,
  previewPanel,
}: MobileLayoutProps) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* Bottom padding so the last row of content isn't hidden
          behind the fixed tab bar (48px + safe-area). */}
      <div className="min-h-0 flex-1 overflow-hidden pb-[calc(48px+env(safe-area-inset-bottom))]">
        {/*
         * Only render the panel that the user has selected. The tab
         * bar is responsible for switching — we just route.
         *
         * When `showCode` is false we force the chat panel even if
         * the user has somehow selected another tab.
         */}
        {(!showCode || active === 'chat') && (
          <div
            id="mobile-tabpanel-chat"
            role="tabpanel"
            aria-labelledby="mobile-tab-chat"
            className="h-full w-full"
          >
            {chatPanel}
          </div>
        )}
        {showCode && active === 'code' && (
          <div
            id="mobile-tabpanel-code"
            role="tabpanel"
            aria-labelledby="mobile-tab-code"
            className="h-full w-full"
          >
            {codePanel}
          </div>
        )}
        {showCode && showPreview && active === 'preview' && (
          <div
            id="mobile-tabpanel-preview"
            role="tabpanel"
            aria-labelledby="mobile-tab-preview"
            className="h-full w-full"
          >
            {previewPanel}
          </div>
        )}
      </div>

      <MobileTabBar active={active} onChange={onChange} showPreview={showPreview} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function PanelLayout(props: PanelLayoutProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isTablet = useMediaQuery('(min-width: 640px) and (max-width: 1023.98px)')

  // When there is no right column at all, the "code-only" right
  // column is hidden — fall through to chat-only on every viewport.
  if (!props.showCode) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-background">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {props.chatPanel}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isDesktop ? (
          <TwoColumnLayout
            defaults={DESKTOP_DEFAULTS}
            showPreview={props.showPreview}
            activeTab={props.activeTab}
            onActiveTabChange={props.onActiveTabChange}
            chatPanel={props.chatPanel}
            codePanel={props.codePanel}
            previewPanel={props.previewPanel}
          />
        ) : isTablet ? (
          <TwoColumnLayout
            defaults={TABLET_DEFAULTS}
            showPreview={props.showPreview}
            activeTab={props.activeTab}
            onActiveTabChange={props.onActiveTabChange}
            chatPanel={props.chatPanel}
            codePanel={props.codePanel}
            previewPanel={props.previewPanel}
          />
        ) : (
          <MobileLayout
            showCode={props.showCode}
            showPreview={props.showPreview}
            active={props.mobileTab}
            onChange={props.onMobileTabChange}
            chatPanel={props.chatPanel}
            codePanel={props.codePanel}
            previewPanel={props.previewPanel}
          />
        )}
      </div>
    </div>
  )
}

// Re-exported so Builder can pass the imperative ref type through if
// it ever needs to. Currently unused; kept here for future use.
export type { PanelImperativeHandle }
