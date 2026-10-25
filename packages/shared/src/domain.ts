export const AGENT_IDS = ["claude-code", "codex", "cursor", "fake"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const TASK_STATUSES = [
  "backlog",
  "ready",
  "running",
  "review",
  "changes_requested",
  "done",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = [
  "queued",
  "starting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const REVIEW_VERDICTS = ["approved", "changes_requested", "rejected"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const REVIEWER_TYPES = ["human", "codex", "claude", "cursor", "system"] as const;
export type ReviewerType = (typeof REVIEWER_TYPES)[number];

export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ARTIFACT_KINDS = ["log", "diff", "test_report", "screenshot", "pr", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const EVENT_TYPES = [
  "task.created",
  "task.updated",
  "task.moved",
  "run.queued",
  "run.started",
  "run.progress",
  "run.completed",
  "run.failed",
  "review.created",
  "artifact.created",
  "session.updated",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface CodexThread {
  id: string;
  title: string | null;
  firstUserMessage: string | null;
  cwd: string;
  gitBranch: string | null;
  source: string | null;
  updatedAt: number | null;
  archived: boolean;
  syncedAt: number;
}

export interface Board {
  id: string;
  codexThreadId: string | null;
  titleOverride: string | null;
  title: string;
  cwd: string | null;
  gitBranch: string | null;
  updatedAt: number | null;
  createdAt: number;
}

export interface Task {
  id: string;
  boardId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  createdBy: "human" | "codex" | "system";
  labels: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Run {
  id: string;
  taskId: string;
  parentRunId: string | null;
  attempt: number;
  agent: AgentId;
  model: string | null;
  timeoutSec: number | null;
  prompt: string;
  reviewContext: string | null;
  status: RunStatus;
  worktreePath: string | null;
  baseRef: string | null;
  headSha: string | null;
  sessionId: string | null;
  pid: number | null;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
  summary: string | null;
  diffStat: string | null;
  diffPatch: string | null;
  usage: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: number;
}

export interface ReviewComment {
  id: string;
  reviewId: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  side: "old" | "new" | null;
  severity: Severity;
  body: string;
  resolved: boolean;
  createdAt: number;
}

export interface Review {
  id: string;
  runId: string;
  reviewerType: ReviewerType;
  reviewerName: string | null;
  verdict: ReviewVerdict;
  summary: string | null;
  comments: ReviewComment[];
  createdAt: number;
}

export interface Artifact {
  id: string;
  runId: string;
  kind: ArtifactKind;
  name: string;
  path: string;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: number;
}

export interface RunEvent {
  id: number;
  boardId: string;
  taskId: string | null;
  runId: string | null;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface TaskWithRuns extends Task {
  runs: Run[];
  latestRun: Run | null;
  reviewCount: number;
  unresolvedCommentCount: number;
}

export interface BoardSnapshot {
  board: Board;
  tasks: TaskWithRuns[];
  activeRuns: number;
}

export interface SessionSummary {
  thread: CodexThread;
  boardId: string;
  activeRuns: number;
  taskCount: number;
  updatedAt: number;
}

export interface RunDetail {
  run: Run;
  task: Task;
  reviews: Review[];
  artifacts: Artifact[];
}

export interface DispatchInput {
  boardId?: string;
  taskId?: string;
  prompt?: string;
  title?: string;
  description?: string;
  agent: AgentId;
  repo?: string;
  baseRef?: string;
  model?: string;
  timeoutSec?: number;
}

export interface DispatchResult {
  taskId: string;
  runId: string;
}

export interface ReviewCommentInput {
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  side?: "old" | "new";
  severity?: Severity;
  body: string;
}

export interface SubmitReviewInput {
  runId: string;
  verdict: ReviewVerdict;
  summary?: string;
  comments?: ReviewCommentInput[];
  reviewerType?: ReviewerType;
  reviewerName?: string;
}

export interface RequestChangesInput {
  runId: string;
  comments: ReviewCommentInput[];
  summary?: string;
  agent?: AgentId;
  reviewerType?: ReviewerType;
  reviewerName?: string;
}
