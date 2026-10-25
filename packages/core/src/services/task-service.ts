import type {
  Board,
  BoardSnapshot,
  DispatchInput,
  DispatchResult,
  Run,
  Task,
  TaskStatus,
  TaskWithRuns,
} from "@coworker/shared";
import { assertTransition, canTransition } from "../domain/state-machine.js";
import type { BoardRepository } from "../repositories/board-repository.js";
import type { EventStore } from "../repositories/event-store.js";
import type { ReviewRepository } from "../repositories/review-repository.js";
import type { RunRepository } from "../repositories/run-repository.js";
import type { TaskRepository, UpdateTaskRecord } from "../repositories/task-repository.js";
import { buildTaskPrompt } from "./prompt-builder.js";

export interface TaskServiceDeps {
  boards: BoardRepository;
  tasks: TaskRepository;
  runs: RunRepository;
  reviews: ReviewRepository;
  events: EventStore;
}

export interface CreateTaskServiceInput {
  boardId?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  labels?: string[];
  createdBy?: Task["createdBy"];
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  resolveBoard(boardId?: string): Board {
    if (boardId) {
      const board = this.deps.boards.get(boardId);
      if (!board) throw new Error(`Board not found: ${boardId}`);
      return board;
    }
    return this.deps.boards.ensureDefault();
  }

  create(input: CreateTaskServiceInput): Task {
    const board = this.resolveBoard(input.boardId);
    const task = this.deps.tasks.create({
      boardId: board.id,
      title: input.title,
      description: input.description,
      status: input.status ?? "ready",
      priority: input.priority,
      createdBy: input.createdBy ?? "codex",
      labels: input.labels,
    });
    this.deps.events.append({
      boardId: board.id,
      taskId: task.id,
      type: "task.created",
      payload: { task: task as unknown as Record<string, unknown> },
    });
    return task;
  }

  update(taskId: string, patch: UpdateTaskRecord): Task {
    const existing = this.requireTask(taskId);
    if (patch.status && patch.status !== existing.status) {
      assertTransition(existing.status, patch.status);
    }
    const updated = this.deps.tasks.update(taskId, patch);
    if (!updated) throw new Error(`Task not found: ${taskId}`);
    if (patch.status && patch.status !== existing.status) {
      this.deps.events.append({
        boardId: updated.boardId,
        taskId: updated.id,
        type: "task.moved",
        payload: { from: existing.status, to: patch.status },
      });
    }
    this.deps.events.append({
      boardId: updated.boardId,
      taskId: updated.id,
      type: "task.updated",
      payload: { task: updated as unknown as Record<string, unknown> },
    });
    return updated;
  }

  setStatus(taskId: string, status: TaskStatus): Task {
    const existing = this.requireTask(taskId);
    if (existing.status === status) return existing;
    assertTransition(existing.status, status);
    const updated = this.deps.tasks.setStatus(taskId, status);
    if (!updated) throw new Error(`Task not found: ${taskId}`);
    this.deps.events.append({
      boardId: updated.boardId,
      taskId: updated.id,
      type: "task.moved",
      payload: { from: existing.status, to: status },
    });
    return updated;
  }

  dispatch(input: DispatchInput): DispatchResult {
    const board = this.resolveBoard(input.boardId);
    let task = input.taskId ? this.requireTask(input.taskId) : null;

    if (task && task.boardId !== board.id) {
      throw new Error(`Task ${task.id} does not belong to board ${board.id}`);
    }

    if (!task) {
      const title = input.title ?? deriveTitle(input.prompt) ?? "Untitled task";
      const description = input.description ?? input.prompt ?? "";
      task = this.create({
        boardId: board.id,
        title,
        description,
        status: "ready",
        createdBy: "codex",
      });
    }

    if (task.status === "backlog") {
      task = this.setStatus(task.id, "ready");
    }
    if (!canTransition(task.status, "running")) {
      throw new Error(`Task ${task.id} cannot start a new run from status ${task.status}`);
    }

    const previousRuns = this.deps.runs.listByTask(task.id);
    const attempt = previousRuns.length + 1;
    const latest = previousRuns.at(-1) ?? null;
    const reviewComments = latest
      ? this.deps.reviews.listByRun(latest.id).flatMap((review) => review.comments)
      : [];
    const prompt =
      input.prompt ??
      buildTaskPrompt({
        task,
        reviewComments,
        previousSummary: latest?.summary ?? null,
        repoPath: input.repo ?? board.cwd,
        baseRef: input.baseRef ?? null,
      });

    const run = this.deps.runs.create({
      taskId: task.id,
      parentRunId: latest?.id ?? null,
      attempt,
      agent: input.agent,
      model: input.model ?? null,
      timeoutSec: input.timeoutSec ?? null,
      prompt,
      reviewContext: reviewComments.length
        ? JSON.stringify(reviewComments.map((comment) => comment.body))
        : null,
    });

    this.setStatus(task.id, "running");
    this.deps.events.append({
      boardId: board.id,
      taskId: task.id,
      runId: run.id,
      type: "run.queued",
      payload: {
        runId: run.id,
        taskId: task.id,
        agent: run.agent,
        attempt: run.attempt,
      },
    });
    return { taskId: task.id, runId: run.id };
  }

  createFollowUpRun(
    task: Task,
    previousRun: Run,
    agent: DispatchInput["agent"],
    prompt: string,
    reviewCommentBodies: string[],
  ): Run {
    const previousRuns = this.deps.runs.listByTask(task.id);
    const run = this.deps.runs.create({
      taskId: task.id,
      parentRunId: previousRun.id,
      attempt: previousRuns.length + 1,
      agent,
      model: previousRun.model,
      timeoutSec: previousRun.timeoutSec,
      prompt,
      reviewContext: JSON.stringify(reviewCommentBodies),
    });
    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId: run.id,
      type: "run.queued",
      payload: { runId: run.id, taskId: task.id, agent, attempt: run.attempt },
    });
    return run;
  }

  requireTask(taskId: string): Task {
    const task = this.deps.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  withRuns(task: Task): TaskWithRuns {
    const runs = this.deps.runs.listByTask(task.id);
    const counts = this.deps.runs.reviewCounts(task.id);
    return {
      ...task,
      runs,
      latestRun: runs.at(-1) ?? null,
      reviewCount: counts.reviewCount,
      unresolvedCommentCount: counts.unresolvedCommentCount,
    };
  }

  snapshot(boardId: string): BoardSnapshot {
    const board = this.deps.boards.get(boardId);
    if (!board) throw new Error(`Board not found: ${boardId}`);
    const tasks = this.deps.tasks.listByBoard(boardId).map((task) => this.withRuns(task));
    return {
      board,
      tasks,
      activeRuns: this.deps.runs.countActiveByBoard(boardId),
    };
  }
}

function deriveTitle(prompt?: string): string | null {
  if (!prompt) return null;
  const firstLine = prompt
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ? firstLine.slice(0, 120) : null;
}
