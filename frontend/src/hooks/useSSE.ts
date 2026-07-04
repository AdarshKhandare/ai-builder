/**
 * `useSSE` — React hook wrapping the backend's `generateStream` SSE
 * generator with reactive state.
 *
 * The hook:
 *  - Accumulates every `code` event's `content` into a single string.
 *  - Tracks the latest `status` event (`planning` → `generating`).
 *  - Toggles `isStreaming` while the request is in flight.
 *  - Captures the first `error` event into `error` and stops streaming.
 *  - Resets `isStreaming` and sets `done` when a `done` event arrives.
 *  - Uses an `AbortController` so callers can cancel (e.g. unmount,
 *    or starting a new generation while one is in flight).
 *
 * Example:
 *
 *     const { code, status, isStreaming, start, reset, load } = useSSE()
 *     await start('a coffee shop landing page')
 *     // ...or hydrate from a saved project:
 *     load(savedCode, savedTitle)
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { generateStream, type SSEEvent } from '@/lib/api'

export interface UseSSEResult {
  /** Concatenated code from every `code` event received so far. */
  code: string
  /** Latest status event content (`planning` | `generating` | `null`). */
  status: string | null
  /**
   * Project title emitted by the backend as a `title` event. Defaults
   * to an empty string until the first title arrives; the caller is
   * expected to render its own placeholder (e.g. "Untitled") when
   * this is empty.
   */
  title: string
  /** True while a generation request is in flight. */
  isStreaming: boolean
  /** Error message from the most recent failed request, or `null`. */
  error: string | null
  /** True once a `done` event has been received for the current run. */
  done: boolean
  /**
   * Start a new generation. Any in-flight generation is aborted
   * first. Resolves when the stream ends (success or failure).
   */
  start: (prompt: string, model?: string) => Promise<void>
  /** Abort the current generation and clear all state. */
  reset: () => void
  /**
   * Restore `code` + `title` from a saved project without
   * streaming. Aborts any in-flight request and hydrates the
   * reactive state.
   *
   * Does NOT set `done=true` — the Builder's `handleLoadProject`
   * handles all UI state directly (panels, tabs, chat synthesis).
   * Setting `done` would trigger the save-on-done effect, causing
   * a phantom "Generation complete" toast, an unwanted
   * "Generated successfully" chat message, and an unnecessary
   * PATCH/POST to the backend.
   */
  load: (code: string, title: string) => void
}

export function useSSE(): UseSSEResult {
  const [code, setCode] = useState<string>('')
  const [status, setStatus] = useState<string | null>(null)
  const [title, setTitle] = useState<string>('')
  const [isStreaming, setIsStreaming] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<boolean>(false)

  // Persist the controller across renders. The actual signal is read
  // inside `start`/`reset`, never during render.
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setCode('')
    setStatus(null)
    setTitle('')
    setIsStreaming(false)
    setError(null)
    setDone(false)
  }, [])

  /**
   * Hydrate the hook from a saved project. Unlike `start`, this
   * does NOT call the backend — it just sets the reactive state
   * and aborts any in-flight request.
   *
   * `done` is intentionally left at its current value (typically
   * `false`) — the Builder's `handleLoadProject` handles all UI
   * state (panels, tabs, chat, toasts) directly. Flipping `done`
   * to `true` here would re-run the save-on-done effect, causing
   * a phantom "Generation complete" toast, an unwanted chat
   * message, and an unnecessary PATCH/POST to the backend.
   */
  const load = useCallback((code: string, title: string): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setCode(code)
    setStatus(null)
    setTitle(title)
    setIsStreaming(false)
    setError(null)
    // Intentionally NOT calling setDone(...) — see docstring above.
  }, [])

  const start = useCallback(
    async (prompt: string, model?: string): Promise<void> => {
      // Cancel any previous in-flight request before starting a new one.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // Reset reactive state for the new run.
      setCode('')
      setStatus(null)
      setTitle('')
      setError(null)
      setDone(false)
      setIsStreaming(true)

      try {
        for await (const event of generateStream(prompt, model, controller.signal)) {
          if (controller.signal.aborted) break
          applyEvent(event, setCode, setStatus, setTitle, setError, setDone)
        }
      } catch (err) {
        // AbortError is expected when we cancel — don't surface it.
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
      } finally {
        // Only flip `isStreaming` off if we're still the active run.
        if (abortRef.current === controller) {
          setIsStreaming(false)
          abortRef.current = null
        }
      }
    },
    [],
  )

  // Cleanup on unmount: abort any in-flight request.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  return { code, status, title, isStreaming, error, done, start, reset, load }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function applyEvent(
  event: SSEEvent,
  setCode: Dispatch<SetStateAction<string>>,
  setStatus: (next: string | null) => void,
  setTitle: (next: string) => void,
  setError: (next: string | null) => void,
  setDone: (next: boolean) => void,
): void {
  switch (event.type) {
    case 'status':
      setStatus(event.content)
      return
    case 'title':
      // Title arrives once per generation. We replace (not append)
      // because it's a single value the backend picks from the prompt.
      // Trim to defend against accidental whitespace in the payload.
      setTitle(event.content.trim())
      return
    case 'code':
      // Functional updater so concurrent chunks don't clobber each
      // other if React schedules the setters out of order.
      setCode((prev) => prev + event.content)
      return
    case 'error':
      setError(event.message)
      return
    case 'done':
      setDone(true)
      return
  }
}
