/**
 * HistoryDrawer — slide-in panel listing every saved project.
 *
 * Spec: `docs/BUILDER_REDESIGN_SPEC.md` §3.
 *
 * Built on the shadcn `Sheet` primitive (Radix Dialog) with
 * `side="left"`. Renders a search input, a scrollable list of
 * {@link ProjectCard}s, a loading skeleton, an empty state, and a
 * destructive `AlertDialog` for delete confirmation.
 *
 * Data fetching is owned by the `useProjects` hook; this component
 * is purely presentational + interaction wiring. The integration
 * agent passes `onLoadProject(project: ProjectFull)` to receive
 * the chosen project — the drawer itself does NOT navigate or
 * touch builder state.
 *
 * The drawer's export contract:
 *
 *   interface HistoryDrawerProps {
 *     open: boolean
 *     onOpenChange: (open: boolean) => void
 *     onLoadProject: (project: ProjectFull) => void
 *     activeProjectId: number | null
 *   }
 */
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Hammer, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ProjectCard } from '@/components/history/ProjectCard'
import { useProjects } from '@/hooks/useProjects'
import { getProject, type ProjectFull, type ProjectSummary } from '@/lib/api'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface HistoryDrawerProps {
  /** Whether the drawer is open. Controlled by the parent. */
  open: boolean
  /** Called when the user opens or closes the drawer. */
  onOpenChange: (open: boolean) => void
  /**
   * Called when the user picks a project. The drawer is responsible
   * for fetching the full row (including `code`) and passing it up.
   * On error: surfaces a toast and keeps the drawer open.
   */
  onLoadProject: (project: ProjectFull) => void
  /** The id of the project currently loaded in the builder, or `null`. */
  activeProjectId: number | null
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

/** Loading skeleton — three pulsing card-shaped placeholders. */
function CardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col gap-2 rounded-lg border border-border bg-background-sunken p-3"
    >
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="flex flex-col gap-1">
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-1 flex items-center justify-between">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        <div className="h-3 w-12 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}

/** Empty state — amber forge icon + two-line message. */
function EmptyState() {
  return (
    <div
      data-testid="history-empty-state"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <span
        aria-hidden="true"
        className="
          flex size-12 items-center justify-center
          rounded-md bg-primary/10 text-primary
          shadow-[0_0_16px_oklch(0.75_0.16_70/0.2)]
        "
      >
        <Hammer className="size-6" />
      </span>
      <div className="font-display text-sm font-semibold text-foreground">
        No projects yet
      </div>
      <p className="text-xs text-muted-foreground">
        Describe an app to get started
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function HistoryDrawer({
  open,
  onOpenChange,
  onLoadProject,
  activeProjectId,
}: HistoryDrawerProps) {
  const { projects, loading, error, refresh, deleteProject } = useProjects()

  /* ── Search ────────────────────────────────────────────────── */
  // `query` is the controlled value (updates on every keystroke).
  // `debouncedQuery` is what we actually filter against. The 200ms
  // delay is overcautious for a 50-row list but follows the spec
  // and keeps the door open for a server-side search later.
  const [query, setQuery] = useState<string>('')
  const [debouncedQuery, setDebouncedQuery] = useState<string>('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(t)
  }, [query])

  // Reset the query whenever the drawer closes so reopening starts
  // fresh.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filteredProjects: ProjectSummary[] = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.prompt.toLowerCase().includes(q),
    )
  }, [projects, debouncedQuery])

  /* ── Delete confirmation state ───────────────────────────── */
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const pendingDeleteProject = useMemo<ProjectSummary | undefined>(
    () => projects.find((p) => p.id === pendingDeleteId),
    [projects, pendingDeleteId],
  )

  /* ── Surface fetch errors via toast ──────────────────────── */
  // `useProjects` already populates `error` on failure. The drawer
  // mirrors it to a toast so the user gets immediate feedback, then
  // refetches on the next open to clear the state.
  const lastErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      toast.error(error)
      lastErrorRef.current = error
    } else if (!error) {
      lastErrorRef.current = null
    }
  }, [error])

  /* ── Open: refresh from the server ───────────────────────── */
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  /* ── Handlers ────────────────────────────────────────────── */
  const handleOpenProject = async (id: number): Promise<void> => {
    try {
      const full = await getProject(id)
      onLoadProject(full)
      // Close the drawer only AFTER the fetch + the parent's
      // `handleLoadProject` complete. If the fetch fails, keep the
      // drawer open so the user can try another project.
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't load project"
      toast.error(message)
      // Drawer stays open — user can try another project.
    }
  }

  const handleRequestDelete = (id: number): void => {
    setPendingDeleteId(id)
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (pendingDeleteId == null) return
    const ok = await deleteProject(pendingDeleteId)
    if (ok) {
      toast.success('Project deleted')
    }
    // On failure the hook already set `error`, which the effect above
    // surfaces as a toast.
    setPendingDeleteId(null)
  }

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className={cn(
            'flex w-full flex-col gap-0 border-r border-border bg-card p-0',
            'sm:w-[380px]',
          )}
          // Sheet content has its own padding for the default case;
          // we override to 0 so the section dividers line up.
        >
          {/* ── Header ─────────────────────────────────────── */}
          <SheetHeader className="flex h-12 shrink-0 flex-row items-center justify-between gap-2 border-b border-border px-4">
            <div className="flex min-w-0 flex-col">
              <SheetTitle className="font-display text-base font-semibold text-foreground">
                History
              </SheetTitle>
              {/* Hidden but kept for a11y — describes the drawer's purpose. */}
              <SheetDescription className="sr-only">
                Browse, load, and delete previously generated projects.
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label="Close history drawer"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </SheetHeader>

          {/* ── Search ─────────────────────────────────────── */}
          <div className="shrink-0 border-b border-border p-3">
            <div className="relative">
              <Search
                className="
                  pointer-events-none absolute top-1/2 left-2.5
                  size-3.5 -translate-y-1/2 text-muted-foreground
                "
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects..."
                aria-label="Search projects"
                className="bg-background-sunken pl-8"
              />
            </div>
          </div>

          {/* ── Body: loading / empty / list ────────────────── */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 p-3">
              {loading && projects.length === 0 ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : filteredProjects.length === 0 ? (
                <EmptyState />
              ) : (
                <AnimatePresence initial={false}>
                  {filteredProjects.map((project) => (
                    <motion.div
                      key={project.id}
                      layout
                      exit={{
                        opacity: 0,
                        height: 0,
                        transition: { duration: 0.2, ease: 'easeInOut' },
                      }}
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 30,
                      }}
                    >
                      <ProjectCard
                        project={project}
                        onOpen={handleOpenProject}
                        onDelete={handleRequestDelete}
                        isActive={project.id === activeProjectId}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* ── Delete confirmation ─────────────────────────────── */}
      <AlertDialog
        open={pendingDeleteId != null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDeleteProject?.title ?? 'This project'}" will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // we'll trigger manually so the toast fires after the dialog closes
                void handleConfirmDelete()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
