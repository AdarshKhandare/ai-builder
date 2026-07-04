/**
 * `useProjects` — React hook for the projects CRUD lifecycle.
 *
 * Owns the local copy of the project list plus the loading/error
 * state. Mutation methods (`createProject`, `updateProject`,
 * `deleteProject`) wrap the corresponding `lib/api` calls and
 * refresh the list on success so consumers never see stale data.
 *
 * The hook deliberately does NOT throw — mutations set `error`
 * instead, mirroring the pattern of the rest of the app (e.g.
 * `useSSE`). Callers check `error` for the message to surface in
 * a toast.
 *
 * Example:
 *
 *     const { projects, loading, error, refresh, deleteProject } = useProjects()
 *     useEffect(() => { void refresh() }, [])
 *     if (error) toast.error(error)
 */
import { useCallback, useEffect, useState } from 'react'

import {
  createProject as apiCreate,
  deleteProject as apiDelete,
  listProjects,
  updateProject as apiUpdate,
  type ProjectCreateBody,
  type ProjectFull,
  type ProjectSummary,
  type ProjectUpdateBody,
} from '@/lib/api'

export interface UseProjectsResult {
  /** Lightweight list rows, newest first. Empty until the first
   *  `refresh` resolves successfully. */
  projects: ProjectSummary[]
  /** True while the initial `listProjects()` is in flight. */
  loading: boolean
  /** Most-recent error message, or `null` after a successful call. */
  error: string | null
  /** Re-fetch the list. Safe to call any time. */
  refresh: () => Promise<void>
  /**
   * Create a project and refresh the list. Returns the newly-created
   * full row (with `code` and `updated_at`) on success.
   *
   * On failure: sets `error`, returns `null`. Does NOT throw.
   */
  createProject: (data: ProjectCreateBody) => Promise<ProjectFull | null>
  /**
   * Update a project by id and refresh the list. Returns the updated
   * full row on success, or `null` on failure.
   */
  updateProject: (id: number, data: ProjectUpdateBody) => Promise<ProjectFull | null>
  /**
   * Delete a project by id and refresh the list.
   *
   * On failure: sets `error`, resolves to `false`. Otherwise resolves
   * to `true`. Never throws.
   */
  deleteProject: (id: number) => Promise<boolean>
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Centralised list fetcher. Used on mount and after every mutation
   * so the UI never has to re-assemble state itself. Stamps the
   * `error` field on failure.
   */
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const rows = await listProjects()
      setProjects(rows)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load projects'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch. Refresh is stable (useCallback with []), so this
  // only runs once on mount.
  useEffect(() => {
    void refresh()
  }, [refresh])

  const createProject = useCallback(
    async (data: ProjectCreateBody): Promise<ProjectFull | null> => {
      try {
        const created = await apiCreate(data)
        await refresh()
        return created
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create project'
        setError(message)
        return null
      }
    },
    [refresh],
  )

  const updateProject = useCallback(
    async (id: number, data: ProjectUpdateBody): Promise<ProjectFull | null> => {
      try {
        const updated = await apiUpdate(id, data)
        await refresh()
        return updated
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update project'
        setError(message)
        return null
      }
    },
    [refresh],
  )

  const deleteProject = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        await apiDelete(id)
        await refresh()
        return true
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete project'
        setError(message)
        return false
      }
    },
    [refresh],
  )

  return {
    projects,
    loading,
    error,
    refresh,
    createProject,
    updateProject,
    deleteProject,
  }
}
