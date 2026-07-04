/**
 * Tests for `src/hooks/useModels.ts`.
 *
 * The hook wraps `getModels()` from `@/lib/api` with reactive state
 * and a hardcoded fallback. We mock `getModels` directly (rather
 * than `fetch`) so each test can pin the success / failure shape
 * without writing a `ReadableStream` response body.
 *
 * Coverage:
 *  - Initial state: `loading=true`, `models=FALLBACK_MODELS`,
 *    `error=null`, `usingFallback=true`.
 *  - On success: `models` is the API payload, `usingFallback=false`,
 *    `error=null`, `loading=false`.
 *  - On error: `models` is `FALLBACK_MODELS`, `usingFallback=true`,
 *    `error=<message>`, `loading=false`.
 *  - `refetch()` re-runs the fetch; subsequent success clears the
 *    error and `usingFallback`.
 *  - The component unmounting before the fetch resolves does NOT
 *    update state (we just don't assert against an unmounted
 *    component, but the hook's `cancelled` guard is exercised).
 */
import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FALLBACK_MODELS, useModels, type UseModelsResult } from './useModels'
import type { ModelInfo } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    getModels: vi.fn(),
  }
})

// Imported lazily so the mock above is in place first.
import { getModels } from '@/lib/api'

const getModelsMock = vi.mocked(getModels)

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const API_MODELS: ModelInfo[] = [
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
  {
    id: 'opencode-go/qwen-3.7-plus',
    name: 'Qwen 3.7 Plus',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.4,
    output_price_per_mtok: 1.2,
    context_window: 128_000,
    recommended: false,
    description: 'Mid-cost generalist.',
  },
]

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                    */
/* ------------------------------------------------------------------ */

afterEach(() => {
  vi.clearAllMocks()
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
 * fire a "state update not wrapped in act" warning. Returns the
 * standard `renderHook` result so the rest of the test can read
 * `result.current` normally.
 *
 * This is intentionally synchronous. The hook's `loadModels` runs
 * inside the effect and calls `setLoading(true)` + `setError(null)`
 * — both of which are no-ops given the initial state, so React
 * bails out before scheduling a re-render. The fetch's eventual
 * resolution (which would call `setLoading(false)`) is what
 * `flush()` handles for the post-resolve tests.
 */
function mountHook(): RenderHookResult<UseModelsResult, void> {
  let captured!: RenderHookResult<UseModelsResult, void>
  act(() => {
    captured = renderHook(() => useModels())
  })
  return captured
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('useModels() — initial state', () => {
  it('test_initial_state — loading=true, models=FALLBACK_MODELS, usingFallback=true', () => {
    // Never-resolving so we can observe the synchronous initial
    // state without the fetch's post-resolve setStates clobbering
    // it. The post-resolve state is covered by the next describe.
    getModelsMock.mockReturnValue(new Promise<ModelInfo[]>(() => {}))

    const { result } = mountHook()

    // Before the fetch resolves, we render the fallback so the picker
    // is never empty. The user can see the catalog immediately, and
    // the real list swaps in when the request completes.
    expect(result.current.loading).toBe(true)
    expect(result.current.models).toBe(FALLBACK_MODELS)
    expect(result.current.usingFallback).toBe(true)
    expect(result.current.error).toBeNull()
  })
})

describe('useModels() — successful fetch', () => {
  it('test_success_replaces_models — on resolve, models is the API payload, usingFallback=false', async () => {
    getModelsMock.mockResolvedValue(API_MODELS)

    const { result } = mountHook()
    await flush()

    expect(result.current.loading).toBe(false)
    expect(result.current.models).toEqual(API_MODELS)
    expect(result.current.models).not.toBe(FALLBACK_MODELS)
    expect(result.current.usingFallback).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('test_calls_getModels_once — the initial mount triggers a single fetch', async () => {
    getModelsMock.mockResolvedValue(API_MODELS)

    mountHook()
    await flush()

    expect(getModelsMock).toHaveBeenCalledTimes(1)
  })
})

describe('useModels() — fetch error', () => {
  it('test_error_uses_fallback — on reject, models is FALLBACK_MODELS, error is set', async () => {
    getModelsMock.mockRejectedValue(new Error('Network unreachable'))

    const { result } = mountHook()
    await flush()

    expect(result.current.loading).toBe(false)
    expect(result.current.models).toBe(FALLBACK_MODELS)
    expect(result.current.usingFallback).toBe(true)
    expect(result.current.error).toBe('Network unreachable')
  })

  it('test_error_handles_non_error_throw — wraps non-Error values into a string', async () => {
    // The hook should never crash even if `getModels` rejects with
    // something that's not an Error instance (e.g. a string, a plain
    // object, a Promise rejection value). String() is the fallback.
    getModelsMock.mockRejectedValue('boom')

    const { result } = mountHook()
    await flush()

    expect(result.current.error).toBe('boom')
    expect(result.current.models).toBe(FALLBACK_MODELS)
  })
})

describe('useModels() — refetch()', () => {
  it('test_refetch_re_runs_fetch — calling refetch re-invokes getModels', async () => {
    getModelsMock.mockResolvedValue(API_MODELS)

    const { result } = mountHook()
    await flush()

    expect(getModelsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetch()
    })

    expect(getModelsMock).toHaveBeenCalledTimes(2)
  })

  it('test_refetch_recovers_from_error — a successful refetch clears the error and fallback flag', async () => {
    // First fetch fails, second succeeds.
    getModelsMock
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(API_MODELS)

    const { result } = mountHook()
    await flush()

    expect(result.current.usingFallback).toBe(true)
    expect(result.current.error).toBe('temporary')

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.models).toEqual(API_MODELS)
    expect(result.current.usingFallback).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('test_refetch_records_loading — loading flips true while a refetch is in flight', async () => {
    // Use a controllable promise so we can observe the in-flight
    // `loading` state before the resolution.
    let resolveFetch: ((value: ModelInfo[]) => void) | null = null
    getModelsMock.mockImplementation(
      () =>
        new Promise<ModelInfo[]>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { result } = await mountHook()
    // The initial fetch is pending; flush the synchronous microtask
    // queue so the effect runs, but the fetch is still in flight.
    await act(async () => {
      await Promise.resolve()
    })

    // Resolve the initial fetch first so we can clear the in-flight
    // guard, then trigger a manual refetch we can pause on.
    await act(async () => {
      resolveFetch?.(API_MODELS)
      await Promise.resolve()
    })

    expect(result.current.loading).toBe(false)

    // Start a new refetch and pause it.
    let resolveRefetch: ((value: ModelInfo[]) => void) | null = null
    getModelsMock.mockImplementationOnce(
      () =>
        new Promise<ModelInfo[]>((resolve) => {
          resolveRefetch = resolve
        }),
    )

    let refetchPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      refetchPromise = result.current.refetch()
      await Promise.resolve()
    })

    // Loading should be true while the refetch is in flight.
    expect(result.current.loading).toBe(true)

    // Resolve the refetch and let state settle.
    await act(async () => {
      resolveRefetch?.(API_MODELS)
      await refetchPromise
    })

    expect(result.current.loading).toBe(false)
  })
})

describe('useModels() — unmount', () => {
  it('test_unmount_before_resolve_does_not_throw — late resolution is safely ignored', async () => {
    let resolveFetch: ((value: ModelInfo[]) => void) | null = null
    getModelsMock.mockImplementation(
      () =>
        new Promise<ModelInfo[]>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { unmount } = mountHook()
    // Yield once so the effect's `void loadModels()` call commits.
    await act(async () => {
      await Promise.resolve()
    })

    // Unmount before the fetch resolves. This must not throw or
    // produce a React warning about state updates on an unmounted
    // component.
    unmount()

    // Resolving after unmount is the "late delivery" race. The
    // hook's `cancelled` ref makes this a no-op; we just assert
    // that no exception escapes.
    expect(() => {
      resolveFetch?.(API_MODELS)
    }).not.toThrow()
  })
})

describe('FALLBACK_MODELS', () => {
  it('test_fallback_list_shape — every entry satisfies the ModelInfo contract', () => {
    // Defensive: the fallback is hand-edited, so we pin its shape.
    // If a future edit drops a field or changes a type, this test
    // catches it before the picker tries to render a malformed row.
    expect(FALLBACK_MODELS.length).toBeGreaterThanOrEqual(9)
    for (const m of FALLBACK_MODELS) {
      expect(typeof m.id).toBe('string')
      expect(typeof m.name).toBe('string')
      expect(typeof m.provider).toBe('string')
      expect(['openai', 'anthropic']).toContain(m.endpoint)
      expect(['coder', 'planner', 'both']).toContain(m.role)
      expect(typeof m.input_price_per_mtok).toBe('number')
      expect(typeof m.output_price_per_mtok).toBe('number')
      expect(typeof m.context_window).toBe('number')
      expect(typeof m.recommended).toBe('boolean')
      expect(typeof m.description).toBe('string')
    }
  })

  it('test_fallback_includes_recommended_coder — at least one recommended coder exists for the default', () => {
    // The Builder defaults to `opencode-go/minimax-m3`. The fallback
    // list MUST include this id (and a `recommended: true` flag) so
    // the default selection resolves and the picker shows the badge
    // even when offline.
    const target = FALLBACK_MODELS.find(
      (m) => m.id === 'opencode-go/minimax-m3',
    )
    expect(target).toBeDefined()
    expect(target?.recommended).toBe(true)
  })

  it('test_fallback_ids_are_unique — no duplicate model ids in the list', () => {
    const ids = FALLBACK_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
