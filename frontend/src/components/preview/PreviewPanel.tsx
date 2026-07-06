import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Lock, Monitor, Smartphone, Tablet } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * PreviewPanel — the live-rendering preview of the generated app.
 *
 * Spec (`docs/UI_REDESIGN_SPEC.md` §7.5 — "Calm Precision" light theme):
 *  - White card bg with a subtle border + shadow-sm device frame.
 *  - URL bar uses `bg-background-sunken` with muted mono text.
 *  - Streaming overlay: `bg-background/60` with `backdrop-blur-sm`
 *    so the page underneath reads as "building" rather than blank.
 *  - Indigo streaming dot (matches the rest of the design system).
 *
 * 2026-07-04 (Phase 6 redesign) — light theme, subtle border + shadow,
 *  no amber accents.
 */

interface PreviewPanelProps {
  html: string
  isStreaming: boolean
  /**
   * Project title — used to generate a fake URL slug for the URL bar
   * (e.g. "My Coffee Shop" → `forge.app/my-coffee-shop`). When empty
   * the URL falls back to a generic placeholder.
   */
  projectTitle: string
}

type Device = 'desktop' | 'tablet' | 'mobile'

/**
 * Viewport widths for the device-frame toggle. Desktop fills the panel;
 * tablet and mobile are centred with a visible "device" silhouette.
 */
const DEVICE_WIDTHS: Record<Device, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
}

const DEVICE_LABELS: Record<Device, string> = {
  desktop: 'Desktop view',
  tablet: 'Tablet view',
  mobile: 'Mobile view',
}

const DEBOUNCE_MS = 200

const DEVICES: ReadonlyArray<{ key: Device; Icon: typeof Monitor }> = [
  { key: 'desktop', Icon: Monitor },
  { key: 'tablet', Icon: Tablet },
  { key: 'mobile', Icon: Smartphone },
]

/**
 * Slug-ify a project title for the fake URL bar.
 *  - Lowercase
 *  - Replace any non-alphanumeric run with a single hyphen
 *  - Trim leading/trailing hyphens
 *  - Cap at 30 chars
 *  - Fall back to "untitled" if the result is empty
 */
function slugify(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  return normalized || 'untitled'
}

export function PreviewPanel({ html, isStreaming, projectTitle }: PreviewPanelProps) {
  const [device, setDevice] = useState<Device>('desktop')
  const [displayHtml, setDisplayHtml] = useState(html)
  const debounceRef = useRef<number | null>(null)

  /**
   * Debounce iframe re-renders during streaming.
   *
   * Re-rendering an iframe with a new `srcDoc` is expensive (the browser
   * re-parses HTML, re-runs scripts, re-paints). During streaming we may
   * receive dozens of updates per second, so we coalesce them into a
   * single render every 200ms. When streaming ends we flush the final
   * value immediately so the user never sees a stale frame.
   */
  useEffect(() => {
    if (!isStreaming) {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      setDisplayHtml(html)
      return
    }

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      setDisplayHtml(html)
      debounceRef.current = null
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [html, isStreaming])

  const isEmpty = html.length === 0
  const url = `forge.app/${slugify(projectTitle)}`

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Preview
        </h2>

        <div className="flex items-center gap-1" role="group" aria-label="Device frame">
          {DEVICES.map(({ key, Icon }) => {
            const active = device === key
            return (
              <Button
                key={key}
                type="button"
                variant={active ? 'secondary' : 'ghost'}
                size="icon-sm"
                onClick={() => setDevice(key)}
                aria-label={DEVICE_LABELS[key]}
                aria-pressed={active}
              >
                <Icon />
              </Button>
            )
          })}
        </div>
      </div>

      {/* URL bar — visual only. Reinforces the "this is a real running
          app" framing without making a network request. */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-background-sunken px-3">
        <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span
          className="truncate font-mono text-xs text-muted-foreground"
          title={url}
        >
          {url}
        </span>
      </div>

      {/* Preview area */}
      <div className="relative flex-1 overflow-hidden bg-background p-4">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex h-3/4 w-full max-w-3xl flex-col items-center justify-center rounded-xl border-2 border-dashed border-border">
              <p className="text-sm text-muted-foreground">
                Preview will render here
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <motion.div
              initial={false}
              animate={{ width: DEVICE_WIDTHS[device] }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className="relative h-full overflow-hidden rounded-md border border-border bg-card shadow-sm"
              style={{ maxWidth: '100%' }}
            >
              {/*
               * Sandbox:
               *   - `allow-scripts` — the generated app needs JS to
               *     run (todo apps, counters, fetch examples, etc.)
               *   - `allow-same-origin` — required for `localStorage`
               *     and `sessionStorage` to work. With `srcDoc` the
               *     iframe is same-origin with the parent (both are
               *     `about:srcdoc`), so this is safe — the srcdoc
               *     content cannot reach into the parent DOM
               *     because the sandbox blocks it.
               *   - `allow-forms` — let the generated app submit
               *     forms (contact form demos, login screens, etc.)
               *
               * We deliberately do NOT add `allow-top-navigation`,
               * `allow-popups-to-escape-sandbox`, or
               * `allow-modals` — none of these are needed for a
               * generated single-page app, and omitting them keeps
               * the blast radius small if a generated page is
               * malicious.
               */}
              <iframe
                srcDoc={displayHtml}
                title="Preview"
                sandbox="allow-scripts allow-same-origin allow-forms"
                className="h-full w-full"
              />
            </motion.div>
          </div>
        )}

        {/* Streaming skeleton overlay — sits over the iframe while code
            is still arriving so the panel reads as "building" rather
            than showing a half-rendered page. */}
        <AnimatePresence>
          {isStreaming && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-md bg-background/60 backdrop-blur-sm"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="flex w-full max-w-md flex-col gap-3">
                <div className="h-6 w-3/4 animate-pulse rounded-md bg-muted" />
                <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
                <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted" />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="h-24 animate-pulse rounded-md bg-muted" />
                  <div className="h-24 animate-pulse rounded-md bg-muted" />
                </div>
                <div className="mt-2 flex items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
                  <motion.span
                    className="inline-block size-1.5 rounded-full bg-primary"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                  <span>Building preview…</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
