/**
 * Builder page.
 *
 * The main app surface for Forge. Owns:
 *
 *   - The chat history (`messages`)
 *   - The model catalog and currently-selected model
 *   - Timing of the active generation
 *   - Download (zip) of the latest generated code
 *   - The "New Project" reset action
 *   - The active tab in the right column (Code / Preview)
 *   - The active tab on mobile (Chat / Code / Preview)
 *   - The history-drawer open state + the currently-loaded project id
 *   - Auto-save to the backend when a generation completes
 *     (POST for new projects, PATCH for iterations on a loaded one)
 *
 * Renders the shared `TopBar` + `GenerationProgressBar` +
 * `PanelLayout(ChatPanel | CodePanel | PreviewPanel)` +
 * `HistoryDrawer` + `StatusBar` chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";

import { useSSE } from "@/hooks/useSSE";
import { createProject, health, updateProject, type ModelInfo, type ProjectFull } from "@/lib/api";
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

/** A single chat turn (user prompt or assistant acknowledgement). */
interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * Fallback model list used when the backend health endpoint is
 * unreachable. Lets the user see the model picker populated even
 * before the API responds (or in offline demos).
 */
const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "opencode-go/minimax-m3",
    name: "MiniMax M3",
    cost_input: 0.14,
    cost_output: 0.28,
    endpoint: "/api/generate",
  },
  {
    id: "opencode-go/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    cost_input: 0.14,
    cost_output: 0.28,
    endpoint: "/api/generate",
  },
  {
    id: "opencode-go/qwen-3.7-plus",
    name: "Qwen 3.7 Plus",
    cost_input: 0.4,
    cost_output: 1.2,
    endpoint: "/api/generate",
  },
];

/** The default model the picker initializes to. */
const DEFAULT_MODEL_ID = "opencode-go/deepseek-v4-flash";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Builder() {
  /* --- chat state ------------------------------------------------- */
  const [messages, setMessages] = useState<Message[]>([]);

  /* --- model state ------------------------------------------------ */
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);

  /* --- timing state ---------------------------------------------- */
  const [generationStart, setGenerationStart] = useState<number | null>(null);
  const [generationTime, setGenerationTime] = useState<number | null>(null);

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
  const { code, status, isStreaming, error, done, title, start, reset, load } = useSSE();

  // Tracks whether we've already surfaced the latest `error` event
  // to the chat + toast. SSE errors arrive as events (not thrown),
  // so we react via this effect.
  const lastErrorRef = useRef<string | null>(null);

  /* --- on mount: load model catalog ------------------------------ */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await health();
        if (cancelled) return;
        setModels(res.models);
        // If the default model isn't in the catalog, fall back to the
        // first available one.
        if (res.models.length > 0) {
          const hasDefault = res.models.some((m) => m.id === DEFAULT_MODEL_ID);
          if (!hasDefault) {
            setSelectedModel(res.models[0].id);
          }
        }
      } catch (err) {
        if (cancelled) return;
        // Non-fatal — show a toast and let the fallback models stand in.
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Couldn't reach the backend", {
          description:
            "Using a fallback model list. Generation will still try to connect when you send a prompt.",
        });
        setModels([...FALLBACK_MODELS]);
        // Reference `message` to avoid the unused-var lint while
        // still logging it for debugging.
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("health() failed:", message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "Generated successfully — code is live in the panel.",
      },
    ]);
    // Progressive disclosure: the preview panel slides in now that
    // the latest run has produced actual code to render.
    setShowPreview(true);
    // Auto-switch to the Preview tab on the right column.
    setActiveTab("preview");
    setMobileTab("preview");
    toast.success("Generation complete", {
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
     * `currentProjectId`, `messages`) are read at the moment `done`
     * flips true. The deps array intentionally stays at `[done]`
     * because we don't want to re-fire when any of these mutate
     * post-completion (e.g. user toggles a tab, model picker).
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
    // `code`, `title`, `selectedModel`, `currentProjectId`, and
    // `messages` from deps to avoid re-firing on every timing/state
    // update; the guard is "this run just produced a `done` event".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  /* --- handlers --------------------------------------------------- */

  const handleSend = useCallback(
    async (prompt: string): Promise<void> => {
      const trimmed = prompt.trim();
      if (!trimmed || isStreaming) return;

      // Reset the timer for the new run and append the user turn.
      setGenerationStart(Date.now());
      setGenerationTime(null);
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

      // Progressive disclosure: reveal the code panel as soon as the
      // user has committed to a prompt, so the streaming output
      // lands in an already-visible surface. Preview is held back
      // until the `done` event fires in the SSE effect above.
      setShowCode(true);
      setActiveTab("code");
      setMobileTab("code");

      try {
        await start(trimmed, selectedModel);
      } catch (err) {
        // Network/abort errors. The SSE hook already populates
        // `error`; the error-effect above surfaces it.
        const message = err instanceof Error ? err.message : String(err);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("start() threw:", message);
        }
      }
    },
    [isStreaming, selectedModel, start],
  );

  const handleNewProject = useCallback((): void => {
    reset();
    setMessages([]);
    setGenerationStart(null);
    setGenerationTime(null);
    // Collapse the shell back to the "describe your app" hero —
    // the code and preview panels slide away.
    setShowCode(false);
    setShowPreview(false);
    setActiveTab("code");
    setMobileTab("chat");
    // Forget the current project — the next "done" event will
    // create a fresh row in the backend instead of updating one.
    setCurrentProjectId(null);
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
    void zip.generateAsync({ type: "blob" }).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "forge-app.zip";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revocation so Safari has a chance to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }, [code]);

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
   * immediately sees the loaded app.
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
      toast.success("Project loaded", {
        description: project.title,
      });
    },
    [load],
  );

  /* --- derived UI flags ------------------------------------------ */
  const modelList: ModelInfo[] = useMemo(
    () => (models.length > 0 ? models : FALLBACK_MODELS),
    [models],
  );

  /* --- layout ----------------------------------------------------- */
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Toaster position="bottom-right" richColors closeButton />

      <TopBar
        models={modelList}
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
      />
    </div>
  );
}
