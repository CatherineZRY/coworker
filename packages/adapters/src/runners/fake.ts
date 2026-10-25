import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkerResult, WorkerRunInput, WorkerRunner } from "@coworker/core";
import { WorkerExecutionError } from "../errors.js";
import { diffWorktree } from "../git.js";
import { buildResult, createContext, pushMessage } from "./base.js";

export interface FakeRunnerOptions {
  delayMs?: number;
}

/**
 * Deterministic worker used by tests and `coworker doctor`. It writes a marker
 * file into the worktree so the diff pipeline is exercised for real.
 */
export class FakeRunner implements WorkerRunner {
  readonly agent = "fake";
  private readonly delayMs: number;

  constructor(options: FakeRunnerOptions = {}) {
    this.delayMs = options.delayMs ?? 250;
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async run(input: WorkerRunInput): Promise<WorkerResult> {
    const ctx = createContext(input);
    input.onSpawn(process.pid, input.worktreePath);

    pushMessage(ctx, `Fake worker picked up attempt ${input.run.attempt}.`);
    await delay(this.delayMs, input.signal);

    if (process.env.COWORKER_FAKE_FAIL === "1") {
      throw new WorkerExecutionError("Fake worker configured to fail", { exitCode: 1 });
    }

    const dir = path.join(input.worktreePath, ".coworker");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${input.run.id}.md`),
      [
        `# Fake worker report`,
        ``,
        `Run: ${input.run.id}`,
        `Task: ${input.run.taskId}`,
        `Attempt: ${input.run.attempt}`,
        ``,
        `The fake worker completed successfully.`,
        ``,
        `## Prompt excerpt`,
        ``,
        "```",
        input.run.prompt.slice(0, 2_000),
        "```",
        ``,
      ].join("\n"),
      "utf8",
    );

    pushMessage(ctx, "Fake worker wrote .coworker report and finished.");
    ctx.resultText = `Fake worker completed attempt ${input.run.attempt}.`;
    const diff = await diffWorktree(input.worktreePath);
    return buildResult(ctx, diff);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new WorkerExecutionError("Fake worker cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new WorkerExecutionError("Fake worker cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
