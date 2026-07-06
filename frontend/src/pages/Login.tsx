/**
 * Login page.
 *
 * A single, focused sign-in screen for the GitHub OAuth flow.
 *
 *  - Centered card on a light, full-bleed background.
 *  - Forge wordmark + logo at the top of the card.
 *  - Geist Sans display headline ("Sign in to Forge") + a
 *    one-line explanation of *why* GitHub.
 *  - A single "Sign in with GitHub" CTA. Clicking it performs
 *    `window.location.href = '/api/auth/login'` — a full-page
 *    browser navigation to the backend, which 302s to GitHub.
 *  - A small "Why GitHub?" note and a "back to home" link.
 *  - If the user is ALREADY signed in (per `useAuth()`) the
 *    page redirects to `/builder` on mount. The auth check
 *    shows the same calm loader as `ProtectedRoute` for
 *    consistency.
 *
 * Design notes (per the dark theme spec):
 *  - Uses semantic tokens only (`bg-card`, `text-foreground`,
 *    `border-border`, `bg-primary`, `text-primary-foreground`).
 *  - The GitHub button uses the brand's dark-on-dark
 *    treatment: a near-black surface in front of the refined
 *    blue primary accent would clash, so we use the existing
 *    primary button style and lean on the GitHub icon to
 *    communicate the provider.
 *  - framer-motion drives a single `fadeInUp` entrance for
 *    the whole card — GSAP is reserved for the landing page
 *    scroll reveals.
 */
import { useEffect, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Hammer, Loader2 } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'

/**
 * GitHub Octocat mark — inline SVG so the Login screen does not
 * depend on a brand-specific icon package. Lucide removed all
 * brand icons (Slack, GitHub, etc.) in 2024; rendering the mark
 * ourselves keeps the asset portable and version-agnostic.
 *
 * Sized via the parent `size-*` utility class.
 */
function GitHubIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
      />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * Backend endpoint that initiates the GitHub OAuth flow.
 *
 * The backend's `GET /api/auth/login` returns a 302 to GitHub's
 * `/login/oauth/authorize` URL. Because this is a full-page
 * browser navigation (not a SPA route) we assign to
 * `window.location.href` directly — using `<a>` would also
 * work, but we want the click to feel native and bypass any
 * same-tab anchor handling.
 */
const AUTH_LOGIN_URL = '/api/auth/login'

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

/**
 * The centered loader shown while `useAuth` resolves the
 * current session. Mirrors `ProtectedRoute`'s loader for
 * consistency between the two auth gates.
 */
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
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Login(): ReactNode {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion() ?? false

  /*
   * If the user is already signed in, bounce straight to the
   * builder. This makes the Login page safe to bookmark as
   * "/login" — anyone who lands there while authenticated
   * never sees the sign-in form.
   */
  useEffect(() => {
    if (!loading && user) {
      navigate('/builder', { replace: true })
    }
  }, [loading, user, navigate])

  if (loading) {
    return <AuthLoader />
  }

  // Defensive: the `useEffect` above may not have flushed yet
  // in the same render. Mirror the redirect here so the form
  // never briefly flashes for an already-authenticated user.
  if (user) {
    return <Navigate to="/builder" replace />
  }

  const handleGitHubSignIn = (): void => {
    // Full-page navigation. We deliberately do NOT use
    // `navigate(AUTH_LOGIN_URL)` — the backend issues a 302 to
    // an external domain (github.com), and a SPA-style client-
    // side navigation would either fail to follow the redirect
    // or replace history with a 404.
    window.location.href = AUTH_LOGIN_URL
  }

  return (
    <div
      className="
        relative isolate flex min-h-dvh w-full items-center
        justify-center overflow-hidden
        bg-background text-foreground
      "
    >
      {/* Subtle radial wash behind the card — same anchor as the
        * landing-page hero so the two surfaces feel related. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 50% at 50% 40%, color-mix(in oklch, var(--primary) 6%, transparent), transparent 70%)",
        }}
      />

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="
          mx-4 w-full max-w-md
          rounded-2xl border border-border bg-card
          p-8 shadow-sm sm:p-10
        "
      >
        {/* Logo + wordmark */}
        <Link
          to="/"
          aria-label="Forge — back to landing page"
          className="
            group inline-flex items-center gap-2
            rounded-md outline-none
            focus-visible:ring-2 focus-visible:ring-ring
            focus-visible:ring-offset-2 focus-visible:ring-offset-card
          "
        >
          <span
            aria-hidden="true"
            className="
              flex size-8 items-center justify-center
              rounded-md bg-accent text-accent-foreground
              transition-colors group-hover:bg-primary/15
            "
          >
            <Hammer className="size-4 text-primary" />
          </span>
          <span className="font-body text-base font-semibold tracking-tight text-foreground transition-opacity group-hover:opacity-80">
            Forge
          </span>
        </Link>

        {/* Headline */}
        <h1
          className="
            mt-8 font-display text-3xl font-bold leading-tight
            tracking-tight text-foreground sm:text-4xl
          "
        >
          Sign in to Forge
        </h1>

        {/* Subtext */}
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Sign in with GitHub to start building. Your projects are
          saved to your account.
        </p>

        {/* GitHub sign-in CTA */}
        <button
          type="button"
          onClick={handleGitHubSignIn}
          className="
            mt-8 inline-flex w-full items-center justify-center
            gap-2 rounded-md bg-primary px-6 py-3 text-base
            font-semibold text-primary-foreground
            shadow-sm transition-all
            hover:bg-primary/90
            focus-visible:ring-2 focus-visible:ring-ring
            focus-visible:ring-offset-2 focus-visible:ring-offset-card
            disabled:pointer-events-none disabled:opacity-50
          "
        >
          <GitHubIcon className="size-5" />
          Sign in with GitHub
        </button>

        {/* Why GitHub? */}
        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why GitHub?</span>{' '}
          It's how we verify you're real and save your projects. No
          spam, no data selling.
        </p>

        {/* Back to home */}
        <div className="mt-8 border-t border-border-subtle pt-6">
          <Link
            to="/"
            className="
              inline-flex items-center gap-1.5
              text-sm text-muted-foreground
              transition-colors hover:text-foreground
              focus-visible:rounded-sm focus-visible:outline-none
              focus-visible:ring-2 focus-visible:ring-ring
              focus-visible:ring-offset-2 focus-visible:ring-offset-card
            "
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
