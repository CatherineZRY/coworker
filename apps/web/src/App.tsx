import type { AgentId, RunEvent } from "@coworker/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Boxes,
  Check,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardView } from "@/components/board-view";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { SessionPicker } from "@/components/session-picker";
import { TaskPanel } from "@/components/task-panel";
import { Button } from "@/components/ui/button";
import { ApiError, api, eventStreamUrl } from "@/lib/api";
import type { Notify, NotifyKind } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

type LiveState = "connecting" | "live" | "offline";

interface Toast {
  id: number;
  kind: NotifyKind;
  message: string;
}

export function App() {
  const queryClient = useQueryClient();
  const [selectedBoardId, setSelectedBoardId] = usePersistentState("coworker.board", "");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<AgentId | "all">("all");
  const [live, setLive] = useState<LiveState>("connecting");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const toastSeq = useRef(0);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  const notify = useCallback<Notify>((kind, message) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5_000);
  }, []);

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.sessions(),
    refetchInterval: 15_000,
  });

  const sessions = useMemo(
    () =>
      [...(sessionsQuery.data?.sessions ?? [])].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      ),
    [sessionsQuery.data],
  );
  const boards = sessionsQuery.data?.boards ?? [];

  useEffect(() => {
    if (!sessionsQuery.data) return;
    const exists = boards.some((board) => board.id === selectedBoardId);
    if (exists) return;
    const preferred =
      sessions.find((session) => !session.thread.archived)?.boardId ??
      sessions[0]?.boardId ??
      sessionsQuery.data.defaultBoard.id;
    setSelectedBoardId(preferred);
  }, [sessionsQuery.data, boards, sessions, selectedBoardId, setSelectedBoardId]);

  const boardQuery = useQuery({
    queryKey: ["board", selectedBoardId],
    queryFn: () => api.board(selectedBoardId),
    enabled: Boolean(selectedBoardId),
    refetchInterval: 5_000,
  });
  const snapshot = boardQuery.data ?? null;

  useEffect(() => {
    if (!selectedBoardId) {
      setLive("offline");
      return;
    }
    setLive("connecting");
    const source = new EventSource(eventStreamUrl(selectedBoardId));
    source.onopen = () => setLive("live");
    source.onerror = () => setLive("offline");
    source.onmessage = (message) => {
      let event: RunEvent;
      try {
        event = JSON.parse(message.data) as RunEvent;
      } catch {
        return;
      }
      if (event.type === "session.updated") {
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
      if (event.type !== "run.progress") {
        void queryClient.invalidateQueries({ queryKey: ["board", selectedBoardId] });
        if (event.taskId) {
          void queryClient.invalidateQueries({ queryKey: ["task", event.taskId] });
        }
      }
      if (event.runId) {
        void queryClient.invalidateQueries({ queryKey: ["run", event.runId] });
      }
    };
    return () => source.close();
  }, [selectedBoardId, queryClient]);

  const syncSessions = useMutation({
    mutationFn: api.syncSessions,
    onSuccess: () => {
      notify("success", "Codex sessions synced");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const renameBoard = useMutation({
    mutationFn: (title: string) =>
      api.renameBoard(selectedBoardId, title.trim() ? title.trim() : null),
    onSuccess: () => {
      setEditingTitle(false);
      notify("success", "Board renamed");
      void queryClient.invalidateQueries({ queryKey: ["board", selectedBoardId] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const board = snapshot?.board ?? boards.find((item) => item.id === selectedBoardId) ?? null;

  const counts = useMemo(() => {
    const tasks = snapshot?.tasks ?? [];
    return {
      total: tasks.length,
      running: tasks.filter((task) => task.status === "running").length,
      review: tasks.filter((task) => task.status === "review").length,
      attention: tasks.filter((task) => task.status === "changes_requested").length,
      done: tasks.filter((task) => task.status === "done").length,
      activeRuns: snapshot?.activeRuns ?? 0,
    };
  }, [snapshot]);

  const filterAgents = useMemo(() => {
    const agents = new Set<AgentId>();
    for (const task of snapshot?.tasks ?? []) {
      if (task.latestRun) agents.add(task.latestRun.agent);
    }
    return [...agents];
  }, [snapshot]);

  const closeTask = useCallback(() => setOpenTaskId(null), []);

  const unauthorized =
    sessionsQuery.error instanceof ApiError && sessionsQuery.error.status === 401;

  const fatalError = sessionsQuery.error ?? boardQuery.error;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <div className="flex shrink-0 items-center gap-2.5 pr-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
              <Boxes className="size-4" />
            </div>
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold text-slate-900">coworker</div>
              <div className="text-[10px] text-muted-foreground">Codex worker boards</div>
            </div>
          </div>

          <div className="hidden h-6 w-px shrink-0 bg-border sm:block" />

          <SessionPicker
            sessions={sessions}
            boards={boards}
            selectedBoardId={selectedBoardId || null}
            selectedTitle={board?.title ?? null}
            onSelect={(boardId) => {
              setSelectedBoardId(boardId);
              setOpenTaskId(null);
              setSearch("");
              setAgentFilter("all");
            }}
            onSync={() => syncSessions.mutate()}
            syncing={syncSessions.isPending}
          />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LiveIndicator state={live} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void sessionsQuery.refetch();
                if (selectedBoardId) void boardQuery.refetch();
              }}
              title="Refresh board"
            >
              <RefreshCw className={cn("size-3.5", boardQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setNewTaskOpen(true)}
              disabled={!selectedBoardId || !board}
            >
              <Plus className="size-3.5" />
              New task
            </Button>
          </div>
        </div>

        {board && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 px-4 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {editingTitle ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") renameBoard.mutate(titleDraft);
                      if (event.key === "Escape") setEditingTitle(false);
                    }}
                    className="h-7 w-64 rounded border border-blue-300 px-2 text-xs outline-none ring-2 ring-blue-100"
                  />
                  <button
                    type="button"
                    className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                    onClick={() => renameBoard.mutate(titleDraft)}
                    title="Save title"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100"
                    onClick={() => setEditingTitle(false)}
                    title="Cancel"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="group flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                  onClick={() => {
                    setTitleDraft(board.title);
                    setEditingTitle(true);
                  }}
                  title="Rename this board"
                >
                  <h1 className="truncate text-sm font-semibold text-slate-800">{board.title}</h1>
                  <Pencil className="size-3 shrink-0 text-slate-300 group-hover:text-slate-500" />
                </button>
              )}
              {board.cwd && (
                <span className="hidden items-center gap-1 truncate font-mono text-[10px] text-muted-foreground lg:flex">
                  <GitBranch className="size-3" />
                  {board.cwd}
                  {board.gitBranch ? ` (${board.gitBranch})` : ""}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <StatChip label="tasks" value={counts.total} />
              {counts.running > 0 && (
                <StatChip label="running" value={counts.running} tone="blue" />
              )}
              {counts.review > 0 && (
                <StatChip label="in review" value={counts.review} tone="amber" />
              )}
              {counts.attention > 0 && (
                <StatChip label="needs changes" value={counts.attention} tone="rose" />
              )}
              {counts.activeRuns > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                  <Zap className="size-3" />
                  {counts.activeRuns} active run{counts.activeRuns === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter tasks…"
                  className="h-8 w-52 rounded-md border border-border bg-white pl-7 pr-7 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                {search && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setSearch("")}
                    title="Clear filter"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <select
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.target.value as AgentId | "all")}
                className="h-8 rounded-md border border-border bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400"
                title="Filter by worker agent"
              >
                <option value="all">All agents</option>
                {filterAgents.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent}
                  </option>
                ))}
                {!filterAgents.includes("claude-code") && (
                  <option value="claude-code">claude-code</option>
                )}
                {!filterAgents.includes("codex") && <option value="codex">codex</option>}
                {!filterAgents.includes("cursor") && <option value="cursor">cursor</option>}
              </select>
            </div>
          </div>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-4">
        {fatalError && !snapshot ? (
          <ErrorPanel error={fatalError} unauthorized={unauthorized} />
        ) : (sessionsQuery.isLoading || (boardQuery.isLoading && !snapshot)) && !snapshot ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Loading session boards…
          </div>
        ) : snapshot && board ? (
          <>
            {snapshot.tasks.length === 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-slate-700">This board is empty.</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Create a task here, or ask Codex to dispatch one into this session's board.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setNewTaskOpen(true)}>
                  <Plus className="size-3.5" />
                  Create the first task
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <BoardView
                boardId={board.id}
                snapshot={snapshot}
                search={search}
                agentFilter={agentFilter}
                onOpenTask={setOpenTaskId}
                notify={notify}
              />
            </div>
            <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>Drag a card to change status (valid transitions only).</span>
              <span className="text-slate-300">·</span>
              <span>Click a card to review, comment, and rerun.</span>
              <span className="ml-auto flex items-center gap-1">
                <LastUpdated value={boardQuery.dataUpdatedAt} />
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a Codex session to open its board.
          </div>
        )}
      </main>

      {openTaskId && board && (
        <TaskPanel
          boardId={board.id}
          boardTitle={board.title}
          taskId={openTaskId}
          onClose={closeTask}
          notify={notify}
        />
      )}

      {board && (
        <NewTaskDialog
          open={newTaskOpen}
          boardId={board.id}
          boardTitle={board.title}
          onClose={() => setNewTaskOpen(false)}
          onCreated={(taskId) => setOpenTaskId(taskId)}
          notify={notify}
        />
      )}

      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </div>
  );
}

function LiveIndicator({ state }: { state: LiveState }) {
  const config =
    state === "live"
      ? {
          label: "Live",
          className: "border-emerald-200 bg-emerald-50 text-emerald-700",
          Icon: Wifi,
        }
      : state === "connecting"
        ? {
            label: "Connecting",
            className: "border-slate-200 bg-slate-50 text-slate-500",
            Icon: Loader2,
          }
        : {
            label: "Polling",
            className: "border-amber-200 bg-amber-50 text-amber-700",
            Icon: WifiOff,
          };
  const Icon = config.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium",
        config.className,
      )}
      title={
        state === "live"
          ? "Streaming board events"
          : "Live stream unavailable — the board still refreshes every few seconds"
      }
    >
      <Icon className={cn("size-3", state === "connecting" && "animate-spin")} />
      {config.label}
    </span>
  );
}

function StatChip({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "blue" | "amber" | "rose";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tones[tone],
      )}
    >
      <span className="font-mono">{value}</span>
      {label}
    </span>
  );
}

function LastUpdated({ value }: { value: number }) {
  return (
    <>
      <RefreshCw className="size-2.5" />
      {value ? `updated ${formatTime(value)}` : "not loaded"}
    </>
  );
}

function ErrorPanel({ error, unauthorized }: { error: unknown; unauthorized: boolean }) {
  if (unauthorized) {
    return (
      <div className="mx-auto mt-10 w-full max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertCircle className="size-4" />
          Authentication required
        </div>
        <p className="mt-2 text-xs leading-5 text-amber-800">
          This board is protected by a local token. Open the URL printed by{" "}
          <code className="rounded bg-white/70 px-1">coworker start</code> (it includes the token),
          or run <code className="rounded bg-white/70 px-1">coworker open</code> again. The token is
          stored at <code className="rounded bg-white/70 px-1">~/.coworker/token</code>.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-10 w-full max-w-lg rounded-lg border border-rose-200 bg-rose-50 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-rose-900">
        <AlertCircle className="size-4" />
        Could not reach the coworker daemon
      </div>
      <p className="mt-2 text-xs leading-5 text-rose-800">{messageOf(error)}</p>
      <pre className="mt-2 overflow-x-auto rounded bg-white/70 p-2 text-[11px] text-rose-900">
        coworker start
      </pre>
      <p className="mt-2 text-[11px] text-rose-700">
        Start the local service, then refresh this page.
      </p>
    </div>
  );
}

function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-lg border bg-white p-3 text-xs shadow-lg",
            toast.kind === "success" && "border-emerald-200",
            toast.kind === "error" && "border-rose-200",
            toast.kind === "info" && "border-blue-200",
          )}
        >
          <span
            className={cn(
              "mt-0.5 size-2 shrink-0 rounded-full",
              toast.kind === "success" && "bg-emerald-500",
              toast.kind === "error" && "bg-rose-500",
              toast.kind === "info" && "bg-blue-500",
            )}
          />
          <p className="min-w-0 flex-1 leading-5 text-slate-700">{toast.message}</p>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600"
            onClick={() => onDismiss(toast.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function usePersistentState(key: string, initial: string) {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // localStorage can be unavailable in private contexts; selection still works in-memory
      }
    },
    [key],
  );
  return [value, set] as const;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
