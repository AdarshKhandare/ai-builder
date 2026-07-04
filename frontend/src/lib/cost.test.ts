/**
 * Tests for `src/lib/cost.ts`.
 *
 * `estimateTokens` and `estimateCostUsd` are pure functions that
 * drive the StatusBar's cost display. We pin:
 *   - the per-4-char token heuristic
 *   - the +2000 system-prompt overhead
 *   - the per-MTok formula
 *   - the null-return for missing model / NaN / negative values
 */
import { describe, expect, it } from 'vitest'

import {
  CHARS_PER_TOKEN,
  SYSTEM_PROMPT_OVERHEAD_TOKENS,
  estimateCostUsd,
  estimateTokens,
} from './cost'
import type { ModelInfo } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const BASE_MODEL: ModelInfo = {
  id: 'opencode-go/test-model',
  name: 'Test Model',
  provider: 'opencode-go',
  endpoint: 'openai',
  role: 'coder',
  input_price_per_mtok: 0.14,
  output_price_per_mtok: 0.28,
  context_window: 200_000,
  recommended: false,
  description: 'test',
}

/* ------------------------------------------------------------------ */
/* estimateTokens                                                      */
/* ------------------------------------------------------------------ */

describe('estimateTokens()', () => {
  it('test_zero_prompt_and_code — both counts round to the system overhead', () => {
    const { inputTokens, outputTokens } = estimateTokens('', '')
    expect(outputTokens).toBe(0)
    // 0 + 2000 overhead
    expect(inputTokens).toBe(SYSTEM_PROMPT_OVERHEAD_TOKENS)
  })

  it('test_token_heuristic_is_4_chars — output is chars / 4, ceiling', () => {
    // 4 chars → 1 token
    expect(estimateTokens('', 'abcd').outputTokens).toBe(1)
    // 5 chars → ceil(1.25) = 2
    expect(estimateTokens('', 'abcde').outputTokens).toBe(2)
    // 8 chars → 2
    expect(estimateTokens('', 'abcdefgh').outputTokens).toBe(2)
  })

  it('test_input_overhead_is_added — input includes the 2000 system overhead', () => {
    // 0-char prompt + 2000 = 2000
    expect(estimateTokens('', '').inputTokens).toBe(2000)
    // 40-char prompt + 2000 = 2010
    expect(estimateTokens('a'.repeat(40), '').inputTokens).toBe(2010)
    // 4000-char prompt + 2000 = 3000
    expect(estimateTokens('a'.repeat(4000), '').inputTokens).toBe(3000)
  })

  it('test_uses_chars_per_token_constant — 4 chars per token exactly', () => {
    // Sanity check that the constant is what we expect — if a
    // future edit changes CHARS_PER_TOKEN, the formula above
    // would need to change too.
    expect(CHARS_PER_TOKEN).toBe(4)
  })
})

/* ------------------------------------------------------------------ */
/* estimateCostUsd                                                     */
/* ------------------------------------------------------------------ */

describe('estimateCostUsd()', () => {
  it('test_null_model_returns_null — unknown model → no cost', () => {
    expect(estimateCostUsd('hi', '<h1>x</h1>', undefined)).toBeNull()
  })

  it('test_zero_code_zero_prompt — only the system overhead is billed', () => {
    // 2000 input tokens * $0.14 / 1_000_000 = $0.00028
    // 0 output tokens * $0.28 / 1_000_000 = $0
    const cost = estimateCostUsd('', '', BASE_MODEL)
    expect(cost).toBeCloseTo(0.00028, 6)
  })

  it('test_realistic_run — MiniMax M3 default model, 1KB code, 50-char prompt', () => {
    // 50-char prompt → 13 input tokens; +2000 = 2013
    // 1024-byte code → 256 output tokens
    // cost = (2013 * 0.14 + 256 * 0.28) / 1_000_000
    //      = (281.82 + 71.68) / 1_000_000
    //      = 0.0003535
    const code = 'x'.repeat(1024)
    const cost = estimateCostUsd('x'.repeat(50), code, BASE_MODEL)
    expect(cost).toBeCloseTo(0.0003535, 7)
  })

  it('test_larger_code_scales_linearly — doubling the code doubles the output cost', () => {
    const cost1 = estimateCostUsd('hello', 'a'.repeat(1000), BASE_MODEL)
    const cost2 = estimateCostUsd('hello', 'a'.repeat(2000), BASE_MODEL)
    // The output cost doubles, input cost is identical. So the
    // delta is the *additional* output cost.
    const outputCost1 = (250 * BASE_MODEL.output_price_per_mtok) / 1_000_000
    const outputCost2 = (500 * BASE_MODEL.output_price_per_mtok) / 1_000_000
    expect(cost2! - cost1!).toBeCloseTo(outputCost2 - outputCost1, 7)
  })

  it('test_uses_model_pricing — different prices give different costs', () => {
    // 4 KB of code → 1024 output tokens. The 10x output price
    // difference should at least double the total cost (output
    // cost dominates the small fixed input cost here).
    const cheap: ModelInfo = { ...BASE_MODEL, output_price_per_mtok: 0.1 }
    const pricey: ModelInfo = { ...BASE_MODEL, output_price_per_mtok: 1.0 }
    const cost1 = estimateCostUsd('hi', 'a'.repeat(4000), cheap)
    const cost2 = estimateCostUsd('hi', 'a'.repeat(4000), pricey)
    // Output-only cost diff: 1024 * 1.0/1M - 1024 * 0.1/1M = 0.0009216
    // Total diff is at least 2x the cheap total because output cost
    // is the dominant term for 4 KB of code.
    expect(cost2!).toBeGreaterThan(cost1! * 2)
  })

  it('test_negative_pricing_returns_null — defends against bad model data', () => {
    // Hypothetical future bug: the backend sends a negative price
    // for some reason. We refuse to render that as a cost.
    const broken: ModelInfo = { ...BASE_MODEL, input_price_per_mtok: -1 }
    expect(estimateCostUsd('hi', 'x', broken)).toBeNull()
  })
})
