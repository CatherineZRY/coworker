import type { WorkerResult, WorkerRunInput, WorkerRunner } from "@coworker/core";
import { type CommandResult, commandExists, runCommand } from "../command.js";
import { truncate, WorkerExecutionError } from "../errors.js";
import { diffWorktree } from "../git.js";
import { buildResult, createContext, parseJsonLine, pushMessage, textFromContent } from "./base.js";

export interface ClaudeCodeRunnerOptions {
  command?: string;
  /**
   * `bypassPermissions` is required for unattended runs. Each worker runs in a
   * disposable git worktree, but it still has the host user's filesystem access.
   */
  permissionMode?: string;
}

export class ClaudeCodeRunner implements WorkerRunner {
  readonly agent = "claude-code";
  private readonly command: string;
  private readonly permissionMode: string;

  constructor(options: ClaudeCodeRunnerOptions = {}) {
    this.command = options.command ?? process.env.COWORKER_CLAUDE_COMMAND ?? "claude";
    this.permissionMode =
      options.permissionMode ?? process.env.COWORKER_CLAUDE_PERMISSION_MODE ?? "bypassPermissions";
  }

  isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  async run(input: WorkerRunInput): Promise<WorkerResult> {
    const ctx = createContext(input);
    let isError = false;
    const stderrLines: string[] = [];

    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (this.permissionMode) args.push("--permission-mode", this.permissionMode);
    if (input.run.model) args.push("--model", input.run.model);

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
          handleEvent(event, ctx, () => {
            isError = true;
          });
        },
      });
    } catch (error) {
      if (isMissingCommand(error)) {
        throw new WorkerExecutionError(
          `Claude Code CLI not found (tried "${this.command}"). Install it or set COWORKER_CLAUDE_COMMAND.`,
        );
      }
      throw error;
    }

    if (result.timedOut) {
      throw new WorkerExecutionError(`Claude Code timed out after ${input.timeoutSec}s`, {
        timedOut: true,
        details: { stderr: truncate(stderrLines.join("\n")) },
      });
    }
    if (result.aborted) {
      throw new WorkerExecutionError("Claude Code run was cancelled", {
        details: { stderr: truncate(stderrLines.join("\n")) },
      });
    }
    if (result.code !== 0 || isError) {
      throw new WorkerExecutionError(
        `Claude Code exited with ${result.code ?? "no code"}${isError ? " (reported error)" : ""}`,
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

function handleEvent(
  event: Record<string, unknown>,
  ctx: ReturnType<typeof createContext>,
  markError: () => void,
): void {
  const type = event.type;
  if (type === "system" && event.subtype === "init") {
    ctx.sessionId = typeof event.session_id === "string" ? event.session_id : ctx.sessionId;
    ctx.input.onEvent({
      type: "session",
      payload: { sessionId: ctx.sessionId, agent: "claude-code" },
    });
    return;
  }
  if (type === "assistant") {
    const message = event.message as Record<string, unknown> | undefined;
    pushMessage(ctx, textFromContent(message?.content));
    return;
  }
  if (type === "result") {
    if (typeof event.session_id === "string") ctx.sessionId = event.session_id;
    if (typeof event.result === "string") ctx.resultText = event.result;
    if (event.usage && typeof event.usage === "object") {
      ctx.usage = event.usage as Record<string, unknown>;
    }
    if (event.is_error === true) markError();
    if (typeof event.subtype === "string" && event.subtype !== "success") markError();
    ctx.input.onEvent({
      type: "session",
      payload: { sessionId: ctx.sessionId, agent: "claude-code", usage: ctx.usage },
    });
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
