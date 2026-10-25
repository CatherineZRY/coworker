import { DEFAULT_HOST, DEFAULT_PORT } from "@coworker/shared";

export interface WorkerConfig {
  enabled: boolean;
  command?: string;
  model?: string;
}

export interface CoworkerConfig {
  host: string;
  port: number;
  maxConcurrentRuns: number;
  defaultTimeoutSec: number;
  maxAttempts: number;
  allowedRoots: string[];
  defaultRepo: string | null;
  workers: {
    claudeCode: WorkerConfig & { permissionMode: string };
    codex: WorkerConfig;
    cursor: WorkerConfig;
  };
}

export const DEFAULT_CONFIG: CoworkerConfig = {
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  maxConcurrentRuns: 4,
  defaultTimeoutSec: 1_800,
  maxAttempts: 3,
  allowedRoots: [],
  defaultRepo: null,
  workers: {
    claudeCode: {
      enabled: true,
      command: "claude",
      permissionMode: "bypassPermissions",
    },
    codex: {
      enabled: true,
      command: "codex",
    },
    cursor: {
      enabled: true,
      command: "cursor-agent",
    },
  },
};

export function mergeConfig(
  base: CoworkerConfig,
  override: Partial<CoworkerConfig>,
): CoworkerConfig {
  return {
    ...base,
    ...override,
    workers: {
      claudeCode: { ...base.workers.claudeCode, ...override.workers?.claudeCode },
      codex: { ...base.workers.codex, ...override.workers?.codex },
      cursor: { ...base.workers.cursor, ...override.workers?.cursor },
    },
  };
}
