/**
 * Tests for `src/components/ProtectedRoute.tsx`.
 *
 * The component is a thin auth gate:
 *  - While `useAuth` is loading → render the centered loader.
 *  - When `useAuth` resolves to a non-null user → render children.
 *  - When `useAuth` resolves to a null user → `<Navigate to="/login" replace />`.
 *
 * We mock `useAuth` directly (rather than `getMe` / `fetch`) so each
 * test can pin the auth state without writing Response bodies.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProtectedRoute } from './ProtectedRoute'
import type { UseAuthResult } from '@/hooks/useAuth'
import type { User } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

vi.mock('@/hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAuth')>(
    '@/hooks/useAuth',
  )
  return {
    ...actual,
    useAuth: vi.fn(),
  }
})

// Imported lazily so the mock above is in place first.
import { useAuth } from '@/hooks/useAuth'

const useAuthMock = vi.mocked(useAuth)

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const SAMPLE_USER: User = {
  id: 1,
  username: 'octocat',
  avatar_url: null,
  email: null,
  lifetime_project_count: 0,
  project_limit: 2,
}

function authState(overrides: Partial<UseAuthResult>): UseAuthResult {
  return {
    user: null,
    loading: false,
    error: null,
    logout: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

afterEach(() => {
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Render the protected route inside a `MemoryRouter` that knows
 * about both `/builder` (the protected destination) and `/login`
 * (the redirect target). The route tree is:
 *
 *     /builder   → <ProtectedRoute><Secret /></ProtectedRoute>
 *     /login     → <LoginPage />
 */
function renderProtected(): void {
  render(
    <MemoryRouter initialEntries={['/builder']}>
      <Routes>
        <Route
          path="/builder"
          element={
            <ProtectedRoute>
              <div data-testid="secret-content">secret</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/login"
          element={<div data-testid="login-page">login</div>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('ProtectedRoute()', () => {
  it('test_loading_shows_loader — shows the centered loader while the auth check is in flight', () => {
    useAuthMock.mockReturnValue(authState({ loading: true, user: null }))

    renderProtected()

    // The loader's `role="status"` with aria-label "Checking your
    // session" is the canonical hook the ProtectedRoute
    // exposes to assistive tech.
    expect(
      screen.getByRole('status', { name: 'Checking your session' }),
    ).toBeInTheDocument()
    // The protected content must NOT render while loading.
    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument()
  })

  it('test_authenticated_renders_children — renders the protected children when user is non-null', () => {
    useAuthMock.mockReturnValue(
      authState({ loading: false, user: SAMPLE_USER }),
    )

    renderProtected()

    expect(screen.getByTestId('secret-content')).toBeInTheDocument()
    // The loader should be gone once the auth check resolves.
    expect(
      screen.queryByRole('status', { name: 'Checking your session' }),
    ).not.toBeInTheDocument()
  })

  it('test_unauthenticated_redirects_to_login — Navigate to /login when user is null', () => {
    useAuthMock.mockReturnValue(authState({ loading: false, user: null }))

    renderProtected()

    // The protected content does NOT render.
    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument()
    // The Login page IS in the DOM — React Router has swapped the
    // route as a side effect of the `<Navigate to="/login" replace />`.
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })
})
