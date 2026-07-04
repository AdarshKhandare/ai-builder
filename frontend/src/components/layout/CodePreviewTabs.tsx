/**
 * CodePreviewTabs — the tab toggle inside the right column of the
 * builder (desktop/tablet layouts).
 *
 * Renders two tabs (`Code` / `Preview`) with a single amber underline
 * that slides between them via framer-motion `layoutId`. The active
 * tab's content is rendered inside an `AnimatePresence mode="wait"`
 * for a fast cross-fade.
 *
 * The Preview tab is only shown after the first `done` SSE event
 * (i.e. once we have real, generated code to render). Until then the
 * right column is code-only and the tab bar is hidden.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Code, Eye } from 'lucide-react'
import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type CodePreviewTab = 'code' | 'preview'

export interface CodePreviewTabsProps {
  /** The content of the Code tab (typically a `<CodePanel>`). */
  codePanel: ReactNode
  /** The content of the Preview tab (typically a `<PreviewPanel>`). */
  previewPanel: ReactNode
  /** Which tab is currently active. */
  activeTab: CodePreviewTab
  /** Called when the user clicks a tab. */
  onTabChange: (tab: CodePreviewTab) => void
  /**
   * Whether the Preview tab should be visible. `false` before the
   * first generation completes. When `false`, the right column shows
   * the code panel only and the tab bar is hidden.
   */
  showPreview: boolean
}

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

const TAB_UNDERLINE_ID = 'code-preview-tab-underline'

interface TabButtonProps {
  id: CodePreviewTab
  label: string
  active: boolean
  onSelect: (id: CodePreviewTab) => void
  Icon: typeof Code
}

function TabButton({ id, label, active, onSelect, Icon }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`code-preview-tabpanel-${id}`}
      id={`code-preview-tab-${id}`}
      onClick={() => onSelect(id)}
      className={cn(
        'relative flex h-8 items-center gap-1.5 rounded-t-md px-3 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

export function CodePreviewTabs({
  codePanel,
  previewPanel,
  activeTab,
  onTabChange,
  showPreview,
}: CodePreviewTabsProps) {
  // The Preview tab is opt-in. Until the first `done` event we render
  // a code-only right column with no tab bar.
  //
  // `useReducedMotion` is called unconditionally because hooks must
  // be called in the same order on every render. Even when the
  // preview-only fallback branch is taken below, we still need
  // the value to count toward the hook call.
  const prefersReduced = useReducedMotion()

  if (!showPreview) {
    return (
      <div
        id="code-preview-tabpanel-code"
        role="tabpanel"
        aria-labelledby="code-preview-tab-code"
        className="flex h-full min-w-0 flex-col"
      >
        {codePanel}
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Code and preview"
        className="
          relative flex h-10 shrink-0 items-center gap-1
          border-b border-border bg-card px-2
        "
      >
        <TabButton
          id="code"
          label="Code"
          active={activeTab === 'code'}
          onSelect={onTabChange}
          Icon={Code}
        />
        <TabButton
          id="preview"
          label="Preview"
          active={activeTab === 'preview'}
          onSelect={onTabChange}
          Icon={Eye}
        />

        {/* The animated amber underline. `layoutId` makes framer-motion
            slide it between tab buttons when the active tab changes.
            When the user prefers reduced motion, we collapse the
            spring to a zero-duration instant transition. */}
        <motion.div
          layoutId={TAB_UNDERLINE_ID}
          aria-hidden="true"
          className="
            pointer-events-none absolute bottom-0 h-0.5
            rounded-full bg-primary
          "
          transition={
            prefersReduced ? REDUCED_TRANSITION : TAB_UNDERLINE_TRANSITION
          }
        />
      </div>

      {/* Tab content area — only the active tab is rendered. */}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            id={`code-preview-tabpanel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`code-preview-tab-${activeTab}`}
            className="absolute inset-0 flex min-h-0 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            {activeTab === 'code' ? codePanel : previewPanel}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
