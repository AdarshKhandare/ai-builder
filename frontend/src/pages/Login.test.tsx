/**
 * Tests for `src/pages/Login.tsx`.
 *
 * Coverage:
 *  - Renders the headline, subtext, and the GitHub sign-in button.
 *  - Clicking the GitHub button calls
 *    `window.location.href = '/api/auth/login'`.
 *  - The "back to home" link points to `/`.
 *  - When `useAuth` resolves to a non-null user, the page
 *    auto-redirects to `/builder` (renders the builder content
 *    inside the test router).
 *  - While `useAuth` is loading, the centered loader is shown.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Login } from './Login'
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
/* Setup / teardown                                                    */
/* ------------------------------------------------------------------ */

afterEach(() => {
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Render the Login page inside a `MemoryRouter` that also knows
 * about `/builder` so the auto-redirect path can be observed.
 */
function renderLogin(initialPath = '/login'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/builder"
          element={<div data-testid="builder-page">builder</div>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('Login()', () => {
  it('test_renders_headline_and_cta — Sign in headline + GitHub button are in the document', () => {
    useAuthMock.mockReturnValue(authState({ loading: false, user: null }))

    renderLogin()

    expect(
      screen.getByRole('heading', { name: 'Sign in to Forge' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sign in with GitHub' }),
    ).toBeInTheDocument()
    // The "back to home" link points to the landing page.
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('test_loading_shows_loader — shows the centered loader while auth is in flight', () => {
    useAuthMock.mockReturnValue(authState({ loading: true, user: null }))

    renderLogin()

    expect(
      screen.getByRole('status', { name: 'Checking your session' }),
    ).toBeInTheDocument()
    // The sign-in form must NOT render while loading.
    expect(
      screen.queryByRole('button', { name: 'Sign in with GitHub' }),
    ).not.toBeInTheDocument()
  })

  it('test_authenticated_redirects_to_builder — already-signed-in users are bounced to /builder', () => {
    useAuthMock.mockReturnValue(
      authState({ loading: false, user: SAMPLE_USER }),
    )

    renderLogin()

    // The login form is NOT shown.
    expect(
      screen.queryByRole('button', { name: 'Sign in with GitHub' }),
    ).not.toBeInTheDocument()
    // The builder page IS in the DOM (via the Navigate redirect).
    expect(screen.getByTestId('builder-page')).toBeInTheDocument()
  })

  it('test_github_signin_sets_location_href — clicking the button navigates to /api/auth/login', () => {
    useAuthMock.mockReturnValue(authState({ loading: false, user: null }))

    // Replace window.location with a stub we can observe. jsdom
    // disallows setting `window.location.href` directly, so we
    // install a writable property descriptor and capture the
    // assignment.
    let capturedHref: string | null = null
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        // Use a property accessor so we can observe writes.
        get href(): string {
          return capturedHref ?? 'http://localhost/'
        },
        set href(value: string) {
          capturedHref = value
        },
      } as unknown as Location,
    })

    renderLogin()
    screen.getByRole('button', { name: 'Sign in with GitHub' }).click()

    expect(capturedHref).toBe('/api/auth/login')

    // Restore the original `window.location` so the rest of the
    // test suite isn't affected.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
  })
})
