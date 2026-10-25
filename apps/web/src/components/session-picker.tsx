import type { Board, SessionSummary } from "@coworker/shared";
import { Check, ChevronsUpDown, MessagesSquare, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { basename, cn, formatTime } from "@/lib/utils";

interface SessionPickerProps {
  sessions: SessionSummary[];
  boards: Board[];
  selectedBoardId: string | null;
  selectedTitle: string | null;
  onSelect: (boardId: string) => void;
  onSync: () => void;
  syncing: boolean;
}

interface PickerEntry {
  boardId: string;
  title: string;
  cwd: string;
  branch: string | null;
  taskCount: number;
  activeRuns: number;
  updatedAt: number | null;
  kind: "codex" | "local";
  archived: boolean;
}

export function SessionPicker({
  sessions,
  boards,
  selectedBoardId,
  selectedTitle,
  onSelect,
  onSync,
  syncing,
}: SessionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const entries = useMemo<PickerEntry[]>(() => {
    const boardById = new Map(boards.map((board) => [board.id, board]));
    const covered = new Set<string>();
    const codexEntries = sessions.map((session) => {
      covered.add(session.boardId);
      const board = boardById.get(session.boardId);
      return {
        boardId: session.boardId,
        title: board?.title ?? session.thread.title ?? "Untitled session",
        cwd: board?.cwd ?? session.thread.cwd,
        branch: board?.gitBranch ?? session.thread.gitBranch,
        taskCount: session.taskCount,
        activeRuns: session.activeRuns,
        updatedAt: session.updatedAt,
        kind: "codex" as const,
        archived: session.thread.archived,
      };
    });
    const localEntries = boards
      .filter((board) => !covered.has(board.id))
      .map((board) => ({
        boardId: board.id,
        title: board.title,
        cwd: board.cwd ?? "",
        branch: board.gitBranch,
        taskCount: 0,
        activeRuns: 0,
        updatedAt: board.updatedAt ?? board.createdAt,
        kind: "local" as const,
        archived: false,
      }));
    return [...codexEntries, ...localEntries].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
  }, [sessions, boards]);

  const selected = entries.find((entry) => entry.boardId === selectedBoardId) ?? null;

  const renderEntry = (entry: PickerEntry) => (
    <button
      key={entry.boardId}
      type="button"
      onClick={() => {
        onSelect(entry.boardId);
        setOpen(false);
      }}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-slate-50",
        entry.boardId === selectedBoardId && "bg-blue-50/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold uppercase",
          entry.kind === "codex"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-50 text-slate-500",
        )}
      >
        {entry.kind === "codex" ? "CX" : "LB"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-800">{entry.title}</span>
          {entry.archived && (
            <Badge className="border-slate-200 bg-slate-50 text-[9px] text-slate-400">
              archived
            </Badge>
          )}
          {entry.boardId === selectedBoardId && (
            <Check className="size-3.5 shrink-0 text-blue-600" />
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{basename(entry.cwd) || "no repo"}</span>
          {entry.branch && <span className="truncate text-slate-400">· {entry.branch}</span>}
        </span>
        <span className="mt-0.5 block text-[10px] text-muted-foreground">
          {entry.taskCount} tasks
          {entry.activeRuns > 0 && (
            <span className="ml-1 text-blue-600">· {entry.activeRuns} running</span>
          )}
          <span className="ml-1">· {formatTime(entry.updatedAt)}</span>
        </span>
      </span>
    </button>
  );

  return (
    <div className="relative min-w-0 max-w-[420px] flex-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-white px-2.5 text-left shadow-sm transition-colors hover:bg-slate-50"
      >
        <MessagesSquare className="size-4 shrink-0 text-emerald-600" />
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-slate-800">
            {selectedTitle ?? selected?.title ?? "Select a Codex session"}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {selected?.kind === "codex" ? "Codex session board" : "Local board"}
            {selected?.activeRuns ? ` · ${selected.activeRuns} running` : ""}
          </span>
        </span>
        <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-40 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-700">Session boards</h3>
              <p className="text-[10px] text-muted-foreground">
                Each Codex thread gets its own board.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSync}
              disabled={syncing}
              title="Sync Codex sessions"
            >
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
              Sync
            </Button>
          </div>
          <div className="max-h-[380px] overflow-y-auto p-1.5">
            {entries.length === 0 && (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No Codex sessions found yet. Start a Codex thread, then press Sync.
              </p>
            )}
            {entries.filter((entry) => entry.kind === "codex").map(renderEntry)}
            {entries.some((entry) => entry.kind === "local") && (
              <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Local boards
              </div>
            )}
            {entries.filter((entry) => entry.kind === "local").map(renderEntry)}
          </div>
        </div>
      )}
    </div>
  );
}
