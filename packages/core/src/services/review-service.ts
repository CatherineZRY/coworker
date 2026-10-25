import type { RequestChangesInput, Review, Run, SubmitReviewInput, Task } from "@coworker/shared";
import { canTransition, isTerminalRunStatus } from "../domain/state-machine.js";
import type { EventStore } from "../repositories/event-store.js";
import type { ReviewRepository } from "../repositories/review-repository.js";
import type { RunRepository } from "../repositories/run-repository.js";
import type { TaskRepository } from "../repositories/task-repository.js";
import { buildTaskPrompt } from "./prompt-builder.js";

export interface ReviewServiceDeps {
  tasks: TaskRepository;
  runs: RunRepository;
  reviews: ReviewRepository;
  events: EventStore;
}

export interface ReviewResult {
  review: Review;
  task: Task;
  run: Run;
}

export class ReviewService {
  constructor(private readonly deps: ReviewServiceDeps) {}

  submit(input: SubmitReviewInput): ReviewResult {
    const run = this.requireRun(input.runId);
    if (!isTerminalRunStatus(run.status)) {
      throw new Error(`Run ${run.id} is not finished (status: ${run.status})`);
    }
    const task = this.requireTask(run.taskId);

    const review = this.deps.reviews.create({
      runId: run.id,
      reviewerType: input.reviewerType ?? "codex",
      reviewerName: input.reviewerName ?? "Codex",
      verdict: input.verdict,
      summary: input.summary ?? null,
      comments: input.comments ?? [],
    });

    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId: run.id,
      type: "review.created",
      payload: { review: review as unknown as Record<string, unknown> },
    });

    if (input.verdict === "approved") this.deps.reviews.resolveForTask(task.id);
    const target = input.verdict === "approved" ? "done" : "changes_requested";
    const moved = this.moveTask(task, target);
    return { review, task: moved, run };
  }

  requestChanges(input: RequestChangesInput): ReviewResult {
    const previousRun = this.requireRun(input.runId);
    if (!isTerminalRunStatus(previousRun.status)) {
      throw new Error(`Run ${previousRun.id} is not finished (status: ${previousRun.status})`);
    }
    const task = this.requireTask(previousRun.taskId);

    const review = this.deps.reviews.create({
      runId: previousRun.id,
      reviewerType: input.reviewerType ?? "codex",
      reviewerName: input.reviewerName ?? "Codex",
      verdict: "changes_requested",
      summary: input.summary ?? null,
      comments: input.comments,
    });

    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId: previousRun.id,
      type: "review.created",
      payload: { review: review as unknown as Record<string, unknown> },
    });

    const moved = this.moveTask(task, "changes_requested");
    const previousRuns = this.deps.runs.listByTask(task.id);
    const prompt = buildTaskPrompt({
      task,
      reviewComments: review.comments,
      previousSummary: previousRun.summary,
    });
    const run = this.deps.runs.create({
      taskId: task.id,
      parentRunId: previousRun.id,
      attempt: previousRuns.length + 1,
      agent: input.agent ?? previousRun.agent,
      model: previousRun.model,
      timeoutSec: previousRun.timeoutSec,
      prompt,
      reviewContext: JSON.stringify(review.comments.map((comment) => comment.body)),
    });

    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      runId: run.id,
      type: "run.queued",
      payload: {
        runId: run.id,
        taskId: task.id,
        agent: run.agent,
        attempt: run.attempt,
        parentRunId: previousRun.id,
      },
    });

    return { review, task: moved, run };
  }

  private moveTask(task: Task, to: Task["status"]): Task {
    if (task.status === to) return task;
    const forced = !canTransition(task.status, to);
    const updated = this.deps.tasks.setStatus(task.id, to);
    if (!updated) throw new Error(`Task not found: ${task.id}`);
    this.deps.events.append({
      boardId: task.boardId,
      taskId: task.id,
      type: "task.moved",
      payload: { from: task.status, to, ...(forced ? { forced: true } : {}) },
    });
    return updated;
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
}
