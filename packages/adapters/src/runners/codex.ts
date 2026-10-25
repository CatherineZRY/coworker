import type { WorkerResult, WorkerRunInput, WorkerRunner } from "@coworker/core";
import { type CommandResult, commandExists, runCommand } from "../command.js";
import { truncate, WorkerExecutionError } from "../errors.js";
import { diffWorktree } from "../git.js";
import { buildResult, createContext, parseJsonLine, pushMessage } from "./base.js";

export interface CodexRunnerOptions {
  command?: string;
  /**
   * `--full-auto` runs the worker in Codex's workspace-write sandbox without
   * approval prompts. The worktree is still the only intended write target.
   */
  automationFlag?: string;
}

export class CodexRunner implements WorkerRunner {
  readonly agent = "codex";
  private readonly command: string;
  private readonly automationFlag: string;

  constructor(options: CodexRunnerOptions = {}) {
    this.command = options.command ?? process.env.COWORKER_CODEX_COMMAND ?? "codex";
    this.automationFlag = options.automationFlag ?? "--full-auto";
  }

  isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  async run(input: WorkerRunInput): Promise<WorkerResult> {
    const ctx = createContext(input);
    const stderrLines: string[] = [];
    let failedMessage: string | null = null;

    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--cd",
      input.worktreePath,
      this.automationFlag,
    ];
    if (input.run.model) args.push("--model", input.run.model);

    // `-` asks Codex to read the prompt from stdin, avoiding argv size limits.
    args.push("-");

    let result: CommandResult;
    try {
      result = await runCommand({
        command: this.command,
        args,
        cwd: input.worktreePath,
        env: input.env,
        input: input.run.prompt,
        timeoutMs: input.timeoutSec * 1000,
        signal: input.signal,
        onSpawn: (pid) => input.onSpawn(pid, input.worktreePath),
        onStderrLine: (line) => {
          stderrLines.push(line);
          if (stderrLines.length > 200) stderrLines.shift();
        },
        onStdoutLine: (line) => {
          const event = parseJsonLine(line);
          if (!event) return;
          const type = event.type;
          if (type === "thread.started" && typeof event.thread_id === "string") {
            ctx.sessionId = event.thread_id;
            input.onEvent({
              type: "session",
              payload: { sessionId: ctx.sessionId, agent: "codex" },
            });
          } else if (type === "item.completed") {
            const item = event.item as Record<string, unknown> | undefined;
            if (item?.type === "agent_message" && typeof item.text === "string") {
              pushMessage(ctx, item.text);
            }
          } else if (type === "turn.completed") {
            if (event.usage && typeof event.usage === "object") {
              ctx.usage = event.usage as Record<string, unknown>;
            }
          } else if (type === "turn.failed") {
            const error = event.error as Record<string, unknown> | undefined;
            failedMessage =
              typeof error?.message === "string" ? error.message : "Codex turn failed";
          } else if (type === "error" && typeof event.message === "string") {
            failedMessage = event.message;
          }
        },
      });
    } catch (error) {
      if (isMissingCommand(error)) {
        throw new WorkerExecutionError(
          `Codex CLI not found (tried "${this.command}"). Install it or set COWORKER_CODEX_COMMAND.`,
        );
      }
      throw error;
    }

    if (result.timedOut) {
      throw new WorkerExecutionError(`Codex timed out after ${input.timeoutSec}s`, {
        timedOut: true,
        details: { stderr: truncate(stderrLines.join("\n")) },
      });
    }
    if (result.aborted) {
      throw new WorkerExecutionError("Codex run was cancelled", {
        details: { stderr: truncate(stderrLines.join("\n")) },
      });
    }
    if (result.code !== 0 || failedMessage) {
      throw new WorkerExecutionError(
        failedMessage ?? `Codex exited with ${result.code ?? "no code"}`,
        {
          exitCode: result.code,
          details: {
            stderr: truncate(stderrLines.join("\n")),
            lastMessage: ctx.messages.at(-1)?.slice(0, 2_000) ?? null,
          },
        },
      );
    }

    const diff = await diffWorktree(input.worktreePath);
    return buildResult(ctx, diff);
  }
}

function isMissingCommand(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
