import { type Core, createCore, createDatabase } from "@coworker/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let core: Core;

beforeEach(() => {
  core = createCore(createDatabase(":memory:"));
});

afterEach(() => {
  core.ctx.close();
});

function seedThread(id: string, title: string | null, firstUserMessage: string | null) {
  return core.threads.upsert({
    id,
    title,
    firstUserMessage,
    cwd: "/tmp/project",
    gitBranch: "main",
    source: "codex",
    updatedAt: Date.now(),
    archived: false,
  });
}

describe("board titles", () => {
  it("names the board after the Codex thread title", () => {
    seedThread("thread_1", "Refactor the scheduler", "hello");
    const board = core.boards.ensureForThread("thread_1");
    expect(board.title).toBe("Refactor the scheduler");
    expect(board.cwd).toBe("/tmp/project");
    expect(board.gitBranch).toBe("main");
  });

  it("falls back to the first user message when the thread has no title", () => {
    seedThread("thread_2", null, "Please add a web board\nwith review");
    expect(core.boards.ensureForThread("thread_2").title).toBe("Please add a web board");
  });

  it("uses a neutral name for local boards without a Codex thread", () => {
    expect(core.boards.ensureDefault().title).toBe("Local board");
  });

  it("prefers a manual rename over the thread title", () => {
    seedThread("thread_3", "Original title", null);
    const board = core.boards.ensureForThread("thread_3");
    const renamed = core.boards.rename(board.id, "My renamed board");
    expect(renamed?.title).toBe("My renamed board");

    core.boards.rename(board.id, null);
    expect(core.boards.get(board.id)?.title).toBe("Original title");
  });
});
