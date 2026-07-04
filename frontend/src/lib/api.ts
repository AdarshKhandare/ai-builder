/**
 * Backend API client.
 *
 * The FastAPI backend exposes these endpoints used by the builder:
 *
 * - `GET  /api/health`   — service status + available model catalog.
 * - `POST /api/generate`  — streams a Server-Sent Events (SSE) response
 *   shaped as a sequence of JSON frames:
 *
 *       data: {"type":"status","content":"planning"}\n\n
 *       data: {"type":"status","content":"generating"}\n\n
 *       data: {"type":"title","content":"Project Name"}\n\n
 *       data: {"type":"code","content":"<html chunk>"}\n\n   (N chunks)
 *       data: {"type":"done"}\n\n
 *       data: {"type":"error","message":"..."}\n\n          (on failure)
 *
 * - `POST /api/iterate`   — streams a chat-style SSE response where the
 *   entire current code is re-emitted (not a diff) under `code` events.
 *   Used for "ask for changes" follow-up turns:
 *
 *       data: {"type":"status","content":"iterating"}\n\n
 *       data: {"type":"code","content":"<full code>"}\n\n    (N chunks)
 *       data: {"type":"done"}\n\n
 *       data: {"type":"error","message":"..."}\n\n          (on failure)
 *
 *   Note: iterate does NOT emit a `title` event — the project's title
 *   is already set from the first generation. The streamed `code`
 *   events REPLACE the previous code entirely, not append to it.
 *
 * In dev, Vite proxies `/api/*` to `http://localhost:8000` (see
 * `vite.config.ts`), so we always use relative URLs.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** A model listed by `GET /api/health`. */
export interface ModelInfo {
  id: string
  name: string
  cost_input: number
  cost_output: number
  endpoint: string
}

/** Response shape of `GET /api/health`. */
export interface HealthResponse {
  status: string
  models: ModelInfo[]
}

/** A single parsed SSE frame. */
export type SSEEvent =
  | { type: 'status'; content: string }
  | { type: 'title'; content: string }
  | { type: 'code'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** A single turn in the chat history sent to `/api/iterate`. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Body sent to `POST /api/generate`. */
export interface GenerateRequest {
  prompt: string
  /** OpenCode Go model ID, e.g. `opencode-go/minimax-m3`. */
  model?: string
}

/** Body sent to `POST /api/iterate`. */
export interface IterateRequest {
  prompt: string
  /** The full code currently in the editor — sent verbatim so the
   *  model can produce the next revision against the latest state. */
  current_code: string
  /** Conversation history excluding the current `prompt`. The
   *  backend appends the current prompt itself. */
  history: ChatMessage[]
  /** OpenCode Go model ID, e.g. `opencode-go/minimax-m3`. */
  model?: string
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fetch service health and the model catalog.
 *
 * Throws an `Error` if the network request fails or the backend
 * returns a non-2xx response. Callers should surface the message in a
 * toast / error boundary.
 */
export async function health(): Promise<HealthResponse> {
  const res = await fetch('/api/health', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as HealthResponse
}

/* ------------------------------------------------------------------ */
/* SSE generator                                                       */
/* ------------------------------------------------------------------ */

/**
 * Stream generated code for a prompt.
 *
 * Yields parsed {@link SSEEvent} frames as they arrive. The
 * `text/event-stream` response body is split on the SSE event
 * separator (`\n\n`) and each `data:` line is JSON-decoded. Malformed
 * frames are silently skipped so a single bad chunk does not abort
 * the stream.
 *
 * @param prompt  Natural-language description of the app to build.
 * @param model   Optional model ID. Defaults to the backend's
 *                `opencode-go/minimax-m3`.
 * @param signal  Optional `AbortSignal` to cancel the request.
 */
export async function* generateStream(
  prompt: string,
  model?: string,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, void> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ prompt, model } satisfies GenerateRequest),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Generate failed: ${res.status} ${res.statusText}`)
  }
  if (!res.body) {
    throw new Error('Generate failed: response has no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by a blank line. Split, keep the
      // last (possibly incomplete) chunk in the buffer for the next
      // iteration, and process the completed events.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const line = frame.trim()
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (!data) continue

        try {
          const parsed = JSON.parse(data) as SSEEvent
          yield parsed
        } catch {
          // Malformed frame — skip rather than abort the whole stream.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Reader may already be released on abort; ignore.
    }
  }
}

/**
 * Stream an iteration on top of existing code.
 *
 * Used for the "ask for changes" follow-up flow. Yields parsed
 * {@link SSEEvent} frames in the same shape as {@link generateStream}
 * (status → N code chunks → done, or error). The backend emits the
 * full updated code as `code` events — the client should REPLACE the
 * previous code, not append to it.
 *
 * Like `generateStream`, malformed frames are silently skipped and
 * the caller may cancel via the optional `signal`.
 *
 * @param prompt       The follow-up instruction (e.g. "make the hero blue").
 * @param currentCode  The full code currently in the editor. The
 *                     backend will revise against this snapshot.
 * @param history      Chat history up to but not including the current
 *                     prompt. The backend appends the current prompt.
 * @param model        Optional model ID. Defaults to the backend's
 *                     `opencode-go/minimax-m3`.
 * @param signal       Optional `AbortSignal` to cancel the request.
 */
export async function* iterateStream(
  prompt: string,
  currentCode: string,
  history: ChatMessage[],
  model?: string,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, void> {
  const res = await fetch('/api/iterate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      prompt,
      current_code: currentCode,
      history,
      model,
    } satisfies IterateRequest),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Iterate failed: ${res.status} ${res.statusText}`)
  }
  if (!res.body) {
    throw new Error('Iterate failed: response has no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by a blank line. Split, keep the
      // last (possibly incomplete) chunk in the buffer for the next
      // iteration, and process the completed events.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        // SSE spec: lines that start with `:` are comments
        // (e.g. `: keepalive`) — skip them.
        const line = frame.trim()
        if (line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (!data) continue

        try {
          const parsed = JSON.parse(data) as SSEEvent
          yield parsed
        } catch {
          // Malformed frame — skip rather than abort the whole stream.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Reader may already be released on abort; ignore.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Projects API                                                        */
/*                                                                     */
/* CRUD wrappers around `/api/projects`. The backend uses SQLAlchemy   */
/* integer primary keys, so every project id is a `number` (NOT a     */
/* string — the BUILDER_REDESIGN_SPEC v1 said string, but the actual  */
/* backend schema is `int`). Fields are snake_case to match the wire  */
/* format verbatim. The frontend never transforms them.               */
/*                                                                     */
/* Endpoints:                                                         */
/*   GET    /api/projects?limit=&offset=    → ProjectSummary[]        */
/*   GET    /api/projects/{id}              → ProjectFull             */
/*   POST   /api/projects                   → ProjectFull (201)       */
/*   PATCH  /api/projects/{id}              → ProjectFull             */
/*   DELETE /api/projects/{id}              → 204 No Content          */
/* ------------------------------------------------------------------ */

/** Lightweight project row returned by `GET /api/projects`. */
export interface ProjectSummary {
  id: number
  title: string
  /** First ~200 chars; the full prompt is in `ProjectFull`. */
  prompt: string
  /** OpenCode Go model id, e.g. `opencode-go/minimax-m3`. */
  model: string
  /** ISO 8601 timestamp. */
  created_at: string
}

/** Full project row returned by `GET /api/projects/{id}` and the
 *  mutating endpoints. Adds `code` and `updated_at` over
 *  {@link ProjectSummary}. The backend does NOT persist chat
 *  `messages` — the integration layer synthesizes them from
 *  `prompt` on load. */
export interface ProjectFull extends ProjectSummary {
  code: string
  updated_at: string
}

/** Request body for `POST /api/projects`. */
export interface ProjectCreateBody {
  title: string
  prompt: string
  code: string
  model: string
}

/** Request body for `PATCH /api/projects/{id}`. All fields optional. */
export interface ProjectUpdateBody {
  title?: string
  code?: string
  model?: string
}

/**
 * Helper: parse a `Response` as JSON, throwing an `Error` with a
 * descriptive message on non-2xx. Centralised so every CRUD call
 * produces the same toast-friendly error string.
 */
async function parseJson<T>(res: Response, verb: string): Promise<T> {
  if (!res.ok) {
    let detail = ''
    try {
      // FastAPI error shape: { detail: string | object }
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') {
        detail = body.detail
      } else if (body.detail !== undefined) {
        detail = JSON.stringify(body.detail)
      }
    } catch {
      // Body wasn't JSON; fall back to statusText.
    }
    throw new Error(
      detail
        ? `${verb} failed: ${res.status} ${detail}`
        : `${verb} failed: ${res.status} ${res.statusText}`,
    )
  }
  return (await res.json()) as T
}

/**
 * List projects (newest first — the backend orders by `created_at desc`).
 *
 * @param limit  Max rows to return. Defaults to 50, matching the
 *               backend's default.
 * @param offset Rows to skip for pagination. Defaults to 0.
 */
export async function listProjects(
  limit = 50,
  offset = 0,
): Promise<ProjectSummary[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  const res = await fetch(`/api/projects?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  return parseJson<ProjectSummary[]>(res, 'List projects')
}

/**
 * Fetch a single project (including full `code`).
 *
 * @throws Error with a descriptive message on non-2xx, including
 *         404s for missing ids.
 */
export async function getProject(id: number): Promise<ProjectFull> {
  const res = await fetch(`/api/projects/${id}`, {
    headers: { Accept: 'application/json' },
  })
  return parseJson<ProjectFull>(res, `Get project ${id}`)
}

/**
 * Create a new project. Used by the auto-save flow after the first
 * `done` SSE event when no `projectId` is in state yet.
 *
 * @throws Error on validation failure (422) or other non-2xx.
 */
export async function createProject(
  data: ProjectCreateBody,
): Promise<ProjectFull> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  })
  return parseJson<ProjectFull>(res, 'Create project')
}

/**
 * Update an existing project. All fields are optional; the backend
 * interprets an empty body as a no-op (still returns the current row).
 */
export async function updateProject(
  id: number,
  data: ProjectUpdateBody,
): Promise<ProjectFull> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  })
  return parseJson<ProjectFull>(res, `Update project ${id}`)
}

/**
 * Delete a project. The backend returns 204 No Content on success;
 * we deliberately do NOT call `.json()` because there's no body.
 */
export async function deleteProject(id: number): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(
      `Delete project ${id} failed: ${res.status} ${res.statusText}`,
    )
  }
}
