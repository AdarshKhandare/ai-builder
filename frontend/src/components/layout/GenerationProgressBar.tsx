/**
 * GenerationProgressBar — a 2px indigo bar shown below the TopBar
 * while a generation is in flight.
 *
 * The bar uses an indeterminate animation: a 30%-wide indigo segment
 * slides from left to right repeatedly. This is the same pattern
 * that native browsers use for "loading" states and reads as "active
 * work" without claiming any specific progress percentage (the SSE
 * stream doesn't emit granular progress events).
 *
 * Mounted at the top of the builder shell, just under the TopBar.
 * Render nothing when `isStreaming` is `false` so it doesn't take
 * any vertical space between generations.
 *
 * 2026-07-04 (Phase 6 redesign) — "Calm Precision" light theme:
 * indigo progress segment (was amber), subtle shadow-sm (no glow).
 */
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from 'framer-motion'

export interface GenerationProgressBarProps {
  /** Whether a generation is currently in flight. */
  isStreaming: boolean
}

export function GenerationProgressBar({ isStreaming }: GenerationProgressBarProps) {
  const prefersReduced = useReducedMotion()

  return (
    <div
      className="relative h-0.5 w-full overflow-hidden bg-transparent"
      aria-hidden="true"
    >
      <AnimatePresence>
        {isStreaming && (
          <motion.div
            key="progress-bar"
            // The bar itself: a 30%-wide indigo block. We animate its
            // `x` percentage so it appears to slide from -30% to
            // 100% of the container width.
            initial={{ x: '-30%' }}
            animate={
              prefersReduced
                ? { opacity: [0.5, 1, 0.5] }
                : { x: '100%' }
            }
            exit={{ opacity: 0 }}
            transition={
              prefersReduced
                ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
            }
            className="
              absolute inset-y-0 left-0
              w-[30%] bg-primary
            "
            style={{ willChange: 'transform' }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
