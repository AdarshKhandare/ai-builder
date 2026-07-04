/**
 * StatusBar — 28px footer strip with model, status, cost, and
 * timing info.
 *
 * Spec (`docs/UI_DESIGN_DIRECTION.md` §9.3):
 *  - Left:    model name with the `opencode-go/` provider prefix
 *             stripped for display.
 *  - Center:  status indicator (idle = "Ready", streaming = pulsing
 *             amber dot + status text).
 *  - Right:   combined stats line — `~$0.0024 · minimax-m3 · 1.2s`
 *             after a completed run, or just the model + time
 *             when pricing is unavailable, or just the time when
 *             no run has completed yet. Cost is a tilde-prefixed
 *             estimate based on the model's per-MTok pricing
 *             and a rough `code.length / 4` token heuristic.
 *
 * 2026-07-04 additions (Phase 5):
 *  - The right side now renders the consolidated
 *    `cost · model · time` mono string. The model in the right
 *    string is the *short* name (provider prefix stripped and
 *    lowercased) so the right side is self-contained and doesn't
 *    rely on the left-side label.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface StatusBarProps {
  /** Selected model id, e.g. `opencode-go/minimax-m3`. */
  model: string
  /** Latest backend status event. */
  status: string | null
  /** Whether a stream is in flight. */
  isStreaming: boolean
  /** Generation time in ms for the last completed run, or `null`. */
  generationTime: number | null
  /**
   * Pre-computed estimated cost in USD for the last completed
   * run, or `null` when no run has completed yet, or when the
   * selected model's pricing is unavailable. The Builder computes
   * this once when `done` flips true so the StatusBar stays purely
   * presentational.
   */
  estimatedCostUsd: number | null
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

/**
 * Format an estimated cost in USD as a short `~$0.0024` string.
 * Uses 4 decimal places so even a $0.0001 cost is visible (a
 * typical MiniMax M3 generation lands in the $0.001-$0.01
 * range; 4dp gives us headroom for the cheap models).
 *
 * Returns `null` if the cost is `null` (no run yet) so callers
 * can branch on "no info" vs. "explicit $0.0000".
 */
function formatCost(cost: number | null): string | null {
  if (cost === null) return null
  if (cost === 0) return '~$0.0000'
  return `~$${cost.toFixed(4)}`
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

interface StatsLineProps {
  estimatedCostUsd: number | null
  model: string
  generationTime: number | null
}

/**
 * The right-aligned stats line. Composed of three optional parts,
 * joined with the `·` middle dot:
 *
 *   - Cost (`~$0.0024`) — only when `estimatedCostUsd` is non-null
 *     AND non-negative. A negative value is treated as "unknown"
 *     to keep the math simple.
 *   - Model short name (`minimax-m3`) — always shown when present.
 *   - Generation time (`1.2s`) — only when `generationTime` is set.
 *
 * The whole line is in a muted mono font so it reads as a single
 * "stats panel" rather than three separate labels.
 */
function StatsLine({ estimatedCostUsd, model, generationTime }: StatsLineProps) {
  const costLabel = estimatedCostUsd !== null ? formatCost(estimatedCostUsd) : null
  const modelLabel = model ? formatModelName(model) : ''
  const timeLabel = generationTime !== null ? formatGenerationTime(generationTime) : null

  // Build the line. Always include the model (it's the identity of
  // the stats line) and append the optional cost + time around it.
  const parts: string[] = []
  if (costLabel) parts.push(costLabel)
  if (modelLabel) parts.push(modelLabel)
  if (timeLabel) parts.push(timeLabel)

  // Pulse the stats line briefly when a new value arrives so the
  // user sees the cost / time update on completion.
  const [pulseKey, setPulseKey] = useState(0)
  useEffect(() => {
    setPulseKey((k) => k + 1)
  }, [costLabel, timeLabel])

  const display = parts.length > 0 ? parts.join(' · ') : '—'

  return (
    <span
      key={pulseKey}
      className="font-mono text-[11px] tracking-tight text-muted-foreground tabular-nums"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={display}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="inline-block"
        >
          {display}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function StatusBar({
  model,
  status,
  isStreaming,
  generationTime,
  estimatedCostUsd,
}: StatusBarProps) {
  const label = statusLabel(status, isStreaming)
  const displayModel = formatModelName(model)

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

      {/* ── Right: stats line (cost · model · time) ─────────── */}
      <div className="hidden sm:flex items-center">
        <StatsLine
          estimatedCostUsd={estimatedCostUsd}
          model={model}
          generationTime={generationTime}
        />
      </div>
    </footer>
  )
}
