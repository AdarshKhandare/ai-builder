/**
 * Tests for `src/components/history/HistoryDrawer.tsx`.
 *
 * The drawer uses `useProjects` which makes a `fetch` call on mount.
 * We stub the global `fetch` with a `vi.fn()` that resolves to a
 * JSON-encoded list of `ProjectSummary` rows. The same pattern is
 * used in `useProjects.test.ts` — we just call it from a component
 * test instead of a hook test.
 *
 * The Sheet is built on Radix Dialog and renders into a portal. By
 * default, `@testing-library/react` queries cover portal contents
 * (this has been the default since RTL v9), so `screen.getBy*` works
 * against the dialog title, search input, close button, and project
 * cards without any extra wrapping.
 *
 * Tests cover:
 *  - open=true renders the drawer chrome (title, search, close)
 *  - empty list → "No projects yet" empty state
 *  - non-empty list → one `data-testid="project-card"` per row
 *  - close button → `onOpenChange(false)`
 */
import { render, screen, waitFor } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'

import { HistoryDrawer } from './HistoryDrawer'
import type { ProjectFull, ProjectSummary } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const SAMPLE_PROJECTS: ProjectSummary[] = [
  {
    id: 1,
    title: 'My Counter',
    prompt: 'A simple counter with increment and decrement',
    model: 'opencode-go/minimax-m3',
    created_at: '2026-07-03T10:00:00.000Z',
  },
  {
    id: 2,
    title: 'Coffee Shop Landing',
    prompt: 'A landing page for a small coffee shop with menu and hours',
    model: 'opencode-go/qwen-3-7-plus',
    created_at: '2026-07-02T10:00:00.000Z',
  },
]

interface RenderOpts {
  open?: boolean
  projects?: ProjectSummary[]
  onOpenChange?: Mock<(open: boolean) => void>
  onLoadProject?: Mock<(project: ProjectFull) => void>
  activeProjectId?: number | null
}

interface RenderResult {
  onOpenChange: Mock<(open: boolean) => void>
  onLoadProject: Mock<(project: ProjectFull) => void>
}

function renderDrawer(opts: RenderOpts = {}): RenderResult {
  const onOpenChange = opts.onOpenChange ?? vi.fn()
  const onLoadProject = opts.onLoadProject ?? vi.fn()
  const projects = opts.projects ?? []
  // `mockResolvedValue` returns the same response for every call,
  // which is what we want — both `useProjects`' mount effect and
  // the drawer's `if (open) refresh()` effect will hit this stub.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(projects)))

  render(
    <HistoryDrawer
      open={opts.open ?? true}
      onOpenChange={onOpenChange}
      onLoadProject={onLoadProject}
      activeProjectId={opts.activeProjectId ?? null}
    />,
  )
  return { onOpenChange, onLoadProject }
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  // `renderDrawer` stubs its own `fetch`. The beforeEach just
  // guarantees any leak from a previous test is cleared.
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('HistoryDrawer() — open=true', () => {
  it('test_renders_when_open — title, search input, and close button are in the document', async () => {
    renderDrawer({ projects: [] })

    // The Sheet title is mounted into a Radix Dialog portal. The
    // dialog's role is `dialog`; we look for the title text by
    // content because that is the only stable identifier across
    // Radix versions.
    await waitFor(() => {
      expect(screen.getByText('History')).toBeInTheDocument()
    })

    // Search input has an aria-label so it's locatable by role.
    expect(screen.getByLabelText('Search projects')).toBeInTheDocument()

    // The explicit close button in the header (the Sheet primitive
    // also renders its own sr-only close, so we target by label).
    expect(
      screen.getByLabelText('Close history drawer'),
    ).toBeInTheDocument()
  })
})

describe('HistoryDrawer() — empty state', () => {
  it('test_shows_empty_state_when_no_projects — renders "No projects yet" when the list is empty', async () => {
    renderDrawer({ projects: [] })

    // Wait for the loading skeleton to be replaced by the empty
    // state. The empty state has a dedicated `data-testid`.
    await waitFor(() => {
      expect(screen.getByTestId('history-empty-state')).toBeInTheDocument()
    })

    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    // The empty state also carries a "describe an app" hint.
    expect(screen.getByText(/describe an app/i)).toBeInTheDocument()

    // No project cards should be rendered.
    expect(screen.queryAllByTestId('project-card')).toHaveLength(0)
  })
})

describe('HistoryDrawer() — projects exist', () => {
  it('test_shows_project_cards_when_projects_exist — one card per project, with titles', async () => {
    renderDrawer({ projects: SAMPLE_PROJECTS })

    // Wait for both cards to mount. `findAllByTestId` retries until
    // the count matches, which sidesteps any brief loading-state
    // flicker between the two refresh() calls.
    const cards = await waitFor(() => {
      const found = screen.queryAllByTestId('project-card')
      expect(found).toHaveLength(2)
      return found
    })

    // The empty state must NOT be visible.
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument()

    // Each card's title text is present in the document.
    expect(screen.getByText('My Counter')).toBeInTheDocument()
    expect(screen.getByText('Coffee Shop Landing')).toBeInTheDocument()

    // Sanity: the card count matches what we passed in.
    expect(cards).toHaveLength(SAMPLE_PROJECTS.length)
  })
})

describe('HistoryDrawer() — close button', () => {
  it('test_close_button_calls_onOpenChange — clicking close fires onOpenChange(false)', async () => {
    const onOpenChange = vi.fn()
    renderDrawer({ projects: [], onOpenChange })

    // Wait for the drawer to be fully open before clicking.
    await waitFor(() => {
      expect(screen.getByText('History')).toBeInTheDocument()
    })

    // Click the close button in the header. We use `click()` on
    // the located element (rather than `fireEvent.click`) so any
    // pointer event handlers are also exercised.
    const closeButton = screen.getByLabelText('Close history drawer')
    closeButton.click()

    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
