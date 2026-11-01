import { createCore, createDatabase } from "@coworker/core";
import { afterEach, describe, expect, it } from "vitest";

const core = createCore(createDatabase(":memory:"));
afterEach(() => {
  core.ctx.sqlite.exec("DELETE FROM boards; DELETE FROM codex_threads;");
});
function setup() {
  const threads: Array<[string, string, string]> = [
    ["main", "Kitchen", "vscode"],
    ["guardian", "Guardian review", '{"subagent":{"other":"guardian"}}'],
  ];
  for (const [id, title, source] of threads) {
    core.threads.upsert({
      id,
      title,
      source,
      cwd: "/project",
      firstUserMessage: null,
      gitBranch: "main",
      updatedAt: 1,
      archived: false,
    });
  }
  return {
    source: core.boards.ensureForThread("guardian"),
    target: core.boards.ensureForThread("main"),
  };
}
describe("live board reassociation", () => {
  it("preserves running execution and event cursors while binding the board to main", async () => {
    const { source, target } = setup();
    const { taskId, runId } = core.taskService.dispatch({
      boardId: source.id,
      title: "Work",
      agent: "fake",
    });
    core.runService.start(runId, { pid: 4242, worktreePath: "/worktree", baseRef: "HEAD" });
    const before = core.runs.get(runId);
    const cursor = core.events.latestId(source.id);
    const waiting = core.events.waitForEvents(source.id, cursor, 1);
    const result = core.boardService.reassociate(source.id, "main");
    expect(result.id).toBe(source.id);
    expect(result.codexThreadId).toBe("main");
    expect(result.title).toBe("Kitchen");
    expect(result.titleOverride).toBeNull();
    expect(core.tasks.get(taskId)?.boardId).toBe(source.id);
    expect(core.runs.get(runId)).toEqual(before);
    expect(core.events.listAfter(source.id, 0).some((e) => e.id === cursor)).toBe(true);
    expect(core.boards.get(target.id)?.codexThreadId).toBe("guardian");
    core.runService.progress(runId, { text: "still working" });
    expect((await waiting).some((e) => e.runId === runId)).toBe(true);
    core.runService.succeed(runId, {
      summary: "Done",
      diffStat: "1",
      diffPatch: "patch",
      headSha: "sha",
      usage: null,
      artifacts: [],
    });
    expect(core.tasks.get(taskId)?.status).toBe("review");
    expect(core.boardService.reassociate(source.id, "main").id).toBe(source.id);
  });
  it("refuses a populated target without modifying board bindings", () => {
    const { source, target } = setup();
    core.taskService.create({ boardId: target.id, title: "Existing" });
    expect(() => core.boardService.reassociate(source.id, "main")).toThrow(/contains tasks/);
    expect(core.boards.get(source.id)?.codexThreadId).toBe("guardian");
    expect(core.boards.get(target.id)?.codexThreadId).toBe("main");
  });
  it("refuses another repository and non-primary targets", () => {
    const { source } = setup();
    const main = core.threads.get("main");
    if (!main) throw new Error("Missing fixture");
    core.threads.upsert({ ...main, cwd: "/other" });
    expect(() => core.boardService.reassociate(source.id, "main")).toThrow(/same repository/);
    expect(() => core.boardService.reassociate(source.id, "guardian")).toThrow(/primary/);
  });
});
