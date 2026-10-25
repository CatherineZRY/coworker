import { type Run, type RunStatus, TASK_TRANSITIONS, type TaskStatus } from "@coworker/shared";

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || (TASK_TRANSITIONS[from]?.includes(to) ?? false);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * A run reaching a terminal state is the authoritative completion signal.
 * Hooks and stream watchers may report earlier, but they never override a
 * terminal run.
 */
export function taskStatusForRun(run: Run): TaskStatus | null {
  switch (run.status) {
    case "queued":
    case "starting":
    case "running":
      return "running";
    case "succeeded":
      return "review";
    case "failed":
    case "timed_out":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return ["succeeded", "failed", "cancelled", "timed_out"].includes(status);
}
