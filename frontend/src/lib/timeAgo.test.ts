/**
 * Tests for `src/lib/timeAgo.ts`.
 *
 * Pure utility — no React, no DOM. The tricky part is that the
 * output depends on `Date.now()`, so we freeze time with
 * `vi.useFakeTimers()` and step the clock forward as needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { timeAgo } from './timeAgo'

describe('timeAgo()', () => {
  // Anchor "now" to a fixed point so all relative comparisons are
  // deterministic.
  const NOW = new Date('2026-07-03T12:00:00.000Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('test_just_now — under 60s returns "just now"', () => {
    const iso = new Date(NOW - 5_000).toISOString()
    expect(timeAgo(iso)).toBe('just now')
  })

  it('test_zero_seconds — exactly now returns "just now"', () => {
    expect(timeAgo(new Date(NOW).toISOString())).toBe('just now')
  })

  it('test_minutes — under 60 minutes shows "<n>m ago"', () => {
    const iso = new Date(NOW - 3 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('3m ago')
  })

  it('test_one_minute — boundary at 60s is "1m ago"', () => {
    const iso = new Date(NOW - 60_000).toISOString()
    expect(timeAgo(iso)).toBe('1m ago')
  })

  it('test_hours — under 24 hours shows "<n>h ago"', () => {
    const iso = new Date(NOW - 2 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('2h ago')
  })

  it('test_one_hour — boundary at 60 minutes is "1h ago"', () => {
    const iso = new Date(NOW - 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('1h ago')
  })

  it('test_days — under 7 days shows "<n>d ago"', () => {
    const iso = new Date(NOW - 2 * 24 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('2d ago')
  })

  it('test_one_day — boundary at 24h is "1d ago"', () => {
    const iso = new Date(NOW - 24 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('1d ago')
  })

  it('test_weeks — under 6 weeks shows "<n>w ago"', () => {
    const iso = new Date(NOW - 2 * 7 * 24 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('2w ago')
  })

  it('test_one_week — boundary at 7d is "1w ago"', () => {
    const iso = new Date(NOW - 7 * 24 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('1w ago')
  })

  it('test_old_date — over 6 weeks falls back to locale date', () => {
    const iso = new Date(NOW - 90 * 24 * 60 * 60_000).toISOString()
    const out = timeAgo(iso)
    // We don't pin the exact locale string (depends on the host),
    // but it should be a multi-character string that is NOT a
    // relative form.
    expect(out).toMatch(/[A-Z][a-z]{2}/)
    expect(out).not.toMatch(/ago/)
  })

  it('test_future_date — clamps to "just now" (clock skew safety)', () => {
    const iso = new Date(NOW + 5 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('just now')
  })

  it('test_invalid_string — returns "—" for non-date input', () => {
    expect(timeAgo('not-a-date')).toBe('—')
  })

  it('test_empty_string — returns "—" for empty input', () => {
    expect(timeAgo('')).toBe('—')
  })
})
