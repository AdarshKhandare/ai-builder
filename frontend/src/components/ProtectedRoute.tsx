/**
 * `ProtectedRoute` — auth gate for the `/builder` route.
 *
 * Wraps any children that require an authenticated session. Uses
 * `useAuth()` to read the current user state:
 *
 *  - `loading`  → render a full-screen loader (centered spinner
 *                 + the Forge wordmark). This is shown while
 *                 `GET /api/auth/me` is in flight; the user is
 *                 NOT redirected to `/login` until we know for
 *                 sure that they are unauthenticated.
 *  - `user`     → render the protected children.
 *  - `!user`    → `<Navigate to="/login" replace />`.
 *
 * The `replace` flag on the Navigate keeps the history clean —
 * the user does not have to press "back" twice to escape the
 * login flow after signing in.
 *
 * The loader is intentionally calm: a centered spinner on a
 * dark card, no flashy animation. The auth check is fast (a
 * single GET to `/api/auth/me`) so the loader is on screen for
 * tens of milliseconds in practice.
 */
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

function AuthLoader(): ReactNode {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Checking your session"
      className="
        flex min-h-dvh w-full items-center justify-center
        bg-background text-foreground
      "
    >
      <div
        className="
          flex flex-col items-center gap-3
          rounded-2xl border border-border bg-card
          px-8 py-10 shadow-sm
        "
      >
        <Loader2
          className="size-6 animate-spin text-primary"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export interface ProtectedRouteProps {
  /** The children to render when the user is authenticated. */
  children: ReactNode
}

/**
 * Wrap any auth-required route element. While the auth check
 * is in flight the user sees a calm full-screen loader; if
 * the check returns "no session" they are redirected to
 * `/login`; otherwise the protected children are rendered.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps): ReactNode {
  const { user, loading } = useAuth()

  if (loading) {
    return <AuthLoader />
  }

  if (!user) {
    // `replace` keeps the back button from trapping the user in
    // the login flow after a successful sign-in.
    return <Navigate to="/login" replace />
  }

  return children
}
