import type {
  AgentId,
  Artifact,
  Board,
  BoardSnapshot,
  DispatchResult,
  Review,
  ReviewCommentInput,
  Run,
  RunDetail,
  SessionSummary,
  Task,
  TaskWithRuns,
} from "@coworker/shared";

const TOKEN_KEY = "coworker.token";

let memoryToken = "";

function bootstrapToken(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    memoryToken = queryToken;
    localStorage.setItem(TOKEN_KEY, queryToken);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return;
  }
  memoryToken = localStorage.getItem(TOKEN_KEY) ?? "";
}

bootstrapToken();

export function authToken(): string {
  return memoryToken || localStorage.getItem(TOKEN_KEY) || "";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(pathname, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // keep default message
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
  defaultBoard: Board;
  boards: Board[];
}

export interface TaskDetailResponse {
  task: TaskWithRuns;
  reviews: Review[];
  artifacts: Artifact[];
}

export interface DispatchResponse extends DispatchResult {
  boardId: string | null;
  latestEventId: number;
}

export interface EventsResponse {
  events: Array<{
    id: number;
    boardId: string;
    taskId: string | null;
    runId: string | null;
    type: string;
    payload: Record<string, unknown>;
    createdAt: number;
  }>;
  latestEventId: number;
}

export interface CreateTaskPayload {
  boardId: string;
  title: string;
  description?: string;
  priority?: number;
  labels?: string[];
}

export interface PatchTaskPayload {
  title?: string;
  description?: string;
  status?: Task["status"];
  priority?: number;
  labels?: string[];
}

export interface DispatchPayload {
  boardId: string;
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

export interface ReviewPayload {
  runId: string;
  verdict: "approved" | "changes_requested" | "rejected";
  summary?: string;
  comments?: ReviewCommentInput[];
}

export interface RequestChangesPayload {
  runId: string;
  comments: ReviewCommentInput[];
  summary?: string;
  agent?: AgentId;
}

export const api = {
  sessions: (force = false) => request<SessionsResponse>(`/api/sessions${force ? "?force=1" : ""}`),
  syncSessions: () =>
    request<{ threads: number; boards: number }>("/api/sessions/sync", { method: "POST" }),
  board: (boardId: string) => request<BoardSnapshot>(`/api/boards/${encodeURIComponent(boardId)}`),
  renameBoard: (boardId: string, title: string | null) =>
    request<Board>(`/api/boards/${encodeURIComponent(boardId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  createTask: (payload: CreateTaskPayload) =>
    request<TaskWithRuns>("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  patchTask: (taskId: string, payload: PatchTaskPayload) =>
    request<TaskWithRuns>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteTask: (taskId: string) =>
    request<void>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }),
  dispatch: (payload: DispatchPayload) =>
    request<DispatchResponse>("/api/dispatch", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  task: (taskId: string) => request<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(taskId)}`),
  run: (runId: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`),
  cancelRun: (runId: string) =>
    request<Run | null>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  submitReview: (payload: ReviewPayload) =>
    request<{ review: Review; task: Task; run: Run }>("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ ...payload, reviewerType: "human", reviewerName: "Local reviewer" }),
    }),
  requestChanges: (payload: RequestChangesPayload) =>
    request<{ review: Review; task: Task; run: Run }>(
      `/api/runs/${encodeURIComponent(payload.runId)}/request-changes`,
      {
        method: "POST",
        body: JSON.stringify({
          comments: payload.comments,
          summary: payload.summary,
          agent: payload.agent,
          reviewerType: "human",
          reviewerName: "Local reviewer",
        }),
      },
    ),
  resolveComment: (commentId: string, resolved: boolean) =>
    request<{ ok: boolean }>(`/api/reviews/comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      body: JSON.stringify({ resolved }),
    }),
  events: (boardId: string, after = 0, limit = 200) =>
    request<EventsResponse>(
      `/api/events?boardId=${encodeURIComponent(boardId)}&after=${after}&limit=${limit}`,
    ),
  agents: () => request<{ agents: Array<{ id: AgentId; available: boolean }> }>("/api/agents"),
  health: () => request<{ ok: boolean; version: string; activeRuns: number }>("/api/health"),
};

export function eventStreamUrl(boardId: string, after = 0): string {
  const token = authToken();
  const params = new URLSearchParams({ after: String(after) });
  if (token) params.set("token", token);
  return `/api/boards/${encodeURIComponent(boardId)}/events/stream?${params.toString()}`;
}
