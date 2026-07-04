/**
 * TopBar — the sticky 48px header for the builder page.
 *
 * Spec (`docs/UI_DESIGN_DIRECTION.md` §9.2):
 *  - Left:   amber forge icon + "Forge" wordmark in the display font.
 *  - Center: project name. Empty / pre-generation → "Untitled";
 *            once a `title` SSE event arrives the value fades in
 *            in place.
 *  - Right:  model picker (shadcn Select) + History button +
 *            "New" outline button + Download outline button.
 *
 * 2026-07-03 additions:
 *  - `History` button between the model picker and the "New" button.
 *    The button is a PLACEHOLDER — the drawer is built by another
 *    agent. We only wire the onClick to the `onHistoryOpen` callback
 *    that the Builder page supplies.
 *
 * Responsive: on viewports < 640px the project name and the History
 * label collapse to icons-only so the logo, model picker, history,
 * new, and download buttons stay visible without horizontal scroll.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Download, Hammer, History, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="
          flex size-7 items-center justify-center
          rounded-md bg-primary/10 text-primary
          shadow-[0_0_12px_oklch(0.75_0.16_70/0.25)]
        "
      >
        <Hammer className="size-4" />
      </span>
      <span className="font-display text-base font-bold text-primary tracking-tight">
        Forge
      </span>
    </div>
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

function ModelPicker({ models, value, onChange }: ModelPickerProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        aria-label="Select model"
        className="
          h-8 max-w-[180px] gap-1.5
          border-border bg-secondary
          text-secondary-foreground
          hover:bg-secondary/80
          sm:max-w-[220px]
        "
      >
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent align="end" className="min-w-[200px]">
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClick}
              aria-label="Open project history"
              className="h-8 gap-1.5"
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
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClick}
              disabled={disabled}
              aria-label="Start a new project"
              className="h-8 gap-1.5"
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
        <motion.div
          whileHover={prefersReduced || !hasDownload ? undefined : { scale: 1.02 }}
          whileTap={prefersReduced || !hasDownload ? undefined : { scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={!hasDownload}
            aria-label="Download project as ZIP"
            className="h-8 gap-1.5"
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Download</span>
          </Button>
        </motion.div>
      </div>
    </header>
  )
}
