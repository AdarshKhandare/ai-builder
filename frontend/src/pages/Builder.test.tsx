/**
 * Tests for `src/pages/Builder.tsx`.
 *
 * The Builder is the integration point for chat iteration, model
 * selection, and the cost estimate. A full end-to-end render would
 * require mocking fetch, JSZip, sonner, the HistoryDrawer, the
 * useModels hook, and half a dozen UI primitives, so we test the
 * *minimum* needed to lock in the invariants:
 *
 *  - When `code` is empty and no stream is in flight, the chat
 *    input's placeholder says "Describe …" (generation mode).
 *  - When `code` is non-empty and no stream is in flight, the
 *    chat input's placeholder says "Ask for changes" (iteration
 *    mode).
 *  - When a stream is in flight, the input is disabled regardless
 *    of `code` length.
 *
 * We mock the SSE hook and the API client so the page renders
 * without touching the network; the real iterate / start behaviour
 * is covered by `useSSE.test.ts` + `api.test.ts`.
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/*                                                                     */
/* We need to mock the SSE hook and the API client BEFORE the Builder */
/* module is imported, so we use `vi.mock` with a factory at the top  */
/* of the file. Each test re-shapes the hook's return value by        */
/* mutating the captured `sseState` before calling `render()`.        */
/* ------------------------------------------------------------------ */

type SSEShape = {
  code: string
  status: string | null
  title: string
  isStreaming: boolean
  error: string | null
  done: boolean
  start: (...args: unknown[]) => Promise<void>
  iterate: (...args: unknown[]) => Promise<void>
  reset: () => void
  load: () => void
}

let sseState: SSEShape

vi.mock('@/hooks/useSSE', () => ({
  useSSE: (): SSEShape => sseState,
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    // The Builder now pulls the model catalog from `getModels` via
    // the `useModels` hook. Mock it to return a single recommended
    // model so the picker is populated without hitting the network.
    getModels: vi.fn().mockResolvedValue([
      {
        id: 'opencode-go/minimax-m3',
        name: 'MiniMax M3',
        provider: 'opencode-go',
        endpoint: 'openai',
        role: 'coder',
        input_price_per_mtok: 0.14,
        output_price_per_mtok: 0.28,
        context_window: 200_000,
        recommended: true,
        description: 'Cheap and fast.',
      },
    ]),
    createProject: vi.fn().mockResolvedValue({ id: 1 }),
    updateProject: vi.fn().mockResolvedValue({ id: 1 }),
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  // The Builder renders `<Toaster />` from `sonner` via the
  // `@/components/ui/sonner` wrapper. The wrapper is itself a
  // real component that uses `useTheme` + `next-themes` — stub
  // the inner Sonner to a no-op so the page mounts without
  // pulling in a real portal / theme provider.
  Toaster: () => null,
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}))

/*
 * Importing the actual `Builder` here, after the mocks are in place,
 * is safe — `vi.mock` is hoisted by Vitest.
 */
import { Builder } from './Builder'

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                    */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  // Default: no code, not streaming, no error — i.e. "first run"
  // state. Each test mutates this directly before calling `render()`.
  sseState = {
    code: '',
    status: null,
    title: '',
    isStreaming: false,
    error: null,
    done: false,
    start: vi.fn().mockResolvedValue(undefined),
    iterate: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    load: vi.fn(),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('Builder() — chat mode (Phase 4)', () => {
  it('test_mode_generation_no_code — placeholder says "Describe" when there is no code', async () => {
    sseState.code = ''
    sseState.isStreaming = false

    render(<Builder />)

    // The chat input is rendered with aria-label="Prompt input".
    const input = await screen.findByLabelText('Prompt input')
    const placeholder = input.getAttribute('placeholder') ?? ''
    expect(placeholder.toLowerCase()).toContain('describe')
  })

  it('test_mode_iteration_with_code — placeholder says "Ask for changes" when code exists', async () => {
    sseState.code = '<h1>hello</h1>'
    sseState.isStreaming = false

    render(<Builder />)

    const input = await screen.findByLabelText('Prompt input')
    const placeholder = input.getAttribute('placeholder') ?? ''
    expect(placeholder.toLowerCase()).toContain('ask for changes')
  })

  it('test_input_disabled_while_streaming — input is disabled during a stream regardless of code', async () => {
    sseState.code = ''
    sseState.isStreaming = true

    render(<Builder />)

    const input = await screen.findByLabelText('Prompt input')
    expect(input).toBeDisabled()
  })

  it('test_input_enabled_when_idle_with_code — input is enabled when code is on screen and no stream is in flight', async () => {
    sseState.code = '<h1>done</h1>'
    sseState.isStreaming = false

    render(<Builder />)

    const input = await screen.findByLabelText('Prompt input')
    expect(input).not.toBeDisabled()
  })
})
