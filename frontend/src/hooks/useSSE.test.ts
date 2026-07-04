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
