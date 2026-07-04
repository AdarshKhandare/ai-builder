/**
 * Tests for `src/hooks/useAuth.ts`.
 *
 * The hook wraps `getMe()` and `logout()` from `@/lib/api` with
 * reactive state. We mock the API functions directly (rather than
 * `fetch`) so each test can pin the success / failure shape.
 *
 * Coverage:
 *  - Initial state: `loading=true`, `user=null`, `error=null`.
 *  - On 200 success: `user` is the payload, `loading=false`.
 *  - On 401 (canonical "not signed in"): `user=null`,
 *    `error=null`, `loading=false`.
 *  - On non-401 error: `user=null`, `error=<message>`,
 *    `loading=false`.
 *  - `logout()` calls the API, clears state, and navigates to `/`.
 *  - `refetch()` re-runs the fetch.
 */
import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAuth, type UseAuthResult } from './useAuth'
import type { User } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    getMe: vi.fn(),
    logout: vi.fn(),
  }
})

// Imported lazily so the mocks above are in place first.
import { getMe, logout as apiLogout } from '@/lib/api'

const getMeMock = vi.mocked(getMe)
const logoutMock = vi.mocked(apiLogout)

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const SAMPLE_USER: User = {
  id: 42,
  username: 'octocat',
  avatar_url: 'https://github.com/images/octocat.png',
  email: 'octocat@github.com',
}

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                    */
/* ------------------------------------------------------------------ */

afterEach(() => {
  vi.clearAllMocks()
  // jsdom keeps `window.location.assign` between tests; reset the
  // spy so the "navigates to /" assertion is per-test.
  ;(window.location.assign as unknown as ReturnType<typeof vi.fn>).mockClear?.()
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Drain microtasks + React's scheduler so async state commits. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/**
 * Mount the hook inside `act()` so the initial `useEffect` doesn't
 * fire a "state update not wrapped in act" warning. Mirrors the
 * helper in `useModels.test.ts`.
 */
function mountHook(): RenderHookResult<UseAuthResult, void> {
  let captured!: RenderHookResult<UseAuthResult, void>
  act(() => {
    captured = renderHook(() => useAuth())
  })
  return captured
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('useAuth() — initial state', () => {
  it('test_initial_state — loading=true, user=null, error=null', () => {
    // Never-resolving so we can observe the synchronous initial
    // state without the fetch's post-resolve setStates clobbering
    // it. The post-resolve state is covered by the next describe.
    getMeMock.mockReturnValue(new Promise<User | null>(() => {}))

    const { result } = mountHook()

    expect(result.current.loading).toBe(true)
    expect(result.current.user).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

describe('useAuth() — successful fetch', () => {
  it('test_success_sets_user — on resolve, user is the API payload', async () => {
    getMeMock.mockResolvedValue(SAMPLE_USER)

    const { result } = mountHook()
    await flush()

    expect(result.current.loading).toBe(false)
    expect(result.current.user).toEqual(SAMPLE_USER)
    expect(result.current.error).toBeNull()
  })

  it('test_calls_getMe_once — the initial mount triggers a single fetch', async () => {
    getMeMock.mockResolvedValue(SAMPLE_USER)

    mountHook()
    await flush()

    expect(getMeMock).toHaveBeenCalledTimes(1)
  })
})

describe('useAuth() — 401 (not signed in)', () => {
  it('test_401_sets_user_null — canonical "not signed in" is user=null, not an error', async () => {
    // 401 is the "no session" signal — getMe() resolves to null
    // for it, and the hook must NOT surface an error in that case.
    getMeMock.mockResolvedValue(null)

    const { result } = mountHook()
    await flush()

    expect(result.current.loading).toBe(false)
    expect(result.current.user).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

describe('useAuth() — fetch error', () => {
  it('test_error_sets_message — on non-401 reject, error is set, user is null', async () => {
    getMeMock.mockRejectedValue(new Error('Network unreachable'))

    const { result } = mountHook()
    await flush()

    expect(result.current.loading).toBe(false)
    expect(result.current.user).toBeNull()
    expect(result.current.error).toBe('Network unreachable')
  })

  it('test_error_handles_non_error_throw — wraps non-Error values into a string', async () => {
    // Defensive: the hook should never crash even if `getMe`
    // rejects with something that's not an Error instance.
    getMeMock.mockRejectedValue('plain string rejection')

    const { result } = mountHook()
    await flush()

    expect(result.current.error).toBe('plain string rejection')
  })
})

describe('useAuth() — refetch()', () => {
  it('test_refetch_re_runs_getMe — manual re-fetch re-calls the API', async () => {
    getMeMock.mockResolvedValue(SAMPLE_USER)

    const { result } = mountHook()
    await flush()

    expect(getMeMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetch()
    })

    expect(getMeMock).toHaveBeenCalledTimes(2)
  })

  it('test_refetch_updates_user — a fresh fetch surfaces the new user', async () => {
    getMeMock.mockResolvedValueOnce(SAMPLE_USER)
    const NEW_USER: User = { ...SAMPLE_USER, id: 99, username: 'newcomer' }
    getMeMock.mockResolvedValueOnce(NEW_USER)

    const { result } = mountHook()
    await flush()

    expect(result.current.user?.id).toBe(42)

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.user?.id).toBe(99)
    expect(result.current.user?.username).toBe('newcomer')
  })
})

describe('useAuth() — logout()', () => {
  it('test_logout_clears_user_and_navigates — POSTs and redirects to /', async () => {
    getMeMock.mockResolvedValue(SAMPLE_USER)
    logoutMock.mockResolvedValue(undefined)
    // Spy on window.location.assign so we can assert the redirect
    // without actually navigating jsdom's URL.
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignSpy },
    })

    const { result } = mountHook()
    await flush()

    expect(result.current.user).toEqual(SAMPLE_USER)

    await act(async () => {
      await result.current.logout()
    })

    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(assignSpy).toHaveBeenCalledWith('/')
  })

  it('test_logout_propagates_error — API failure re-throws so the caller can toast', async () => {
    getMeMock.mockResolvedValue(SAMPLE_USER)
    logoutMock.mockRejectedValue(new Error('logout failed'))

    const { result } = mountHook()
    await flush()

    await expect(
      act(async () => {
        await result.current.logout()
      }),
    ).rejects.toThrow(/logout failed/)
  })
})
