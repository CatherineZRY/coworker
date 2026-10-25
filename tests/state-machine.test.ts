import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTerminalRunStatus,
  taskStatusForRun,
} from "@coworker/core";
import type { Run } from "@coworker/shared";
import { describe, expect, it } from "vitest";

function run(status: Run["status"]): Run {
  return {
    id: "run_test",
    taskId: "tsk_test",
    parentRunId: null,
    attempt: 1,
    agent: "fake",
    model: null,
    timeoutSec: null,
    prompt: "do it",
    reviewContext: null,
    status,
    worktreePath: null,
    baseRef: null,
    headSha: null,
    sessionId: null,
    pid: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    summary: null,
    diffStat: null,
    diffPatch: null,
    usage: null,
    error: null,
    createdAt: Date.now(),
  };
}

describe("task state machine", () => {
  it("allows the documented transitions", () => {
    expect(canTransition("backlog", "ready")).toBe(true);
    expect(canTransition("ready", "running")).toBe(true);
    expect(canTransition("running", "review")).toBe(true);
    expect(canTransition("review", "done")).toBe(true);
    expect(canTransition("review", "changes_requested")).toBe(true);
    expect(canTransition("changes_requested", "running")).toBe(true);
    expect(canTransition("failed", "ready")).toBe(true);
  });

  it("rejects skipping review or reopening done work", () => {
    expect(canTransition("ready", "done")).toBe(false);
    expect(canTransition("done", "running")).toBe(false);
    expect(() => assertTransition("done", "running")).toThrow(InvalidTransitionError);
  });

  it("treats a move to the same column as a no-op", () => {
    expect(canTransition("review", "review")).toBe(true);
  });
});

describe("run status mapping", () => {
  it("maps active runs to running and successful runs to review", () => {
    expect(taskStatusForRun(run("queued"))).toBe("running");
    expect(taskStatusForRun(run("starting"))).toBe("running");
    expect(taskStatusForRun(run("running"))).toBe("running");
    expect(taskStatusForRun(run("succeeded"))).toBe("review");
  });

  it("maps failures and cancellations to their columns", () => {
    expect(taskStatusForRun(run("failed"))).toBe("failed");
    expect(taskStatusForRun(run("timed_out"))).toBe("failed");
    expect(taskStatusForRun(run("cancelled"))).toBe("cancelled");
  });

  it("knows terminal run statuses", () => {
    expect(isTerminalRunStatus("succeeded")).toBe(true);
    expect(isTerminalRunStatus("running")).toBe(false);
  });
});
