/**
 * Shared test helper for mocking Server-Sent Events responses.
 *
 * `mockSSEStream` returns a `Response` object whose body is a real
 * `ReadableStream` that yields the given events as `data: <json>\n\n`
 * SSE frames — exactly the wire format the backend uses. The matching
 * `text/event-stream` Content-Type is set so consumer code can detect
 * the format if it cares.
 *
 * Usage in a vitest test:
 *
 *     const events: SSEEvent[] = [
 *       { type: 'status', content: 'planning' },
 *       { type: 'code', content: '<h1>hi</h1>' },
 *       { type: 'done' },
 *     ]
 *     vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockSSEStream(events))))
 *
 * The returned Response is real enough for `await res.body.getReader()`
 * to work — no monkey-patching of `Response` required.
 */
import type { SSEEvent } from '@/lib/api'

/** Build a single SSE frame as a UTF-8 byte string. */
function frame(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Return a `Response` whose body yields the given SSE events and then
 * closes. Suitable for assigning to `globalThis.fetch` in a test.
 */
export function mockSSEStream(events: ReadonlyArray<SSEEvent>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(frame(event)))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * Like {@link mockSSEStream} but the stream is left open. The returned
 * `close` function flushes any pending events and closes the stream.
 * Useful for testing mid-stream cancellation.
 */
export function mockHangingSSEStream(): {
  response: Response
  enqueue: (event: SSEEvent) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
  })
  const response = new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
  return {
    response,
    enqueue: (event: SSEEvent) => {
      controllerRef?.enqueue(encoder.encode(frame(event)))
    },
    close: () => {
      controllerRef?.close()
      controllerRef = null
    },
  }
}

/** Build a non-2xx `Response` with a JSON error body. */
export function mockErrorResponse(status: number, statusText: string): Response {
  return new Response(JSON.stringify({ detail: statusText }), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  })
}
