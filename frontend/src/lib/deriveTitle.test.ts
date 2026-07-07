/**
 * Tests for `src/lib/deriveTitle.ts`.
 *
 * `deriveTitleFromPrompt` produces a short, sensible project title
 * from a freeform prompt. The backend uses the same algorithm;
 * these tests pin the frontend copy so a refactor doesn't drift
 * out of sync.
 */
import { describe, expect, it } from 'vitest'
import { deriveTitleFromPrompt } from './deriveTitle'

describe('deriveTitleFromPrompt()', () => {
  it('test_strips_filler_words — drops build/create/make/a/an/app from the front', () => {
    expect(deriveTitleFromPrompt('Build a coffee shop landing page')).toBe(
      'Coffee Shop Landing Page',
    )
    // "app" is in the filler list (per spec) — only "Todo" survives.
    expect(deriveTitleFromPrompt('Create a todo app')).toBe('Todo')
    expect(deriveTitleFromPrompt('Make me an app')).toBeNull() // All words are filler
  })

  it('test_title_cases — capitalises the first letter of each kept word', () => {
    expect(deriveTitleFromPrompt('todo list with local storage')).toBe(
      'Todo List Local Storage',
    )
    expect(deriveTitleFromPrompt('Landing page for a small coffee shop')).toBe(
      'Landing Page Small Coffee Shop',
    )
  })

  it('test_preserves_acronyms — all-uppercase words pass through unchanged', () => {
    // `API` is all uppercase — must NOT become `Api`.
    expect(deriveTitleFromPrompt('build a REST API for todos')).toBe(
      'REST API Todos',
    )
  })

  it('test_caps_at_target_word_count — only the first N meaningful words are kept', () => {
    // The helper keeps TARGET_WORD_COUNT (5) words. The remaining
    // words are dropped without breaking the title.
    expect(
      deriveTitleFromPrompt('a coffee shop landing page with menu and hours'),
    ).toBe('Coffee Shop Landing Page Menu')
  })

  it('test_caps_at_max_length — long titles are truncated on a word boundary', () => {
    // The result must be <= 60 chars and not end with a partial
    // word or trailing punctuation.
    const long = 'a very very very very long title that should be capped at the configured maximum length for the output of this helper function'
    const out = deriveTitleFromPrompt(long)
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThanOrEqual(60)
    expect(out).not.toMatch(/[,;:.!?\-]$/)
  })

  it('test_returns_null_for_empty_input — empty / whitespace-only prompts return null', () => {
    expect(deriveTitleFromPrompt('')).toBeNull()
    expect(deriveTitleFromPrompt('   ')).toBeNull()
    expect(deriveTitleFromPrompt('\n\t')).toBeNull()
  })

  it('test_returns_null_when_all_filler — prompts that are only filler words return null', () => {
    expect(deriveTitleFromPrompt('build create make')).toBeNull()
    expect(deriveTitleFromPrompt('an app application that which')).toBeNull()
  })

  it('test_strips_punctuation — leading/trailing punctuation on tokens is removed', () => {
    // Note: the test does NOT use filler words here so the
    // punctuation-stripping is visible in the output.
    expect(deriveTitleFromPrompt('"todo, list!"')).toBe('Todo List')
  })

  it('test_handles_single_word — a single meaningful word is title-cased and returned', () => {
    expect(deriveTitleFromPrompt('portfolio')).toBe('Portfolio')
    expect(deriveTitleFromPrompt('PORTFOLIO')).toBe('PORTFOLIO')
  })
})
