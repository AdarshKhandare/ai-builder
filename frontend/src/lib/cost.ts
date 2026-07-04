/**
 * Cost estimation for a single generation / iteration run.
 *
 * The backend doesn't currently emit token counts in the SSE stream
 * (only the streamed `code` chunks and the final `title` event), so
 * we estimate the cost locally from the `code` length, the prompt
 * length, and the model's published per-MTok pricing. The estimate
 * is intentionally rough — it's surfaced in the StatusBar as
 * `~$0.0024` (note the tilde) so the user understands it's not
 * exact.
 *
 * Heuristics (chosen to err on the side of slightly *over* counting
 * input tokens, which is the more conservative direction for cost
 * display):
 *
 *   - 1 token ≈ 4 characters of mixed HTML / JS / CSS
 *   - Output tokens ≈ `code.length / 4`
 *   - Input tokens ≈ `prompt.length / 4 + 2000` (2000 covers the
 *     system prompt, the iteration history, and the safety margin
 *     for chat-style follow-ups)
 *
 * The 2000-token overhead is a constant tuned to the current
 * system prompt. If the system prompt grows significantly, bump
 * this constant — it's deliberately not derived from the prompt
 * itself so the estimate stays stable as the system prompt
 * evolves.
 *
 * @see StatusBar.tsx for the rendering of the resulting value.
 */
import type { ModelInfo } from '@/lib/api'

/** Approximate characters per token. */
export const CHARS_PER_TOKEN = 4

/** Estimated system-prompt + history overhead per run, in tokens. */
export const SYSTEM_PROMPT_OVERHEAD_TOKENS = 2000

/**
 * Estimate the input + output token count for a single run. Pure
 * function — useful for unit tests and for the Builder to snapshot
 * the values when a run completes.
 */
export function estimateTokens(
  prompt: string,
  code: string,
): { inputTokens: number; outputTokens: number } {
  const outputTokens = Math.ceil(code.length / CHARS_PER_TOKEN)
  const inputTokens =
    Math.ceil(prompt.length / CHARS_PER_TOKEN) + SYSTEM_PROMPT_OVERHEAD_TOKENS
  return { inputTokens, outputTokens }
}

/**
 * Estimate the USD cost of a run given the selected model's
 * per-MTok pricing. Returns `null` when the model is not in the
 * catalog (caller renders the stats line without a cost prefix).
 */
export function estimateCostUsd(
  prompt: string,
  code: string,
  model: ModelInfo | undefined,
): number | null {
  if (!model) return null
  const { inputTokens, outputTokens } = estimateTokens(prompt, code)
  const usd =
    (inputTokens * model.input_price_per_mtok +
      outputTokens * model.output_price_per_mtok) /
    1_000_000
  // Guard against NaN / negative values from future model-shape
  // changes. A negative or NaN cost is meaningless and would
  // render as `~$-0.00` or `~$NaN`.
  if (!Number.isFinite(usd) || usd < 0) return null
  return usd
}
