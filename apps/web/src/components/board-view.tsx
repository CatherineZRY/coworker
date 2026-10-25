import {
  type AgentId,
  BOARD_COLUMNS,
  type BoardSnapshot,
  TASK_TRANSITIONS,
  type TaskStatus,
  type TaskWithRuns,
} from "@coworker/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CircleSlash, Play } from "lucide-react";
import { useMemo } from "react";
import {
  type DragEndEvent,
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/kibo-ui/kanban";
import { AgentBadge, RunStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { ApiError, api } from "@/lib/api";
import type { Notify } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

interface BoardViewProps {
  boardId: string;
  snapshot: BoardSnapshot;
  search: string;
  agentFilter: AgentId | "all";
  onOpenTask: (taskId: string) => void;
  notify: Notify;
}

interface BoardItem {
  id: string;
  name: string;
  column: TaskStatus;
  task: TaskWithRuns;
  [key: string]: unknown;
}

const ACTIVE_RUN = new Set(["queued", "starting", "running"]);
const COLUMN_IDS = new Set<string>(BOARD_COLUMNS.map((column) => column.id));

export function BoardView({
  boardId,
  snapshot,
  search,
  agentFilter,
  onOpenTask,
  notify,
}: BoardViewProps) {
  const queryClient = useQueryClient();

  const items = useMemo<BoardItem[]>(() => {
    const query = search.trim().toLowerCase();
    return snapshot.tasks
      .filter((task) => {
        if (agentFilter !== "all" && task.latestRun?.agent !== agentFilter) return false;
        if (!query) return true;
        return (
          task.title.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query) ||
          task.id.toLowerCase().includes(query) ||
          task.labels.some((label) => label.toLowerCase().includes(query))
        );
      })
      .map((task) => ({
        id: task.id,
        name: task.title,
        column: task.status,
        task,
      }));
  }, [snapshot.tasks, search, agentFilter]);

  const columns = useMemo(
    () =>
      BOARD_COLUMNS.map((column) => ({
        ...column,
        count: items.filter((item) => item.column === column.id).length,
        total: snapshot.tasks.filter((task) => task.status === column.id).length,
      })),
    [items, snapshot.tasks],
  );

  const moveTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      api.patchTask(taskId, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
    },
    onError: (error) =>
      notify(
        "error",
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      ),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const task = snapshot.tasks.find((item) => item.id === String(active.id));
    if (!task) return;

    const overTask = snapshot.tasks.find((item) => item.id === String(over.id));
    const overId = overTask?.status ?? String(over.id);
    if (!COLUMN_IDS.has(overId)) return;
    const target = overId as TaskStatus;
    if (target === task.status) return;

    if (task.runs.some((run) => ACTIVE_RUN.has(run.status))) {
      notify("error", "Cancel the active run before moving this task");
      return;
    }

    const allowed = TASK_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(target)) {
      notify(
        "error",
        `Cannot move a task from ${task.status.replaceAll("_", " ")} to ${target.replaceAll("_", " ")}`,
      );
      return;
    }
    moveTask.mutate({ taskId: task.id, status: target });
  };

  return (
    <div className="h-full min-h-0 overflow-x-auto pb-2">
      <KanbanProvider
        columns={columns}
        data={items}
        onDragEnd={handleDragEnd}
        className="h-full min-h-0 auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3"
      >
        {(column) => (
          <KanbanBoard
            key={column.id}
            id={column.id}
            className={cn(
              "flex h-full min-h-0 flex-col rounded-lg border-border bg-slate-100/70",
              column.id === "running" && "bg-blue-50/60",
              column.id === "review" && "bg-amber-50/50",
              column.id === "changes_requested" && "bg-rose-50/40",
              column.id === "done" && "bg-emerald-50/30",
            )}
          >
            <KanbanHeader className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2">
              <span className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: column.color }}
                  aria-hidden
                />
                <span className="text-xs font-semibold text-slate-700">{column.name}</span>
              </span>
              <span className="rounded-full bg-white/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                {column.count}
                {column.count !== column.total ? `/${column.total}` : ""}
              </span>
            </KanbanHeader>

            {column.total === 0 ? (
              <div className="flex flex-1 items-center justify-center p-4 text-center text-[10px] text-slate-400">
                No tasks
              </div>
            ) : (
              <KanbanCards<BoardItem> id={column.id} className="gap-2 p-2">
                {(item) => {
                  const task = item.task;
                  const latest = task.latestRun;
                  return (
                    <KanbanCard
                      key={item.id}
                      id={item.id}
                      name={item.name}
                      column={item.column}
                      onClick={() => onOpenTask(task.id)}
                      className="group border-slate-200/80 bg-white hover:border-blue-300 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-3 text-[13px] font-medium leading-5 text-slate-800">
                          {task.title}
                        </p>
                        {task.priority > 0 && (
                          <span
                            className="shrink-0 rounded bg-slate-100 px-1 py-0.5 font-mono text-[9px] text-slate-500"
                            title={`Priority ${task.priority}`}
                          >
                            P{task.priority}
                          </span>
                        )}
                      </div>

                      {task.labels.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {task.labels.slice(0, 3).map((label) => (
                            <Badge
                              key={label}
                              className="border-slate-200 bg-slate-50 text-[9px] text-slate-500"
                            >
                              {label}
                            </Badge>
                          ))}
                          {task.labels.length > 3 && (
                            <span className="text-[9px] text-slate-400">
                              +{task.labels.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      {latest ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <AgentBadge agent={latest.agent} />
                          <RunStatusBadge status={latest.status} />
                          {task.runs.length > 1 && (
                            <span className="font-mono text-[9px] text-slate-400">
                              #{latest.attempt}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                          <CircleSlash className="size-3" />
                          Not dispatched
                        </span>
                      )}

                      {latest?.summary && (
                        <p className="line-clamp-2 text-[10px] leading-4 text-slate-500">
                          {latest.summary}
                        </p>
                      )}

                      {latest?.error && (
                        <p className="flex items-start gap-1 text-[10px] leading-4 text-rose-600">
                          <AlertCircle className="mt-0.5 size-3 shrink-0" />
                          <span className="line-clamp-2">
                            {String(latest.error.message ?? "Run failed")}
                          </span>
                        </p>
                      )}

                      <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 text-[9px] text-slate-400">
                        <span className="flex items-center gap-1 font-mono">
                          <Play className="size-2.5" />
                          {task.runs.length} attempt{task.runs.length === 1 ? "" : "s"}
                          {task.unresolvedCommentCount > 0 && (
                            <span className="ml-1 text-amber-600">
                              · {task.unresolvedCommentCount} open
                            </span>
                          )}
                        </span>
                        <span>{formatTime(task.updatedAt)}</span>
                      </div>
                    </KanbanCard>
                  );
                }}
              </KanbanCards>
            )}
          </KanbanBoard>
        )}
      </KanbanProvider>
    </div>
  );
}
