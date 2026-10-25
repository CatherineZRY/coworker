import type { ArtifactKind, Run } from "@coworker/shared";

export interface WorkerEvent {
  type: "progress" | "session" | "artifact" | "message";
  payload: Record<string, unknown>;
}

export interface WorkerRunInput {
  run: Run;
  repoPath: string;
  worktreePath: string;
  baseRef: string | null;
  timeoutSec: number;
  env: Record<string, string>;
  onEvent: (event: WorkerEvent) => void;
  onSpawn: (pid: number | null, worktreePath: string) => void;
  signal: AbortSignal;
}

export interface WorkerResult {
  summary: string | null;
  diffStat: string | null;
  diffPatch: string | null;
  headSha: string | null;
  usage: Record<string, unknown> | null;
  artifacts: Array<{
    kind: ArtifactKind;
    name: string;
    path: string;
    mime?: string | null;
    sizeBytes?: number | null;
  }>;
}

export interface WorkerError {
  message: string;
  exitCode?: number | null;
  timedOut?: boolean;
  details?: Record<string, unknown>;
}

export interface WorkerRunner {
  readonly agent: string;
  isAvailable(): Promise<boolean>;
  run(input: WorkerRunInput): Promise<WorkerResult>;
}
