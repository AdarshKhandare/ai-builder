/**
 * Tests for `src/hooks/useProjects.ts`.
 *
 * Stubs the `fetch` global so the hook's `listProjects`,
 * `createProject`, `updateProject`, and `deleteProject` calls
 * hit a fake `Response` object. We never touch the network.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjects } from './useProjects'
import type {
  ProjectCreateBody,
  ProjectFull,
  ProjectSummary,
  ProjectUpdateBody,
} from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status })
}

const SAMPLE_SUMMARY: ProjectSummary = {
  id: 1,
  title: 'My Counter',
  prompt: 'A simple counter with increment and decrement',
  model: 'opencode-go/minimax-m3',
  created_at: '2026-07-03T10:00:00.000Z',
}

const SAMPLE_FULL: ProjectFull = {
  ...SAMPLE_SUMMARY,
  code: '<!doctype html><h1>counter</h1>',
  updated_at: '2026-07-03T10:00:00.000Z',
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Drain the React scheduler. */
// Reserved for future use; tests that need it can call it inline.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}
void flush

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('useProjects() — initial state', () => {
  it('test_initial_state — loading starts true, list empty', () => {
    // Return a never-resolving promise so the initial fetch stays
    // "in flight" while we inspect the synchronous initial state.
    fetchMock.mockReturnValue(new Promise(() => undefined))

    const { result } = renderHook(() => useProjects())

    expect(result.current.loading).toBe(true)
    expect(result.current.projects).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('test_loads_list — fetches /api/projects on mount and updates state', async () => {
    fetchMock.mockResolvedValue(jsonResponse([SAMPLE_SUMMARY]))

    const { result } = renderHook(() => useProjects())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.projects).toEqual([SAMPLE_SUMMARY])
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects?limit=50&offset=0')
  })
})

/* ------------------------------------------------------------------ */
/* Error handling                                                      */
/* ------------------------------------------------------------------ */

describe('useProjects() — error handling', () => {
  it('test_load_error — sets error on failed list fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, 500))

    const { result } = renderHook(() => useProjects())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toMatch(/500/)
    expect(result.current.projects).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

describe('useProjects() — createProject()', () => {
  it('test_create_succeeds — posts body, returns full row, refreshes list', async () => {
    // First call: initial list fetch.
    // Second call: POST /api/projects.
    // Third call: refresh list after create.
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_FULL, 201))
      .mockResolvedValueOnce(jsonResponse([SAMPLE_SUMMARY]))

    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const body: ProjectCreateBody = {
      title: SAMPLE_FULL.title,
      prompt: SAMPLE_FULL.prompt,
      code: SAMPLE_FULL.code,
      model: SAMPLE_FULL.model,
    }

    let created: ProjectFull | null = null
    await act(async () => {
      created = await result.current.createProject(body)
    })

    expect(created).toEqual(SAMPLE_FULL)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/projects')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
  })

  it('test_create_failure — returns null, sets error, does not throw', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ detail: 'invalid' }, 422))

    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let created: ProjectFull | null | undefined
    await act(async () => {
      created = await result.current.createProject({
        title: 'x',
        prompt: 'x',
        code: 'x',
        model: 'opencode-go/minimax-m3',
      })
    })

    expect(created).toBeNull()
    expect(result.current.error).toMatch(/422/)
  })
})

describe('useProjects() — updateProject()', () => {
  it('test_update_succeeds — sends PATCH, refreshes, returns row', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([SAMPLE_SUMMARY]))
      .mockResolvedValueOnce(jsonResponse({ ...SAMPLE_FULL, title: 'Renamed' }))
      .mockResolvedValueOnce(jsonResponse([SAMPLE_SUMMARY]))

    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const body: ProjectUpdateBody = { title: 'Renamed' }
    let updated: ProjectFull | null | undefined
    await act(async () => {
      updated = await result.current.updateProject(1, body)
    })

    expect(updated).toBeDefined()
    expect(updated?.title).toBe('Renamed')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/projects/1')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PATCH')
  })
})

describe('useProjects() — deleteProject()', () => {
  it('test_delete_succeeds — sends DELETE, returns true, refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([SAMPLE_SUMMARY]))
      .mockResolvedValueOnce(emptyResponse(204))
      .mockResolvedValueOnce(jsonResponse([]))

    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.deleteProject(1)
    })

    expect(ok).toBe(true)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/projects/1')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })

  it('test_delete_failure — returns false, sets error, does not throw', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([SAMPLE_SUMMARY]))
      .mockResolvedValueOnce(jsonResponse({ detail: 'gone' }, 404))

    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.deleteProject(99)
    })

    expect(ok).toBe(false)
    expect(result.current.error).toMatch(/404/)
  })
})
