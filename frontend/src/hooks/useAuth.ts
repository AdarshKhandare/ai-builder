/**
 * `useAuth` — React hook for the current authenticated user.
 *
 * Behaviour:
 *  - On mount, calls `GET /api/auth/me` once. The 401 path is
 *    translated to `user = null` so callers don't have to
 *    try/catch the canonical "not signed in" response.
 *  - Exposes `user`, `loading`, and `error` for rendering the
 *    three states of the auth surface (loading spinner,
 *    authenticated content, or login redirect).
 *  - Exposes `logout()` which calls `POST /api/auth/logout`,
 *    clears local state, and redirects the browser to `/`.
 *  - Fetches exactly once per mount. Re-renders do not refetch.
 *    This is intentional — the auth surface (TopBar avatar,
 *    ProtectedRoute) only needs to know the current state.
 *  - Cancels in-flight requests on unmount via a `cancelled` ref
 *    so a slow response can't `setState` on an unmounted
 *    component.
 *
 * The hook is read-only: a successful `GET /api/auth/me` does
 * NOT auto-redirect anywhere. `ProtectedRoute` and the Login
 * page own the routing side (redirecting to `/builder` after
 * sign-in, etc.). This keeps `useAuth` simple and decoupled
 * from `react-router-dom` so the hook is easy to unit-test.
 *
 * Example:
 *
 *     const { user, loading, logout } = useAuth()
 *     if (loading) return <Spinner />
 *     if (!user) return <Navigate to="/login" />
 *     return <Avatar src={user.avatar_url} onLogout={logout} />
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { getMe, logout as apiLogout, type User } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Hook result                                                         */
/* ------------------------------------------------------------------ */

export interface UseAuthResult {
  /**
   * The currently-authenticated user, or `null` if not signed in
   * (or while loading). When the server returns 401 from
   * `GET /api/auth/me`, the hook treats that as a successful
   * "no session" answer — `user` is `null` and `error` stays
   * `null`. Only true errors (network failures, 5xx, malformed
   * JSON) populate `error`.
   *
   * The `User` payload also carries abuse-prevention counters
   * (`lifetime_project_count`, `project_limit`) that the
   * Builder uses to disable the "Generate" button when the
   * user is at the project cap.
   */
  user: User | null
  /** True while the initial `GET /api/auth/me` is in flight. */
  loading: boolean
  /**
   * Human-readable error message from the most recent failed
   * fetch, or `null`. `user` may still be `null` when this is
   * set — the hook never falls back to a "ghost" user.
   */
  error: string | null
  /**
   * Clear the server-side session, then navigate to the landing
   * page. Uses `window.location.assign('/')` for a full page
   * reload so the entire app re-mounts in a clean state (the
   * builder, history cache, etc. are discarded).
   *
   * Resolves when both the API call and the navigation have
   * been initiated. Re-throws if the API call fails so the
   * caller can surface a toast.
   */
  logout: () => Promise<void>
  /**
   * Re-run the `GET /api/auth/me` fetch on demand. Useful when
   * the user signs in via a separate flow (e.g. the Login page
   * returning from the GitHub OAuth redirect) and the rest of
   * the app needs to re-render against the new auth state.
   *
   * Concurrent calls cancel the previous in-flight fetch via
   * the `cancelled` ref — only the latest call's result is
   * committed.
   */
  refetch: () => Promise<void>
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // `cancelled` guards against the race where the fetch resolves
  // AFTER the component unmounts. Mirrors the pattern in
  // `useModels.ts` so the two hooks share a consistent shape.
  const cancelledRef = useRef<boolean>(false)

  const loadMe = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await getMe()
      if (cancelledRef.current) return
      setUser(result)
    } catch (err) {
      if (cancelledRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setUser(null)
    } finally {
      if (!cancelledRef.current) {
        setLoading(false)
      }
    }
  }, [])

  // Initial fetch on mount. The cleanup marks the ref so a late
  // resolution can't `setState` on an unmounted component.
  useEffect(() => {
    cancelledRef.current = false
    void loadMe()
    return () => {
      cancelledRef.current = true
    }
  }, [loadMe])

  const refetch = useCallback(async (): Promise<void> => {
    await loadMe()
  }, [loadMe])

  const logout = useCallback(async (): Promise<void> => {
    await apiLogout()
    // Clear local state immediately so any UI bound to `user`
    // re-renders before the navigation completes. The full-page
    // reload below discards the rest of the React tree anyway.
    setUser(null)
    setError(null)
    // Full-page reload so the builder + history cache are
    // cleared. A SPA navigate would leave the Builder mounted
    // with stale state until the next refresh.
    if (typeof window !== 'undefined') {
      window.location.assign('/')
    }
  }, [])

  return { user, loading, error, logout, refetch }
}
