/**
 * Tests for `src/lib/api.ts`.
 *
 * Covers the exported functions:
 *  - `health()` — JSON GET against `/api/health`.
 *  - `generateStream()` — async generator that parses SSE frames.
 *  - `iterateStream()` — async generator for chat-style follow-up turns.
 *
 * `fetch` is replaced with a `vi.fn()` per test so we can assert the
 * request shape and inject canned responses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateStream, health, iterateStream, type ChatMessage, type SSEEvent } from './api'
import {
  mockErrorResponse,
  mockHangingSSEStream,
  mockSSEStream,
} from '@/test-utils/sse'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ */
/* health()                                                            */
/* ------------------------------------------------------------------ */

describe('health()', () => {
  it('test_health_returns_models — parses the JSON model catalog', async () => {
    const payload = {
      status: 'ok',
      models: [
        {
          id: 'opencode-go/minimax-m3',
          name: 'MiniMax M3',
          cost_input: 0.14,
          cost_output: 0.28,
          endpoint: '/v1/chat/completions',
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await health()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Hit the proxied backend, send the JSON Accept header.
    expect(fetchMock).toHaveBeenCalledWith('/api/health', {
      headers: { Accept: 'application/json' },
    })
    expect(result.status).toBe('ok')
    expect(result.models).toHaveLength(1)
    expect(result.models[0]?.id).toBe('opencode-go/minimax-m3')
    expect(result.models[0]?.cost_input).toBe(0.14)
  })

  it('test_health_throws_on_error — surfaces a non-2xx as an Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockErrorResponse(503, 'Service Unavailable')))

    await expect(health()).rejects.toThrow(/Health check failed: 503/)
  })
})

/* ------------------------------------------------------------------ */
/* generateStream()                                                    */
/* ------------------------------------------------------------------ */

describe('generateStream()', () => {
  it('test_generateStream_yields_events — yields parsed SSE frames in order', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'planning' },
      { type: 'title', content: 'Coffee Shop' },
      { type: 'code', content: '<h1>' },
      { type: 'code', content: 'hi</h1>' },
      { type: 'done' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(mockSSEStream(events))
    vi.stubGlobal('fetch', fetchMock)

    const collected: SSEEvent[] = []
    for await (const event of generateStream('build a coffee shop page')) {
      collected.push(event)
    }

    expect(collected).toEqual(events)
    // POST the JSON body, with the right content type and SSE accept.
    expect(fetchMock).toHaveBeenCalledWith('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ prompt: 'build a coffee shop page' }),
      signal: undefined,
    })
  })

  it('test_generateStream_yields_events — passes model when supplied', async () => {
    const events: SSEEvent[] = [{ type: 'done' }]
    const fetchMock = vi.fn().mockResolvedValue(mockSSEStream(events))
    vi.stubGlobal('fetch', fetchMock)

    const collected: SSEEvent[] = []
    for await (const event of generateStream('hello', 'opencode-go/kimi-k2.6')) {
      collected.push(event)
    }

    expect(collected).toEqual(events)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { prompt: string; model?: string }
    expect(body).toEqual({ prompt: 'hello', model: 'opencode-go/kimi-k2.6' })
  })

  it('test_generateStream_handles_malformed_data — skips junk frames, keeps valid ones', async () => {
    // Mix valid frames with two intentionally bad ones. The first bad
    // frame is missing the `data:` prefix; the second is a `data:` line
    // whose payload is not valid JSON. Neither should abort the stream.
    const validEvent: SSEEvent = { type: 'status', content: 'generating' }
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(':heartbeat\n\n')) // comment line — no `data:`
        controller.enqueue(encoder.encode('not-a-data-line\n\n')) // missing prefix
        controller.enqueue(encoder.encode('data: {not json}\n\n')) // invalid JSON
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(validEvent)}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' } satisfies SSEEvent)}\n\n`))
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    const collected: SSEEvent[] = []
    for await (const event of generateStream('x')) {
      collected.push(event)
    }

    expect(collected).toEqual([validEvent, { type: 'done' }])
  })

  it('test_generateStream_aborts_on_signal — controller.signal triggers reader cleanup', async () => {
    // The reader should be released and the underlying fetch's signal
    // should be propagated. We assert the fetch was called with our
    // signal, and that aborting the stream causes the for-await to exit.
    const hanging = mockHangingSSEStream()
    const fetchMock = vi.fn().mockResolvedValue(hanging.response)
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const generator = generateStream('x', undefined, controller.signal)

    // Start iterating — this triggers the fetch call inside the generator.
    const iteration = (async () => {
      const events: SSEEvent[] = []
      for await (const event of generator) {
        events.push(event)
      }
      return events
    })()

    // Let the generator reach its first `read()`.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Verify the signal was passed to fetch (after iteration has started).
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)

    controller.abort()
    hanging.close()

    // The for-await must exit cleanly (no throw) because the generator
    // catches and the caller's signal is what aborted it.
    await expect(iteration).resolves.toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* iterateStream()                                                     */
/* ------------------------------------------------------------------ */

describe('iterateStream()', () => {
  it('test_iterateStream_yields_events — yields parsed SSE frames in order', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'iterating' },
      { type: 'code', content: '<h1>' },
      { type: 'code', content: 'blue</h1>' },
      { type: 'done' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(mockSSEStream(events))
    vi.stubGlobal('fetch', fetchMock)

    const collected: SSEEvent[] = []
    for await (const event of iterateStream(
      'make the hero blue',
      '<h1>red</h1>',
      [
        { role: 'user', content: 'build a hero' },
        { role: 'assistant', content: '<h1>red</h1>' },
      ],
    )) {
      collected.push(event)
    }

    expect(collected).toEqual(events)
    // POST to /api/iterate with the right shape: prompt,
    // current_code, history, and (optional) model.
    expect(fetchMock).toHaveBeenCalledWith('/api/iterate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        prompt: 'make the hero blue',
        current_code: '<h1>red</h1>',
        history: [
          { role: 'user', content: 'build a hero' },
          { role: 'assistant', content: '<h1>red</h1>' },
        ],
      }),
      signal: undefined,
    })
  })

  it('test_iterateStream_passes_model — model is forwarded when supplied', async () => {
    const events: SSEEvent[] = [{ type: 'done' }]
    const fetchMock = vi.fn().mockResolvedValue(mockSSEStream(events))
    vi.stubGlobal('fetch', fetchMock)

    const collected: SSEEvent[] = []
    const history: ChatMessage[] = [
      { role: 'user', content: 'build a hero' },
    ]
    for await (const event of iterateStream(
      'tweak it',
      '<h1>x</h1>',
      history,
      'opencode-go/kimi-k2.6',
    )) {
      collected.push(event)
    }

    expect(collected).toEqual(events)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      prompt: string
      current_code: string
      history: ChatMessage[]
      model?: string
    }
    expect(body).toEqual({
      prompt: 'tweak it',
      current_code: '<h1>x</h1>',
      history: [{ role: 'user', content: 'build a hero' }],
      model: 'opencode-go/kimi-k2.6',
    })
  })

  it('test_iterateStream_handles_malformed_data — skips junk frames, keeps valid ones', async () => {
    // Mix valid frames with several intentionally bad ones. None
    // should abort the stream.
    const validEvent: SSEEvent = { type: 'status', content: 'iterating' }
    const doneEvent: SSEEvent = { type: 'done' }
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // SSE comment line — must be skipped.
        controller.enqueue(encoder.encode(':keepalive\n\n'))
        // Missing `data:` prefix — must be skipped.
        controller.enqueue(encoder.encode('not-a-data-line\n\n'))
        // `data:` line whose payload is not valid JSON — must be skipped.
        controller.enqueue(encoder.encode('data: {not json}\n\n'))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(validEvent)}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`))
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    const collected: SSEEvent[] = []
    for await (const event of iterateStream('x', '', [])) {
      collected.push(event)
    }

    expect(collected).toEqual([validEvent, doneEvent])
  })

  it('test_iterateStream_aborts_on_signal — controller.signal exits the for-await', async () => {
    // Like generateStream's abort test, but for iterateStream: the
    // signal must be propagated to fetch and aborting must cause the
    // for-await to exit cleanly.
    const hanging = mockHangingSSEStream()
    const fetchMock = vi.fn().mockResolvedValue(hanging.response)
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const generator = iterateStream('x', '', [], undefined, controller.signal)

    const iteration = (async () => {
      const events: SSEEvent[] = []
      for await (const event of generator) {
        events.push(event)
      }
      return events
    })()

    // Let the generator reach its first `read()`.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)

    controller.abort()
    hanging.close()

    await expect(iteration).resolves.toEqual([])
  })

  it('test_iterateStream_throws_on_error_response — non-2xx surfaces as an Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockErrorResponse(500, 'Internal Server Error')))

    const gen = iterateStream('x', '', [])
    await expect(
      (async () => {
        for await (const _ of gen) {
          /* drain */
        }
      })(),
    ).rejects.toThrow(/Iterate failed: 500/)
  })

  it('test_iterateStream_emits_error_event — backend error frame is yielded', async () => {
    const events: SSEEvent[] = [
      { type: 'status', content: 'iterating' },
      { type: 'error', message: 'model rate limited' },
      { type: 'done' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(mockSSEStream(events))
    vi.stubGlobal('fetch', fetchMock)

    const collected: SSEEvent[] = []
    for await (const event of iterateStream('x', '', [])) {
      collected.push(event)
    }

    // The error event must be forwarded as-is (the hook decides how
    // to surface it). The trailing `done` is also yielded.
    expect(collected).toEqual(events)
    const errorEvent = collected.find((e) => e.type === 'error')
    expect(errorEvent).toEqual({ type: 'error', message: 'model rate limited' })
  })
})
