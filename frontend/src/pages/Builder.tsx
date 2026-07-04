/**
 * Builder page.
 *
 * The main app surface for Forge. Owns:
 *
 *   - The chat history (`messages`) — short assistant summaries for
 *     the chat bubbles. The full code lives in the Code / Preview
 *     panel and is not duplicated into the chat thread.
 *   - The backend conversation history (`history`) — sent verbatim
 *     to `/api/iterate` so the model can revise against the full
 *     prior context. The assistant turn in `history` contains the
 *     full final code, not the short summary shown in the chat.
 *   - The currently-selected model (the catalog itself is owned
 *     by the `useModels` hook — see `src/hooks/useModels.ts`)
 *   - Timing + estimated cost of the active generation
 *   - Download (zip with `index.html` + `README.md`) of the latest
 *     generated code
 *   - The "New Project" reset action
 *   - The active tab in the right column (Code / Preview)
 *   - The active tab on mobile (Chat / Code / Preview)
 *   - The history-drawer open state + the currently-loaded project id
 *   - Auto-save to the backend when a generation completes
 *     (POST for new projects, PATCH for iterations on a loaded one)
 *   - The `mode` flag ("generation" vs "iteration") — derived from
 *     `code.length > 0 && !isStreaming`. When code is on screen and
 *     no stream is in flight, the next send is a chat-style
 *     `iterate()` follow-up. When no code exists yet, the next send
 *     is a fresh `start()`.
 *
 * Renders the shared `TopBar` + `GenerationProgressBar` +
 * `PanelLayout(ChatPanel | CodePanel | PreviewPanel)` +
 * `HistoryDrawer` + `StatusBar` chrome.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";

import { useSSE } from "@/hooks/useSSE";
import { useModels } from "@/hooks/useModels";
import {
  createProject,
  updateProject,
  type ChatMessage,
  type ModelInfo,
  type ProjectFull,
} from "@/lib/api";
import { estimateCostUsd } from "@/lib/cost";
import { TopBar } from "@/components/layout/TopBar";
import { PanelLayout } from "@/components/layout/PanelLayout";
import { StatusBar } from "@/components/layout/StatusBar";
import { GenerationProgressBar } from "@/components/layout/GenerationProgressBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { CodePanel } from "@/components/code/CodePanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { HistoryDrawer } from "@/components/history/HistoryDrawer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";

/* ------------------------------------------------------------------ */
/* Local types                                                         */
/* ------------------------------------------------------------------ */

/** A single chat bubble (UI). Assistant content is a short summary;
 *  the full code is in `history` and rendered in the Code panel. */
interface Message {
  role: "user" | "assistant";
  content: string;
}

/** Two-mode prompt semantics — drives placeholder + send handler. */
type BuilderMode = "generation" | "iteration";

/**
 * The default model the picker initializes to. Pinned to
 * `opencode-go/minimax-m3` — the recommended coder in the
 * fallback catalog. If the live catalog doesn't include this id
 * (e.g. a future backend rebrand), the on-mount effect falls
 * back to the first recommended model.
 */
const DEFAULT_MODEL_ID = "opencode-go/minimax-m3";

/** Slug fallback for the download filename when the project has no
 *  title yet. */
const DEFAULT_DOWNLOAD_FILENAME = "forge-app.zip";

/** Maximum length of the slug derived from the project title. */
const MAX_SLUG_LENGTH = 64;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Convert an arbitrary project title into a URL-safe slug suitable
 * for a download filename. Strips diacritics, lowercases, replaces
 * non-alphanumerics with `-`, collapses runs, and trims leading /
 * trailing hyphens. Returns `null` for empty / all-punctuation
 * inputs so the caller can decide on a fallback filename.
 */
function slugifyTitle(title: string): string | null {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : null;
}

/**
 * Build a short Markdown README for the downloaded ZIP. Includes
 * the project title, the original prompt, the model used, and the
 * generation date so the user can re-open the project later and
 * remember the context.
 */
function buildReadme(args: {
  title: string;
  prompt: string;
  model: string;
  generatedAt: Date;
}): string {
  const { title, prompt, model, generatedAt } = args;
  const dateStr = generatedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  return [
    `# ${title}`,
    "",
    "> Generated by [Forge](https://adarshweb.in) — describe it, Forge builds it.",
    "",
    "## Prompt",
    "",
    prompt.trim().length > 0 ? prompt.trim() : "_(no prompt recorded)_",
    "",
    "## Model",
    "",
    `\`${model}\``,
    "",
    "## Generated",
    "",
    dateStr,
    "",
    "## Run locally",
    "",
    "Open `index.html` in any modern browser. No build step is",
    "required — Forge output is a single self-contained HTML file.",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Builder() {
  /* --- chat state ------------------------------------------------- */
  const [messages, setMessages] = useState<Message[]>([]);

  /*
   * Backend conversation history, sent verbatim to `/api/iterate`.
   * The user-turn entries are the same as the `messages` list, but
   * the assistant-turn entries contain the FULL final code (not the
   * short chat-bubble summary) so the model has the complete prior
   * context to revise against.
   */
  const [history, setHistory] = useState<ChatMessage[]>([]);

  /* --- model state ------------------------------------------------ */
  /*
   * The catalog is owned by `useModels`, which fetches from
   * `/api/models` on mount and falls back to a hardcoded 9-model
   * list if the backend is unreachable. The Builder only needs to
   * know the current selection — picking a new value is just a
   * `setSelectedModel` call.
   */
  const { models } = useModels();
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);

  /* --- timing + cost state ---------------------------------------- */
  const [generationStart, setGenerationStart] = useState<number | null>(null);
  const [generationTime, setGenerationTime] = useState<number | null>(null);
  /*
   * Snapshot of the estimated cost for the most recent completed
   * run, in USD. `null` means "no run has completed yet" or
   * "pricing for the selected model is unavailable". The StatusBar
   * shows `~$0.0024` when this is a number, and omits the cost
   * prefix otherwise.
   */
  const [estimatedCostUsd, setEstimatedCostUsd] = useState<number | null>(null);
  /*
   * The prompt that produced the currently-displayed cost. Stored
   * so the StatusBar's stats line stays stable even if the user
   * changes the model picker afterwards — the cost reflects the
   * *run that produced the code on screen*, not the current
   * picker selection.
   */
  const [lastRunPrompt, setLastRunPrompt] = useState<string>("");

  /*
   * --- progressive-disclosure flags -------------------------------
   * Controls how many panels are visible. The shell is animated so
   * panels appear "as they earn their place" — chat only on first
   * load, code once a generation is in flight, preview once it
   * finishes. Both reset to `false` on "New project".
   */
  const [showCode, setShowCode] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  /* --- tabs ------------------------------------------------------ */
  /*
   * Active tab in the right column (desktop/tablet). Auto-switches
   * to 'code' on send and to 'preview' on `done`. The user can
   * override at any time.
   */
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  /* Mobile-only tab. Defaults to 'chat' so the first-run screen
     shows the full-width empty state. */
  const [mobileTab, setMobileTab] = useState<"chat" | "code" | "preview">("chat");

  /* --- history drawer state --------------------------------------- */
  /*
   * `historyOpen` is the controlled open flag for `<HistoryDrawer>`.
   * `currentProjectId` tracks which saved project (if any) is
   * currently loaded into the builder. When non-null, the auto-save
   * effect issues a PATCH on `done`; when null, it issues a POST
   * to create a brand-new project.
   */
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);

  /* --- SSE -------------------------------------------------------- */
  const { code, status, isStreaming, error, done, title, start, iterate, reset, load } = useSSE();

  // Tracks whether we've already surfaced the latest `error` event
  // to the chat + toast. SSE errors arrive as events (not thrown),
  // so we react via this effect.
  const lastErrorRef = useRef<string | null>(null);

  /*
   * Tracks the last kind of send ("start" for a fresh generation,
   * "iterate" for a follow-up turn). Read by the `done` effect to
   * pick the right assistant-bubble text ("Generated" vs "Updated")
   * without us having to re-derive it from `code`/`messages`.
   * Cleared by `handleNewProject`.
   */
  const lastActionRef = useRef<"start" | "iterate" | null>(null);

  /* --- on mount: ensure default model is in the catalog ---------- */
  /*
   * `useModels` already populates `models` with a fallback list
   * before the network round-trip resolves, so this effect can run
   * on the very first render. Its only job is to redirect the
   * selection to the first recommended model if the default id
   * isn't present (e.g. a future backend that drops
   * `opencode-go/minimax-m3`).
   */
  useEffect(() => {
    if (models.length === 0) return;
    const hasDefault = models.some((m) => m.id === DEFAULT_MODEL_ID);
    if (!hasDefault) {
      const firstRecommended = models.find((m) => m.recommended);
      setSelectedModel(firstRecommended?.id ?? models[0].id);
    }
  }, [models]);

  /* --- react to SSE errors --------------------------------------- */
  useEffect(() => {
    if (!error) {
      lastErrorRef.current = null;
      return;
    }
    if (lastErrorRef.current === error) return;
    lastErrorRef.current = error;

    toast.error("Generation failed", { description: error });
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: `Error: ${error}` },
    ]);
  }, [error]);

  /* --- react to completion --------------------------------------- */
  useEffect(() => {
    if (!done) return;
    if (generationStart != null) {
      setGenerationTime(Date.now() - generationStart);
    }

    /*
     * Distinguish "first generation" from "iteration" so the chat
     * bubble reads naturally for each flow.
     */
    const wasIterate = lastActionRef.current === "iterate";
    const assistantContent = wasIterate
      ? "Updated the app — changes are live in the panel."
      : "Generated successfully — code is live in the panel.";

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: assistantContent },
    ]);

    /*
     * Append the assistant turn to the backend `history`. We use the
     * full final `code` (NOT the short chat summary) so the model
     * has the complete prior context to revise against on the next
     * iterate call.
     *
     * Skip when the run errored out — the assistant turn never
     * produced a valid response, so adding it would poison future
     * iterations. The error effect above already surfaces the
     * failure to the user.
     */
    if (!error) {
      setHistory((prev) => [...prev, { role: "assistant", content: code }]);
    }

    /*
     * Snapshot the prompt that produced the current code, then
     * compute the estimated cost for the StatsBar. We use the
     * model the run was sent with (`selectedModel` at the moment
     * `done` flipped) so the cost is consistent with the model
     * banner shown elsewhere.
     */
    let promptForRun = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        promptForRun = messages[i].content;
        break;
      }
    }
    setLastRunPrompt(promptForRun);
    const modelMeta: ModelInfo | undefined = models.find(
      (m) => m.id === selectedModel,
    );
    setEstimatedCostUsd(estimateCostUsd(promptForRun, code, modelMeta));

    // Progressive disclosure: the preview panel slides in now that
    // the latest run has produced actual code to render.
    setShowPreview(true);
    // Auto-switch to the Preview tab on the right column.
    setActiveTab("preview");
    setMobileTab("preview");
    toast.success(wasIterate ? "Update complete" : "Generation complete", {
      description: generationTime
        ? `Took ${(generationTime / 1000).toFixed(1)}s`
        : "Code is ready to preview and download.",
    });

    /*
     * Auto-save the project to the backend after generation completes.
     * - New project (no `currentProjectId`): create via POST.
     * - Iterating on a loaded project: update via PATCH.
     * Non-blocking and non-fatal — the code is already in the
     * editor; if the save fails we just toast a warning.
     *
     * Closure values (`code`, `title`, `selectedModel`,
     * `currentProjectId`, `messages`, `history`) are read at the
     * moment `done` flips true. The deps array intentionally stays
     * at `[done]` because we don't want to re-fire when any of
     * these mutate post-completion (e.g. user toggles a tab, model
     * picker).
     */
    void (async () => {
      try {
        // Backend stores only the original prompt, not the full chat
        // history. Use the most recent user message as the prompt
        // for the saved project.
        let prompt = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            prompt = messages[i].content;
            break;
          }
        }
        if (currentProjectId === null) {
          const created = await createProject({
            title: title || "Untitled",
            prompt,
            code,
            model: selectedModel,
          });
          setCurrentProjectId(created.id);
        } else {
          await updateProject(currentProjectId, {
            code,
            title: title || "Untitled",
          });
        }
      } catch (err) {
        // Non-fatal — the generation itself succeeded; the save just failed.
        const message = err instanceof Error ? err.message : String(err);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("Auto-save failed:", message);
        }
        toast.error("Couldn't save project", {
          description:
            "Your code is still in the editor, but it wasn't saved to history.",
        });
      }
    })();

    // We intentionally exclude `generationStart`, `generationTime`,
    // `code`, `title`, `selectedModel`, `currentProjectId`,
    // `messages`, and `history` from deps to avoid re-firing on
    // every timing/state update; the guard is "this run just
    // produced a `done` event".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  /* --- handlers --------------------------------------------------- */

  /*
   * The mode flag is the key piece of state for Phase 4 chat
   * iteration. "generation" sends to /api/generate; "iteration"
   * sends to /api/iterate with the current `code` + `history`.
   * The flag is derived rather than stored, so it can never go
   * stale:
   *
   *   - If we have no code yet (or we just clicked "New project"),
   *     the next send is generation.
   *   - If we already have code on screen and aren't currently
   *     streaming, the next send is iteration.
   *   - While streaming, the input is disabled and the mode
   *     question is moot (the streaming indicator is what the
   *     user is looking at).
   */
  const mode: BuilderMode = !isStreaming && code.length > 0 ? "iteration" : "generation";

  const handleSend = useCallback(
    async (prompt: string): Promise<void> => {
      const trimmed = prompt.trim();
      if (!trimmed || isStreaming) return;

      // Recompute the mode at the moment of send so the branch
      // below uses the most up-to-date value of `code` (rather
      // than the `mode` captured in this callback's closure,
      // which may be stale across re-renders).
      const isIteration = code.length > 0;

      // Reset the timer for the new run and append the user turn
      // to BOTH the UI chat list and the backend history list.
      setGenerationStart(Date.now());
      setGenerationTime(null);
      // The cost from the previous run is no longer relevant — the
      // StatsBar will pick up the new estimate when the new run
      // finishes.
      setEstimatedCostUsd(null);
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setHistory((prev) => [...prev, { role: "user", content: trimmed }]);

      // Mark which kind of send we're about to do so the `done`
      // effect can pick the right assistant-bubble text and
      // toast copy ("Generated" vs "Updated").
      lastActionRef.current = isIteration ? "iterate" : "start";

      // Progressive disclosure: reveal the code panel as soon as the
      // user has committed to a prompt, so the streaming output
      // lands in an already-visible surface. Preview is held back
      // until the `done` event fires in the SSE effect above.
      setShowCode(true);
      setActiveTab("code");
      setMobileTab("code");

      try {
        if (isIteration) {
          // Chat-style follow-up: hand the backend the current
          // code + full prior history so it can produce a
          // revised version.
          await iterate({
            prompt: trimmed,
            currentCode: code,
            history,
            model: selectedModel,
          });
        } else {
          // Initial generation: no prior code or history to seed.
          await start(trimmed, selectedModel);
        }
      } catch (err) {
        // Network/abort errors. The SSE hook already populates
        // `error`; the error-effect above surfaces it.
        const message = err instanceof Error ? err.message : String(err);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(isIteration ? "iterate() threw:" : "start() threw:", message);
        }
      }
    },
    [isStreaming, selectedModel, start, iterate, code, history],
  );

  const handleNewProject = useCallback((): void => {
    reset();
    setMessages([]);
    setHistory([]);
    setGenerationStart(null);
    setGenerationTime(null);
    setEstimatedCostUsd(null);
    setLastRunPrompt("");
    // Collapse the shell back to the "describe your app" hero —
    // the code and preview panels slide away.
    setShowCode(false);
    setShowPreview(false);
    setActiveTab("code");
    setMobileTab("chat");
    // Forget the current project — the next "done" event will
    // create a fresh row in the backend instead of updating one.
    setCurrentProjectId(null);
    // Reset the action tracker so the next completion shows
    // "Generated", not "Updated".
    lastActionRef.current = null;
  }, [reset]);

  const handleDownload = useCallback((): void => {
    if (!code.trim()) {
      toast.error("Nothing to download yet", {
        description: "Generate some code first, then try again.",
      });
      return;
    }
    const zip = new JSZip();
    zip.file("index.html", code);
    // Auto-generated README so the user can re-open the project
    // later and remember what they asked for, which model produced
    // it, and when. Falls back gracefully when the title hasn't
    // been set yet by the backend.
    const readmeTitle = (title || "").trim() || "Untitled";
    zip.file(
      "README.md",
      buildReadme({
        title: readmeTitle,
        prompt: lastRunPrompt,
        model: selectedModel,
        generatedAt: new Date(),
      }),
    );
    const slug = slugifyTitle(readmeTitle);
    const filename = slug ? `${slug}.zip` : DEFAULT_DOWNLOAD_FILENAME;
    void zip.generateAsync({ type: "blob" }).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revocation so Safari has a chance to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    toast.success("Download started", {
      description: filename,
    });
  }, [code, title, lastRunPrompt, selectedModel]);

  const handleHistoryOpen = useCallback((): void => {
    setHistoryOpen(true);
  }, []);

  /*
   * Restore the builder to a saved project. Called by
   * `<HistoryDrawer>` after the drawer fetches the full row
   * (including `code`). The SSE hook is hydrated with the saved
   * `code` + `title` (no streaming), the chat is synthesised from
   * the original `prompt`, the model picker is restored, and both
   * panels are revealed with the Preview tab active so the user
   * immediately sees the loaded app. The cost estimate is also
   * recomputed from the loaded prompt + code so the StatusBar
   * shows the right number for a loaded project.
   */
  const handleLoadProject = useCallback(
    (project: ProjectFull): void => {
      // Restore the SSE state from the saved project (no streaming).
      load(project.code, project.title);
      // Synthesize chat messages from the saved prompt (backend doesn't
      // store full conversation history — just the original prompt).
      setMessages([
        { role: "user", content: project.prompt },
        { role: "assistant", content: "Loaded from history — code is live in the panel." },
      ]);
      /*
       * Seed the backend `history` so the first iterate-after-load
       * has the original prompt + code as its prior context. This
       * is a best-effort reconstruction: the backend only persists
       * the original `prompt` and final `code`, so we can only
       * synthesize a single-turn history. Subsequent iterations
       * will accumulate from here.
       */
      setHistory([
        { role: "user", content: project.prompt },
        { role: "assistant", content: project.code },
      ]);
      // Restore the model selection.
      setSelectedModel(project.model);
      // Track which project is loaded (for save-on-done updates).
      setCurrentProjectId(project.id);
      // Reveal the panels and switch to Preview so the user sees the result.
      setShowCode(true);
      setShowPreview(true);
      setActiveTab("preview");
      setMobileTab("preview");
      // Close the drawer.
      setHistoryOpen(false);
      // Reset timing (we don't have the original generation time).
      setGenerationStart(null);
      setGenerationTime(null);
      // Re-derive the cost from the loaded prompt + code. This
      // makes the StatusBar useful for loaded projects, not just
      // freshly-completed ones.
      setLastRunPrompt(project.prompt);
      const modelMeta: ModelInfo | undefined = models.find(
        (m) => m.id === project.model,
      );
      setEstimatedCostUsd(
        estimateCostUsd(project.prompt, project.code, modelMeta),
      );
      // Reset the action tracker so the next completion (if any)
      // shows "Updated", not "Generated" — the next send will be
      // an iteration on top of the loaded code.
      lastActionRef.current = null;
      toast.success("Project loaded", {
        description: project.title,
      });
    },
    [load, models],
  );

  /* --- layout ----------------------------------------------------- */
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Toaster position="bottom-right" richColors closeButton />

      <TopBar
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        onDownload={handleDownload}
        onHistoryOpen={handleHistoryOpen}
        projectTitle={title}
        onNewProject={handleNewProject}
        isStreaming={isStreaming}
        hasContent={messages.length > 0}
        hasDownload={code.trim().length > 0}
      />

      {/* Thin amber progress bar — only visible while streaming. */}
      <GenerationProgressBar isStreaming={isStreaming} />

      <div className="relative flex-1 overflow-hidden">
        <PanelLayout
          showCode={showCode}
          showPreview={showPreview}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          mobileTab={mobileTab}
          onMobileTabChange={setMobileTab}
          chatPanel={
            <ChatPanel
              messages={messages}
              onSend={handleSend}
              isStreaming={isStreaming}
              status={status}
              mode={mode}
              fullWidth={!showCode}
            />
          }
          codePanel={
            <ErrorBoundary>
              <CodePanel code={code} isStreaming={isStreaming} />
            </ErrorBoundary>
          }
          previewPanel={
            <ErrorBoundary>
              <PreviewPanel
                html={code}
                isStreaming={isStreaming}
                projectTitle={title}
              />
            </ErrorBoundary>
          }
        />
      </div>

      {/*
        History drawer — slides in from the left, lists every saved
        project, and hands the chosen one back via `handleLoadProject`.
        The drawer itself owns the list/delete UX; the builder only
        needs to know which project (if any) is currently loaded so
        it can highlight it and route save-on-done to the right row.
      */}
      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onLoadProject={handleLoadProject}
        activeProjectId={currentProjectId}
      />

      <StatusBar
        model={selectedModel}
        status={status}
        isStreaming={isStreaming}
        generationTime={generationTime}
        estimatedCostUsd={estimatedCostUsd}
      />
    </div>
  );
}
