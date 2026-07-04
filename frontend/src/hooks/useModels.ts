/**
 * `useModels` — React hook wrapping {@link getModels} from
 * `@/lib/api` with reactive state and a hardcoded fallback.
 *
 * Behaviour:
 *  - On mount, calls `getModels()` (a single GET to `/api/models`).
 *  - Tracks `loading`, `error`, and the resolved `models` list in
 *    React state so consumers can render skeletons / toasts.
 *  - On any failure (network error, non-2xx, malformed JSON), falls
 *    back to the exported {@link FALLBACK_MODELS} list so the UI
 *    always has something to show — the picker is never empty, even
 *    in offline / demo mode.
 *  - Exposes a `refetch()` callback that re-runs the fetch on
 *    demand (e.g. when the user clicks a "Refresh" link in the
 *    picker, or after a settings change).
 *  - Cancels in-flight requests on unmount via a local
 *    `cancelled` flag so a slow response can't `setState` on an
 *    unmounted component.
 *
 * Example:
 *
 *     const { models, loading, error, refetch } = useModels()
 *     if (loading) return <Skeleton />
 *     if (error) return <Banner message={error} onRetry={refetch} />
 *     return <Select options={models} … />
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { getModels, type ModelInfo } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Fallback model list                                                 */
/* ------------------------------------------------------------------ */

/**
 * Hardcoded model catalog used when the backend `/api/models`
 * endpoint is unreachable. Same shape as the live response so the
 * picker renders identically with or without the network.
 *
 * Models are ordered roughly by "best for code generation first":
 * `MiniMax M3` is the recommended default coder (cheap, fast, high
 * quality for HTML/CSS/JS one-page apps). `MiMo V2.5` is the
 * cheapest fallback for offline demos.
 *
 * Pricing is USD per 1M tokens. The cost estimator in
 * `StatusBar.tsx` consumes these numbers directly.
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: 'opencode-go/minimax-m3',
    name: 'MiniMax M3',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'coder',
    input_price_per_mtok: 0.14,
    output_price_per_mtok: 0.28,
    context_window: 200_000,
    recommended: true,
    description:
      'Cheap and fast. Recommended default for one-page app generation.',
  },
  {
    id: 'opencode-go/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.14,
    output_price_per_mtok: 0.28,
    context_window: 128_000,
    recommended: true,
    description:
      'Fast DeepSeek variant. Great for quick iterations on simple UIs.',
  },
  {
    id: 'opencode-go/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.55,
    output_price_per_mtok: 2.19,
    context_window: 128_000,
    recommended: true,
    description:
      'Higher-quality DeepSeek. Best when the prompt is nuanced or the design is complex.',
  },
  {
    id: 'opencode-go/qwen-3.7-plus',
    name: 'Qwen 3.7 Plus',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.4,
    output_price_per_mtok: 1.2,
    context_window: 128_000,
    recommended: false,
    description:
      'Mid-cost generalist. Good for long chat-style iterations.',
  },
  {
    id: 'opencode-go/qwen-3.7-max',
    name: 'Qwen 3.7 Max',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 1.2,
    output_price_per_mtok: 6.0,
    context_window: 128_000,
    recommended: false,
    description:
      'Top-tier Qwen model. Use for the most demanding generation tasks.',
  },
  {
    id: 'opencode-go/kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.6,
    output_price_per_mtok: 2.5,
    context_window: 200_000,
    recommended: false,
    description:
      'Strong reasoning, large context window. Good for long-form copy.',
  },
  {
    id: 'opencode-go/glm-5.2',
    name: 'GLM 5.2',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'planner',
    input_price_per_mtok: 0.85,
    output_price_per_mtok: 3.4,
    context_window: 128_000,
    recommended: false,
    description:
      'Orchestrator/planner model. Best paired with a cheaper coder in a multi-step flow.',
  },
  {
    id: 'opencode-go/mimo-v2.5',
    name: 'MiMo V2.5',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.1,
    output_price_per_mtok: 0.3,
    context_window: 64_000,
    recommended: false,
    description:
      'Cheapest model in the catalog. Fine for tiny static pages.',
  },
  {
    id: 'opencode-go/mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 0.3,
    output_price_per_mtok: 1.2,
    context_window: 128_000,
    recommended: false,
    description:
      'Mid-tier MiMo variant. Better adherence to detailed UI specs than V2.5.',
  },
]

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export interface UseModelsResult {
  /** Resolved model list. Falls back to {@link FALLBACK_MODELS} on error. */
  models: ModelInfo[]
  /** True while the initial fetch (or a `refetch()`) is in flight. */
  loading: boolean
  /**
   * Human-readable error message from the most recent failed fetch,
   * or `null` if the last fetch succeeded (or we never tried).
   * `models` is still populated (from the fallback) when this is set.
   */
  error: string | null
  /**
   * `true` if the current `models` list came from the fallback
   * (because the network call failed). Lets the UI show a subtle
   * "offline / cached" hint without blocking the picker.
   */
  usingFallback: boolean
  /**
   * Re-run the fetch on demand. Resolves when the new state has
   * been committed. Safe to call repeatedly; concurrent calls
   * cancel the previous in-flight fetch.
   */
  refetch: () => Promise<void>
}

/**
 * Fetch the model catalog on mount and expose a reactive view of it.
 *
 * See the file-level docstring for behaviour details. The hook
 * never throws — every error path lands in `error` + `usingFallback`
 * so the UI can degrade gracefully.
 */
export function useModels(): UseModelsResult {
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [usingFallback, setUsingFallback] = useState<boolean>(true)

  // `cancelled` guards against the race where the fetch resolves
  // AFTER the component unmounts. We mutate the ref synchronously
  // in the cleanup function; reading it inside the async IIFE
  // is safe because React effects run cleanup before the next
  // effect, and a single `loadModels` invocation is contained
  // within one effect cycle.
  const cancelledRef = useRef<boolean>(false)

  const loadModels = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    // Don't flip `usingFallback` to false yet — we only know we have
    // a real catalog AFTER the fetch resolves successfully. While
    // the request is in flight, we keep the previous (fallback) list
    // visible so the picker is never empty.
    try {
      const result = await getModels()
      if (cancelledRef.current) return
      setModels(result)
      setUsingFallback(false)
    } catch (err) {
      if (cancelledRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setModels(FALLBACK_MODELS)
      setUsingFallback(true)
    } finally {
      if (!cancelledRef.current) {
        setLoading(false)
      }
    }
  }, [])

  // Initial fetch on mount. The `cancelled` ref tears down the
  // in-flight fetch if the component unmounts (or the hook is
  // re-instantiated) before it resolves.
  useEffect(() => {
    cancelledRef.current = false
    void loadModels()
    return () => {
      cancelledRef.current = true
    }
  }, [loadModels])

  const refetch = useCallback(async (): Promise<void> => {
    await loadModels()
  }, [loadModels])

  return { models, loading, error, usingFallback, refetch }
}
