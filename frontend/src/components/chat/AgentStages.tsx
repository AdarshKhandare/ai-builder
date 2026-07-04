/**
 * AgentStages — the "thinking" status panel that lives inside the
 * chat list while a generation is in flight, and collapses to a
 * single summary line once the run completes.
 *
 * Replaces the old plain "Planning… / Generating…" text. The new
 * pattern is closer to ChatGPT / Claude: each agent stage (plan,
 * generate, iterate) is a card with an icon + label; while the
 * stage is in progress the card is expanded with a pulsing dot, and
 * once the stage completes the card collapses to a single "✓
 * Planned" line. Clicking the summary line expands the card to
 * reveal the stage detail (the plan text, the generated code length,
 * etc.).
 *
 * States:
 *  - planning (in flight)  → expanded "Planning your app…" card
 *  - generating (in flight)→ expanded "Writing code…" card
 *  - iterating (in flight) → expanded "Updating your app…" card
 *  - done (no streaming)   → single collapsed line:
 *                            "✓ Planned · Generated 1,234 chars"
 *
 * 2026-07-04 (Builder UX pass) — added as part of the chat-panel
 * polish. Replaces the simple "statusText" string that lived in
 * the chat list before.
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Code2,
  Pencil,
  Sparkles,
} from 'lucide-react'

import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AgentStage = 'planning' | 'generating' | 'iterating' | 'done'

export interface AgentStagesProps {
  /**
   * The current agent stage. Pass `'done'` once the SSE `done` event
   * has been processed — the component will render the collapsed
   * summary line in that case.
   */
  stage: AgentStage
  /**
   * Length of the most recent generated code, in characters. Shown
   * in the collapsed summary line so the user can see "what came
   * out" without expanding the card.
   */
  codeLength: number
  /**
   * Optional plan text from the planner agent. Surfaced when the
   * user expands the "Planned" card.
   */
  planDetail?: string | null
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k chars`
  return `${Math.round(n / 1000)}k chars`
}

/* ------------------------------------------------------------------ */
/* Card (expanded / in-flight)                                         */
/* ------------------------------------------------------------------ */

interface StageCardProps {
  icon: React.ReactNode
  label: string
  detail?: string | null
  /** Unique key for AnimatePresence enter / exit. */
  stageKey: string
}

function StageCard({ icon, label, detail, stageKey }: StageCardProps) {
  return (
    <motion.div
      key={stageKey}
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="
        flex items-start gap-2.5 self-start rounded-xl
        border border-border bg-card px-3 py-2.5
        text-sm shadow-xs
      "
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="
          mt-0.5 flex size-6 shrink-0 items-center justify-center
          rounded-md bg-primary/15 text-primary
        "
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <motion.span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          <span className="font-medium text-foreground">{label}</span>
        </div>
        {detail ? (
          <p className="pl-3.5 text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Summary (collapsed / done)                                          */
/* ------------------------------------------------------------------ */

interface SummaryLineProps {
  stage: AgentStage
  codeLength: number
  expanded: boolean
  onToggle: () => void
}

function SummaryLine({
  stage,
  codeLength,
  expanded,
  onToggle,
}: SummaryLineProps) {
  // Compose a one-line summary based on the most recent stage.
  // "Plan ✓ · Generated 1.2k chars" / "Updated ✓ · 3.4k chars"
  const verb = stage === 'iterating' ? 'Updated' : 'Planned'
  const parts: string[] = [`${verb} ✓`]
  if (codeLength > 0) {
    parts.push(`Generated ${formatChars(codeLength)}`)
  }
  const text = parts.join(' · ')

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      aria-expanded={expanded}
      className={cn(
        'group flex cursor-pointer items-center gap-2 self-start rounded-md',
        'border border-border bg-card px-2.5 py-1.5',
        'text-xs text-muted-foreground',
        'transition-colors hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <Check className="size-3 text-success" aria-hidden="true" />
      <span>{text}</span>
      <ChevronDown
        className={cn(
          'size-3 transition-transform',
          expanded && 'rotate-180',
        )}
        aria-hidden="true"
      />
    </motion.button>
  )
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export function AgentStages({
  stage,
  codeLength,
  planDetail,
}: AgentStagesProps) {
  // Track the expanded state for the collapsed summary. Default to
  // collapsed — the user can tap the chevron to see the plan text.
  const [expanded, setExpanded] = useState(false)

  if (stage === 'done') {
    return (
      <div className="flex flex-col items-start gap-1">
        <SummaryLine
          stage={stage}
          codeLength={codeLength}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="plan-detail"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div
                className="
                  mt-1 max-w-md rounded-md border border-border-subtle
                  bg-background-sunken p-2.5 text-xs text-muted-foreground
                "
              >
                {planDetail ? (
                  <p className="whitespace-pre-wrap">{planDetail}</p>
                ) : (
                  <p className="italic">
                    No plan text was emitted by the planner agent.
                  </p>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    )
  }

  // In-flight: show the matching stage card. The card animates in
  // and out as the stage changes (e.g. planning → generating).
  return (
    <AnimatePresence mode="wait" initial={false}>
      {stage === 'planning' ? (
        <StageCard
          key="planning"
          stageKey="planning"
          icon={<Sparkles className="size-3.5" aria-hidden="true" />}
          label="Planning your app…"
          detail="The planner agent is designing the structure."
        />
      ) : null}
      {stage === 'generating' ? (
        <StageCard
          key="generating"
          stageKey="generating"
          icon={<Code2 className="size-3.5" aria-hidden="true" />}
          label="Writing code…"
          detail="Streaming the implementation into the code panel."
        />
      ) : null}
      {stage === 'iterating' ? (
        <StageCard
          key="iterating"
          stageKey="iterating"
          icon={<Pencil className="size-3.5" aria-hidden="true" />}
          label="Updating your app…"
          detail="Applying your requested changes."
        />
      ) : null}
    </AnimatePresence>
  )
}
