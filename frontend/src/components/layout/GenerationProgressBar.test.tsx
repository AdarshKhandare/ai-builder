/**
 * Tests for `src/components/layout/GenerationProgressBar.tsx`.
 *
 * The progress bar is a 2px-tall, fixed-position wrapper with a
 * `role="progressbar"` outer div and a framer-motion `motion.div`
 * inside that animates its width while a generation is in flight.
 * When `isStreaming` is `false` (and we're past the brief
 * `completing` phase) the inner bar is unmounted by AnimatePresence.
 * When `isStreaming` is `true` the inner bar is mounted and animating.
 *
 * 2026-07-04 (Builder UX pass) — the wrapper is now a real
 * progressbar role (was previously `aria-hidden`). Screen readers
 * can announce "Generation progress, 90 percent" while a stream is
 * in flight. The chat status text is still the primary feedback
 * surface; the role is a progressive enhancement for AT users.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GenerationProgressBar } from './GenerationProgressBar'

/**
 * The animated inner block carries `bg-primary` (or `bg-destructive`
 * when `hasError=true`). We assert on the presence of either class
 * to detect whether the inner bar is mounted.
 */
function innerBarMounted(container: HTMLElement): boolean {
  const wrapper = container.firstElementChild
  if (!wrapper) return false
  return (
    wrapper.querySelector('.bg-primary') !== null ||
    wrapper.querySelector('.bg-destructive') !== null
  )
}

describe('GenerationProgressBar()', () => {
  it('test_hidden_when_not_streaming — no inner bar element when isStreaming=false', () => {
    const { container } = render(<GenerationProgressBar isStreaming={false} />)

    expect(innerBarMounted(container)).toBe(false)
  })

  it('test_visible_when_streaming — the inner bar element is mounted when isStreaming=true', () => {
    const { container } = render(<GenerationProgressBar isStreaming={true} />)

    expect(innerBarMounted(container)).toBe(true)
  })

  it('test_exposes_progressbar_role — the outer wrapper has role="progressbar" and an aria-label', () => {
    // The bar communicates progress to assistive tech via
    // `role="progressbar"` + `aria-valuemin/max` + `aria-label`.
    // The chat's status text is the primary feedback surface, but
    // screen readers should still be able to announce the bar.
    const { container } = render(<GenerationProgressBar isStreaming={true} />)

    const wrapper = container.firstElementChild
    expect(wrapper).not.toBeNull()
    expect(wrapper?.getAttribute('role')).toBe('progressbar')
    expect(wrapper?.getAttribute('aria-label')).toBe('Generation progress')
    expect(wrapper?.getAttribute('aria-valuemin')).toBe('0')
    expect(wrapper?.getAttribute('aria-valuemax')).toBe('100')
  })

  it('test_error_uses_destructive_color — hasError=true renders the destructive-colored bar', () => {
    const { container } = render(
      <GenerationProgressBar isStreaming={true} hasError={true} />,
    )

    // The bar element should carry `bg-destructive` when an error
    // is in flight. (During the `active` phase the wrapper has the
    // class but the inner bar is what gets the colour.)
    expect(container.querySelector('.bg-destructive')).not.toBeNull()
  })
})
