/**
 * Tests for `src/hooks/useSSE.ts`.
 *
 * `useSSE` wraps `generateStream` from `@/lib/api` with reactive state.
 * We never hit the network — `fetch` is replaced with a `vi.fn()` that
 * returns a fake `Response` whose body is a `ReadableStream` of SSE
 * frames, built by `mockSSEStream` / `mockHangingSSEStream`.
 *
 * Pattern: renderHook + act. State changes inside the hook are
 * flushed by `act()` so we can assert against `result.current`.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from './useSSE'
import {
  mockHangingSSEStream,
  mockSSEStream,
} from '@/test-utils/sse'
import type { SSEEvent } from '@/lib/api'

/** Build a 429 `Response` with the abuse-prevention detail body. */
function mockProjectCapResponse(): Response {
  return new Response(
    JSON.stringify({
      detail:
        "You've reached the 2-project limit for your account. You can still iterate on your existing projects, but you cannot create new ones.",
    }),
    {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/** Build a 429 `Response` with the per-project iteration-cap detail. */
function mockIterationCapResponse(): Response {
  return new Response(
    JSON.stringify({
      detail: "You've reached the 10-iteration limit for this project.",
    }),
    {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Drain the React scheduler (effects + state setters) before asserting. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('useSSE() — initial state', () => {
  it('test_initial_state — code, status, isStreaming, done, title defaults', () => {
    vi.stubGlobal('fetch', vi.fn())

    const { result } = renderHook(() => useSSE())

    expect(result.current.code).toBe('')
    expect(result.current.status).toBeNull()
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.done).toBe(false)
    expect(result.current.title).toBe('')
    expect(result.current.error).toBeNull()
    expect(typeof result.current.start).toBe('function')
    expect(typeof result.current.reset).toBe('function')
  })
})

describe('useSSE() — start() lifecycle', () => {
  it('test_start_sets_streaming — isStreaming flips true synchronously after start()', async () => {
    // Use a hanging stream so the for-await never iterates and we
    // can observe the "streaming" state before the request finishes.
    const hanging = mockHangingSSEStream()
    const fetchMock = vi.fn().mockResolvedValue(hanging.response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSSE())

    expect(result.current.isStreaming).toBe(false)

    await act(async () => {
      // Fire-and-forget: we don't await the inner promise because
      // the for-await inside start() is blocked on the hanging stream.
      void result.current.start('build a coffee shop')
    })

    expect(result.current.isStreaming).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Tidy up: close the stream so the in-flight await resolves and
    // the test doesn't leak an open handle.
    hanging.close()
    await flush()
  })

  it('test_handles_status_events — status updates as status frames arrive', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'planning' },
      { type: 'status', content: 'generating' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('hello')
    })

    // Last status event wins.
    expect(result.current.status).toBe('generating')
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.done).toBe(true)
  })

  it('test_handles_code_events — code events accumulate into one string', async () => {
    const events: SSEEvent[] = [
      { type: 'code', content: '<h1>' },
      { type: 'code', content: 'Hello' },
      { type: 'code', content: '</h1>' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('hello')
    })

    expect(result.current.code).toBe('<h1>Hello</h1>')
  })

  it('test_handles_title_event — title updates and is trimmed', async () => {
    const events: SSEEvent[] = [
      { type: 'title', content: '  Coffee Shop  ' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('hello')
    })

    expect(result.current.title).toBe('Coffee Shop')
  })

  it('test_handles_done_event — done becomes true and isStreaming resets to false', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'generating' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('hello')
    })

    expect(result.current.done).toBe(true)
    expect(result.current.isStreaming).toBe(false)
  })

  it('test_handles_error_event — error is captured, streaming stops', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'generating' },
      { type: 'error', message: 'Backend blew up' },
      { type: 'done' }, // Should be processed too — but the user just wants error caught.
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('hello')
    })

    expect(result.current.error).toBe('Backend blew up')
    expect(result.current.isStreaming).toBe(false)
  })
})

describe('useSSE() — reset()', () => {
  it('test_reset_clears_state — all reactive state returns to defaults', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'generating' },
      { type: 'title', content: 'Some App' },
      { type: 'code', content: '<p>hi</p>' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('hello')
    })

    // Sanity: state is populated after a successful run.
    expect(result.current.code).toBe('<p>hi</p>')
    expect(result.current.status).toBe('generating')
    expect(result.current.title).toBe('Some App')
    expect(result.current.done).toBe(true)

    act(() => {
      result.current.reset()
    })

    expect(result.current.code).toBe('')
    expect(result.current.status).toBeNull()
    expect(result.current.title).toBe('')
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.done).toBe(false)
  })
})

describe('useSSE() — abort semantics', () => {
  it('test_aborts_on_unmount — AbortController fires when the hook unmounts', async () => {
    // We need to capture the AbortSignal that `useSSE` hands to fetch,
    // and then verify it is aborted after unmount.
    let capturedSignal: AbortSignal | undefined
    const hanging = mockHangingSSEStream()
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      // `useSSE` passes its AbortController.signal in the init options.
      capturedSignal = init?.signal as AbortSignal | undefined
      return Promise.resolve(hanging.response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, unmount } = renderHook(() => useSSE())

    await act(async () => {
      void result.current.start('hello')
    })

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal?.aborted).toBe(false)

    unmount()

    expect(capturedSignal?.aborted).toBe(true)

    // Tidy up the stream handle.
    hanging.close()
  })
})

describe('useSSE() — load()', () => {
  it('test_load_sets_code_and_title — load(code, title) sets code and title state', () => {
    // No fetch needed: `load` does not touch the network.
    vi.stubGlobal('fetch', vi.fn())

    const { result } = renderHook(() => useSSE())

    // Sanity: defaults.
    expect(result.current.code).toBe('')
    expect(result.current.title).toBe('')

    act(() => {
      result.current.load('<h1>hello</h1>', 'My Saved App')
    })

    expect(result.current.code).toBe('<h1>hello</h1>')
    expect(result.current.title).toBe('My Saved App')
  })

  it('test_load_does_not_set_done — load() leaves done=false so the save-on-done effect does NOT fire', () => {
    // Regression: previously `load()` called `setDone(true)`, which
    // triggered the Builder's `done` useEffect — causing a phantom
    // "Generation complete" toast, an unwanted chat message, and an
    // unnecessary PATCH/POST to the backend. The Builder's
    // `handleLoadProject` already handles all UI state directly, so
    // `load` must NOT mark the run as complete.
    vi.stubGlobal('fetch', vi.fn())

    const { result } = renderHook(() => useSSE())

    expect(result.current.done).toBe(false)

    act(() => {
      result.current.load('<p>x</p>', 'X')
    })

    // `done` must remain `false` after `load` — the Builder
    // handles all loaded-state UI (panels, tabs, chat, toast)
    // directly in `handleLoadProject`.
    expect(result.current.done).toBe(false)
  })

  it('test_load_sets_isStreaming_false — load() clears the streaming flag', async () => {
    // Start a hanging stream so `isStreaming` is true mid-flight.
    const hanging = mockHangingSSEStream()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hanging.response))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      void result.current.start('hello')
    })

    expect(result.current.isStreaming).toBe(true)

    act(() => {
      result.current.load('<p>restored</p>', 'Restored')
    })

    expect(result.current.isStreaming).toBe(false)

    hanging.close()
  })

  it('test_load_clears_error_and_status — load() resets error and status after a failed run', async () => {
    // First, run a stream that produces both an error and a status
    // so we can verify `load` clears them.
    const events: SSEEvent[] = [
      { type: 'status', content: 'planning' },
      { type: 'status', content: 'generating' },
      { type: 'error', message: 'backend blew up' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('hello')
    })

    // Sanity: error + status are populated.
    expect(result.current.error).toBe('backend blew up')
    expect(result.current.status).toBe('generating')

    act(() => {
      result.current.load('<p>saved</p>', 'Saved')
    })

    expect(result.current.error).toBeNull()
    expect(result.current.status).toBeNull()
  })

  it('test_load_aborts_in_flight_request — load() aborts an active stream', async () => {
    // Capture the AbortSignal handed to fetch so we can confirm it
    // is aborted when `load` is called.
    let capturedSignal: AbortSignal | undefined
    const hanging = mockHangingSSEStream()
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined
      return Promise.resolve(hanging.response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      void result.current.start('hello')
    })

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal?.aborted).toBe(false)

    act(() => {
      result.current.load('<p>new</p>', 'New')
    })

    // `load` calls `abortRef.current?.abort()` first thing, so the
    // signal handed to the in-flight fetch must now be aborted.
    expect(capturedSignal?.aborted).toBe(true)

    hanging.close()
  })
})

/* ------------------------------------------------------------------ */
/* useSSE() — iterate()                                                */
/*                                                                     */
/* The iterate() method is the Phase 4 "chat follow-up" flow. It uses  */
/* a FRESH `code` buffer (the backend re-emits the full updated code,  */
/* not a diff), preserves `title` (iterate never emits one), and      */
/* tracks the same done/error/isStreaming flags as `start()`.          */
/* ------------------------------------------------------------------ */

describe('useSSE() — iterate() lifecycle', () => {
  it('test_iterate_exposes_method — result.iterate is a function', () => {
    vi.stubGlobal('fetch', vi.fn())

    const { result } = renderHook(() => useSSE())

    expect(typeof result.current.iterate).toBe('function')
  })

  it('test_iterate_replaces_code — code is cleared to a fresh buffer, then accumulated from chunks', async () => {
    // Regression: the old behaviour was to append. The backend, however,
    // re-emits the FULL updated code on every iteration — so the hook
    // must start from a fresh buffer and append to it, otherwise the
    // final code would be (old + new) concatenated.
    const events: SSEEvent[] = [
      { type: 'status', content: 'iterating' },
      { type: 'code', content: '<h1>' },
      { type: 'code', content: 'BLUE</h1>' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.iterate({
        prompt: 'make the hero blue',
        currentCode: '<h1>red</h1>',
        history: [],
        projectId: 1,
      })
    })

    // Final code is the new (replacement) code, NOT old + new.
    expect(result.current.code).toBe('<h1>BLUE</h1>')
  })

  it('test_iterate_preserves_title — title from a previous generation is NOT cleared', async () => {
    // Run a generation that emits a title, then an iterate. The title
    // should survive the iterate (iterate does not emit title events,
    // and the hook must not blank the field).
    const generationEvents: SSEEvent[] = [
      { type: 'title', content: 'My Coffee Shop' },
      { type: 'code', content: '<h1>red</h1>' },
      { type: 'done' },
    ]
    const iterateEvents: SSEEvent[] = [
      { type: 'code', content: '<h1>blue</h1>' },
      { type: 'done' },
    ]
    let callIndex = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1
      if (callIndex === 1) return Promise.resolve(mockSSEStream(generationEvents))
      return Promise.resolve(mockSSEStream(iterateEvents))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('a coffee shop')
    })
    expect(result.current.title).toBe('My Coffee Shop')

    await act(async () => {
      await result.current.iterate({
        prompt: 'make hero blue',
        currentCode: '<h1>red</h1>',
        history: [],
        projectId: 1,
      })
    })

    expect(result.current.title).toBe('My Coffee Shop')
    expect(result.current.code).toBe('<h1>blue</h1>')
  })

  it('test_iterate_sets_iterating_status — status is "iterating" during the run', async () => {
    const hanging = mockHangingSSEStream()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hanging.response))

    const { result } = renderHook(() => useSSE())

    expect(result.current.status).toBeNull()

    await act(async () => {
      void result.current.iterate({
        prompt: 'tweak',
        currentCode: '<h1>x</h1>',
        history: [],
        projectId: 1,
      })
    })

    // `iterate` sets status to 'iterating' synchronously, BEFORE the
    // first SSE event arrives.
    expect(result.current.status).toBe('iterating')
    expect(result.current.isStreaming).toBe(true)

    hanging.close()
    await flush()
  })

  it('test_iterate_handles_done_event — done becomes true and isStreaming resets', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'iterating' },
      { type: 'code', content: '<h1>blue</h1>' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.iterate({
        prompt: 'tweak',
        currentCode: '<h1>x</h1>',
        history: [],
        projectId: 1,
      })
    })

    expect(result.current.done).toBe(true)
    expect(result.current.isStreaming).toBe(false)
  })

  it('test_iterate_handles_error_event — error is captured, streaming stops', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'iterating' },
      { type: 'error', message: 'rate limited' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEStream(events)))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.iterate({
        prompt: 'tweak',
        currentCode: '<h1>x</h1>',
        history: [],
        projectId: 1,
      })
    })

    expect(result.current.error).toBe('rate limited')
    expect(result.current.isStreaming).toBe(false)
  })

  it('test_iterate_sends_correct_payload — body has prompt, current_code, history, model', async () => {
    // Capture the body of the fetch call so we can assert the wire
    // format. The hook should forward prompt, currentCode, history,
    // and model verbatim — the backend relies on this.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockSSEStream([{ type: 'code', content: '<h1>x</h1>' }, { type: 'done' }]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSSE())

    const history = [
      { role: 'user' as const, content: 'build a hero' },
      { role: 'assistant' as const, content: '<h1>red</h1>' },
    ]
    await act(async () => {
      await result.current.iterate({
        prompt: 'make it blue',
        currentCode: '<h1>red</h1>',
        history,
        projectId: 1,
        model: 'opencode-go/kimi-k2.6',
      })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/iterate')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({
      prompt: 'make it blue',
      current_code: '<h1>red</h1>',
      history,
      project_id: 1,
      model: 'opencode-go/kimi-k2.6',
    })
  })

  it('test_iterate_aborts_previous_stream — starting iterate while another iterate is in flight aborts the first', async () => {
    // Capture the AbortSignal from the first fetch call so we can
    // confirm it is aborted when a second iterate() is started.
    let firstSignal: AbortSignal | undefined
    let callIndex = 0
    const hanging1 = mockHangingSSEStream()
    const hanging2 = mockHangingSSEStream()
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      callIndex += 1
      const signal = init?.signal as AbortSignal | undefined
      if (callIndex === 1) {
        firstSignal = signal
        return Promise.resolve(hanging1.response)
      }
      return Promise.resolve(hanging2.response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      void result.current.iterate({
        prompt: 'first',
        currentCode: '<h1>x</h1>',
        history: [],
        projectId: 1,
      })
    })

    expect(firstSignal).toBeDefined()
    expect(firstSignal?.aborted).toBe(false)

    await act(async () => {
      void result.current.iterate({
        prompt: 'second',
        currentCode: '<h1>x</h1>',
        history: [],
        projectId: 1,
      })
    })

    // The first stream's signal must be aborted by the second iterate.
    expect(firstSignal?.aborted).toBe(true)

    hanging1.close()
    hanging2.close()
    await flush()
  })
})

/* ------------------------------------------------------------------ */
/* 429 error handling                                                  */
/*                                                                     */
/* The backend returns a plain HTTP 429 (NOT SSE) with a JSON body     */
/* of the form `{ "detail": "..." }` when the user is at the project   */
/* cap (on `start`) or the per-project iteration cap (on `iterate`).  */
/* The async generator must read the detail and surface it verbatim   */
/* so the hook layer can promote it straight to the user-visible       */
/* `error` state. The `useSSE` hook's own try/catch then puts it in    */
/* `result.current.error`.                                            */
/* ------------------------------------------------------------------ */

describe('useSSE() — 429 error handling (abuse prevention)', () => {
  it('test_start_sets_error_to_detail_on_project_cap — 429 detail is the error string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockProjectCapResponse()))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.start('build me an app')
    })

    expect(result.current.error).toBe(
      "You've reached the 2-project limit for your account. You can still iterate on your existing projects, but you cannot create new ones.",
    )
    expect(result.current.isStreaming).toBe(false)
    // No code was produced — the 429 came BEFORE any SSE body.
    expect(result.current.code).toBe('')
    expect(result.current.done).toBe(false)
  })

  it('test_iterate_sets_error_to_detail_on_iteration_cap — 429 detail is the error string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockIterationCapResponse()))

    const { result } = renderHook(() => useSSE())

    await act(async () => {
      await result.current.iterate({
        prompt: 'tweak the hero',
        currentCode: '<h1>red</h1>',
        history: [],
        projectId: 1,
      })
    })

    expect(result.current.error).toBe(
      "You've reached the 10-iteration limit for this project.",
    )
    expect(result.current.isStreaming).toBe(false)
    // No code was produced — the 429 came BEFORE any SSE body.
    expect(result.current.code).toBe('')
    expect(result.current.done).toBe(false)
  })
})
