/**
 * Relative timestamp formatter for the history drawer.
 *
 * Returns short, human-friendly strings like "3m ago", "2h ago",
 * "1d ago", "5d ago", "2w ago". For dates older than ~6 weeks we
 * fall back to a localized short date ("Mar 14, 2026") so the
 * label stays compact but still informative.
 *
 * Invalid input returns the em-dash placeholder ("—") so the UI
 * never has to special-case missing/broken timestamps.
 *
 * The implementation is pure: no React, no Date side effects, and
 * no dependence on `Intl.RelativeTimeFormat` (which would buy us
 * nothing here — we need *short* forms, not "3 minutes ago").
 *
 * @example
 *   timeAgo(new Date(Date.now() - 90_000).toISOString()) // "1m ago"
 *   timeAgo("not-a-date")                                // "—"
 */
export function timeAgo(isoDate: string): string {
  if (!isoDate) return '—'

  const then = new Date(isoDate).getTime()
  if (Number.isNaN(then)) return '—'

  const diffMs = Date.now() - then
  // A future-dated input (clock skew, manual edit) clamps to "just now"
  // rather than reporting negative durations.
  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 6) return `${weeks}w ago`

  // Older than ~6 weeks: surface a compact absolute date so the
  // label doesn't keep growing. Uses en-US short month + day + year.
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
