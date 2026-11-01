import { DEFAULT_CONFIG, getPaths, WorktreeManager } from "@coworker/adapters";
import { createCore, createDatabase } from "@coworker/core";
import { buildServer, createLogger, Scheduler } from "@coworker/daemon";
import { expect, it } from "vitest";

it("rejects stale internal board dispatch and task creation after repair", async () => {
  const core = createCore(createDatabase(":memory:"));
  const paths = getPaths("/tmp/coworker-api-fixture-unused");
  const logger = createLogger(false);
  const scheduler = new Scheduler({
    core,
    paths,
    logger,
    config: DEFAULT_CONFIG,
    runners: {},
    worktrees: new WorktreeManager(paths.worktreesDir),
  });
  const app = await buildServer({
    core,
    scheduler,
    paths,
    logger,
    config: DEFAULT_CONFIG,
    runners: {},
    token: "test-token",
    webDist: null,
  });
  try {
    core.threads.upsert({
      id: "guardian",
      title: "Guardian review",
      cwd: "/project",
      source: '{"subagent":{}}',
      firstUserMessage: null,
      gitBranch: null,
      updatedAt: 1,
      archived: false,
    });
    const board = core.boards.ensureForThread("guardian");
    for (const url of ["/api/dispatch", "/api/tasks"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { authorization: "Bearer test-token" },
        payload: { boardId: board.id, title: "Stale request", agent: "fake" },
      });
      expect(response.statusCode).toBe(409);
    }
    expect(core.tasks.listByBoard(board.id)).toHaveLength(0);
    expect(scheduler.activeCount).toBe(0);
  } finally {
    await app.close();
    core.ctx.close();
  }
});
