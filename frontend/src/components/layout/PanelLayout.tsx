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
 *     - Both panels are ALWAYS mounted. When `showCode=false` the
 *       right Panel is collapsed to 0% via the imperative
 *       `PanelImperativeHandle`, so the chat fills the shell AND the
 *       user's manual resize position is preserved across the
 *       collapse / expand cycle. (Previously the Group was unmounted
 *       on `showCode=false`, which reset the panel sizes every time
 *       and produced the "chat shrinks to 35% the moment the user
 *       sends the first prompt" glitch.)
 *
 *   Mobile (< 640px):
 *     - Single panel at a time + `MobileTabBar` at the bottom
 *
 * 2026-07-04 (Phase 6 redesign) — white bg, subtle border separators,
 * indigo on hover/active. Kept 2-column resizable layout.
 *
 * 2026-07-04 (Builder UX pass) — kept PanelGroup always mounted; the
 * right panel now uses `collapsible + collapsedSize={0}` and is
 * imperatively collapsed / expanded via the Panel ref. A `key` on
 * the right Panel content drives the framer-motion enter / exit
 * animation.
 */
import {
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from 'react-resizable-panels'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
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
  /**
   * `chatMin` was 25 — the user reported the chat could shrink to
   * unusable widths. 30% keeps the chat legible on a 1280px screen
   * (≥ 384px column) while still allowing the right column enough
   * space to read a wide code line.
   */
  chatMin: 30,
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
  showCode: boolean
  showPreview: boolean
  activeTab: CodePreviewTab
  onActiveTabChange: (tab: CodePreviewTab) => void
  chatPanel: ReactNode
  codePanel: ReactNode
  previewPanel: ReactNode
}

/**
 * The 2-column layout used on desktop and tablet. Both panels are
 * always rendered; the right panel is imperatively collapsed to
 * `collapsedSize` (0%) when `showCode` is `false` so the chat fills
 * the shell. The `PanelImperativeHandle.collapse()` /
 * `.expand()` calls preserve the user's manual resize position
 * across the cycle, so the chat doesn't snap back to 35% every
 * time the user sends a new prompt after a "New project" reset.
 */
function TwoColumnLayout({
  defaults,
  showCode,
  showPreview,
  activeTab,
  onActiveTabChange,
  chatPanel,
  codePanel,
  previewPanel,
}: TwoColumnLayoutProps) {
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null)
  /*
   * Track the previously-applied `showCode` value so we only call
   * collapse/expand when the value actually changes. The ref is
   * initialised to `null` (NOT to the current `showCode`) so the
   * first effect run always applies the state — otherwise, when
   * the page mounts with `showCode=false`, the guard
   * `null === false` is false, the ref updates to `false`, and
   * `collapse()` fires. Without the sentinel, `lastShowCodeRef`
   * would be initialised to `false`, the guard `false === false`
   * would early-return, and the right Panel would stay at its
   * `defaultSize=65` with no content (AnimatePresence renders
   * nothing) — leaving the chat squeezed to 35% of the shell.
   */
  const lastShowCodeRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (!rightPanelRef.current) return
    if (lastShowCodeRef.current === showCode) return
    lastShowCodeRef.current = showCode
    if (showCode) {
      // Restore the right panel to its most recent size.
      rightPanelRef.current.expand()
    } else {
      // Snap to `collapsedSize` (0%). The right column visually
      // disappears and the chat fills the shell.
      rightPanelRef.current.collapse()
    }
  }, [showCode])

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
        className={cn(
          'group relative w-1 cursor-col-resize bg-border',
          'transition-colors duration-150 ease-out',
          'hover:bg-primary',
          'data-[separator=hover]:bg-primary',
          'data-[separator=active]:bg-primary',
          'data-[separator=active]:shadow-sm',
          'data-[separator=focus]:bg-primary',
          'data-[separator=focus]:outline data-[separator=focus]:outline-2',
          'data-[separator=focus]:outline-ring',
          // Hide the drag handle when the right panel is collapsed —
          // there's nothing to drag and a visible handle on a 0-width
          // column is confusing.
          !showCode && 'pointer-events-none opacity-0',
        )}
      />

      <Panel
        id="right"
        panelRef={rightPanelRef}
        defaultSize={defaults.right}
        minSize={defaults.rightMin}
        // `collapsible + collapsedSize=0` lets the imperative API
        // collapse the panel all the way down. The Group respects
        // the collapsed size and the chat panel fills the freed
        // space automatically.
        collapsible
        collapsedSize={0}
        className="h-full min-w-0"
      >
        {/*
         * The right column is always rendered (the Panel itself is
         * always mounted), but its CONTENT is conditionally swapped
         * via framer-motion's `AnimatePresence` so the appearance is
         * a smooth fade-in rather than a hard pop. The Panel
         * element stays in the DOM, which preserves the user's
         * resize state.
         */}
        <AnimatePresence initial={false}>
          {showCode ? (
            <motion.div
              key="right-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="h-full w-full"
            >
              <CodePreviewTabs
                activeTab={activeTab}
                onTabChange={onActiveTabChange}
                showPreview={showPreview}
                codePanel={codePanel}
                previewPanel={previewPanel}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
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
      {/*
       * Bottom padding so the last row of content isn't hidden
       * behind the fixed tab bar. The tab bar is `fixed bottom-7`
       * (48px tall) and the StatusBar is `h-7` (28px) in the
       * Builder's flex flow, so the content area needs to clear
       * both: 48px (tab bar) + 28px (status bar) + safe-area.
       */}
      <div className="min-h-0 flex-1 overflow-hidden pb-[calc(48px+28px+env(safe-area-inset-bottom))]">
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isDesktop || isTablet ? (
          <TwoColumnLayout
            defaults={isDesktop ? DESKTOP_DEFAULTS : TABLET_DEFAULTS}
            showCode={props.showCode}
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
