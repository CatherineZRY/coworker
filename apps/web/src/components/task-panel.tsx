import type { AgentId, Artifact, Review, Run, Severity } from "@coworker/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileDiff,
  GitBranch,
  Info,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { DiffView, type DraftComment } from "@/components/diff-view";
import {
  AgentBadge,
  RunStatusBadge,
  SeverityBadge,
  TaskStatusBadge,
  VerdictBadge,
} from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, api, type EventsResponse } from "@/lib/api";
import type { Notify } from "@/lib/types";
import { cn, formatDuration, formatTime, truncate } from "@/lib/utils";

type Tab = "overview" | "runs" | "review" | "diff";

interface TaskPanelProps {
  boardId: string;
  boardTitle: string;
  taskId: string;
  onClose: () => void;
  notify: Notify;
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Info }> = [
  { id: "overview", label: "Overview", icon: Info },
  { id: "runs", label: "Runs", icon: Activity },
  { id: "review", label: "Review", icon: MessageSquare },
  { id: "diff", label: "Diff", icon: FileDiff },
];

const ACTIVE_RUN = new Set(["queued", "starting", "running"]);
const TERMINAL_RUN = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export function TaskPanel({ boardId, boardTitle, taskId, onClose, notify }: TaskPanelProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  const [reviewSummary, setReviewSummary] = useState("");
  const [generalFile, setGeneralFile] = useState("");
  const [generalLine, setGeneralLine] = useState("");
  const [generalSeverity, setGeneralSeverity] = useState<Severity>("major");
  const [generalBody, setGeneralBody] = useState("");
  const [dispatchAgent, setDispatchAgent] = useState<AgentId>("claude-code");
  const [dispatchModel, setDispatchModel] = useState("");
  const [dispatchBaseRef, setDispatchBaseRef] = useState("");
  const [dispatchPrompt, setDispatchPrompt] = useState("");
  const [dispatchTimeout, setDispatchTimeout] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.task(taskId),
    refetchInterval: 5_000,
  });
  const task = taskQuery.data?.task;
  const activeRun = task?.runs.find((run) => ACTIVE_RUN.has(run.status)) ?? null;

  useEffect(() => {
    if (!task) return;
    if (!selectedRunId || !task.runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(task.latestRun?.id ?? null);
    }
  }, [task, selectedRunId]);

  useEffect(() => {
    if (!task || dirty) return;
    setTitle(task.title);
    setDescription(task.description);
  }, [task?.updatedAt, task?.id, dirty, task]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: drafts belong to the selected run and must reset when it changes
  useEffect(() => {
    setDrafts([]);
    setReviewSummary("");
  }, [selectedRunId]);

  const runQuery = useQuery({
    queryKey: ["run", selectedRunId],
    queryFn: () => api.run(selectedRunId as string),
    enabled: Boolean(selectedRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status && ACTIVE_RUN.has(status) ? 2_000 : false;
    },
  });
  const run = runQuery.data?.run ?? task?.runs.find((item) => item.id === selectedRunId) ?? null;
  const reviews = runQuery.data?.reviews ?? [];
  const artifacts = runQuery.data?.artifacts ?? [];
  const comments = useMemo(() => reviews.flatMap((review) => review.comments), [reviews]);

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents,
    staleTime: 60_000,
  });
  const availability = useMemo(() => {
    const map = new Map<AgentId, boolean>();
    for (const agent of agentsQuery.data?.agents ?? []) map.set(agent.id, agent.available);
    return map;
  }, [agentsQuery.data]);

  const eventsQuery = useQuery({
    queryKey: ["events", boardId],
    queryFn: () => api.events(boardId, 0, 200),
    refetchInterval: 10_000,
  });
  const taskEvents = useMemo(
    () =>
      (eventsQuery.data?.events ?? [])
        .filter((event) => event.taskId === taskId)
        .slice(-40)
        .reverse(),
    [eventsQuery.data, taskId],
  );

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
    void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["run", selectedRunId] });
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["events", boardId] });
  };

  const saveTask = useMutation({
    mutationFn: () => api.patchTask(taskId, { title: title.trim(), description }),
    onSuccess: () => {
      setDirty(false);
      notify("success", "Task saved");
      invalidateAll();
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const dispatch = useMutation({
    mutationFn: () =>
      api.dispatch({
        boardId,
        taskId,
        agent: dispatchAgent,
        model: dispatchModel.trim() || undefined,
        baseRef: dispatchBaseRef.trim() || undefined,
        prompt: dispatchPrompt.trim() || undefined,
        timeoutSec: dispatchTimeout.trim() ? Number.parseInt(dispatchTimeout, 10) : undefined,
      }),
    onSuccess: (result) => {
      notify("success", `Dispatched attempt ${(task?.runs.length ?? 0) + 1} to ${dispatchAgent}`);
      setSelectedRunId(result.runId);
      setTab("runs");
      invalidateAll();
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const cancelRun = useMutation({
    mutationFn: (runId: string) => api.cancelRun(runId),
    onSuccess: () => {
      notify("info", "Run cancelled");
      invalidateAll();
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const submitReview = useMutation({
    mutationFn: (verdict: "approved" | "rejected") => {
      if (!run) throw new Error("Select a run first");
      return api.submitReview({
        runId: run.id,
        verdict,
        summary: reviewSummary.trim() || undefined,
        comments: drafts,
      });
    },
    onSuccess: (_result, verdict) => {
      notify(
        verdict === "approved" ? "success" : "info",
        verdict === "approved" ? "Approved and moved to Done" : "Review recorded",
      );
      setDrafts([]);
      setReviewSummary("");
      invalidateAll();
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const requestChanges = useMutation({
    mutationFn: () => {
      if (!run) throw new Error("Select a run first");
      return api.requestChanges({
        runId: run.id,
        comments: drafts,
        summary: reviewSummary.trim() || undefined,
      });
    },
    onSuccess: (result) => {
      notify("success", `Queued attempt ${result.run.attempt} with review feedback`);
      setSelectedRunId(result.run.id);
      setDrafts([]);
      setReviewSummary("");
      setTab("runs");
      invalidateAll();
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const resolveComment = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      api.resolveComment(id, resolved),
    onSuccess: () => invalidateAll(),
    onError: (error) => notify("error", messageOf(error)),
  });

  const removeTask = useMutation({
    mutationFn: () => api.deleteTask(taskId),
    onSuccess: () => {
      notify("success", "Task deleted");
      onClose();
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const moveToReady = useMutation({
    mutationFn: () => api.patchTask(taskId, { status: "ready" }),
    onSuccess: () => {
      notify("success", "Task moved to Ready");
      invalidateAll();
    },
    onError: (error) => notify("error", messageOf(error)),
  });

  const addGeneralComment = () => {
    if (!generalBody.trim()) return;
    const line = generalLine.trim() ? Number.parseInt(generalLine, 10) : undefined;
    setDrafts((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        filePath: generalFile.trim() || undefined,
        lineStart: line && Number.isFinite(line) ? line : undefined,
        side: line ? "new" : undefined,
        severity: generalSeverity,
        body: generalBody.trim(),
      },
    ]);
    setGeneralBody("");
    setGeneralLine("");
  };

  const reviewable = run != null && TERMINAL_RUN.has(run.status);
  const canApprove = run?.status === "succeeded";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close task panel"
        className="absolute inset-0 cursor-default bg-slate-900/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-[900px] flex-col border-l border-border bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{boardTitle}</span>
              <ChevronRight className="size-3" />
              <span className="font-mono">{taskId}</span>
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-900">
              {task?.title ?? "Loading task…"}
            </h2>
            {task && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <TaskStatusBadge status={task.status} />
                {task.latestRun && <AgentBadge agent={task.latestRun.agent} />}
                {task.latestRun && <RunStatusBadge status={task.latestRun.status} />}
                <span className="text-[11px] text-muted-foreground">
                  updated {formatTime(task.updatedAt)}
                </span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title="Refresh"
              onClick={() => {
                void taskQuery.refetch();
                if (selectedRunId) void runQuery.refetch();
                void eventsQuery.refetch();
              }}
            >
              <RefreshCw className={cn("size-4", taskQuery.isFetching && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <div className="flex gap-1 border-b border-border px-4">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            const count =
              entry.id === "runs"
                ? task?.runs.length
                : entry.id === "review"
                  ? reviews.length
                  : undefined;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                  tab === entry.id
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-800",
                )}
              >
                <Icon className="size-3.5" />
                {entry.label}
                {count != null && count > 0 && (
                  <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {taskQuery.isLoading && (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Loading task…
            </div>
          )}
          {taskQuery.isError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {messageOf(taskQuery.error)}
            </div>
          )}

          {task && tab === "overview" && (
            <div className="flex flex-col gap-4">
              <section className="rounded-lg border border-border p-4">
                <label
                  htmlFor="task-title"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  Title
                </label>
                <input
                  id="task-title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setDirty(true);
                  }}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <label
                  htmlFor="task-description"
                  className="mt-3 mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  Description
                </label>
                <textarea
                  id="task-description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDirty(true);
                  }}
                  rows={5}
                  className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Created {formatTime(task.createdAt)} · by {task.createdBy}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!dirty}
                      onClick={() => {
                        setTitle(task.title);
                        setDescription(task.description);
                        setDirty(false);
                      }}
                    >
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      disabled={!dirty || !title.trim() || saveTask.isPending}
                      onClick={() => saveTask.mutate()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Task
                  </h3>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    <Row label="Status" value={<TaskStatusBadge status={task.status} />} />
                    <Row label="Priority" value={String(task.priority)} />
                    <Row
                      label="Labels"
                      value={
                        task.labels.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {task.labels.map((label) => (
                              <Badge
                                key={label}
                                className="border-slate-200 bg-slate-50 text-slate-600"
                              >
                                {label}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          "—"
                        )
                      }
                    />
                    <Row label="Attempts" value={String(task.runs.length)} />
                    <Row label="Reviews" value={String(task.reviewCount)} />
                    <Row
                      label="Open comments"
                      value={
                        <span className={task.unresolvedCommentCount > 0 ? "text-amber-700" : ""}>
                          {task.unresolvedCommentCount}
                        </span>
                      }
                    />
                  </dl>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Actions
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeRun && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cancelRun.mutate(activeRun.id)}
                        disabled={cancelRun.isPending}
                      >
                        <Square className="size-3.5" />
                        Cancel run
                      </Button>
                    )}
                    {["failed", "changes_requested", "cancelled"].includes(task.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => moveToReady.mutate()}
                        disabled={moveToReady.isPending}
                      >
                        <RotateCcw className="size-3.5" />
                        Move to Ready
                      </Button>
                    )}
                    {task.latestRun && TERMINAL_RUN.has(task.latestRun.status) && (
                      <Button variant="outline" size="sm" onClick={() => setTab("review")}>
                        <MessageSquare className="size-3.5" />
                        Review latest
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                  {confirmDelete && (
                    <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                      Delete this task and all attempts? This cannot be undone.
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => removeTask.mutate()}
                          disabled={removeTask.isPending}
                        >
                          Delete
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Dispatch a worker
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    Runs in an isolated git worktree
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-600">Agent</span>
                    <select
                      value={dispatchAgent}
                      onChange={(event) => setDispatchAgent(event.target.value as AgentId)}
                      className="w-full rounded-md border border-border bg-white px-2 py-2 text-xs outline-none focus:border-blue-400"
                    >
                      {(["claude-code", "codex", "cursor", "fake"] as AgentId[]).map((agent) => (
                        <option key={agent} value={agent}>
                          {agent}
                          {availability.get(agent) === false ? " (not found)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-600">Model (optional)</span>
                    <input
                      value={dispatchModel}
                      onChange={(event) => setDispatchModel(event.target.value)}
                      placeholder="default"
                      className="w-full rounded-md border border-border bg-white px-2 py-2 text-xs outline-none focus:border-blue-400"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-600">Base ref (optional)</span>
                    <input
                      value={dispatchBaseRef}
                      onChange={(event) => setDispatchBaseRef(event.target.value)}
                      placeholder="HEAD"
                      className="w-full rounded-md border border-border bg-white px-2 py-2 text-xs outline-none focus:border-blue-400"
                    />
                  </label>
                </div>
                <label className="mt-3 block text-xs">
                  <span className="mb-1 block text-slate-600">
                    Prompt override (optional — leave empty to build from the task and prior review)
                  </span>
                  <textarea
                    value={dispatchPrompt}
                    onChange={(event) => setDispatchPrompt(event.target.value)}
                    rows={3}
                    placeholder="Extra context for the worker…"
                    className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-blue-400"
                  />
                </label>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    Timeout (sec)
                    <input
                      value={dispatchTimeout}
                      onChange={(event) => setDispatchTimeout(event.target.value)}
                      placeholder="config default"
                      inputMode="numeric"
                      className="w-28 rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                    />
                  </label>
                  <Button
                    onClick={() => dispatch.mutate()}
                    disabled={dispatch.isPending || task.status === "done"}
                    title={
                      task.status === "done" ? "Reopen the task before dispatching" : undefined
                    }
                  >
                    <Play className="size-4" />
                    Dispatch attempt {task.runs.length + 1}
                  </Button>
                </div>
              </section>

              {task.latestRun && (
                <section className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Latest attempt
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        #{task.latestRun.attempt}
                      </span>
                      <AgentBadge agent={task.latestRun.agent} />
                      <RunStatusBadge status={task.latestRun.status} />
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {formatTime(task.latestRun.startedAt ?? task.latestRun.createdAt)} ·{" "}
                    {formatDuration(task.latestRun.startedAt, task.latestRun.endedAt)}
                  </div>
                  {task.latestRun.summary && (
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">
                      {truncate(task.latestRun.summary, 1_500)}
                    </p>
                  )}
                  {task.latestRun.error && (
                    <p className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                      {String(task.latestRun.error.message ?? "Run failed")}
                    </p>
                  )}
                  {task.latestRun.diffStat && (
                    <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] leading-5 text-slate-600">
                      {task.latestRun.diffStat}
                    </pre>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setTab("diff")}>
                      <FileDiff className="size-3.5" />
                      View diff
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setTab("runs")}>
                      <Activity className="size-3.5" />
                      All runs
                    </Button>
                  </div>
                </section>
              )}

              <section className="rounded-lg border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Activity
                </h3>
                {taskEvents.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {taskEvents.map((event) => (
                      <li key={event.id} className="flex items-start gap-2 text-xs">
                        <Clock className="mt-0.5 size-3 shrink-0 text-slate-300" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[11px] text-slate-700">
                              {event.type}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatTime(event.createdAt)}
                            </span>
                          </div>
                          {eventSummary(event) && (
                            <p className="mt-0.5 break-words text-[11px] text-slate-500">
                              {eventSummary(event)}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}

          {task && tab === "runs" && (
            <div className="flex flex-col gap-3">
              {task.runs.length === 0 && (
                <EmptyState
                  title="No attempts yet"
                  body="Dispatch a worker from the Overview tab to create the first attempt."
                />
              )}
              {[...task.runs].reverse().map((attempt) => (
                <button
                  key={attempt.id}
                  type="button"
                  onClick={() => setSelectedRunId(attempt.id)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-colors",
                    attempt.id === selectedRunId
                      ? "border-blue-300 bg-blue-50/50 ring-1 ring-blue-200"
                      : "border-border bg-white hover:bg-slate-50",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-800">
                      Attempt {attempt.attempt}
                    </span>
                    <AgentBadge agent={attempt.agent} />
                    <RunStatusBadge status={attempt.status} />
                    {ACTIVE_RUN.has(attempt.status) && (
                      <span className="text-[10px] text-blue-600">live</span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatDuration(attempt.startedAt, attempt.endedAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatTime(attempt.startedAt ?? attempt.createdAt)}
                    {attempt.exitCode != null ? ` · exit ${attempt.exitCode}` : ""}
                    {attempt.diffStat ? ` · ${lastLine(attempt.diffStat)}` : ""}
                  </div>
                  {attempt.summary && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">
                      {attempt.summary}
                    </p>
                  )}
                  {attempt.error && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-rose-600">
                      {String(attempt.error.message ?? "Run failed")}
                    </p>
                  )}
                </button>
              ))}

              {run && (
                <section className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Selected run
                    </h3>
                    <div className="flex items-center gap-1.5">
                      {run.worktreePath && (
                        <span
                          className="max-w-[320px] truncate font-mono text-[10px] text-muted-foreground"
                          title={run.worktreePath}
                        >
                          <GitBranch className="mr-1 inline size-3" />
                          {run.worktreePath}
                        </span>
                      )}
                      {ACTIVE_RUN.has(run.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => cancelRun.mutate(run.id)}
                          disabled={cancelRun.isPending}
                        >
                          <Square className="size-3.5" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  {runQuery.isLoading ? (
                    <p className="mt-2 text-xs text-muted-foreground">Loading run…</p>
                  ) : (
                    <RunDetailBlock run={run} artifacts={artifacts} />
                  )}
                </section>
              )}
            </div>
          )}

          {task && tab === "review" && (
            <div className="flex flex-col gap-4">
              {!run && <EmptyState title="Select a run" body="Pick an attempt in the Runs tab." />}
              {run && !reviewable && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  Reviews open when this run finishes. Current status: {run.status}.
                </div>
              )}

              {run && reviewable && (
                <>
                  <section className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Review attempt {run.attempt}
                        </h3>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Comments are recorded on the board. Requesting changes queues a new
                          attempt.
                        </p>
                      </div>
                      <RunStatusBadge status={run.status} />
                    </div>

                    <label className="mt-3 block text-xs">
                      <span className="mb-1 block text-slate-600">Summary</span>
                      <textarea
                        value={reviewSummary}
                        onChange={(event) => setReviewSummary(event.target.value)}
                        rows={3}
                        placeholder="Overall assessment…"
                        className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      />
                    </label>

                    <div className="mt-3 rounded-md border border-border bg-slate-50 p-3">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Add a general comment
                      </h4>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_100px_90px]">
                        <input
                          value={generalFile}
                          onChange={(event) => setGeneralFile(event.target.value)}
                          placeholder="file path (optional)"
                          className="rounded border border-border bg-white px-2 py-1.5 font-mono text-[11px] outline-none focus:border-blue-400"
                        />
                        <input
                          value={generalLine}
                          onChange={(event) => setGeneralLine(event.target.value)}
                          placeholder="line"
                          inputMode="numeric"
                          className="rounded border border-border bg-white px-2 py-1.5 text-[11px] outline-none focus:border-blue-400"
                        />
                        <select
                          value={generalSeverity}
                          onChange={(event) => setGeneralSeverity(event.target.value as Severity)}
                          className="rounded border border-border bg-white px-2 py-1.5 text-[11px]"
                        >
                          <option value="blocker">blocker</option>
                          <option value="major">major</option>
                          <option value="minor">minor</option>
                          <option value="nit">nit</option>
                        </select>
                      </div>
                      <textarea
                        value={generalBody}
                        onChange={(event) => setGeneralBody(event.target.value)}
                        rows={2}
                        placeholder="What needs to change?"
                        className="mt-2 w-full resize-y rounded border border-border bg-white px-2 py-1.5 text-[11px] outline-none focus:border-blue-400"
                      />
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={addGeneralComment}
                          disabled={!generalBody.trim()}
                        >
                          Add comment
                        </Button>
                      </div>
                    </div>

                    {drafts.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Draft comments ({drafts.length})
                        </h4>
                        <ul className="mt-2 space-y-2">
                          {drafts.map((draft, index) => (
                            <li
                              key={draft.id}
                              className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs"
                            >
                              <SeverityBadge severity={draft.severity} />
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-[10px] text-amber-700">
                                  {draft.filePath ?? "general"}
                                  {draft.lineStart ? `:${draft.lineStart}` : ""}
                                </div>
                                <p className="mt-0.5 whitespace-pre-wrap text-amber-950">
                                  {draft.body}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="text-amber-700 hover:text-amber-900"
                                onClick={() =>
                                  setDrafts((current) =>
                                    current.filter((_, itemIndex) => itemIndex !== index),
                                  )
                                }
                              >
                                <X className="size-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => submitReview.mutate("approved")}
                        disabled={!canApprove || submitReview.isPending}
                      >
                        <CheckCircle2 className="size-4" />
                        Approve & move to Done
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => requestChanges.mutate()}
                        disabled={drafts.length === 0 || requestChanges.isPending}
                        title={
                          drafts.length === 0
                            ? "Add at least one comment to request changes"
                            : undefined
                        }
                      >
                        <Send className="size-4" />
                        Request changes & rerun
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => submitReview.mutate("rejected")}
                        disabled={submitReview.isPending}
                      >
                        <XCircle className="size-4" />
                        Reject
                      </Button>
                    </div>
                  </section>

                  <ReviewsList
                    reviews={reviews}
                    onToggleResolved={(id, resolved) => resolveComment.mutate({ id, resolved })}
                  />
                </>
              )}
            </div>
          )}

          {task && tab === "diff" && (
            <div className="flex flex-col gap-3">
              {!run && <EmptyState title="Select a run" body="Pick an attempt in the Runs tab." />}
              {run && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">Attempt {run.attempt}</span>
                      <AgentBadge agent={run.agent} />
                      <RunStatusBadge status={run.status} />
                    </div>
                    <span className="text-muted-foreground">
                      {run.diffStat ? lastLine(run.diffStat) : "no diff recorded"}
                    </span>
                  </div>
                  {runQuery.isLoading ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                      Loading diff…
                    </div>
                  ) : (
                    <DiffView
                      patch={run.diffPatch ?? ""}
                      comments={comments}
                      drafts={drafts}
                      onAddDraft={(draft) => setDrafts((current) => [...current, draft])}
                      onRemoveDraft={(index) =>
                        setDrafts((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      onToggleResolved={(id, resolved) => resolveComment.mutate({ id, resolved })}
                    />
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Click any diff line to attach a comment. Drafts can be submitted from the Review
                    tab.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function RunDetailBlock({ run, artifacts }: { run: Run; artifacts: Artifact[] }) {
  return (
    <div className="mt-2 space-y-2 text-xs">
      <dl className="grid gap-1 sm:grid-cols-2">
        <Row label="Agent" value={<AgentBadge agent={run.agent} />} />
        <Row label="Model" value={run.model ?? "default"} />
        <Row label="Status" value={<RunStatusBadge status={run.status} />} />
        <Row label="Duration" value={formatDuration(run.startedAt, run.endedAt)} />
        <Row label="Started" value={formatTime(run.startedAt)} />
        <Row label="Ended" value={formatTime(run.endedAt)} />
        <Row label="Session" value={run.sessionId ?? "—"} />
        <Row label="Exit code" value={run.exitCode == null ? "—" : String(run.exitCode)} />
      </dl>
      {run.summary && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Summary
          </h4>
          <p className="mt-1 whitespace-pre-wrap leading-5 text-slate-700">{run.summary}</p>
        </div>
      )}
      {run.error && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">Error</h4>
          <pre className="mt-1 overflow-x-auto rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
            {JSON.stringify(run.error, null, 2)}
          </pre>
        </div>
      )}
      {run.diffStat && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Diff stat
          </h4>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] leading-5 text-slate-600">
            {run.diffStat}
          </pre>
        </div>
      )}
      {artifacts.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Artifacts
          </h4>
          <ul className="mt-1 space-y-1">
            {artifacts.map((artifact) => (
              <li key={artifact.id} className="flex items-center gap-2 font-mono text-[11px]">
                <Badge className="border-slate-200 bg-slate-50 text-slate-600">
                  {artifact.kind}
                </Badge>
                <span className="truncate text-slate-700">{artifact.name}</span>
                <span className="truncate text-slate-400">{artifact.path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReviewsList({
  reviews,
  onToggleResolved,
}: {
  reviews: Review[];
  onToggleResolved: (commentId: string, resolved: boolean) => void;
}) {
  if (reviews.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        No review has been recorded for this attempt yet.
      </div>
    );
  }
  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reviews</h3>
      <ul className="mt-3 space-y-3">
        {reviews.map((review) => (
          <li key={review.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge verdict={review.verdict} />
              <span className="text-[11px] text-slate-600">
                {review.reviewerName ?? review.reviewerType}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatTime(review.createdAt)}
              </span>
            </div>
            {review.summary && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-700">{review.summary}</p>
            )}
            {review.comments.length > 0 && (
              <ul className="mt-2 space-y-2">
                {review.comments.map((comment) => (
                  <li
                    key={comment.id}
                    className={cn(
                      "rounded border p-2 text-xs",
                      comment.resolved
                        ? "border-slate-200 bg-slate-50 text-slate-500"
                        : "border-amber-200 bg-amber-50 text-amber-950",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge severity={comment.severity} />
                      <span className="font-mono text-[10px]">
                        {comment.filePath ?? "general"}
                        {comment.lineStart ? `:${comment.lineStart}` : ""}
                      </span>
                      <button
                        type="button"
                        className="ml-auto text-[10px] underline decoration-dotted"
                        onClick={() => onToggleResolved(comment.id, !comment.resolved)}
                      >
                        {comment.resolved ? "Reopen" : "Resolve"}
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <Bot className="mx-auto size-6 text-slate-300" />
      <h3 className="mt-2 text-sm font-medium text-slate-700">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="max-w-[70%] truncate text-right text-slate-800">{value}</dd>
    </div>
  );
}

function lastLine(value: string): string {
  return value.trim().split("\n").at(-1) ?? value;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function eventSummary(event: EventsResponse["events"][number]): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "task.moved") {
    return `${String(payload.from ?? "?")} → ${String(payload.to ?? "?")}`;
  }
  if (event.type === "run.progress") {
    const phase = payload.phase ?? "progress";
    return `${String(phase)}${payload.text ? `: ${truncate(String(payload.text), 160)}` : ""}`;
  }
  if (event.type === "run.completed") {
    return payload.summary ? truncate(String(payload.summary), 200) : "Run completed";
  }
  if (event.type === "run.failed") {
    return truncate(String(payload.error ?? payload.status ?? "Run failed"), 200);
  }
  if (event.type === "review.created") {
    const review = payload.review as Record<string, unknown> | undefined;
    return review?.verdict ? `verdict: ${String(review.verdict)}` : "Review recorded";
  }
  if (event.type === "artifact.created") {
    const artifact = payload.artifact as Record<string, unknown> | undefined;
    return artifact?.name ? String(artifact.name) : "Artifact created";
  }
  return "";
}
