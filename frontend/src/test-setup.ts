/**
 * Vitest setup file.
 *
 * Pulls in `@testing-library/jest-dom` for the `toBeInTheDocument` etc.
 * matchers used in component tests, and stubs a few browser globals that
 * jsdom doesn't ship with but React 19 / framer-motion /
 * `react-resizable-panels` reach for.
 */
import '@testing-library/jest-dom/vitest'

// React 19 calls `IS_REACT_ACT_ENVIRONMENT = true` internally in test
// runners, but the act warnings still leak without this. Set it before
// the first render.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom does not implement matchMedia; PanelLayout's `useMediaQuery`
// short-circuits on the typeof check, so this is just defensive.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

// jsdom does not implement `ResizeObserver`. `react-resizable-panels`
// constructs one in its `mountGroup` useLayoutEffect, so we provide a
// minimal stub. The stub never fires callbacks — that's fine for
// structural tests, which only check that the layout shell mounts and
// that the right DOM nodes are present after a render.
if (typeof window !== 'undefined' && typeof window.ResizeObserver !== 'function') {
  class ResizeObserverStub {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  // Assign through `unknown` because the test polyfill intentionally
  // provides a no-arg constructor (the lib's mountGroup passes a
  // callback, but the test never fires it).
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver =
    ResizeObserverStub
}
