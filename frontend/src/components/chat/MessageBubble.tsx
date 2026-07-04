import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Code } from 'lucide-react'

import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Heuristic that recognises an assistant message whose body is a chunk of
 * HTML markup (a generated page). When matched we render a compact
 * "Code generated" label instead of dumping the raw tags into the chat
 * thread — the user can read the code in the Code panel and we avoid
 * 5,000-character blobs breaking the message list's visual rhythm.
 *
 * Triggers when the message:
 *   1. starts with `<` (i.e. is markup, not prose)
 *   2. is non-trivial in length
 *   3. contains at least one closing tag (so `<input>` alone won't false-fire)
 */
function looksLikeHtmlCode(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed.startsWith('<')) return false
  if (trimmed.length < 80) return false
  if (!/<[a-zA-Z][^>]*>/.test(trimmed)) return false
  if (!/<\/[a-zA-Z][^>]*>/.test(trimmed)) return false
  return true
}

/**
 * "Long" assistant message — show the first 2 lines + a "Show more"
 * button. Below this length the full message is rendered (no collapse).
 */
const COLLAPSE_LINE_LIMIT = 2
const COLLAPSE_CHAR_THRESHOLD = 140

/**
 * Bubble base styles — rounded-2xl with a subtle corner bias toward
 * the speaker (user bubbles have a tighter bottom-right corner,
 * assistant bubbles a tighter bottom-left). Matches the design
 * system: user messages use `bg-primary/10`, assistant messages
 * use `bg-muted`.
 */
const BUBBLE_BASE =
  'max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-3 text-sm leading-relaxed text-foreground'

const USER_BUBBLE = `${BUBBLE_BASE} rounded-br-sm bg-primary/10`

const ASSISTANT_BUBBLE = `${BUBBLE_BASE} rounded-bl-sm bg-muted`

const ENTER_TRANSITION = { duration: 0.2, ease: 'easeOut' as const }

/**
 * Pick a preview string for a long assistant message — the first
 * `COLLAPSE_LINE_LIMIT` lines plus an ellipsis if there's more.
 * Splits on the FIRST newline break so trailing whitespace is
 * preserved naturally.
 */
function previewLines(content: string): string {
  const lines = content.split('\n')
  if (lines.length <= COLLAPSE_LINE_LIMIT) return content
  return lines.slice(0, COLLAPSE_LINE_LIMIT).join('\n') + '…'
}

/**
 * Decide whether a non-code assistant message should be collapsed
 * by default. Long prose messages get the show-more affordance;
 * short messages render in full.
 */
function shouldCollapse(content: string): boolean {
  if (content.length < COLLAPSE_CHAR_THRESHOLD) return false
  const lineCount = content.split('\n').length
  return lineCount > COLLAPSE_LINE_LIMIT
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user'
  const isCode = !isUser && looksLikeHtmlCode(content)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER_TRANSITION}
      className={isUser ? 'flex justify-end' : 'flex justify-start'}
    >
      <div className={isUser ? USER_BUBBLE : ASSISTANT_BUBBLE}>
        {isCode ? (
          <CodeSummary />
        ) : isUser ? (
          content
        ) : (
          <CollapsibleAssistant content={content} />
        )}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

/**
 * The "Code generated — see the Code panel" placeholder rendered in
 * place of a raw HTML blob. Surfaces that code IS available
 * without dumping 5,000 chars of markup into the chat thread.
 */
function CodeSummary() {
  return (
    <div className="flex items-center gap-2">
      <Code className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium text-foreground">Code generated</span>
      <span className="text-xs text-muted-foreground">
        — see the Code panel
      </span>
    </div>
  )
}

/**
 * Long assistant messages get a "Show more" / "Show less" affordance.
 * Short messages render in full (no collapse). User messages never
 * collapse — see {@link MessageBubble} for the dispatch.
 */
function CollapsibleAssistant({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = shouldCollapse(content)
  if (!collapsible) return <>{content}</>

  return (
    <div className="flex flex-col gap-1.5">
      <span>{expanded ? content : previewLines(content)}</span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          'flex w-fit cursor-pointer items-center gap-1 self-start',
          'rounded-md px-1.5 py-0.5',
          'text-[11px] font-medium text-primary',
          'transition-colors hover:bg-primary/10',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span>{expanded ? 'Show less' : 'Show more'}</span>
        <ChevronDown
          className={cn(
            'size-3 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  )
}
