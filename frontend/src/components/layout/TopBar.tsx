/**
 * TopBar — the sticky 48px header for the builder page.
 *
 * Spec (`docs/UI_REDESIGN_SPEC.md` §7.2 — "Calm Precision"):
 *  - Left:   indigo hammer icon (light indigo circle) + "Forge"
 *            wordmark in Geist (clean body font, not display).
 *  - Center: project name. Empty / pre-generation → "Untitled";
 *            once a `title` SSE event arrives the value fades in
 *            in place.
 *  - Right:  model picker (shadcn Select) + History button +
 *            "New" outline button + Download outline button.
 *
 * 2026-07-04 (Phase 5) — model picker shows name + provider with a
 * star badge for `recommended: true` models. Items sorted
 * (recommended first, then alphabetical). Tooltip on the trigger
 * surfaces the currently-selected model's description.
 *
 * 2026-07-04 (Phase 6 redesign) — "Calm Precision" light theme:
 * white card bg, subtle border-bottom, indigo accent on hover/active.
 *
 * Responsive: on viewports < 640px the project name and the History
 * label collapse to icons-only so the logo, model picker, history,
 * new, and download buttons stay visible without horizontal scroll.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Download, Hammer, History, Plus, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ModelInfo } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface TopBarProps {
  models: ModelInfo[]
  selectedModel: string
  onModelChange: (model: string) => void
  onDownload: () => void
  /**
   * Project title emitted by the backend. Empty string means "no
   * title yet" — we render the placeholder "Untitled" in that case.
   */
  projectTitle: string
  /**
   * Reset handler for the "New project" action. Disabled while a
   * stream is in flight and there's no prior work to clear.
   */
  onNewProject: () => void
  /** Whether a generation is in flight — used to disable "New". */
  isStreaming: boolean
  /** Whether there is any prior work (messages) to clear. */
  hasContent: boolean
  /** Whether there is code available to download. */
  hasDownload: boolean
  /**
   * Open the history drawer. PLACEHOLDER — the drawer is built by
   * another agent; this component only wires the button to the
   * callback.
   */
  onHistoryOpen: () => void
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Strip a `provider/` prefix from a model ID for human display. */
function displayName(model: ModelInfo): string {
  // Prefer the `name` field (e.g. "MiniMax M3"); fall back to the id
  // with the provider prefix stripped. The provider is rendered
  // separately as a muted annotation.
  if (model.name) return model.name
  const slashIndex = model.id.indexOf('/')
  return slashIndex >= 0 ? model.id.slice(slashIndex + 1) : model.id
}

/**
 * Sort models for the picker: recommended first (preserving the
 * original order within each group so the backend's "best" list
 * controls ranking), then everything else alphabetical by display
 * name. A stable sort means the backend can hand us an already-
 * curated order and we only re-shuffle the tail.
 */
function sortModels(models: ReadonlyArray<ModelInfo>): ModelInfo[] {
  return [...models].sort((a, b) => {
    if (a.recommended !== b.recommended) {
      return a.recommended ? -1 : 1
    }
    return displayName(a).localeCompare(displayName(b))
  })
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

/**
 * The Forge wordmark + icon. Sits on the far left of the TopBar. Renders
 * as a router link to the landing page so users can hop back to the
 * marketing surface from any builder state.
 */
function Logo() {
  return (
    <Link
      to="/"
      aria-label="Forge — back to landing page"
      className="
        group flex cursor-pointer items-center gap-2
        rounded-md outline-none
        focus-visible:ring-2 focus-visible:ring-ring
        focus-visible:ring-offset-2 focus-visible:ring-offset-card
      "
    >
      <span
        aria-hidden="true"
        className="
          flex size-7 items-center justify-center
          rounded-md bg-accent text-accent-foreground
          transition-colors group-hover:bg-primary/15
        "
      >
        <Hammer className="size-4 text-primary" />
      </span>
      <span
        className="
          font-body text-base font-semibold tracking-tight text-foreground
          transition-opacity group-hover:opacity-80
        "
      >
        Forge
      </span>
    </Link>
  )
}

interface ProjectNameProps {
  /** Empty string → render the "Untitled" placeholder. */
  name: string
}

/**
 * The project name sits in the center of the TopBar. When the value
 * changes (typically once the backend emits a `title` event) the
 * old/new text cross-fade so the swap reads as intentional, not as
 * a flicker. The empty state ("Untitled") is muted to signal
 * "no project yet" without drawing the eye away from the input.
 */
function ProjectName({ name }: ProjectNameProps) {
  const hasTitle = name.trim().length > 0
  const display = hasTitle ? name : 'Untitled'

  return (
    <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
      <span
        aria-hidden="true"
        className="text-muted-foreground/60 text-sm"
      >
        /
      </span>
      <div
        className="
          max-w-[40ch] min-w-0 flex-1 truncate text-sm
          text-muted-foreground
        "
        title={display}
      >
        {/*
         * AnimatePresence with `mode="wait"` ensures the outgoing
         * text fully fades out before the new one starts fading in,
         * which avoids the two strings overlapping mid-transition.
         */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={display}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={
              hasTitle
                ? 'inline-block transition-colors hover:text-foreground'
                : 'inline-block italic text-muted-foreground/70'
            }
          >
            {display}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  )
}

interface ModelPickerProps {
  models: ModelInfo[]
  value: string
  onChange: (value: string) => void
}

/**
 * The model picker. Shows the current selection on the trigger and
 * a sorted list of all models in the dropdown. Recommended models
 * (per the backend's `recommended: true` flag) are pinned to the
 * top of the list and decorated with a small star icon.
 *
 * The trigger is wrapped in a Tooltip that surfaces the currently
 * selected model's `description` — useful for picking the right
 * model when iterating on a complex prompt.
 */
function ModelPicker({ models, value, onChange }: ModelPickerProps) {
  const sorted = sortModels(models)
  const current = models.find((m) => m.id === value)
  const tooltipText = current?.description ?? 'Select a model to generate code'
  const recommended = sorted.filter((m) => m.recommended)
  const rest = sorted.filter((m) => !m.recommended)

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <Select value={value} onValueChange={onChange}>
          <TooltipTrigger asChild>
            {/*
             * The trigger is hidden on viewports narrower than `sm`
             * — the chat-side `ChatModelPicker` handles model
             * selection on mobile (it sits next to the prompt input).
             * The TopBar's value is still kept in sync via the
             * Builder's shared `selectedModel` state, so the
             * picker's value is never "stale" — it's just rendered
             * in the chat surface on small screens.
             */}
            <SelectTrigger
              size="sm"
              aria-label="Select model"
              className="
                hidden h-8 w-[180px] gap-1.5
                border-border bg-secondary
                text-secondary-foreground
                hover:bg-secondary/80
                sm:flex sm:w-[220px]
              "
            >
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
          </TooltipTrigger>
          <SelectContent align="end" className="min-w-[240px]">
            {/*
             * Two groups (when both are non-empty) keep the
             * recommended models visually distinct from the rest
             * without forcing a "Recommended" toggle UI. The
             * separator disappears when one of the groups is empty
             * (e.g. a backend that hasn't marked anything
             * recommended yet).
             */}
            {recommended.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recommended
                </SelectLabel>
                {recommended.map((model) => (
                  <ModelSelectItem key={model.id} model={model} />
                ))}
              </SelectGroup>
            )}
            {recommended.length > 0 && rest.length > 0 && (
              <SelectSeparator />
            )}
            {rest.length > 0 && (
              <SelectGroup>
                {recommended.length > 0 ? (
                  <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    All models
                  </SelectLabel>
                ) : null}
                {rest.map((model) => (
                  <ModelSelectItem key={model.id} model={model} />
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <TooltipContent side="bottom" className="max-w-[260px]">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * A single model entry inside the picker dropdown. Renders the
 * model's display name + provider as a two-line row, with a
 * `Star` icon for `recommended: true` models. The description is
 * exposed via the parent group's tooltip on the trigger (we
 * don't put a per-item Tooltip here because that would be too
 * heavy inside an open dropdown).
 */
function ModelSelectItem({ model }: { model: ModelInfo }) {
  return (
    <SelectItem
      value={model.id}
      className={cn(
        'items-start py-2',
        model.recommended && 'data-[state=checked]:font-semibold',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          {model.recommended ? (
            <Star
              className="size-3 shrink-0 fill-primary text-primary"
              aria-label="Recommended"
            />
          ) : null}
          <span className="truncate font-medium">{displayName(model)}</span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {model.provider}
          {model.role !== 'both' ? ` · ${model.role}` : ''}
        </span>
      </span>
    </SelectItem>
  )
}

interface HistoryButtonProps {
  onClick: () => void
  prefersReduced: boolean
}

/**
 * "History" button — PLACEHOLDER. Opens the history drawer (built
 * by another agent). Rendered between the model picker and the
 * "New" button per the spec (§3.2). The label is hidden on mobile
 * to keep the chrome compact; the icon is always visible.
 */
function HistoryButton({ onClick, prefersReduced }: HistoryButtonProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            whileHover={prefersReduced ? undefined : { scale: 1.02 }}
            whileTap={prefersReduced ? undefined : { scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="cursor-pointer"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClick}
              aria-label="Open project history"
              className="h-8 min-h-[44px] gap-1.5 sm:min-h-0"
            >
              <History className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">History</span>
            </Button>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="bottom">Project history</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface NewProjectButtonProps {
  onClick: () => void
  disabled: boolean
  prefersReduced: boolean
}

/**
 * "New project" action, promoted from the old floating button to a
 * permanent resident of the TopBar. Shows an icon on all viewports
 * and adds the "New" label on ≥sm where there's room.
 */
function NewProjectButton({ onClick, disabled, prefersReduced }: NewProjectButtonProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            whileHover={disabled || prefersReduced ? undefined : { scale: 1.02 }}
            whileTap={disabled || prefersReduced ? undefined : { scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="cursor-pointer"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClick}
              disabled={disabled}
              aria-label="Start a new project"
              className="h-8 min-h-[44px] gap-1.5 sm:min-h-0"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">New</span>
            </Button>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="bottom">New project</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface DownloadButtonProps {
  onClick: () => void
  disabled: boolean
  prefersReduced: boolean
}

/**
 * "Download" action — exports the current code (and a generated
 * `README.md`) as a ZIP archive. Disabled when there is no code on
 * screen OR while a generation stream is in flight (a partial
 * download is worse than no download).
 */
function DownloadButton({ onClick, disabled, prefersReduced }: DownloadButtonProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            whileHover={disabled || prefersReduced ? undefined : { scale: 1.02 }}
            whileTap={disabled || prefersReduced ? undefined : { scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="cursor-pointer"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClick}
              disabled={disabled}
              aria-label="Download project as ZIP"
              className="h-8 min-h-[44px] gap-1.5 sm:min-h-0"
            >
              <Download className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Download</span>
            </Button>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {disabled ? 'Generate code first to download' : 'Download as ZIP'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function TopBar({
  models,
  selectedModel,
  onModelChange,
  onDownload,
  onHistoryOpen,
  projectTitle,
  onNewProject,
  isStreaming,
  hasContent,
  hasDownload,
}: TopBarProps) {
  const prefersReduced = useReducedMotion()
  // The download button is disabled when there's no code OR while
  // streaming — partial downloads of a half-written file would be
  // confusing and would race the streaming code.
  const downloadDisabled = !hasDownload || isStreaming

  return (
    <header
      className="
        flex h-12 shrink-0 items-center justify-between gap-2
        border-b border-border bg-card px-3
        sm:gap-3 sm:px-4
      "
    >
      {/* ── Left: logo ──────────────────────────────────────── */}
      <Logo />

      {/* ── Center: project name (≥sm) ──────────────────────── */}
      <ProjectName name={projectTitle} />

      {/* ── Right: model picker + history + new + download ─── */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ModelPicker
          models={models}
          value={selectedModel}
          onChange={onModelChange}
        />
        <HistoryButton
          onClick={onHistoryOpen}
          prefersReduced={!!prefersReduced}
        />
        <NewProjectButton
          onClick={onNewProject}
          disabled={isStreaming || !hasContent}
          prefersReduced={!!prefersReduced}
        />
        <DownloadButton
          onClick={onDownload}
          disabled={downloadDisabled}
          prefersReduced={!!prefersReduced}
        />
      </div>
    </header>
  )
}
