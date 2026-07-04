/**
 * Top-level app shell.
 *
 * Three routes:
 *  - `/`         — public landing page (marketing surface).
 *  - `/login`    — public GitHub OAuth sign-in page. Redirects
 *                  to `/builder` if the user is already authed.
 *  - `/builder`  — the 3-panel prompt → code → preview workspace.
 *                  Protected: redirects to `/login` when no
 *                  session is detected.
 *
 * Auth gates:
 *  - `<ProtectedRoute>` wraps `<Builder>` and reads `useAuth()`
 *    to decide between the three render states (loading,
 *    redirect, render).
 *  - The Login page itself calls `useAuth()` and auto-redirects
 *    to `/builder` if a session is already present, so a logged-
 *    in user who lands on `/login` is bounced straight to the
 *    workspace.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Landing } from '@/pages/Landing'
import { Login } from '@/pages/Login'
import { Builder } from '@/pages/Builder'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/builder"
          element={
            <ProtectedRoute>
              <Builder />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
