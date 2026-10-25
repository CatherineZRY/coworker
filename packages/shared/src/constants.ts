import type { TaskStatus } from "./domain.js";

export const DEFAULT_PORT = 7788;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_WAIT_TIMEOUT_SEC = 240;
export const DEFAULT_MAX_ATTEMPTS = 3;

export const BOARD_COLUMNS: Array<{ id: TaskStatus; name: string; color: string }> = [
  { id: "backlog", name: "Backlog", color: "#94a3b8" },
  { id: "ready", name: "Ready", color: "#6b7280" },
  { id: "running", name: "Running", color: "#2563eb" },
  { id: "review", name: "Review", color: "#d97706" },
  { id: "changes_requested", name: "Changes Requested", color: "#dc2626" },
  { id: "done", name: "Done", color: "#16a34a" },
  { id: "failed", name: "Failed", color: "#991b1b" },
  { id: "cancelled", name: "Cancelled", color: "#57534e" },
];

export const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running"]);

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["ready", "cancelled"],
  ready: ["running", "cancelled"],
  running: ["review", "failed", "cancelled"],
  review: ["done", "changes_requested", "failed"],
  changes_requested: ["ready", "running", "cancelled"],
  done: [],
  failed: ["ready", "cancelled"],
  cancelled: ["backlog", "ready"],
};
