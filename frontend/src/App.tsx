import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Landing } from '@/pages/Landing'
import { Builder } from '@/pages/Builder'

/**
 * Top-level app shell.
 *
 * Two routes:
 *  - `/`         — landing page (placeholder for Phase 2, full
 *                  marketing page in Phase 6).
 *  - `/builder`  — the 3-panel prompt → code → preview workspace.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/builder" element={<Builder />} />
      </Routes>
    </BrowserRouter>
  )
}
