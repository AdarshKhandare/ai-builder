/**
 * `useMediaQuery` — subscribe to a CSS media query and react to changes.
 *
 * Returns `false` during the first render (and on the server) so the
 * render stays pure, then updates on the next effect tick. The app is
 * CSR-only so the one-frame flash is acceptable. Listeners are cleaned
 * up on unmount and on query change.
 *
 * Usage:
 *
 *   const isDesktop = useMediaQuery('(min-width: 1024px)')
 *   if (isDesktop) { ... }
 */
import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(query)
    // Sync immediately on mount in case the query state changed
    // between initial render and effect.
    setMatches(mql.matches)
    const onChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches)
    }
    mql.addEventListener('change', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
    }
  }, [query])

  return matches
}
