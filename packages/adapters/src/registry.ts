import type { WorkerRunner } from "@coworker/core";
import type { AgentId } from "@coworker/shared";
import type { CoworkerConfig } from "./config.js";
import { ClaudeCodeRunner } from "./runners/claude-code.js";
import { CodexRunner } from "./runners/codex.js";
import { CursorRunner } from "./runners/cursor.js";
import { FakeRunner } from "./runners/fake.js";

export function createRunners(config: CoworkerConfig): Record<AgentId, WorkerRunner> {
  return {
    "claude-code": new ClaudeCodeRunner({
      command: config.workers.claudeCode.command,
      permissionMode: config.workers.claudeCode.permissionMode,
    }),
    codex: new CodexRunner({ command: config.workers.codex.command }),
    cursor: new CursorRunner({ command: config.workers.cursor.command }),
    fake: new FakeRunner(),
  };
}

export class WorkerUnavailableError extends Error {
  constructor(agent: string) {
    super(`Worker "${agent}" is not available on this machine`);
    this.name = "WorkerUnavailableError";
  }
}
