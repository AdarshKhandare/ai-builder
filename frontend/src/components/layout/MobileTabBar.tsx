/**
 * MobileTabBar — the bottom 3-tab navigation shown on viewports
 * narrower than the tablet breakpoint (< 640px).
 *
 * Three tabs (Chat / Code / Preview). The active tab gets an indigo
 * underline that slides between buttons via framer-motion `layoutId`.
 * The Preview tab is disabled until the first `done` SSE event fires
 * (no point showing it before code is ready).
 *
 * 48px minimum touch targets, `env(safe-area-inset-bottom)` padding
 * for the iOS home indicator. The container is `fixed` so it stays
 * glued to the viewport bottom even when the page itself scrolls.
 *
 * 2026-07-04 (Phase 6 redesign) — "Calm Precision" light theme:
 * white card bg, subtle border-top, indigo active state + underline.
 */
import { motion, useReducedMotion } from 'framer-motion'
import { Code, Eye, MessageSquare } from 'lucide-react'

import { cn } from '@/lib/utils'

export type MobileTab = 'chat' | 'code' | 'preview'

export interface MobileTabBarProps {
  active: MobileTab
  onChange: (tab: MobileTab) => void
  /**
   * Whether the Preview tab should be enabled. `false` until the
   * first generation completes — earlier the tab is greyed out and
   * not clickable.
   */
  showPreview: boolean
}

interface TabSpec {
  id: MobileTab
  label: string
  Icon: typeof Code
}

const TABS: ReadonlyArray<TabSpec> = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'code', label: 'Code', Icon: Code },
  { id: 'preview', label: 'Preview', Icon: Eye },
]

const UNDERLINE_LAYOUT_ID = 'mobile-tab-underline'

/**
 * Spring used for the sliding tab underline. Kept in module scope
 * so the same object is shared across renders (mild perf win,
 * also makes the intent obvious to readers).
 */
const TAB_UNDERLINE_TRANSITION = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
  mass: 0.8,
} as const

/** Used when the user has `prefers-reduced-motion: reduce` set. */
const REDUCED_TRANSITION = { duration: 0 } as const

export function MobileTabBar({ active, onChange, showPreview }: MobileTabBarProps) {
  // When the user prefers reduced motion, collapse the spring to
  // a zero-duration instant transition — the underline still moves
  // with the active tab, but the animation itself disappears.
  const prefersReduced = useReducedMotion()

  return (
    <nav
      role="tablist"
      aria-label="Builder panels"
      className="
        fixed bottom-0 left-0 right-0 z-50
        flex h-[calc(48px+env(safe-area-inset-bottom))]
        items-stretch border-t border-border bg-card
        pb-safe
      "
    >
      {TABS.map(({ id, label, Icon }) => {
        const isActive = id === active
        const isDisabled = id === 'preview' && !showPreview
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`mobile-tabpanel-${id}`}
            id={`mobile-tab-${id}`}
            onClick={() => {
              if (isDisabled) return
              onChange(id)
            }}
            disabled={isDisabled}
            className={cn(
              'relative flex min-h-[48px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'text-primary'
                : isDisabled
                  ? 'text-muted-foreground/40'
                  : 'text-muted-foreground hover:text-foreground',
              isDisabled && 'cursor-not-allowed',
            )}
          >
            <Icon
              className="size-[18px]"
              aria-hidden="true"
            />
            <span className="text-[11px] font-medium leading-none">{label}</span>
            {/* The animated underline — only rendered on the active tab.
                When the user prefers reduced motion, the spring is
                replaced with a zero-duration transition. */}
            {isActive && (
              <motion.span
                layoutId={UNDERLINE_LAYOUT_ID}
                aria-hidden="true"
                className="absolute bottom-1 h-0.5 w-8 rounded-full bg-primary"
                transition={
                  prefersReduced
                    ? REDUCED_TRANSITION
                    : TAB_UNDERLINE_TRANSITION
                }
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
