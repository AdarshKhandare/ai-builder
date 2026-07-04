/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
//
// Vite config for the Forge frontend.
//
// Highlights:
// - `@vitejs/plugin-react` enables Fast Refresh + JSX.
// - `@tailwindcss/vite` is the Tailwind v4 first-party Vite plugin
//   (no PostCSS config required). It reads `src/index.css`.
// - `resolve.alias` matches the `@/*` path mapping in tsconfig so we
//   can `import { cn } from "@/lib/utils"`.
// - `server.proxy` forwards `/api/*` to the FastAPI backend on
//   :8000. SSE streaming works through this proxy because the
//   `changeOrigin` header rewrite keeps the `text/event-stream`
//   response unmodified.
// - `test` configures Vitest with the jsdom environment so we can
//   exercise the React components + `useSSE` hook in a real browser-
//   like runtime without touching the network. The setup file pulls
//   in `@testing-library/jest-dom` for nice DOM matchers.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    // We don't load the real Tailwind stylesheet in unit tests; components
    // are asserted on by structure / data attributes, not computed styles.
    css: false,
  },
})
