import { motion } from 'framer-motion'
import { Code } from 'lucide-react'

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

const BUBBLE_BASE =
  'max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-3 text-sm leading-relaxed text-foreground'

const USER_BUBBLE = `${BUBBLE_BASE} rounded-br-sm bg-primary/10`

const ASSISTANT_BUBBLE = `${BUBBLE_BASE} rounded-bl-sm bg-muted`

const ENTER_TRANSITION = { duration: 0.2, ease: 'easeOut' as const }

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
          <div className="flex items-center gap-2">
            <Code className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="font-medium text-foreground">Code generated</span>
            <span className="text-xs text-muted-foreground">
              — see the Code panel
            </span>
          </div>
        ) : (
          content
        )}
      </div>
    </motion.div>
  )
}
