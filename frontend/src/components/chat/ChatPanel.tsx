/**
 * ChatPanel — the conversation surface.
 *
 * Has two visual modes:
 *  - `fullWidth={true}`  (default in the initial state — chat is the
 *                         only visible panel): the empty state is
 *                         centered both axes, the prompt is large
 *                         (`text-3xl font-display`), suggestion chips
 *                         are larger, and the input is centered with
 *                         a `max-w-2xl` column. Mirrors the focused
 *                         "describe your app" experience of an AI
 *                         chat product's first-run screen.
 *  - `fullWidth={false}` (compact — chat shares the shell with the
 *                         code and/or preview panel): current
 *                         compact layout with a panel header and a
 *                         narrower empty state.
 *
 * 2026-07-03 additions:
 *  - Auto-scroll lock indicator: a floating "↓ Scroll to bottom" button
 *    that appears when the user scrolls up while streaming. Click to
 *    resume the auto-scroll behaviour.
 *  - `Cmd+Enter` / `Ctrl+Enter` as an alternative send trigger. The
 *    prompt uses an `<input>`, so any flavour of Enter sends —
 *    plain Enter, Cmd+Enter, Ctrl+Enter, and Shift+Enter all
 *    route through the same `key === 'Enter'` branch. There is no
 *    newline behaviour because there is no `<textarea>`.
 *  - Header style updated to match the design system ("uppercase
 *    tracking-wider text-xs font-mono text-muted-foreground").
 *
 * 2026-07-04 (Phase 4 — chat iteration):
 *  - `mode` prop: `"generation"` vs `"iteration"`. Drives the input
 *    placeholder ("Describe what you want to build…" vs "Ask for
 *    changes…") and the streaming-status copy ("Planning…" /
 *    "Generating…" / "Iterating…").
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, Hammer, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble } from './MessageBubble'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Two prompt-mode semantics for the chat input.
 *  - `generation` — first-time build: send goes to `/api/generate`.
 *  - `iteration`  — follow-up turn: send goes to `/api/iterate`
 *                    with the current code + history.
 */
export type ChatMode = 'generation' | 'iteration'

interface ChatPanelProps {
  messages: Message[]
  onSend: (prompt: string) => void
  isStreaming: boolean
  status: string | null
  /**
   * `true` when this is the only visible panel (initial builder
   * state). Renders a centered, more welcoming empty state and a
   * wider input column. Defaults to `false` to preserve the existing
   * compact behaviour for any caller that doesn't opt in.
   */
  fullWidth?: boolean
  /**
   * Drives the input placeholder and the streaming-status text.
   * `"generation"` (default) shows the "describe your app" copy;
   * `"iteration"` shows the "ask for changes" copy.
   */
  mode?: ChatMode
}

/**
 * Empty-state starter prompts. Clicking a chip sends the prompt
 * immediately — the input stays clean so the user sees their
 * suggestion become the first user bubble without an extra step.
 */
const SUGGESTIONS: ReadonlyArray<string> = [
  'Landing page for a coffee shop',
  'Todo app with local storage',
  'Portfolio site for a photographer',
]

const STAGGER_INDEX_CAP = 2
const STAGGER_STEP_S = 0.06
const ENTRY_DURATION_S = 0.2

/** Pixel threshold for "near bottom" — below this we auto-scroll. */
const SCROLL_NEAR_BOTTOM_PX = 50

export function ChatPanel({
  messages,
  onSend,
  isStreaming,
  status,
  fullWidth = false,
  mode = 'generation',
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const scrollAnchorRef = useRef<HTMLDivElement>(null)

  /*
   * `isAtBottom` is tracked separately from the auto-scroll effect.
   * When the user is reading earlier messages we don't want to drag
   * them back; when they hit the bottom we re-engage the auto-scroll.
   * The indicator is shown only when (a) we are streaming AND
   * (b) the user is scrolled away from the bottom.
   */
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true)

  // Auto-scroll the ScrollArea viewport to the bottom whenever the
  // message list changes or a new streaming chunk arrives — BUT only
  // if the user is at/near the bottom already. If they scrolled up,
  // we leave them alone and surface the "↓ Scroll to bottom" pill.
  useEffect(() => {
    const anchor = scrollAnchorRef.current
    if (!anchor) return
    const viewport = anchor.closest(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLDivElement | null
    if (!viewport) return
    if (!isAtBottom) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
  }, [messages, isStreaming, isAtBottom])

  // Subscribe to scroll events on the viewport so we can update
  // `isAtBottom` in real time. The handler is the same on every
  // render — we re-bind on `messages` / `isStreaming` because the
  // scrollable content size changes and we need a fresh reference.
  useEffect(() => {
    const anchor = scrollAnchorRef.current
    if (!anchor) return
    const viewport = anchor.closest(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLDivElement | null
    if (!viewport) return

    const handleScroll = (): void => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      setIsAtBottom(distanceFromBottom <= SCROLL_NEAR_BOTTOM_PX)
    }

    // Sync on bind in case the user is mid-scroll.
    handleScroll()
    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
    }
  }, [messages])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput('')
    // Re-engage auto-scroll after the next render commits.
    setIsAtBottom(true)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Any flavour of Enter sends — plain Enter, Cmd+Enter, Ctrl+Enter,
    // and Shift+Enter all land in this branch because the prompt is an
    // `<input>`, not a `<textarea>`. We `preventDefault` to stop the
    // implicit form submit that an `<input>` would otherwise fire.
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSend()
    }
  }

  const scrollToBottom = (): void => {
    const anchor = scrollAnchorRef.current
    if (!anchor) return
    const viewport = anchor.closest(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLDivElement | null
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    setIsAtBottom(true)
  }

  const statusText =
    status === 'planning'
      ? 'Planning…'
      : status === 'generating'
        ? 'Generating…'
        : status === 'iterating'
          ? 'Iterating…'
          : 'Thinking…'

  /**
   * Placeholder text — switches between the "first build" and the
   * "ask for changes" copy based on `mode`. When `fullWidth` is
   * `true` we use a slightly longer, hero-style prompt; otherwise
   * the compact default. The text doesn't change with `isStreaming`
   * — the user can still see what the input would do once the
   * current run finishes.
   */
  const placeholder =
    mode === 'iteration'
      ? fullWidth
        ? 'Ask for changes…'
        : 'Ask for changes…'
      : fullWidth
        ? 'Describe the app you want to build…'
        : 'Describe your app...'

  const canSend = input.trim().length > 0 && !isStreaming
  const showScrollLock = isStreaming && !isAtBottom && messages.length > 0

  return (
    <div className="relative flex h-full flex-col bg-card">
      {/*
       * Header — only on compact mode. In fullWidth mode the chat is
       * the entire screen, so the "Chat" label would be redundant;
       * the centred empty state already says everything it needs to.
       */}
      {!fullWidth && (
        <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
          <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Chat
          </h2>
        </div>
      )}

      {/* Body: empty state or message list */}
      {messages.length === 0 ? (
        fullWidth ? (
          <FullWidthEmptyState
            onSuggestion={onSend}
            isStreaming={isStreaming}
          />
        ) : (
          <CompactEmptyState onSuggestion={onSend} isStreaming={isStreaming} />
        )
      ) : (
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-4 p-4">
            <AnimatePresence initial={false}>
              {messages.map((message, index) => (
                <motion.div
                  // Index-based key is safe here — the message list is
                  // append-only, never reordered or filtered.
                  key={index}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: ENTRY_DURATION_S,
                    delay: Math.min(index, STAGGER_INDEX_CAP) * STAGGER_STEP_S,
                    ease: 'easeOut',
                  }}
                >
                  <MessageBubble
                    role={message.role}
                    content={message.content}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            <AnimatePresence>
              {isStreaming && (
                <motion.div
                  key="streaming-indicator"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="flex items-center gap-2 self-start text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  <motion.span
                    className="inline-block size-2 rounded-full bg-primary"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                  <span>{statusText}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={scrollAnchorRef} aria-hidden="true" />
          </div>
        </ScrollArea>
      )}

      {/* Input area — always anchored to the bottom of the panel. */}
      <div
        className={
          fullWidth
            ? 'shrink-0 border-t border-border bg-card p-4'
            : 'shrink-0 border-t border-border bg-card p-3'
        }
      >
        <div
          className={
            fullWidth
              ? 'mx-auto flex max-w-2xl items-center gap-2'
              : 'flex items-center gap-2'
          }
        >
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming}
            className="bg-background-sunken"
            aria-label="Prompt input"
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            size="icon"
            aria-label="Send message"
          >
            <Send />
          </Button>
        </div>
      </div>

      {/* Floating "scroll to bottom" pill — only while streaming. */}
      <AnimatePresence>
        {showScrollLock && (
          <motion.button
            key="scroll-lock"
            type="button"
            onClick={scrollToBottom}
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            aria-label="Scroll chat to bottom"
            className="
              absolute bottom-20 right-4 z-10
              flex items-center gap-1.5 rounded-full
              border border-border bg-secondary px-3 py-1.5
              text-xs font-medium text-secondary-foreground
              shadow-md
              hover:bg-secondary/80
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
            "
          >
            <ArrowDown className="size-3.5" aria-hidden="true" />
            <span>Scroll to bottom</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Empty-state variants                                                */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  onSuggestion: (prompt: string) => void
  isStreaming: boolean
}

/**
 * Compact empty state — chat is in a side panel next to code/preview.
 * Small heading, small chips. Same density as before.
 */
function CompactEmptyState({ onSuggestion, isStreaming }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Describe what you want to build
        </h3>
        <p className="text-sm text-muted-foreground">
          Forge will generate a working app for you.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSuggestion(suggestion)}
            disabled={isStreaming}
            className="rounded-full bg-secondary px-3 py-1.5 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Full-width empty state — chat fills the whole shell. The prompt
 * reads like a marketing hero: large display heading, larger chips,
 * and a small brand mark to anchor the eye.
 *
 * The whole block is a flex column with `items-center justify-center`
 * so it stays vertically centred even if the panel is much taller
 * than its content.
 */
function FullWidthEmptyState({ onSuggestion, isStreaming }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="
          flex w-full max-w-2xl flex-col items-center gap-7 text-center
        "
      >
        <span
          aria-hidden="true"
          className="
            flex size-14 items-center justify-center rounded-2xl
            bg-primary/10 text-primary
            shadow-[0_0_24px_oklch(0.75_0.16_70/0.25)]
          "
        >
          <Hammer className="size-7" />
        </span>

        <div className="flex flex-col items-center gap-2">
          <h3 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Describe what you want to build
          </h3>
          <p className="max-w-md text-base text-muted-foreground">
            Forge will generate a working web app for you. Just type a
            sentence and watch it appear.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestion(suggestion)}
              disabled={isStreaming}
              className="
                rounded-full bg-secondary px-4 py-2.5 text-sm
                text-secondary-foreground
                transition-colors hover:bg-accent hover:text-accent-foreground
                focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-ring/50
                disabled:pointer-events-none disabled:opacity-50
              "
            >
              {suggestion}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
