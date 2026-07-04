/**
 * CodePanel — the syntax-highlighted code surface of the builder.
 *
 * Renders streamed HTML/CSS/JS code with:
 *   - Per-line syntax highlighting via `prism-react-renderer`
 *   - A line-number gutter (right-aligned, dimmed, non-selectable)
 *   - Proper vertical AND horizontal scroll
 *   - A copy-to-clipboard button with checkmark feedback
 *   - A "Streaming" indicator while code is arriving
 *   - An empty state with a blinking cursor (matches §15.4 of the spec)
 *
 * The horizontal scroll is on the inner `<pre>` (per-line flex row)
 * so the line numbers stay glued to the left edge of the wrapper
 * during vertical scroll — but also scroll horizontally WITH the code
 * when a long line is wider than the panel.
 *
 * 2026-07-04 (Phase 6 redesign) — "Calm Precision" light theme:
 * `bg-background-sunken` (very light gray) for the code area,
 * light syntax highlighting theme (indigo keywords, green strings,
 * muted comments, blue tags). Indigo streaming dot.
 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SyntaxHighlighter } from './SyntaxHighlighter'

interface CodePanelProps {
  code: string
  isStreaming: boolean
}

/** Debounce window for the SyntaxHighlighter input. Matches
 *  `PreviewPanel`'s 200ms coalescing window so the two surfaces
 *  stay roughly in lock-step during streaming. */
const DEBOUNCE_MS = 200

/**
 * Read/write fallback for `navigator.clipboard`. The async Clipboard API
 * requires a secure context (HTTPS or localhost) and can throw if the
 * user has denied permission; we fall back to the legacy `execCommand`
 * path so "Copy" still works in dev or unusual environments.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to legacy path
    }
  }
  if (typeof document === 'undefined') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textarea)
  }
  return ok
}

const COPY_FEEDBACK_MS = 2000

export function CodePanel({ code, isStreaming }: CodePanelProps) {
  const [copied, setCopied] = useState(false)
  const scrollAnchorRef = useRef<HTMLDivElement>(null)
  const copyTimerRef = useRef<number | null>(null)

  /**
   * Debounced view of `code` for the SyntaxHighlighter.
   *
   * The SSE stream can deliver dozens of code chunks per second.
   * `prism-react-renderer` re-tokenises the ENTIRE input on every
   * render, so passing the raw `code` straight through turns the
   * panel into an O(n^2) CPU sink. We coalesce updates to a
   * `displayCode` state at 200ms while streaming; when streaming
   * ends we flush the final value immediately so the user never
   * sees a stale frame.
   *
   * The auto-scroll effect still depends on the raw `code` (see
   * below) so it keeps firing on every chunk — the visible content
   * is slightly stale during streaming, but the user is at the
   * bottom of the panel and only ever sees the difference as a
   * smooth "fill-in" effect.
   */
  const [displayCode, setDisplayCode] = useState<string>(code)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isStreaming) {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      setDisplayCode(code)
      return
    }

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      setDisplayCode(code)
      debounceRef.current = null
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [code, isStreaming])

  // Auto-scroll the inner scroll container to the bottom as code streams in,
  // but only if the user is already near the bottom (within 50px). If
  // they've scrolled up to read earlier code, we don't force them back.
  //
  // We intentionally depend on the RAW `code` (not `displayCode`) so
  // the effect fires on every chunk — the container renders the
  // slightly-stale `displayCode`, but the scroll position is driven
  // by the latest activity, giving a smooth "follow the stream"
  // experience.
  useEffect(() => {
    const anchor = scrollAnchorRef.current
    if (!anchor) return
    const container = anchor.closest(
      '[data-code-scroll-container]',
    ) as HTMLElement | null
    if (container) {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 50
      if (isNearBottom) {
        container.scrollTop = container.scrollHeight
      }
    }
  }, [code])

  // Clean up the "Copied!" timer if the panel unmounts mid-flash.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    if (!code) return
    const ok = await writeToClipboard(code)
    if (!ok) return
    setCopied(true)
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyTimerRef.current = null
    }, COPY_FEEDBACK_MS)
  }

  const hasCode = displayCode.length > 0

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Code
        </h2>

        <div className="flex items-center gap-2">
          <AnimatePresence>
            {isStreaming && (
              <motion.div
                key="streaming-pill"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground"
                aria-live="polite"
              >
                <motion.span
                  className="inline-block size-1.5 rounded-full bg-primary"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
                <span>Streaming</span>
              </motion.div>
            )}
          </AnimatePresence>

          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCopy}
                  disabled={!hasCode}
                  aria-label={copied ? 'Code copied' : 'Copy code'}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {copied ? (
                      <motion.span
                        key="check"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 30,
                        }}
                        className="flex items-center justify-center text-success"
                      >
                        <Check />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="copy"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ duration: 0.12, ease: 'easeOut' }}
                        className="flex items-center justify-center"
                      >
                        <Copy />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {copied ? 'Copied!' : 'Copy code'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Code area — the scroll container. The inner `SyntaxHighlighter`
          is a `<pre>` that owns horizontal overflow for long lines. */}
      <div
        data-code-scroll-container
        className="
          relative min-h-0 flex-1 overflow-auto
          bg-background-sunken
        "
      >
        {hasCode ? (
          <SyntaxHighlighter code={displayCode} language="markup" />
        ) : (
          <div className="flex min-h-[200px] items-center justify-center p-4">
            <p className="flex items-center font-mono text-sm text-muted-foreground">
              <span>// Your code will appear here</span>
              <motion.span
                aria-hidden="true"
                className="ml-0.5 inline-block h-4 w-2 bg-muted-foreground"
                animate={{ opacity: [1, 0, 1] }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  ease: 'linear',
                }}
              />
            </p>
          </div>
        )}
        <div ref={scrollAnchorRef} aria-hidden="true" />
      </div>
    </div>
  )
}
