import { realpath } from "node:fs/promises";
import path from "node:path";
import type { CoworkerConfig, CoworkerPaths } from "@coworker/adapters";
import { resolveRepoRoot, WorkerExecutionError, type WorktreeManager } from "@coworker/adapters";
import type { Core, WorkerRunner } from "@coworker/core";
import type { RunEvent } from "@coworker/shared";
import type { Logger } from "./logger.js";

export interface SchedulerDeps {
  core: Core;
  runners: Record<string, WorkerRunner>;
  worktrees: WorktreeManager;
  config: CoworkerConfig;
  paths: CoworkerPaths;
  logger: Logger;
}

export class Scheduler {
  private readonly active = new Map<string, AbortController>();
  private readonly queue: string[] = [];
  private stopped = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    this.deps.core.events.emitter.on("event", (event: RunEvent) => {
      if (event.type === "run.queued" && event.runId) this.enqueue(event.runId);
    });
    this.recover();
  }

  stop(): void {
    this.stopped = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.queue.length = 0;
  }

  enqueue(runId: string): void {
    if (this.stopped) return;
    if (this.active.has(runId) || this.queue.includes(runId)) return;
    const run = this.deps.core.runs.get(runId);
    if (!run || ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status)) return;
    this.queue.push(runId);
    this.drain();
  }

  cancel(runId: string): void {
    const controller = this.active.get(runId);
    controller?.abort();
    const run = this.deps.core.runs.get(runId);
    if (!run) return;
    if (["queued", "starting", "running"].includes(run.status)) {
      this.deps.core.runService.cancel(runId);
    }
    const index = this.queue.indexOf(runId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  get activeCount(): number {
    return this.active.size;
  }

  private drain(): void {
    while (
      !this.stopped &&
      this.active.size < this.deps.config.maxConcurrentRuns &&
      this.queue.length > 0
    ) {
      const runId = this.queue.shift();
      if (!runId) break;
      const controller = new AbortController();
      this.active.set(runId, controller);
      void this.execute(runId, controller.signal)
        .catch((error) => {
          this.deps.logger.error("run execution crashed", {
            runId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.active.delete(runId);
          this.drain();
        });
    }
  }

  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    const { core } = this.deps;
    const run = core.runs.get(runId);
    if (!run) return;

    const task = core.tasks.get(run.taskId);
    if (!task) {
      core.runService.fail(runId, { message: `Task ${run.taskId} disappeared` });
      return;
    }
    const board = core.boards.get(task.boardId);
    if (!board) {
      core.runService.fail(runId, { message: `Board ${task.boardId} disappeared` });
      return;
    }

    try {
      const repoPath = await this.resolveRepo(board.cwd);
      if (!repoPath) {
        core.runService.fail(runId, {
          message:
            "No git repository found for this task. Start the Codex session inside a git repo, or set defaultRepo in ~/.coworker/config.json.",
        });
        return;
      }

      const runner = this.deps.runners[run.agent];
      if (!runner) {
        core.runService.fail(runId, { message: `Unknown worker agent: ${run.agent}` });
        return;
      }
      if (!(await runner.isAvailable())) {
        core.runService.fail(runId, {
          message: `Worker "${run.agent}" is not installed or not on PATH.`,
        });
        return;
      }

      const worktree = await this.deps.worktrees.create(repoPath, run.id, run.baseRef);
      if (signal.aborted) {
        core.runService.cancel(runId);
        return;
      }

      core.runService.start(runId, {
        pid: null,
        worktreePath: worktree.path,
        baseRef: worktree.baseRef,
      });

      const timeoutSec = run.timeoutSec ?? this.deps.config.defaultTimeoutSec;
      this.deps.logger.info("run started", {
        runId,
        taskId: task.id,
        agent: run.agent,
        worktree: worktree.path,
      });

      const result = await runner.run({
        run,
        repoPath,
        worktreePath: worktree.path,
        baseRef: worktree.baseRef,
        timeoutSec,
        env: {
          COWORKER_RUN_ID: run.id,
          COWORKER_TASK_ID: task.id,
          COWORKER_BOARD_ID: task.boardId,
          COWORKER_AGENT: run.agent,
        },
        signal,
        onSpawn: (pid) => {
          if (pid != null) {
            core.runs.update(runId, { pid });
            core.runService.progress(runId, { phase: "spawned", pid });
          }
        },
        onEvent: (event) => {
          if (event.type === "session") {
            const sessionId =
              typeof event.payload.sessionId === "string" ? event.payload.sessionId : null;
            if (sessionId) core.runs.update(runId, { sessionId });
          }
          core.runService.progress(runId, {
            phase: event.type,
            ...event.payload,
          });
        },
      });

      if (signal.aborted) {
        core.runService.cancel(runId);
        return;
      }
      core.runService.succeed(runId, result);
      this.deps.logger.info("run completed", { runId, taskId: task.id, agent: run.agent });
    } catch (error) {
      const current = core.runs.get(runId);
      if (current && ["succeeded", "failed", "cancelled", "timed_out"].includes(current.status)) {
        return;
      }
      if (signal.aborted) {
        core.runService.cancel(runId);
        return;
      }
      if (error instanceof WorkerExecutionError) {
        core.runService.fail(
          runId,
          {
            message: error.message,
            exitCode: error.exitCode,
            timedOut: error.timedOut,
            details: error.details,
          },
          error.timedOut ? "timed_out" : "failed",
        );
      } else {
        core.runService.fail(runId, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.deps.logger.error("run failed", {
        runId,
        taskId: task.id,
        agent: run.agent,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async resolveRepo(boardCwd: string | null): Promise<string | null> {
    const candidates = [boardCwd, this.deps.config.defaultRepo].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    let outsideAllowed: string | null = null;
    for (const candidate of candidates) {
      try {
        const root = await resolveRepoRoot(candidate);
        await this.assertAllowed(root);
        return root;
      } catch (error) {
        if (error instanceof Error && /outside allowedRoots/.test(error.message)) {
          outsideAllowed = error.message;
        }
      }
    }
    if (outsideAllowed) {
      throw new Error(
        `${outsideAllowed}. Add the repository to allowedRoots in config.json, or start the Codex session inside an allowed repository.`,
      );
    }
    return null;
  }

  private async assertAllowed(repoRoot: string): Promise<void> {
    const roots = this.deps.config.allowedRoots;
    if (roots.length === 0) return;
    const resolved = await realpath(repoRoot);
    const allowed = await Promise.all(
      roots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return path.resolve(root);
        }
      }),
    );
    const ok = allowed.some(
      (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
    );
    if (!ok) throw new Error(`Repository ${resolved} is outside allowedRoots`);
  }

  private recover(): void {
    const runs = this.deps.core.runs.listActive();
    for (const run of runs) {
      if (run.status === "queued") {
        this.enqueue(run.id);
        continue;
      }
      if (run.pid != null) {
        try {
          process.kill(run.pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
      this.deps.core.runService.fail(run.id, {
        message: "coworker daemon restarted while this run was active; start it again.",
        details: { recoveredPid: run.pid },
      });
    }
    if (runs.length > 0) {
      this.deps.logger.info("recovered active runs", { count: runs.length });
    }
  }
}
