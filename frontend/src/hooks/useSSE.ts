/**
 * `useSSE` — React hook wrapping the backend's `generateStream` and
 * `iterateStream` SSE generators with reactive state.
 *
 * The hook:
 *  - Accumulates every `code` event's `content` into a single string.
 *  - Tracks the latest `status` event (`planning` → `generating` /
 *    `iterating`).
 *  - Toggles `isStreaming` while the request is in flight.
 *  - Captures the first `error` event into `error` and stops streaming.
 *  - Resets `isStreaming` and sets `done` when a `done` event arrives.
 *  - Uses an `AbortController` so callers can cancel (e.g. unmount,
 *    or starting a new generation while one is in flight).
 *
 * Two streaming modes:
 *  - `start()` — initial generation from a prompt. Clears `code` and
 *    `title` before streaming; appends incoming `code` chunks.
 *  - `iterate()` — follow-up turn that revises existing code. Clears
 *    `code` to a fresh buffer (the backend re-emits the FULL updated
 *    code, not a diff) and then appends incoming `code` chunks. Does
 *    NOT touch `title` (iterate never emits one).
 *
 * Example:
 *
 *     const { code, status, isStreaming, start, iterate, reset, load } = useSSE()
 *     await start('a coffee shop landing page')
 *     // ...later, on a follow-up turn:
 *     await iterate({ prompt: 'make the hero blue', currentCode: code, history })
 *     // ...or hydrate from a saved project:
 *     load(savedCode, savedTitle)
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { generateStream, iterateStream, type ChatMessage, type SSEEvent } from '@/lib/api'

/** Parameters accepted by {@link UseSSEResult.iterate}. */
export interface IterateParams {
  /** The follow-up instruction (e.g. "make the hero blue"). */
  prompt: string
  /** The current full code in the editor — sent verbatim to the backend. */
  currentCode: string
  /** Conversation history (excluding the current `prompt`). */
  history: ChatMessage[]
  /** Optional model ID override. */
  model?: string
}

export interface UseSSEResult {
  /** Concatenated code from every `code` event received so far. */
  code: string
  /** Latest status event content (`planning` | `generating` | `iterating` | `null`). */
  status: string | null
  /**
   * Project title emitted by the backend as a `title` event. Defaults
   * to an empty string until the first title arrives; the caller is
   * expected to render its own placeholder (e.g. "Untitled") when
   * this is empty.
   *
   * `iterate()` does NOT modify this — iterate does not emit a title
   * event, and the project already has a title from the initial
   * generation.
   */
  title: string
  /** True while a generation or iteration request is in flight. */
  isStreaming: boolean
  /** Error message from the most recent failed request, or `null`. */
  error: string | null
  /** True once a `done` event has been received for the current run. */
  done: boolean
  /**
   * Start a new generation. Any in-flight request is aborted
   * first. Resolves when the stream ends (success or failure).
   */
  start: (prompt: string, model?: string) => Promise<void>
  /**
   * Start an iteration (chat follow-up) on top of existing code.
   * Aborts any in-flight request, then clears `code` to a fresh
   * buffer (the backend re-emits the full updated code) and
   * accumulates the streamed chunks. Does NOT clear `title` —
   * iterate does not emit a title event.
   *
   * The caller owns `history`; this method does not read or mutate
   * any React state related to chat messages.
   */
  iterate: (params: IterateParams) => Promise<void>
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
          applyGenerateEvent(event, setCode, setStatus, setTitle, setError, setDone)
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

  /**
   * Iterate on top of existing code (chat follow-up). The backend
   * re-emits the FULL updated code as `code` events — we therefore
   * start with a fresh `code` buffer (the previous code is replaced
   * wholesale, not patched). `title` is preserved: iterate does not
   * emit a title event and the project already has one.
   */
  const iterate = useCallback(
    async ({
      prompt,
      currentCode,
      history,
      model,
    }: IterateParams): Promise<void> => {
      // Cancel any previous in-flight request before starting a new one.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // Reset reactive state for the new run. `title` is preserved
      // because iterate never emits one. `code` is cleared to a fresh
      // buffer because the backend will re-stream the entire updated
      // code (not a diff) — starting from '' ensures the new content
      // replaces, rather than appends to, the previous code.
      setCode('')
      setStatus('iterating')
      setError(null)
      setDone(false)
      setIsStreaming(true)

      try {
        for await (const event of iterateStream(
          prompt,
          currentCode,
          history,
          model,
          controller.signal,
        )) {
          if (controller.signal.aborted) break
          applyIterateEvent(event, setCode, setError, setDone)
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

  return { code, status, title, isStreaming, error, done, start, iterate, reset, load }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Apply an SSE event for the initial generation flow. Handles the
 * full event surface (`status` | `title` | `code` | `error` | `done`).
 */
function applyGenerateEvent(
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

/**
 * Apply an SSE event for the iteration flow. The iteration endpoint
 * never emits `title` events, so we deliberately drop those if the
 * backend ever does send one (future-proofing). Code chunks are
 * appended to a fresh buffer (cleared at the start of `iterate()`).
 */
function applyIterateEvent(
  event: SSEEvent,
  setCode: Dispatch<SetStateAction<string>>,
  setError: (next: string | null) => void,
  setDone: (next: boolean) => void,
): void {
  switch (event.type) {
    case 'status':
      // Pass through (could be 'iterating' or some other marker).
      // Currently the hook's `iterate()` seeds status to 'iterating'
      // synchronously, so this is mainly for completeness.
      return
    case 'title':
      // Iterate does not emit title events. If one ever sneaks through,
      // ignore it — the project's title is owned by the initial
      // generation.
      return
    case 'code':
      // Functional updater so concurrent chunks don't clobber each
      // other if React schedules the setters out of order. The buffer
      // was cleared in `iterate()` before the loop started, so the
      // accumulated string is the full new code, not a concatenation
      // of old + new.
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
