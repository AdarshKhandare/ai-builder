/**
 * Derive a short, sensible project title from a user's prompt.
 *
 * The backend derives a name the same way (defense-in-depth: if the
 * backend's title ever arrives empty, the frontend still has a
 * reasonable name to save). The algorithm:
 *
 *  1. If the prompt is empty/whitespace, return `null` so the caller
 *     can fall back to "Untitled".
 *  2. Split on whitespace and strip out a small set of filler words
 *     (`build`, `create`, `make`, `a`, `an`, `app`, `application`,
 *     `that`, `which`, `for`, `of`, `the`).
 *  3. Take the first 4-6 meaningful words.
 *  4. Title-case the result.
 *  5. Cap the length at `MAX_TITLE_LENGTH` characters, breaking on a
 *     word boundary when possible.
 *  6. Trim trailing punctuation/whitespace.
 *
 * Returns `null` when nothing meaningful remains (so the caller can
 * pick its own fallback, e.g. "Untitled").
 *
 * Examples:
 *
 *     deriveTitle("Build a coffee shop landing page")
 *     // => "Coffee Shop Landing Page"
 *
 *     deriveTitle("make me a todo app that uses local storage")
 *     // => "Todo App Uses Local Storage"
 *
 *     deriveTitle("   ")
 *     // => null
 */
const FILLER_WORDS = new Set([
  "build",
  "create",
  "make",
  "a",
  "an",
  "app",
  "application",
  "that",
  "which",
  "for",
  "of",
  "the",
  "to",
  "with",
  "me",
  "my",
  "i",
  "want",
  "need",
  "please",
])

/** Target number of meaningful words to keep from the prompt. */
const TARGET_WORD_COUNT = 5

/** Hard cap on the output title length. */
const MAX_TITLE_LENGTH = 60

/**
 * Title-case a single word. Keeps all-uppercase acronyms (e.g. "API")
 * recognisable by only lowercasing words that are all-lowercase or
 * mixed-case; all-uppercase words pass through untouched.
 */
function titleCaseWord(word: string): string {
  if (word.length === 0) return word
  if (word === word.toUpperCase()) return word
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Derive a project title from a freeform prompt. Returns `null` when
 * no meaningful words can be extracted.
 */
export function deriveTitleFromPrompt(prompt: string): string | null {
  const tokens = prompt
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((token) => token.length > 0)
    .filter((token) => !FILLER_WORDS.has(token.toLowerCase()))

  if (tokens.length === 0) return null

  const kept = tokens.slice(0, TARGET_WORD_COUNT)
  let title = kept.map(titleCaseWord).join(" ")

  if (title.length > MAX_TITLE_LENGTH) {
    // Try to break on a word boundary at or before the cap.
    const sliced = title.slice(0, MAX_TITLE_LENGTH)
    const lastSpace = sliced.lastIndexOf(" ")
    title = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced
  }

  // Strip trailing punctuation/whitespace introduced by slicing.
  return title.replace(/[\s,;:.!?-]+$/, "").trim() || null
}
