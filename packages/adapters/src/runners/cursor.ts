import type { WorkerResult, WorkerRunInput, WorkerRunner } from "@coworker/core";
import { type CommandResult, commandExists, runCommand } from "../command.js";
import { truncate, WorkerExecutionError } from "../errors.js";
import { diffWorktree } from "../git.js";
import { buildResult, createContext, parseJsonLine, pushMessage, textFromContent } from "./base.js";

export interface CursorRunnerOptions {
  command?: string;
  force?: boolean;
}

export class CursorRunner implements WorkerRunner {
  readonly agent = "cursor";
  private readonly command: string;
  private readonly force: boolean;

  constructor(options: CursorRunnerOptions = {}) {
    this.command = options.command ?? process.env.COWORKER_CURSOR_COMMAND ?? "cursor-agent";
    this.force = options.force ?? true;
  }

  isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  async run(input: WorkerRunInput): Promise<WorkerResult> {
    const ctx = createContext(input);
    const stderrLines: string[] = [];
    let isError = false;

    const args = ["-p", "--output-format", "stream-json"];
    if (this.force) args.push("--force");
    if (input.run.model) args.push("--model", input.run.model);
    args.push(input.run.prompt);

    let result: CommandResult;
    try {
      result = await runCommand({
        command: this.command,
        args,
        cwd: input.worktreePath,
        env: input.env,
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
          if (type === "system" && typeof event.session_id === "string") {
            ctx.sessionId = event.session_id;
            input.onEvent({
              type: "session",
              payload: { sessionId: ctx.sessionId, agent: "cursor" },
            });
          } else if (type === "assistant") {
            const message = event.message as Record<string, unknown> | undefined;
            pushMessage(ctx, textFromContent(message?.content ?? event.content));
          } else if (type === "result") {
            if (typeof event.result === "string") ctx.resultText = event.result;
            if (event.usage && typeof event.usage === "object") {
              ctx.usage = event.usage as Record<string, unknown>;
            }
            if (event.is_error === true) isError = true;
          }
        },
      });
    } catch (error) {
      if (isMissingCommand(error)) {
        throw new WorkerExecutionError(
          `Cursor CLI not found (tried "${this.command}"). Install cursor-agent or set COWORKER_CURSOR_COMMAND.`,
        );
      }
      throw error;
    }

    if (result.timedOut) {
      throw new WorkerExecutionError(`Cursor timed out after ${input.timeoutSec}s`, {
        timedOut: true,
        details: { stderr: truncate(stderrLines.join("\n")) },
      });
    }
    if (result.aborted) {
      throw new WorkerExecutionError("Cursor run was cancelled", {
        details: { stderr: truncate(stderrLines.join("\n")) },
      });
    }
    if (result.code !== 0 || isError) {
      throw new WorkerExecutionError(
        `Cursor exited with ${result.code ?? "no code"}${isError ? " (reported error)" : ""}`,
        {
          exitCode: result.code,
          details: { stderr: truncate(stderrLines.join("\n")) },
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
