import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PATCH_BYTES = 5_000_000;

export interface GitResult {
  stdout: string;
  stderr: string;
}

export async function git(
  cwd: string,
  args: string[],
  opts?: { maxBuffer?: number },
): Promise<GitResult> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: opts?.maxBuffer ?? 20 * 1024 * 1024,
    encoding: "utf8",
  });
  return { stdout, stderr };
}

export async function resolveRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

export async function resolveRef(cwd: string, ref: string): Promise<string> {
  const { stdout } = await git(cwd, ["rev-parse", ref]);
  return stdout.trim();
}

export interface WorktreeInfo {
  path: string;
  baseRef: string;
  baseSha: string;
}

export interface WorktreeDiff {
  stat: string;
  patch: string;
  headSha: string;
  truncated: boolean;
}

export async function diffWorktree(worktreePath: string): Promise<WorktreeDiff> {
  // Stage everything so untracked files show up in the patch. The worktree is
  // disposable, so mutating its index is safe.
  await git(worktreePath, ["add", "-A"]);
  const stat = (await git(worktreePath, ["diff", "--cached", "--stat", "--no-color"])).stdout;
  const patch = (
    await git(worktreePath, ["diff", "--cached", "--patch", "--binary", "--no-color"], {
      maxBuffer: MAX_PATCH_BYTES * 2,
    })
  ).stdout;
  const headSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();

  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    return {
      stat,
      patch:
        patch.slice(0, MAX_PATCH_BYTES) +
        "\n\n[coworker] diff truncated at 5 MB; inspect the worktree for the full change.\n",
      headSha,
      truncated: true,
    };
  }
  return { stat, patch, headSha, truncated: false };
}

export class WorktreeManager {
  constructor(private readonly root: string) {}

  async create(repoPath: string, runId: string, baseRef?: string | null): Promise<WorktreeInfo> {
    let repoRoot: string;
    try {
      repoRoot = await resolveRepoRoot(repoPath);
    } catch {
      throw new Error(`${repoPath} is not a git repository. Worker runs need git for isolation.`);
    }
    const ref = baseRef ?? "HEAD";
    let baseSha: string;
    try {
      baseSha = await resolveRef(repoRoot, ref);
    } catch {
      if (ref === "HEAD") {
        throw new Error(
          `${repoRoot} has no commits yet. Create an initial commit before dispatching tasks: git commit --allow-empty -m "initial commit"`,
        );
      }
      throw new Error(`Cannot resolve base ref "${ref}" in ${repoRoot}.`);
    }
    const repoName = path.basename(repoRoot);
    const worktreePath = path.join(this.root, repoName, runId);

    await mkdir(path.dirname(worktreePath), { recursive: true });
    try {
      await rm(worktreePath, { recursive: true, force: true });
      await git(repoRoot, ["worktree", "add", "--detach", worktreePath, baseSha]);
    } catch (error) {
      throw new Error(
        `Failed to create worktree for ${repoRoot}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { path: worktreePath, baseRef: ref, baseSha };
  }

  async diff(worktreePath: string): Promise<WorktreeDiff> {
    return diffWorktree(worktreePath);
  }

  async remove(repoPath: string, worktreePath: string): Promise<void> {
    const repoRoot = await resolveRepoRoot(repoPath);
    try {
      await git(repoRoot, ["worktree", "remove", "--force", worktreePath]);
    } catch {
      await rm(worktreePath, { recursive: true, force: true });
    }
  }

  async list(repoPath: string): Promise<string[]> {
    const repoRoot = await resolveRepoRoot(repoPath);
    const { stdout } = await git(repoRoot, ["worktree", "list", "--porcelain"]);
    return stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length));
  }
}
