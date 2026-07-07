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
 *  - When the user is at their project cap, the send button is
 *    disabled and the inline limit message is shown.
 *  - When the current project is at its iteration cap, the send
 *    button is disabled and the iteration limit message is shown.
 *
 * We mock the SSE hook, the auth hook, and the API client so the
 * page renders without touching the network; the real iterate /
 * start behaviour is covered by `useSSE.test.ts` + `api.test.ts`.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/*                                                                     */
/* We need to mock the SSE hook, the auth hook, and the API client    */
/* BEFORE the Builder module is imported, so we use `vi.mock` with a  */
/* factory at the top of the file. Each test re-shapes the hooks'     */
/* return values by mutating the captured `sseState` / `authState`    */
/* before calling `render()`.                                         */
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

let authState: {
  user: User | null
  loading: boolean
  error: string | null
  logout: () => Promise<void>
  refetch: () => Promise<void>
}

vi.mock('@/hooks/useSSE', () => ({
  useSSE: (): SSEShape => sseState,
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: (): typeof authState => authState,
}))

// `vi.mock` is hoisted to the top of the file, so any variables
// it references MUST be created with `vi.hoisted` (which is
// also hoisted) to avoid a "Cannot access X before
// initialization" error.
const { createProjectMock, updateProjectMock } = vi.hoisted(() => {
  const createProjectMock = vi.fn().mockResolvedValue({
    id: 1,
    title: 'x',
    prompt: 'x',
    code: 'x',
    model: 'opencode-go/minimax-m3',
    created_at: '2026-07-03T10:00:00.000Z',
    updated_at: '2026-07-03T10:00:00.000Z',
    iteration_count: 0,
    iteration_limit: 10,
  })
  const updateProjectMock = vi.fn().mockResolvedValue({
    id: 1,
    title: 'x',
    prompt: 'x',
    code: 'x',
    model: 'opencode-go/minimax-m3',
    created_at: '2026-07-03T10:00:00.000Z',
    updated_at: '2026-07-03T10:00:00.000Z',
    iteration_count: 0,
    iteration_limit: 10,
  })
  return { createProjectMock, updateProjectMock }
})

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
    createProject: createProjectMock,
    updateProject: updateProjectMock,
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  Toaster: () => null,
}))

/*
 * Importing the actual `Builder` here, after the mocks are in place,
 * is safe — `vi.mock` is hoisted by Vitest.
 */
import { Builder } from './Builder'

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                    */
/* ------------------------------------------------------------------ */

/** A user that is NOT at the project cap. */
const FREE_USER: User = {
  id: 1,
  username: 'octocat',
  avatar_url: null,
  email: null,
  lifetime_project_count: 0,
  project_limit: 2,
}

/** A user that IS at the project cap. */
const CAPPED_USER: User = {
  ...FREE_USER,
  lifetime_project_count: 2,
}

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
  // Default: signed-in user, not at the cap. Each test can
  // override this with a different user (or `null` for "not
  // signed in") by reassigning `authState.user` BEFORE
  // `renderInRouter()`.
  authState = {
    user: FREE_USER,
    loading: false,
    error: null,
    logout: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn().mockResolvedValue(undefined),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('Builder() — chat mode (Phase 4)', () => {
  // The Builder renders the shared `TopBar`, whose `Logo` is a
  // `react-router` `Link`. Wrap every render in a `MemoryRouter`
  // so that Link has the routing context it expects.
  const renderInRouter = (): ReturnType<typeof render> =>
    render(
      <MemoryRouter initialEntries={['/builder']}>
        <Builder />
      </MemoryRouter>,
    )

  it('test_mode_generation_no_code — placeholder says "Describe" when there is no code', async () => {
    sseState.code = ''
    sseState.isStreaming = false

    renderInRouter()

    // The chat input is rendered with aria-label="Prompt input".
    const input = await screen.findByLabelText('Prompt input')
    const placeholder = input.getAttribute('placeholder') ?? ''
    expect(placeholder.toLowerCase()).toContain('describe')
  })

  it('test_mode_iteration_with_code — placeholder says "Ask for changes" when code exists', async () => {
    sseState.code = '<h1>hello</h1>'
    sseState.isStreaming = false

    renderInRouter()

    const input = await screen.findByLabelText('Prompt input')
    const placeholder = input.getAttribute('placeholder') ?? ''
    expect(placeholder.toLowerCase()).toContain('ask for changes')
  })

  it('test_input_disabled_while_streaming — input is disabled during a stream regardless of code', async () => {
    sseState.code = ''
    sseState.isStreaming = true

    renderInRouter()

    const input = await screen.findByLabelText('Prompt input')
    expect(input).toBeDisabled()
  })

  it('test_input_enabled_when_idle_with_code — input is enabled when code is on screen and no stream is in flight', async () => {
    sseState.code = '<h1>done</h1>'
    sseState.isStreaming = false

    renderInRouter()

    const input = await screen.findByLabelText('Prompt input')
    expect(input).not.toBeDisabled()
  })
})

/* ------------------------------------------------------------------ */
/* Abuse-prevention limit checks                                        */
/* ------------------------------------------------------------------ */

describe('Builder() — abuse-prevention limits', () => {
  const renderInRouter = (): ReturnType<typeof render> =>
    render(
      <MemoryRouter initialEntries={['/builder']}>
        <Builder />
      </MemoryRouter>,
    )

  it('test_project_cap_disables_send — when lifetime_project_count >= project_limit, send is disabled and the message is shown', async () => {
    authState.user = CAPPED_USER
    sseState.code = ''
    sseState.isStreaming = false

    renderInRouter()

    const input = await screen.findByLabelText('Prompt input')
    // Type something so the input has content — the limit, not
    // the empty-prompt guard, must be the reason the button is
    // disabled.
    fireEvent.change(input, { target: { value: 'build me an app' } })

    const sendButton = screen.getByLabelText('Send message')
    expect(sendButton).toBeDisabled()
    expect(input).toBeDisabled()

    // The inline limit message is rendered with aria-live="polite"
    // and the project's limit number is part of the copy.
    const message = await screen.findByTestId('chat-limit-message')
    expect(message).toHaveAttribute('aria-live', 'polite')
    expect(message.textContent ?? '').toMatch(/2-project limit/)
    expect(message.textContent ?? '').toMatch(/still iterate on your existing projects/i)
  })

  it('test_project_cap_send_does_not_call_start — clicking send at the project cap is a no-op', async () => {
    authState.user = CAPPED_USER
    sseState.code = ''
    sseState.isStreaming = false

    renderInRouter()

    const input = await screen.findByLabelText('Prompt input')
    fireEvent.change(input, { target: { value: 'build me an app' } })

    // The send button is disabled, but `fireEvent.click` on a
    // disabled button is a no-op in jsdom — verify the start
    // mock was never invoked.
    const sendButton = screen.getByLabelText('Send message')
    fireEvent.click(sendButton)
    expect(sseState.start).not.toHaveBeenCalled()
  })

  it('test_below_project_cap_enables_send — when lifetime_project_count < project_limit, the input is enabled', async () => {
    authState.user = FREE_USER
    sseState.code = ''
    sseState.isStreaming = false

    renderInRouter()

    const input = await screen.findByLabelText('Prompt input')
    fireEvent.change(input, { target: { value: 'build me an app' } })

    const sendButton = screen.getByLabelText('Send message')
    expect(sendButton).not.toBeDisabled()
    // No limit message when the user is below the cap.
    expect(screen.queryByTestId('chat-limit-message')).not.toBeInTheDocument()
  })

  it('test_iteration_cap_takes_precedence — when both caps are in effect, the iteration cap copy wins', async () => {
    // jsdom's ScrollArea viewport doesn't implement `scrollTo`,
    // which the ChatPanel's auto-scroll effect calls whenever
    // the message list grows. Stub it out so the effect is a
    // no-op in this test — we only care about the limit-message
    // behaviour, not the scroll mechanics.
    const scrollToStub = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollToStub,
    })

    // Override the createProject response for this test so the
    // auto-save effect seeds a project at its iteration cap.
    // (The default mock returns 0/10, which would leave the
    // iteration cap inactive and the project-cap message would
    // win — the OPPOSITE of what this test asserts.)
    createProjectMock.mockResolvedValueOnce({
      id: 1,
      title: 'x',
      prompt: 'x',
      code: '<h1>existing</h1>',
      model: 'opencode-go/minimax-m3',
      created_at: '2026-07-03T10:00:00.000Z',
      updated_at: '2026-07-03T10:00:00.000Z',
      iteration_count: 10,
      iteration_limit: 10,
    })

    try {
      // The user is at the project cap (which would normally
      // show the project-cap message), but the auto-save effect
      // has just seeded a project at its iteration cap — so the
      // iteration cap takes precedence (iteration caps are scoped
      // to the current project, project caps are scoped to the
      // user).
      authState.user = CAPPED_USER
      sseState.code = '<h1>existing</h1>'
      sseState.done = true
      sseState.isStreaming = false

      renderInRouter()

      // Wait for the auto-save effect to seed the iteration
      // counters from the created project row. The done effect
      // runs after mount because `done` is `true` on the very
      // first render — React's effects fire after the first
      // commit.
      const message = await screen.findByTestId('chat-limit-message')
      expect(message.textContent ?? '').toMatch(/10-iteration limit/)

      const input = screen.getByLabelText('Prompt input')
      fireEvent.change(input, { target: { value: 'tweak the hero' } })
      const sendButton = screen.getByLabelText('Send message')
      expect(sendButton).toBeDisabled()
    } finally {
      // Restore the original (undefined) `scrollTo` on the
      // prototype so other tests aren't affected.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (HTMLElement.prototype as any).scrollTo
    }
  })
})
