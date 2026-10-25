import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Core, createCore, createDatabase } from "@coworker/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSession } from "../apps/daemon/src/sync.js";

let core: Core;
let codexHome: string;

beforeEach(() => {
  codexHome = mkdtempSync(path.join(os.tmpdir(), "coworker-codex-home-"));
  vi.stubEnv("CODEX_HOME", codexHome);
  core = createCore(createDatabase(":memory:"));
});

afterEach(() => {
  core.ctx.close();
  vi.unstubAllEnvs();
  rmSync(codexHome, { recursive: true, force: true });
});

function seedThread(id: string, cwd: string, title = "A session") {
  core.threads.upsert({
    id,
    title,
    firstUserMessage: null,
    cwd,
    gitBranch: "main",
    source: "codex",
    updatedAt: Date.now(),
    archived: false,
  });
}

describe("Codex session resolution", () => {
  it("maps a cwd to the matching thread board", () => {
    seedThread("thread_cwd", "/tmp/projects/alpha", "Alpha work");
    const session = resolveSession(core, { cwd: "/tmp/projects/alpha" });
    expect(session.threadId).toBe("thread_cwd");
    expect(session.boardId).toBe(core.boards.ensureForThread("thread_cwd").id);
    expect(session.title).toBe("Alpha work");
  });

  it("matches threads for a subdirectory of the session cwd", () => {
    seedThread("thread_cwd", "/tmp/projects/beta", "Beta work");
    const session = resolveSession(core, { cwd: "/tmp/projects/beta/apps/web" });
    expect(session.threadId).toBe("thread_cwd");
  });

  it("prefers the ppid mapping over a cwd match", () => {
    seedThread("thread_from_cwd", "/tmp/projects/gamma", "Gamma by cwd");
    seedThread("thread_from_ppid", "/tmp/projects/elsewhere", "Gamma by hook");
    core.sessions.upsert({
      ppid: 4242,
      codexThreadId: "thread_from_ppid",
      cwd: "/tmp/projects/gamma",
    });

    const session = resolveSession(core, { ppid: 4242, cwd: "/tmp/projects/gamma" });
    expect(session.threadId).toBe("thread_from_ppid");
    expect(session.title).toBe("Gamma by hook");
  });

  it("falls back to the local board when nothing matches", () => {
    const session = resolveSession(core, { cwd: "/tmp/projects/unknown" });
    expect(session.threadId).toBeNull();
    expect(session.boardId).toBe(core.boards.ensureDefault().id);
    expect(session.title).toBe("Local board");
  });

  it("gives each thread its own board", () => {
    seedThread("thread_a", "/tmp/projects/a", "A");
    seedThread("thread_b", "/tmp/projects/b", "B");
    const a = resolveSession(core, { cwd: "/tmp/projects/a" });
    const b = resolveSession(core, { cwd: "/tmp/projects/b" });
    expect(a.boardId).not.toBe(b.boardId);
  });
});
