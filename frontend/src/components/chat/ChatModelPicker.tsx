/**
 * ChatModelPicker — a compact, in-line model selector that lives
 * next to the chat input.
 *
 * Mirrors the TopBar model picker in functionality (both bind to the
 * same `selectedModel` + `onModelChange` props in the Builder), but
 * the trigger is intentionally small and tier-coded so the user can
 * see at a glance which model is selected without leaving the chat
 * surface.
 *
 * Why a SECOND picker?  When the user is mid-iteration (code is on
 * screen, no streaming in flight) the TopBar gets crowded with the
 * history / new / download buttons. The chat-side picker is the
 * primary way to switch models in that context — it's always
 * reachable, always next to the input the user is typing into.
 *
 * Tier dot color rules (matched to the design system):
 *   - output_price_per_mtok <  0.5 USD  → `bg-success`     (very-cheap, green)
 *   - output_price_per_mtok <  1.5 USD  → `bg-warning`     (medium, yellow)
 *   - otherwise                         → `bg-destructive` (upper-medium, orange/red)
 *
 * 2026-07-04 (Builder UX pass) — added alongside the TopBar picker.
 */
import { ChevronDown, Sparkles } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ModelInfo } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface ChatModelPickerProps {
  models: ModelInfo[]
  selectedModel: string
  onModelChange: (model: string) => void
  /** Disabled while a stream is in flight. */
  isStreaming: boolean
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Strip a `provider/` prefix from a model ID for human display. */
function displayName(model: ModelInfo | undefined): string {
  if (!model) return 'Select model'
  if (model.name) return model.name
  const slashIndex = model.id.indexOf('/')
  return slashIndex >= 0 ? model.id.slice(slashIndex + 1) : model.id
}

/** Stable display order — recommended first, then alphabetical. */
function sortModels(models: ReadonlyArray<ModelInfo>): ModelInfo[] {
  return [...models].sort((a, b) => {
    if (a.recommended !== b.recommended) {
      return a.recommended ? -1 : 1
    }
    return displayName(a).localeCompare(displayName(b))
  })
}

/**
 * Map a model's output price to a tier string used for the dot color.
 * Centralised so the dot color and any future label copy stay in sync.
 */
export type ModelTier = 'very-cheap' | 'medium' | 'upper-medium'

export function tierFor(model: ModelInfo | undefined): ModelTier {
  if (!model) return 'very-cheap'
  if (model.output_price_per_mtok < 0.5) return 'very-cheap'
  if (model.output_price_per_mtok < 1.5) return 'medium'
  return 'upper-medium'
}

/** Tailwind classes for the tier dot. Kept here so colour tuning is
 *  a one-line change. */
const TIER_DOT_CLASSES: Record<ModelTier, string> = {
  'very-cheap': 'bg-success',
  medium: 'bg-warning',
  'upper-medium': 'bg-destructive',
}

/** Human label for screen readers + tooltips on the dot. */
const TIER_LABELS: Record<ModelTier, string> = {
  'very-cheap': 'Very cheap',
  medium: 'Mid price',
  'upper-medium': 'Upper-mid price',
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

interface TierDotProps {
  tier: ModelTier
  /** Class for the outer wrapper. Used to hide the dot on mobile. */
  className?: string
}

/**
 * The small coloured dot indicating the model's price tier. Rendered
 * with a `aria-hidden` role on mobile (where we hide it for space)
 * and an explanatory `aria-label` on larger viewports so screen
 * readers can announce the tier.
 */
function TierDot({ tier, className }: TierDotProps) {
  return (
    <span
      role="img"
      aria-label={TIER_LABELS[tier]}
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        TIER_DOT_CLASSES[tier],
        className,
      )}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function ChatModelPicker({
  models,
  selectedModel,
  onModelChange,
  isStreaming,
}: ChatModelPickerProps) {
  const sorted = sortModels(models)
  const current = models.find((m) => m.id === selectedModel)
  const recommended = sorted.filter((m) => m.recommended)
  const rest = sorted.filter((m) => !m.recommended)

  return (
    <Select
      value={selectedModel}
      onValueChange={onModelChange}
      disabled={isStreaming}
    >
      <SelectTrigger
        size="sm"
        aria-label="Select model"
        className={cn(
          'h-8 max-w-[160px] gap-1.5',
          'border-border bg-secondary text-secondary-foreground',
          'hover:bg-secondary/80',
          'sm:max-w-[180px]',
        )}
      >
        {/* Leading tier dot — hidden on narrow viewports to save space.
            The model's display name alone is enough on mobile. */}
        <TierDot tier={tierFor(current)} className="hidden sm:inline-block" />
        <SelectValue placeholder="Model">
          <span className="truncate font-medium text-xs">
            {displayName(current)}
          </span>
        </SelectValue>
        <ChevronDown className="size-3.5 opacity-50" aria-hidden="true" />
      </SelectTrigger>

      <SelectContent align="start" className="min-w-[240px]">
        {recommended.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recommended
            </SelectLabel>
            {recommended.map((model) => (
              <ChatModelItem
                key={model.id}
                model={model}
                tier={tierFor(model)}
              />
            ))}
          </SelectGroup>
        )}
        {recommended.length > 0 && rest.length > 0 && <SelectSeparator />}
        {rest.length > 0 && (
          <SelectGroup>
            {recommended.length > 0 ? (
              <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                All models
              </SelectLabel>
            ) : null}
            {rest.map((model) => (
              <ChatModelItem
                key={model.id}
                model={model}
                tier={tierFor(model)}
              />
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

/* ------------------------------------------------------------------ */
/* Item                                                                */
/* ------------------------------------------------------------------ */

interface ChatModelItemProps {
  model: ModelInfo
  tier: ModelTier
}

function ChatModelItem({ model, tier }: ChatModelItemProps) {
  return (
    <SelectItem
      value={model.id}
      className={cn(
        'items-start py-2',
        model.recommended && 'data-[state=checked]:font-semibold',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <TierDot tier={tier} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            {model.recommended ? (
              <Sparkles
                className="size-3 shrink-0 text-primary"
                aria-label="Recommended"
              />
            ) : null}
            <span className="truncate font-medium">{displayName(model)}</span>
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {TIER_LABELS[tier]} · {model.provider}
          </span>
        </span>
      </span>
    </SelectItem>
  )
}
