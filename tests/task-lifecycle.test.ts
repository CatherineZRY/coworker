import { type Core, createCore, createDatabase, InvalidTransitionError } from "@coworker/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let core: Core;

beforeEach(() => {
  core = createCore(createDatabase(":memory:"));
});

afterEach(() => {
  core.ctx.close();
});

describe("task lifecycle", () => {
  it("moves a task from ready through review to done", () => {
    const task = core.taskService.create({
      boardId: core.boards.ensureDefault().id,
      title: "Add a widget",
      description: "Make the widget.",
    });
    expect(task.status).toBe("ready");

    const { runId } = core.taskService.dispatch({
      boardId: task.boardId,
      taskId: task.id,
      agent: "fake",
    });
    expect(core.tasks.get(task.id)?.status).toBe("running");
    expect(core.events.latestId(task.boardId)).toBeGreaterThan(0);

    core.runService.start(runId, {
      pid: null,
      worktreePath: "/tmp/worktree",
      baseRef: "HEAD",
    });
    core.runService.succeed(runId, {
      summary: "Widget added.",
      diffStat: "1 file changed",
      diffPatch: "--- a\n+++ b\n",
      headSha: "abc123",
      usage: null,
      artifacts: [
        {
          kind: "test_report",
          name: "report",
          path: "/tmp/report.md",
          mime: "text/markdown",
          sizeBytes: 10,
        },
      ],
    });

    expect(core.tasks.get(task.id)?.status).toBe("review");
    const reviewed = core.reviewService.submit({
      runId,
      verdict: "approved",
      summary: "Looks good.",
      reviewerType: "codex",
    });
    expect(reviewed.task.status).toBe("done");
    expect(core.tasks.get(task.id)?.status).toBe("done");
  });

  it("queues a new attempt with the review comments in the prompt", () => {
    const task = core.taskService.create({
      boardId: core.boards.ensureDefault().id,
      title: "Fix the build",
    });
    const first = core.taskService.dispatch({
      boardId: task.boardId,
      taskId: task.id,
      agent: "fake",
    });
    core.runService.start(first.runId, { pid: null, worktreePath: null, baseRef: null });
    core.runService.succeed(first.runId, {
      summary: "First attempt.",
      diffStat: null,
      diffPatch: null,
      headSha: null,
      usage: null,
      artifacts: [],
    });

    const result = core.reviewService.requestChanges({
      runId: first.runId,
      summary: "Please add tests.",
      comments: [
        {
          filePath: "src/build.ts",
          lineStart: 12,
          side: "new",
          severity: "blocker",
          body: "Add a regression test for the build failure.",
        },
      ],
      reviewerType: "codex",
    });

    expect(result.task.status).toBe("changes_requested");
    expect(result.run.attempt).toBe(2);
    expect(result.run.parentRunId).toBe(first.runId);
    expect(result.run.prompt).toContain("Add a regression test for the build failure.");
    expect(result.run.prompt).toContain("src/build.ts:12");
    expect(core.tasks.get(task.id)?.status).toBe("changes_requested");

    const detail = core.taskService.withRuns(core.taskService.requireTask(task.id));
    expect(detail.runs).toHaveLength(2);
    expect(detail.latestRun?.id).toBe(result.run.id);
    expect(detail.unresolvedCommentCount).toBe(1);

    core.runService.start(result.run.id, { pid: null, worktreePath: null, baseRef: null });
    core.runService.succeed(result.run.id, {
      summary: "Tests added.",
      diffStat: null,
      diffPatch: null,
      headSha: null,
      usage: null,
      artifacts: [],
    });
    const approved = core.reviewService.submit({
      runId: result.run.id,
      verdict: "approved",
    });
    expect(approved.task.status).toBe("done");
    const accepted = core.taskService.withRuns(core.taskService.requireTask(task.id));
    expect(accepted.unresolvedCommentCount).toBe(0);
  });

  it("rejects review of a run that is still active", () => {
    const task = core.taskService.create({
      boardId: core.boards.ensureDefault().id,
      title: "Still running",
    });
    const { runId } = core.taskService.dispatch({
      boardId: task.boardId,
      taskId: task.id,
      agent: "fake",
    });
    expect(() => core.reviewService.submit({ runId, verdict: "approved" })).toThrow(/not finished/);
  });

  it("rejects invalid manual transitions", () => {
    const task = core.taskService.create({
      boardId: core.boards.ensureDefault().id,
      title: "Done already",
      status: "done",
    });
    expect(() => core.taskService.setStatus(task.id, "running")).toThrow(InvalidTransitionError);
  });

  it("records a failed run and lets the task be retried", () => {
    const task = core.taskService.create({
      boardId: core.boards.ensureDefault().id,
      title: "Failing task",
    });
    const first = core.taskService.dispatch({
      boardId: task.boardId,
      taskId: task.id,
      agent: "fake",
    });
    core.runService.fail(first.runId, { message: "boom", exitCode: 2 });
    expect(core.tasks.get(task.id)?.status).toBe("failed");

    core.taskService.setStatus(task.id, "ready");
    const second = core.taskService.dispatch({
      boardId: task.boardId,
      taskId: task.id,
      agent: "fake",
    });
    expect(second.runId).not.toBe(first.runId);
    expect(core.runs.listByTask(task.id)).toHaveLength(2);
  });
});

describe("board snapshots", () => {
  it("groups tasks with run metadata on the correct board", () => {
    const defaultBoard = core.boards.ensureDefault();
    core.threads.upsert({
      id: "thread_other",
      title: "Other session",
      firstUserMessage: null,
      cwd: "/tmp/other",
      gitBranch: null,
      source: "codex",
      updatedAt: Date.now(),
      archived: false,
    });
    const otherBoard = core.boards.ensureForThread("thread_other");
    core.taskService.create({ boardId: defaultBoard.id, title: "Default task" });
    core.taskService.create({ boardId: otherBoard.id, title: "Other task" });

    const snapshot = core.boardService.snapshot(defaultBoard.id);
    expect(snapshot.board.id).toBe(defaultBoard.id);
    expect(snapshot.tasks.map((task) => task.title)).toEqual(["Default task"]);
  });
});
