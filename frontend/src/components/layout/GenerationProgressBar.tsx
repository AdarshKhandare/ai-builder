/**
 * GenerationProgressBar — a 2px determinate bar pinned to the very
 * top of the viewport (z-50, above the TopBar) that shows real
 * progress while a generation is in flight.
 *
 * Phases (driven by the props + internal state machine):
 *
 *  - `idle`       — bar is unmounted; nothing rendered
 *  - `active`     — `isStreaming=true`. Bar appears at 0% and
 *                   animates to 90% over `ACTIVE_DURATION_MS` (a
 *                   "best guess" of typical generation time — see
 *                   the comment near the constant). The bar holds
 *                   at 90% if the run takes longer; the chat's
 *                   status text keeps the user informed.
 *  - `completing` — `isStreaming` just went false. Bar jumps to
 *                   100% over `COMPLETE_FILL_MS`, then fades out
 *                   over `FADE_OUT_MS` (with a `COMPLETE_HOLD_MS`
 *                   delay so the user sees the 100% before the
 *                   fade). After the fade completes, the bar
 *                   unmounts (`idle`).
 *  - `error`      — Same lifecycle as `completing`, but the bar
 *                   turns `bg-destructive` (red) before fading.
 *
 * The bar is a sibling of the page content, not a child — it's
 * `position: fixed; top: 0` so it sits above the TopBar's
 * border-bottom and remains visible during scroll. This is the
 * pattern users associate with "the page is doing work" (Linear,
 * Vercel, etc.).
 *
 * The bar is NOT rendered when a project is loaded from history
 * (no streaming) — `isStreaming` stays false in that flow.
 *
 * 2026-07-04 (Builder UX pass) — replaced the old indeterminate
 * "sliding block" with a real determinate bar. The old animation
 * never stopped, which read as "the page is stuck" once a
 * generation completed. The new bar clears within ~450ms of
 * `done`.
 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface GenerationProgressBarProps {
  /** Whether a generation is currently in flight. */
  isStreaming: boolean
  /**
   * Whether the most recent run errored. When `true` the bar
   * turns red during the `completing` phase. Has no effect
   * while `isStreaming=true` (the bar is still in `active`).
   */
  hasError?: boolean
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * The bar fills from 0% → 90% over this many milliseconds while a
 * stream is in flight. Picked to roughly match a typical
 * MiniMax M3 / DeepSeek V4 Flash generation (~10–25s); the bar
 * holds at 90% if the run takes longer.
 */
const ACTIVE_DURATION_MS = 30_000

/** Width-animation duration for the 90% → 100% "completion" jump. */
const COMPLETE_FILL_MS = 180

/** Delay between the 100% jump and the start of the fade-out. */
const COMPLETE_HOLD_MS = 180

/** Fade-out duration once the bar reaches 100%. */
const FADE_OUT_MS = 220

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Phase = 'idle' | 'active' | 'completing'

export function GenerationProgressBar({
  isStreaming,
  hasError = false,
}: GenerationProgressBarProps) {
  /*
   * `phase` tracks the local lifecycle of the bar. We can't just
   * bind everything to `isStreaming` because we want a brief
   * "show 100% then fade" window after the run finishes. `phase`
   * decouples that from the SSE hook.
   */
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    if (isStreaming) {
      setPhase('active')
      return
    }
    if (phase === 'active') {
      // The stream just ended. Move to `completing` and schedule
      // a return to `idle` after the fade-out completes.
      setPhase('completing')
      const totalFadeMs = COMPLETE_FILL_MS + COMPLETE_HOLD_MS + FADE_OUT_MS
      const timer = window.setTimeout(() => {
        setPhase('idle')
      }, totalFadeMs)
      return () => {
        window.clearTimeout(timer)
      }
    }
  }, [isStreaming, phase])

  const visible = phase !== 'idle'

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5',
        'bg-transparent',
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Generation progress"
      data-state={phase}
      data-error={hasError ? 'true' : 'false'}
    >
      <AnimatePresence>
        {visible ? (
          <motion.div
            key="bar"
            // Mount at width 0%, opacity 1 — the bar fades IN as
            // it starts filling.
            initial={{ width: '0%', opacity: 1 }}
            animate={
              phase === 'active'
                ? {
                    width: '90%',
                    transition: {
                      width: {
                        duration: ACTIVE_DURATION_MS / 1000,
                        ease: 'linear',
                      },
                    },
                  }
                : {
                    // `completing` — jump to 100%, then fade.
                    width: '100%',
                    opacity: 0,
                    transition: {
                      width: {
                        duration: COMPLETE_FILL_MS / 1000,
                        ease: 'easeOut',
                      },
                      opacity: {
                        duration: FADE_OUT_MS / 1000,
                        delay: (COMPLETE_HOLD_MS + COMPLETE_FILL_MS) / 1000,
                        ease: 'easeOut',
                      },
                    },
                  }
            }
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className={cn(
              'h-full shadow-[0_0_8px_var(--primary-glow)]',
              hasError ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ willChange: 'width, opacity' }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}
