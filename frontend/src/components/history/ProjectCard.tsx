/**
 * ProjectCard — one row in the history drawer.
 *
 * Renders a project's title, prompt preview, model name, and
 * relative timestamp. Clicking the card (anywhere except the
 * delete button) fires `onOpen(id)`. Hovering reveals the
 * delete affordance.
 *
 * Spec: `docs/UI_REDESIGN_SPEC.md` §7.7 — "Calm Precision" light theme.
 *
 * Visual notes:
 *  - Active card (currently loaded) gets a 2px indigo left border
 *    + a faint indigo tint background — `--primary` accent, no amber.
 *  - `whileTap` press feedback (scale 0.98) for the click affordance.
 *  - The model id arrives as `opencode-go/minimax-m3`; the prefix
 *    is stripped for display so the card stays narrow.
 *  - The delete button calls `e.stopPropagation()` so the card
 *    click doesn't also fire.
 */
import { motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ProjectSummary } from '@/lib/api'
import { timeAgo } from '@/lib/timeAgo'
import { cn } from '@/lib/utils'

export interface ProjectCardProps {
  project: ProjectSummary
  /** Called when the user clicks the card body. */
  onOpen: (id: number) => void
  /** Called when the user clicks the delete button. */
  onDelete: (id: number) => void
  /** True if this card represents the currently-loaded project. */
  isActive: boolean
}

/**
 * Strip the `opencode-go/` vendor prefix from a model id so the
 * card footer stays narrow. Falls back to the full id if there's
 * no slash (shouldn't happen with real backend data, but defensive).
 */
function shortModel(model: string): string {
  const idx = model.lastIndexOf('/')
  return idx >= 0 ? model.slice(idx + 1) : model
}

export function ProjectCard({
  project,
  onOpen,
  onDelete,
  isActive,
}: ProjectCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(project.id)
    }
  }

  const handleDelete = (e: React.MouseEvent<HTMLButtonElement>): void => {
    // Don't bubble to the card click — that's the contract.
    e.stopPropagation()
    onDelete(project.id)
  }

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project.id)}
      onKeyDown={handleKeyDown}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      aria-label={`Open project ${project.title}`}
      data-active={isActive}
      data-testid="project-card"
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left shadow-xs',
        'border-border bg-card',
        'transition-colors hover:border-border-subtle hover:shadow-sm',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        // Active state: indigo left border + faint indigo tint
        isActive && 'border-l-primary border-l-2 bg-accent/50',
      )}
    >
      {/* ── Title ───────────────────────────────────────────── */}
      <div
        className="font-display text-sm font-semibold text-foreground truncate"
        title={project.title}
      >
        {project.title}
      </div>

      {/* ── Prompt preview (clamped to 2 lines) ─────────────── */}
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {project.prompt}
      </p>

      {/* ── Footer: model + timestamp + delete ──────────────── */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span
          className="font-mono truncate max-w-[120px]"
          title={project.model}
        >
          {shortModel(project.model)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <span>{timeAgo(project.created_at)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleDelete}
            aria-label={`Delete project ${project.title}`}
            className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
