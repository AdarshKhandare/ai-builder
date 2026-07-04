/**
 * StatusBar — 28px footer strip with model, status, and timing info.
 *
 * Spec (`docs/UI_DESIGN_DIRECTION.md` §9.3):
 *  - Left:    model name with the `opencode-go/` provider prefix
 *             stripped for display.
 *  - Center:  status indicator (idle = "Ready", streaming = pulsing
 *             amber dot + status text).
 *  - Right:   generation time in seconds (e.g. "2.3s"), shown only
 *             on ≥sm viewports.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface StatusBarProps {
  model: string
  status: string | null
  isStreaming: boolean
  generationTime: number | null
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Strip a `provider/` prefix from a model ID for human display. */
function formatModelName(model: string): string {
  const slashIndex = model.indexOf('/')
  return slashIndex >= 0 ? model.slice(slashIndex + 1) : model
}

/**
 * Map a backend status event (`planning` | `generating` | …) to the
 * short label rendered in the status bar. Unknown statuses fall
 * through with the first letter uppercased.
 */
function statusLabel(status: string | null, isStreaming: boolean): string {
  if (!isStreaming) return 'Ready'
  switch (status) {
    case 'planning':
      return 'Thinking…'
    case 'generating':
      return 'Generating…'
    default:
      // Defensive: backend may emit a new status we don't know yet.
      const trimmed = status?.trim() ?? ''
      if (!trimmed) return 'Streaming…'
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1) + '…'
  }
}

/** Format milliseconds as a short "1.2s" / "12.5s" string. */
function formatGenerationTime(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 10) return seconds.toFixed(1) + 's'
  if (seconds < 100) return seconds.toFixed(1) + 's'
  return Math.round(seconds) + 's'
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

interface StatusIndicatorProps {
  isStreaming: boolean
  label: string
}

function StatusIndicator({ isStreaming, label }: StatusIndicatorProps) {
  return (
    <div
      className="flex items-center gap-2"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        aria-hidden="true"
        className={[
          'inline-block size-2 rounded-full',
          isStreaming ? 'bg-primary animate-pulse' : 'bg-muted-foreground',
        ].join(' ')}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className="font-mono text-[11px] tracking-tight text-muted-foreground"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function StatusBar({ model, status, isStreaming, generationTime }: StatusBarProps) {
  const label = statusLabel(status, isStreaming)
  const displayModel = formatModelName(model)

  // Animate the time display briefly when a new value arrives.
  const [pulseKey, setPulseKey] = useState(0)
  useEffect(() => {
    if (generationTime == null) return
    setPulseKey((k) => k + 1)
  }, [generationTime])

  return (
    <footer
      className="
        flex h-7 shrink-0 items-center justify-between gap-3
        border-t border-border bg-card px-3
        text-xs text-muted-foreground
        sm:px-4
      "
    >
      {/* ── Left: model ────────────────────────────────────── */}
      <span
        className="font-mono text-[11px] tracking-tight truncate"
        title={model}
      >
        {displayModel || '—'}
      </span>

      {/* ── Center: status indicator ────────────────────────── */}
      <StatusIndicator isStreaming={isStreaming} label={label} />

      {/* ── Right: generation time (≥sm) ────────────────────── */}
      <div className="hidden sm:flex items-center gap-1.5">
        {generationTime != null ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={pulseKey}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="font-mono text-[11px] tabular-nums"
            >
              {formatGenerationTime(generationTime)}
            </motion.span>
          </AnimatePresence>
        ) : (
          <span aria-hidden="true" className="font-mono text-[11px] opacity-0">
            0.0s
          </span>
        )}
      </div>
    </footer>
  )
}
