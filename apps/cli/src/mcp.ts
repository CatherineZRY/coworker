import {
  AGENT_IDS,
  BOARD_COLUMNS,
  type BoardSnapshot,
  type Run,
  type TaskWithRuns,
} from "@coworker/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiJson, DaemonNotRunningError } from "./http.js";

interface SessionContext {
  boardId: string;
  threadId: string | null;
  title: string;
  cwd: string | null;
}

interface TaskDetail {
  task: TaskWithRuns;
  reviews: unknown[];
  artifacts: unknown[];
}

interface WaitEvent {
  id: number;
  type: string;
  taskId: string | null;
  runId: string | null;
  payload: unknown;
}

interface WaitResult {
  events: WaitEvent[];
  latestEventId: number;
  timedOut: boolean;
}

const TERMINAL_RUN = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: "coworker", version: "0.1.0" });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function registerTools(server: McpServer): void {
  let cachedSession: { value: SessionContext; at: number } | null = null;

  async function resolveSession(boardId?: string): Promise<SessionContext> {
    if (boardId) {
      return { boardId, threadId: null, title: "", cwd: null };
    }
    if (cachedSession && Date.now() - cachedSession.at < 30_000) {
      return cachedSession.value;
    }
    const threadId = process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID ?? undefined;
    const value = await call<SessionContext>("/api/resolve-session", {
      method: "POST",
      body: JSON.stringify({
        ppid: process.ppid,
        threadId,
        cwd: process.cwd(),
      }),
    });
    cachedSession = { value, at: Date.now() };
    return value;
  }

  server.registerTool(
    "dispatch_task",
    {
      title: "Dispatch a coding task to a worker agent",
      description:
        "Create (or reuse) a task on the current Codex session board and dispatch it to a worker agent. The worker runs in an isolated git worktree. Returns boardId, taskId, runId and afterEventId; pass those to wait_for_board to block until the run finishes.",
      inputSchema: {
        taskId: z.string().optional().describe("Existing task to dispatch a new attempt for"),
        boardId: z
          .string()
          .optional()
          .describe("Board id; omit to use the board for the current Codex session"),
        title: z.string().max(300).optional(),
        description: z.string().max(20_000).optional(),
        prompt: z
          .string()
          .max(200_000)
          .optional()
          .describe("Full worker prompt. If omitted, coworker builds one from title/description."),
        agent: z.enum(AGENT_IDS).default("claude-code"),
        repo: z.string().optional().describe("Repository path; defaults to the Codex session cwd"),
        baseRef: z.string().optional(),
        model: z.string().optional(),
        timeoutSec: z.number().int().min(10).max(86_400).optional(),
      },
    },
    async (args) =>
      runTool(async () => {
        if (!args.taskId && !args.prompt && !args.title) {
          throw new Error("Provide taskId, prompt, or title.");
        }
        const session = await resolveSession(args.boardId);
        const result = await call<{
          taskId: string;
          runId: string;
          boardId: string;
          latestEventId: number;
        }>("/api/dispatch", {
          method: "POST",
          body: JSON.stringify({ ...args, boardId: session.boardId }),
        });
        return {
          boardId: session.boardId,
          boardTitle: session.title,
          taskId: result.taskId,
          runId: result.runId,
          afterEventId: result.latestEventId,
          next: "Call wait_for_board with this boardId and afterEventId (or taskId) to block until the run changes state. Then inspect the diff with get_run before reviewing.",
        };
      }),
  );

  server.registerTool(
    "wait_for_board",
    {
      title: "Wait for worker progress",
      description:
        "Block until the board has new events or the timeout expires. Use after dispatch_task instead of polling. If taskId is provided and its latest run is already finished, returns immediately.",
      inputSchema: {
        boardId: z.string().optional(),
        taskId: z.string().optional(),
        afterEventId: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Cursor from dispatch_task; omit to wait from the current end of the board"),
        timeoutSec: z.number().int().min(1).max(300).default(240),
      },
    },
    async (args) =>
      runTool(async () => {
        const session = await resolveSession(args.boardId);
        const mapEvent = (event: WaitEvent) => ({
          id: event.id,
          type: event.type,
          taskId: event.taskId,
          runId: event.runId,
          payload: truncatePayload(event.payload),
        });
        const readTask = async () => {
          const detail = await call<TaskDetail>(
            `/api/tasks/${encodeURIComponent(args.taskId as string)}`,
          );
          const latest = detail.task.latestRun;
          return {
            detail,
            done: latest != null && TERMINAL_RUN.has(latest.status),
          };
        };
        const startCursor = async (): Promise<number> => {
          if (args.afterEventId != null) return args.afterEventId;
          const cursor = await call<{ latestEventId: number }>(
            `/api/events/cursor?boardId=${encodeURIComponent(session.boardId)}`,
          );
          return cursor.latestEventId;
        };

        // Without a taskId this is a single event wait.
        if (!args.taskId) {
          const after = await startCursor();
          const result = await call<WaitResult>("/api/wait", {
            method: "POST",
            body: JSON.stringify({
              boardId: session.boardId,
              afterEventId: after,
              timeoutSec: args.timeoutSec,
            }),
          });
          return {
            completed: false,
            timedOut: result.timedOut,
            boardId: session.boardId,
            latestEventId: result.latestEventId,
            events: result.events.map(mapEvent),
            next: "Call wait_for_board again with latestEventId to keep watching.",
          };
        }

        const initial = await readTask();
        if (initial.done) {
          return {
            completed: true,
            boardId: session.boardId,
            task: compactTask(initial.detail.task),
            latestEventId: args.afterEventId ?? null,
            events: [],
          };
        }

        let after = await startCursor();

        // Progress events can arrive many times per run. Keep waiting internally so
        // Codex gets one tool call per completion rather than one per log line.
        const startedAt = Date.now();
        const budgetMs = args.timeoutSec * 1_000;
        const collected: WaitEvent[] = [];
        let latestEventId = after;

        while (Date.now() - startedAt < budgetMs) {
          const remainingSec = Math.max(
            1,
            Math.ceil((budgetMs - (Date.now() - startedAt)) / 1_000),
          );
          const result = await call<WaitResult>("/api/wait", {
            method: "POST",
            body: JSON.stringify({
              boardId: session.boardId,
              afterEventId: after,
              timeoutSec: remainingSec,
            }),
          });
          latestEventId = result.latestEventId;
          collected.push(...result.events);

          const state = await readTask();
          if (state.done) {
            return {
              completed: true,
              boardId: session.boardId,
              task: compactTask(state.detail.task),
              latestEventId,
              events: collected.map(mapEvent),
            };
          }

          if (result.timedOut || result.events.length === 0) break;
          if (result.latestEventId <= after) break;
          after = result.latestEventId;
        }

        return {
          completed: false,
          timedOut: true,
          boardId: session.boardId,
          latestEventId,
          events: collected.map(mapEvent),
          next: "Still running. Call wait_for_board again with this latestEventId.",
        };
      }),
  );

  server.registerTool(
    "list_board",
    {
      title: "List the current board",
      description:
        "Return tasks on a board grouped by status, with the latest run state. Use it to monitor delegated work or to recover context.",
      inputSchema: {
        boardId: z.string().optional(),
        includeDone: z.boolean().default(false),
      },
    },
    async (args) =>
      runTool(async () => {
        const session = await resolveSession(args.boardId);
        const snapshot = await call<BoardSnapshot>(
          `/api/boards/${encodeURIComponent(session.boardId)}`,
        );
        const tasks = snapshot.tasks
          .filter((task) => args.includeDone || task.status !== "done")
          .map(compactTask);
        return {
          board: { id: snapshot.board.id, title: snapshot.board.title, cwd: snapshot.board.cwd },
          activeRuns: snapshot.activeRuns,
          columns: BOARD_COLUMNS.map((column) => column.id),
          tasks,
        };
      }),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task details",
      description: "Fetch one task with all attempts, review counts and review comments.",
      inputSchema: { taskId: z.string().min(1) },
    },
    async (args) =>
      runTool(async () => {
        const detail = await call<TaskDetail>(`/api/tasks/${encodeURIComponent(args.taskId)}`);
        return {
          task: compactTask(detail.task),
          attempts: detail.task.runs.map(compactRun),
          reviews: detail.reviews,
          artifactCount: detail.artifacts.length,
        };
      }),
  );

  server.registerTool(
    "get_run",
    {
      title: "Get a run's diff and summary",
      description:
        "Fetch a worker run including its prompt, summary, diff stat and unified diff patch. Review the patch before submitting a review.",
      inputSchema: { runId: z.string().min(1) },
    },
    async (args) =>
      runTool(async () => {
        const detail = await call<{
          run: Run;
          task: TaskWithRuns;
          reviews: unknown[];
          artifacts: unknown[];
        }>(`/api/runs/${encodeURIComponent(args.runId)}`);
        return {
          run: {
            ...detail.run,
            diffPatch: detail.run.diffPatch ? truncateText(detail.run.diffPatch, 60_000) : null,
          },
          task: { id: detail.task.id, title: detail.task.title, status: detail.task.status },
          reviews: detail.reviews,
          artifacts: detail.artifacts,
        };
      }),
  );

  const commentSchema = z.object({
    filePath: z.string().optional(),
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
    side: z.enum(["old", "new"]).optional(),
    severity: z.enum(["blocker", "major", "minor", "nit"]).default("major"),
    body: z.string().min(1).max(10_000),
  });

  server.registerTool(
    "submit_review",
    {
      title: "Submit a review verdict",
      description:
        "Record a review on a finished run. `approved` moves the task to Done; `changes_requested` or `rejected` moves it to Changes Requested without starting a new run.",
      inputSchema: {
        runId: z.string().min(1),
        verdict: z.enum(["approved", "changes_requested", "rejected"]),
        summary: z.string().max(10_000).optional(),
        comments: z.array(commentSchema).max(200).optional(),
        reviewerName: z.string().max(200).optional(),
      },
    },
    async (args) =>
      runTool(async () => {
        const result = await call<unknown>("/api/reviews", {
          method: "POST",
          body: JSON.stringify({
            ...args,
            reviewerType: "codex",
            reviewerName: args.reviewerName ?? "Codex",
          }),
        });
        return result;
      }),
  );

  server.registerTool(
    "request_changes",
    {
      title: "Send a task back for fixes",
      description:
        "Record review comments and automatically queue a new attempt for the same task. The new run's prompt includes every comment. Returns the new runId; then call wait_for_board.",
      inputSchema: {
        runId: z.string().min(1),
        comments: z.array(commentSchema).min(1).max(200),
        summary: z.string().max(10_000).optional(),
        agent: z.enum(AGENT_IDS).optional().describe("Override the worker for the next attempt"),
      },
    },
    async (args) =>
      runTool(async () => {
        const result = await call<{ run: Run; review: { id: string } }>(
          `/api/runs/${encodeURIComponent(args.runId)}/request-changes`,
          {
            method: "POST",
            body: JSON.stringify({
              ...args,
              reviewerType: "codex",
              reviewerName: "Codex",
            }),
          },
        );
        return {
          reviewId: result.review.id,
          newRunId: result.run.id,
          attempt: result.run.attempt,
          next: "Call wait_for_board with this board and the new runId.",
        };
      }),
  );

  server.registerTool(
    "cancel_run",
    {
      title: "Cancel a running worker",
      description: "Abort a queued or running worker and mark the task cancelled.",
      inputSchema: { runId: z.string().min(1) },
    },
    async (args) =>
      runTool(async () => {
        return call(`/api/runs/${encodeURIComponent(args.runId)}/cancel`, { method: "POST" });
      }),
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List Codex session boards",
      description:
        "List Codex threads discovered from ~/.codex with their board ids. Use this when you need to target a board other than the current session.",
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        const result = await call<{
          sessions: Array<{
            boardId: string;
            taskCount: number;
            activeRuns: number;
            updatedAt: number;
            thread: { id: string; title: string | null; cwd: string };
          }>;
          defaultBoard: { id: string; title: string };
        }>("/api/sessions");
        return {
          currentHint: "Omit boardId to use the current Codex session automatically.",
          defaultBoard: result.defaultBoard,
          sessions: result.sessions.map((session) => ({
            boardId: session.boardId,
            title: session.thread.title ?? "(untitled thread)",
            cwd: session.thread.cwd,
            taskCount: session.taskCount,
            activeRuns: session.activeRuns,
            updatedAt: session.updatedAt,
          })),
        };
      }),
  );

  server.registerTool(
    "get_agents",
    {
      title: "Check worker availability",
      description: "List worker agents and whether their CLI is installed.",
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        return call("/api/agents");
      }),
  );

  server.registerTool(
    "current_session",
    {
      title: "Resolve the current board",
      description:
        "Return the board mapped to this Codex session. Useful if you need the board id explicitly.",
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        return resolveSession();
      }),
  );
}

async function call<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  try {
    return await apiJson<T>(pathname, init);
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error && /fetch failed/i.test(error.message))
    ) {
      throw new DaemonNotRunningError();
    }
    throw error;
  }
}

async function runTool(fn: () => Promise<unknown>) {
  try {
    const value = await fn();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `coworker: ${message}` }],
    };
  }
}

function compactTask(task: TaskWithRuns) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    labels: task.labels,
    reviewCount: task.reviewCount,
    unresolvedComments: task.unresolvedCommentCount,
    latestRun: task.latestRun ? compactRun(task.latestRun) : null,
    updatedAt: task.updatedAt,
  };
}

function compactRun(run: Run) {
  return {
    id: run.id,
    attempt: run.attempt,
    agent: run.agent,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    summary: run.summary ? truncateText(run.summary, 2_000) : null,
    diffStat: run.diffStat,
    error: run.error,
  };
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value;
}

function truncatePayload(payload: unknown): unknown {
  const text = JSON.stringify(payload);
  if (!text) return payload;
  if (text.length <= 4_000) return payload;
  return { truncated: true, preview: text.slice(0, 4_000) };
}
