import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCore, createDatabase } from "@coworker/core";
import { afterEach, expect, it, vi } from "vitest";
import { repairSessionBoard } from "../apps/daemon/src/repair.js";

const temp = mkdtempSync(path.join(os.tmpdir(), "coworker-repair-"));
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(temp, { recursive: true, force: true });
});
it("backs up a live database and repairs through a separate connection without modifying runs", async () => {
  const codexHome = path.join(temp, "codex");
  mkdirSync(codexHome);
  vi.stubEnv("CODEX_HOME", codexHome);
  const state = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  state.exec(
    "CREATE TABLE threads (id TEXT, title TEXT, name TEXT, cwd TEXT, source TEXT); INSERT INTO threads VALUES ('main','original','Kitchen','/project','vscode')",
  );
  state.close();
  const core = createCore(createDatabase(path.join(temp, "coworker.db")));
  try {
    core.threads.upsert({
      id: "guardian",
      title: "Guardian review",
      firstUserMessage: null,
      cwd: "/project",
      source: '{"subagent":{}}',
      gitBranch: null,
      updatedAt: 1,
      archived: false,
    });
    const source = core.boards.ensureForThread("guardian");
    const { taskId, runId } = core.taskService.dispatch({
      boardId: source.id,
      title: "Active",
      agent: "fake",
    });
    core.runService.start(runId, { pid: 12345, worktreePath: "/worktree", baseRef: "HEAD" });
    const before = core.runs.get(runId);
    const result = await repairSessionBoard({
      home: temp,
      boardId: source.id,
      targetThreadId: "main",
      pinTitle: true,
    });
    expect(existsSync(result.backupPath)).toBe(true);
    const backup = new DatabaseSync(result.backupPath, { readOnly: true });
    expect(
      backup.prepare("SELECT codex_thread_id FROM boards WHERE id = ?").get(source.id)
        ?.codex_thread_id,
    ).toBe("guardian");
    backup.close();
    expect(core.runs.get(runId)).toEqual(before);
    expect(core.tasks.get(taskId)?.boardId).toBe(source.id);
    expect(core.boards.get(source.id)?.codexThreadId).toBe("main");
    expect(core.boards.get(source.id)?.title).toBe("Kitchen");
    // Legacy daemon sync must not undo the repaired visible name.
    const main = core.threads.get("main");
    if (!main) throw new Error("Missing main");
    core.threads.upsert({ ...main, title: "original" });
    expect(core.boards.get(source.id)?.title).toBe("Kitchen");
    core.runService.progress(runId, { text: "after maintenance" });
    expect(core.events.listAfter(source.id, 0).at(-1)?.runId).toBe(runId);
  } finally {
    core.ctx.close();
  }
});
