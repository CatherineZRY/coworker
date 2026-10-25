import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorktreeManager } from "@coworker/adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
let repo: string;

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Coworker Test",
      GIT_AUTHOR_EMAIL: "coworker@example.com",
      GIT_COMMITTER_NAME: "Coworker Test",
      GIT_COMMITTER_EMAIL: "coworker@example.com",
    },
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "coworker-worktrees-"));
  repo = mkdtempSync(path.join(os.tmpdir(), "coworker-repo-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("WorktreeManager", () => {
  it("creates an isolated worktree and captures its diff", async () => {
    git(repo, ["init"]);
    writeFileSync(path.join(repo, "README.md"), "hello\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial"]);

    const manager = new WorktreeManager(root);
    const worktree = await manager.create(repo, "run_1");
    expect(existsSync(worktree.path)).toBe(true);
    expect(worktree.baseSha).toMatch(/^[0-9a-f]{40}$/);

    writeFileSync(path.join(worktree.path, "change.txt"), "from the worker\n");
    const diff = await manager.diff(worktree.path);
    expect(diff.stat).toContain("change.txt");
    expect(diff.patch).toContain("+from the worker");
    expect(diff.truncated).toBe(false);

    await manager.remove(repo, worktree.path);
    expect(existsSync(worktree.path)).toBe(false);
  });

  it("honours a baseRef", async () => {
    git(repo, ["init"]);
    writeFileSync(path.join(repo, "a.txt"), "one\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "one"]);
    git(repo, ["tag", "base-point"]);
    writeFileSync(path.join(repo, "a.txt"), "two\n");
    git(repo, ["commit", "-am", "two"]);

    const manager = new WorktreeManager(root);
    const worktree = await manager.create(repo, "run_2", "base-point");
    const contents = execFileSync("git", ["show", "HEAD:a.txt"], {
      cwd: worktree.path,
      encoding: "utf8",
    });
    expect(contents).toBe("one\n");
  });

  it("explains that a repo without commits cannot be used", async () => {
    git(repo, ["init"]);
    const manager = new WorktreeManager(root);
    await expect(manager.create(repo, "run_3")).rejects.toThrow(/no commits yet/);
  });

  it("explains that a directory is not a git repo", async () => {
    const manager = new WorktreeManager(root);
    await expect(manager.create(repo, "run_4")).rejects.toThrow(/not a git repository/);
  });
});
