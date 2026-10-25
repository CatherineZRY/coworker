import type {
  Artifact,
  Board,
  CodexThread,
  EventType,
  Review,
  ReviewComment,
  Run,
  RunEvent,
  Task,
} from "@coworker/shared";
import type {
  ArtifactRow,
  BoardRow,
  CodexThreadRow,
  ReviewCommentRow,
  ReviewRow,
  RunEventRow,
  RunRow,
  TaskRow,
} from "./schema.js";

export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function threadFromRow(row: CodexThreadRow): CodexThread {
  return {
    id: row.id,
    title: row.title,
    firstUserMessage: row.firstUserMessage,
    cwd: row.cwd,
    gitBranch: row.gitBranch,
    source: row.source,
    updatedAt: row.updatedAt,
    archived: row.archived,
    syncedAt: row.syncedAt,
  };
}

export function boardFromRow(row: BoardRow, thread: CodexThreadRow | null | undefined): Board {
  const fallbackTitle = thread?.firstUserMessage?.split("\n")[0]?.trim();
  return {
    id: row.id,
    codexThreadId: row.codexThreadId,
    titleOverride: row.titleOverride,
    title:
      row.titleOverride ??
      thread?.title ??
      (fallbackTitle ? fallbackTitle.slice(0, 120) : null) ??
      (row.codexThreadId ? `Session ${row.id.slice(-6)}` : "Local board"),
    cwd: thread?.cwd ?? null,
    gitBranch: thread?.gitBranch ?? null,
    updatedAt: thread?.updatedAt ?? null,
    createdAt: row.createdAt,
  };
}

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    boardId: row.boardId,
    title: row.title,
    description: row.description,
    status: row.status as Task["status"],
    priority: row.priority,
    createdBy: row.createdBy as Task["createdBy"],
    labels: parseJson<string[]>(row.labelsJson, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function runFromRow(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.taskId,
    parentRunId: row.parentRunId,
    attempt: row.attempt,
    agent: row.agent as Run["agent"],
    model: row.model,
    timeoutSec: row.timeoutSec,
    prompt: row.prompt,
    reviewContext: row.reviewContextJson,
    status: row.status as Run["status"],
    worktreePath: row.worktreePath,
    baseRef: row.baseRef,
    headSha: row.headSha,
    sessionId: row.sessionId,
    pid: row.pid,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    exitCode: row.exitCode,
    summary: row.summary,
    diffStat: row.diffStat,
    diffPatch: row.diffPatch,
    usage: parseJson<Record<string, unknown> | null>(row.usageJson, null),
    error: parseJson<Record<string, unknown> | null>(row.errorJson, null),
    createdAt: row.createdAt,
  };
}

export function commentFromRow(row: ReviewCommentRow): ReviewComment {
  return {
    id: row.id,
    reviewId: row.reviewId,
    filePath: row.filePath,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    side: row.side as ReviewComment["side"],
    severity: row.severity as ReviewComment["severity"],
    body: row.body,
    resolved: row.resolved,
    createdAt: row.createdAt,
  };
}

export function reviewFromRow(row: ReviewRow, comments: ReviewCommentRow[]): Review {
  return {
    id: row.id,
    runId: row.runId,
    reviewerType: row.reviewerType as Review["reviewerType"],
    reviewerName: row.reviewerName,
    verdict: row.verdict as Review["verdict"],
    summary: row.summary,
    comments: comments.map(commentFromRow),
    createdAt: row.createdAt,
  };
}

export function artifactFromRow(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind as Artifact["kind"],
    name: row.name,
    path: row.path,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}

export function eventFromRow(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    boardId: row.boardId,
    taskId: row.taskId,
    runId: row.runId,
    type: row.type as EventType,
    payload: parseJson<Record<string, unknown>>(row.payloadJson, {}),
    createdAt: row.createdAt,
  };
}
