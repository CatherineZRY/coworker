import { type Core, createCore, createDatabase } from "@coworker/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let core: Core;
let boardId: string;

beforeEach(() => {
  core = createCore(createDatabase(":memory:"));
  boardId = core.boards.ensureDefault().id;
});

afterEach(() => {
  core.ctx.close();
});

describe("EventStore", () => {
  it("returns events after the cursor", () => {
    const first = core.events.append({ boardId, type: "task.created", payload: { n: 1 } });
    const second = core.events.append({ boardId, type: "task.updated", payload: { n: 2 } });

    expect(second.id).toBeGreaterThan(first.id);
    const events = core.events.listAfter(boardId, first.id);
    expect(events.map((event) => event.type)).toEqual(["task.updated"]);
  });

  it("keeps boards isolated", () => {
    core.threads.upsert({
      id: "thread_a",
      title: "Another session",
      firstUserMessage: null,
      cwd: "/tmp/other",
      gitBranch: null,
      source: "codex",
      updatedAt: Date.now(),
      archived: false,
    });
    const other = core.boards.ensureForThread("thread_a").id;
    core.events.append({ boardId, type: "task.created" });
    core.events.append({ boardId: other, type: "task.created" });
    expect(core.events.listAfter(boardId, 0)).toHaveLength(1);
    expect(core.events.latestId(other)).toBeGreaterThan(core.events.latestId(boardId));
  });

  it("wakes a waiter as soon as an event is appended", async () => {
    const start = Date.now();
    const waiting = core.events.waitForEvents(boardId, 0, 5);
    setTimeout(() => {
      core.events.append({ boardId, type: "run.progress", payload: { line: "building" } });
    }, 50);

    const events = await waiting;
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("run.progress");
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("times out without new events", async () => {
    const existing = core.events.append({ boardId, type: "task.created" });
    const events = await core.events.waitForEvents(boardId, existing.id, 0.1);
    expect(events).toEqual([]);
  });

  it("returns immediately when the waiter is aborted", async () => {
    const controller = new AbortController();
    const waiting = core.events.waitForEvents(boardId, 0, 10, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toEqual([]);
  });
});
