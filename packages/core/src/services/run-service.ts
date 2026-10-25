import type { Run, RunStatus, Task, TaskStatus } from "@coworker/shared";
import { canTransition, isTerminalRunStatus } from "../domain/state-machine.js";
import type { WorkerError, WorkerResult } from "../ports.js";
import type { ArtifactRepository } from "../repositories/artifact-repository.js";
import type { EventStore } from "../repositories/event-store.js";
import type { RunRepository } from "../repositories/run-repository.js";
import type { TaskRepository } from "../repositories/task-repository.js";

export interface RunServiceDeps {
  tasks: TaskRepository;
  runs: RunRepository;
  artifacts: ArtifactRepository;
  events: EventStore;
}

export interface RunStartInput {
  pid: number | null;
  worktreePath: string | null;
  baseRef: string | null;
  sessionId?: string | null;
}

export class RunService {
  constructor(private readonly deps: RunServiceDeps) {}

  start(runId: string, input: RunStartInput): Run {
    const run = this.requireRun(runId);
    if (isTerminalRunStatus(run.status)) return run;

    const updated = this.deps.runs.update(runId, {
      status: "running",
      startedAt: run.startedAt ?? Date.now(),
      pid: input.pid,
      worktreePath: input.worktreePath,
      baseRef: input.baseRef,
      sessionId: input.sessionId ?? null,
    });
    if (!updated) throw new Error(`Run not found: ${runId}`);

    const task = this.requireTask(run.taskId);
    this.moveTask(task, "running");
    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId,
      type: "run.started",
      payload: { runId, taskId: task.id, agent: run.agent, pid: input.pid },
    });
    return updated;
  }

  progress(runId: string, payload: Record<string, unknown>): void {
    const run = this.deps.runs.get(runId);
    if (!run) return;
    this.deps.events.append({
      boardId: this.requireTask(run.taskId).boardId,
      taskId: run.taskId,
      runId,
      type: "run.progress",
      payload,
    });
  }

  succeed(runId: string, result: WorkerResult): Run {
    const run = this.requireRun(runId);
    if (isTerminalRunStatus(run.status)) return run;

    const endedAt = Date.now();
    const updated = this.deps.runs.update(runId, {
      status: "succeeded",
      endedAt,
      exitCode: 0,
      summary: result.summary,
      diffStat: result.diffStat,
      diffPatch: result.diffPatch,
      headSha: result.headSha,
      usage: result.usage,
    });
    if (!updated) throw new Error(`Run not found: ${runId}`);

    for (const artifact of result.artifacts) {
      const created = this.deps.artifacts.create({ runId, ...artifact });
      this.deps.events.append({
        boardId: this.taskForRun(run).boardId,
        taskId: run.taskId,
        runId,
        type: "artifact.created",
        payload: { artifact: created as unknown as Record<string, unknown> },
      });
    }

    const task = this.requireTask(run.taskId);
    this.moveTask(task, "review");
    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId,
      type: "run.completed",
      payload: {
        runId,
        taskId: task.id,
        status: "succeeded",
        summary: result.summary,
        diffStat: result.diffStat,
      },
    });
    return updated;
  }

  fail(runId: string, error: WorkerError, status: "failed" | "timed_out" = "failed"): Run {
    const run = this.requireRun(runId);
    if (isTerminalRunStatus(run.status)) return run;

    const endedAt = Date.now();
    const updated = this.deps.runs.update(runId, {
      status,
      endedAt,
      exitCode: error.exitCode ?? null,
      error: {
        message: error.message,
        timedOut: error.timedOut ?? false,
        ...(error.details ?? {}),
      },
    });
    if (!updated) throw new Error(`Run not found: ${runId}`);

    const task = this.requireTask(run.taskId);
    this.moveTask(task, "failed");
    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId,
      type: "run.failed",
      payload: { runId, taskId: task.id, status, error: error.message },
    });
    return updated;
  }

  cancel(runId: string): Run {
    const run = this.requireRun(runId);
    if (isTerminalRunStatus(run.status)) return run;

    const updated = this.deps.runs.update(runId, {
      status: "cancelled",
      endedAt: Date.now(),
    });
    if (!updated) throw new Error(`Run not found: ${runId}`);

    const task = this.requireTask(run.taskId);
    this.moveTask(task, "cancelled");
    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId,
      type: "run.failed",
      payload: { runId, taskId: task.id, status: "cancelled" },
    });
    return updated;
  }

  /**
   * Completion is authoritative. A hook or a user may already have moved the
   * card, so a move that the state machine would reject is still applied and
   * marked `forced` in the event stream for auditability.
   */
  private moveTask(task: Task, to: TaskStatus): void {
    if (task.status === to) return;
    const forced = !canTransition(task.status, to);
    this.deps.tasks.setStatus(task.id, to);
    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      type: "task.moved",
      payload: { from: task.status, to, ...(forced ? { forced: true } : {}) },
    });
  }

  private requireRun(runId: string): Run {
    const run = this.deps.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private requireTask(taskId: string): Task {
    const task = this.deps.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  private taskForRun(run: Run): Task {
    return this.requireTask(run.taskId);
  }
}

export function runStatusLabel(status: RunStatus): string {
  return status.replaceAll("_", " ");
}

export type { RunStatus };
