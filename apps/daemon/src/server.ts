import { existsSync } from "node:fs";
import type { CoworkerConfig, CoworkerPaths } from "@coworker/adapters";
import type { Core, WorkerRunner } from "@coworker/core";
import {
  type BoardSnapshot,
  createTaskSchema,
  dispatchTaskSchema,
  type EventType,
  isInternalCodexSource,
  patchTaskSchema,
  type Run,
  requestChangesSchema,
  submitReviewSchema,
} from "@coworker/shared";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import Fastify from "fastify";
import { ZodError, z } from "zod";
import { installAuth } from "./auth.js";
import type { Logger } from "./logger.js";
import type { Scheduler } from "./scheduler.js";
import { resolveSession, syncCodexThreads } from "./sync.js";

export interface ServerDeps {
  core: Core;
  scheduler: Scheduler;
  runners: Record<string, WorkerRunner>;
  config: CoworkerConfig;
  paths: CoworkerPaths;
  token: string;
  logger: Logger;
  webDist: string | null;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { core, scheduler, config, token, logger, webDist } = deps;
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });

  await app.register(cookie);
  await app.register(cors, {
    origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
    credentials: true,
  });

  installAuth(app, token);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: "invalid_input",
        message: "Request validation failed",
        issues: error.issues,
      });
      return;
    }
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({ error: "request_failed", message: error.message });
      return;
    }
    const fastifyError = error as { statusCode?: number; message?: string };
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      reply.code(fastifyError.statusCode).send({
        error: "request_failed",
        message: fastifyError.message ?? "Request failed",
      });
      return;
    }
    logger.error("unhandled request error", {
      method: request.method,
      url: request.url,
      error: error instanceof Error ? error.message : String(error),
    });
    reply.code(500).send({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });

  app.get("/api/health", async () => ({
    ok: true,
    version: "0.1.0",
    uptimeSec: Math.round(process.uptime()),
    activeRuns: scheduler.activeCount,
  }));

  app.get("/api/config", async () => ({
    host: config.host,
    port: config.port,
    maxConcurrentRuns: config.maxConcurrentRuns,
    defaultTimeoutSec: config.defaultTimeoutSec,
    maxAttempts: config.maxAttempts,
    defaultRepo: config.defaultRepo,
    allowedRoots: config.allowedRoots,
    workers: config.workers,
    paths: { home: deps.paths.home, db: deps.paths.dbPath, logs: deps.paths.logsDir },
  }));

  app.get("/api/agents", async () => {
    const agents = await Promise.all(
      Object.entries(deps.runners).map(async ([id, runner]) => ({
        id,
        available: await runner.isAvailable(),
      })),
    );
    return { agents };
  });

  app.get("/api/sessions", async (request) => {
    const query = request.query as Record<string, unknown>;
    syncCodexThreads(core, query.force === "1");
    const sessions = core.boardService.sessions(false);
    const defaultBoard = core.boardService.defaultBoard();
    return { sessions, defaultBoard, boards: core.boardService.listBoards() };
  });

  app.post("/api/sessions/sync", async () => {
    const result = syncCodexThreads(core, true);
    return { ...result, sessions: core.boardService.sessions(false) };
  });

  app.post("/api/resolve-session", async (request) => {
    const body = z
      .object({
        ppid: z.number().int().optional(),
        threadId: z.string().min(1).optional(),
        cwd: z.string().min(1).optional(),
      })
      .parse(request.body);
    return resolveSession(core, body);
  });

  app.get("/api/boards", async () => ({ boards: core.boardService.listBoards() }));

  app.get("/api/boards/default", async () => core.boardService.defaultBoard());

  app.get("/api/boards/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return redactSnapshot(core.taskService.snapshot(params.id));
  });

  app.patch("/api/boards/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ title: z.string().max(300).nullable() }).parse(request.body);
    const board = core.boardService.rename(params.id, body.title?.trim() || null);
    if (!board) throw new HttpError(404, `Board not found: ${params.id}`);
    return board;
  });

  app.get("/api/boards/:id/tasks", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return { tasks: redactSnapshot(core.taskService.snapshot(params.id)).tasks };
  });

  // Old MCP clients may cache a board ID for 30 seconds across a repair.
  const requireUserBoard = (boardId: string | undefined) => {
    if (!boardId) return;
    const board = core.boards.get(boardId);
    const source = board?.codexThreadId ? core.threads.get(board.codexThreadId)?.source : null;
    if (isInternalCodexSource(source)) {
      throw new HttpError(
        409,
        "This is an internal session board. Refresh sessions and select the primary session board before dispatching.",
      );
    }
  };

  app.post("/api/tasks", async (request, reply) => {
    const input = createTaskSchema.parse(request.body);
    requireUserBoard(input.boardId);
    const task = core.taskService.create({
      boardId: input.boardId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      labels: input.labels,
      createdBy: "human",
    });
    reply.code(201);
    return core.taskService.withRuns(task);
  });

  app.patch("/api/tasks/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const patch = patchTaskSchema.parse(request.body);
    const task = core.taskService.update(params.id, patch);
    return core.taskService.withRuns(task);
  });

  app.delete("/api/tasks/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const task = core.tasks.get(params.id);
    if (!task) throw new HttpError(404, `Task not found: ${params.id}`);
    const active = core.runs
      .listByTask(task.id)
      .some((run) => ["queued", "starting", "running"].includes(run.status));
    if (active) throw new HttpError(409, "Cancel the active run before deleting this task");
    core.tasks.delete(task.id);
    core.events.append({
      boardId: task.boardId,
      taskId: task.id,
      type: "task.updated",
      payload: { taskId: task.id, deleted: true },
    });
    reply.code(204);
    return null;
  });

  app.post("/api/dispatch", async (request, reply) => {
    const input = dispatchTaskSchema.parse(request.body);
    requireUserBoard(input.boardId);
    const result = core.taskService.dispatch(input);
    const task = core.tasks.get(result.taskId);
    reply.code(202);
    return {
      ...result,
      boardId: task?.boardId ?? null,
      latestEventId: task ? core.events.latestId(task.boardId) : 0,
    };
  });

  app.get("/api/tasks/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const task = core.tasks.get(params.id);
    if (!task) throw new HttpError(404, `Task not found: ${params.id}`);
    const withRuns = core.taskService.withRuns(task);
    const reviews = withRuns.runs.flatMap((run) => core.reviews.listByRun(run.id));
    const artifacts = withRuns.runs.flatMap((run) => core.artifacts.listByRun(run.id));
    return {
      task: { ...withRuns, runs: withRuns.runs.map(redactRun) },
      reviews,
      artifacts,
    };
  });

  app.get("/api/runs/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const run = core.runs.get(params.id);
    if (!run) throw new HttpError(404, `Run not found: ${params.id}`);
    const task = core.tasks.get(run.taskId);
    if (!task) throw new HttpError(404, `Task not found: ${run.taskId}`);
    return {
      run,
      task,
      reviews: core.reviews.listByRun(run.id),
      artifacts: core.artifacts.listByRun(run.id),
    };
  });

  app.post("/api/runs/:id/cancel", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const run = core.runs.get(params.id);
    if (!run) throw new HttpError(404, `Run not found: ${params.id}`);
    scheduler.cancel(params.id);
    return core.runs.get(params.id);
  });

  app.post("/api/reviews", async (request, reply) => {
    const input = submitReviewSchema.parse(request.body);
    const result = core.reviewService.submit(input);
    reply.code(201);
    return result;
  });

  app.patch("/api/reviews/comments/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ resolved: z.boolean() }).parse(request.body);
    core.reviews.setCommentResolved(params.id, body.resolved);
    return { ok: true };
  });

  app.post("/api/runs/:id/request-changes", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        comments: requestChangesSchema.shape.comments,
        summary: z.string().max(10_000).optional(),
        agent: requestChangesSchema.shape.agent,
        reviewerType: requestChangesSchema.shape.reviewerType,
        reviewerName: z.string().max(200).optional(),
      })
      .parse(request.body);
    const run = core.runs.get(params.id);
    if (!run) throw new HttpError(404, `Run not found: ${params.id}`);
    const attempts = core.runs.listByTask(run.taskId).length;
    if (attempts >= config.maxAttempts) {
      throw new HttpError(
        409,
        `Task ${run.taskId} already has ${attempts} attempts (maxAttempts: ${config.maxAttempts}). Submit a final review, raise maxAttempts in config.json, or dispatch a new attempt manually.`,
      );
    }
    const result = core.reviewService.requestChanges({ runId: params.id, ...body });
    reply.code(201);
    return result;
  });

  app.get("/api/events", async (request) => {
    const query = z
      .object({
        boardId: z.string().min(1),
        after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);
    return {
      events: core.events.listAfter(query.boardId, query.after, query.limit),
      latestEventId: core.events.latestId(query.boardId),
    };
  });

  app.get("/api/events/cursor", async (request) => {
    const query = z.object({ boardId: z.string().min(1) }).parse(request.query);
    return { boardId: query.boardId, latestEventId: core.events.latestId(query.boardId) };
  });

  app.post("/api/wait", async (request, reply: FastifyReply) => {
    const body = z
      .object({
        boardId: z.string().min(1),
        afterEventId: z.number().int().min(0).default(0),
        timeoutSec: z.number().int().min(1).max(300).default(240),
      })
      .parse(request.body);

    const controller = new AbortController();
    const onClose = () => controller.abort();
    reply.raw.on("close", onClose);
    try {
      const events = await core.events.waitForEvents(
        body.boardId,
        body.afterEventId,
        body.timeoutSec,
        controller.signal,
      );
      return {
        events,
        latestEventId: core.events.latestId(body.boardId),
        timedOut: events.length === 0,
      };
    } finally {
      reply.raw.off("close", onClose);
    }
  });

  app.get("/api/boards/:id/events/stream", async (request, reply: FastifyReply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z
      .object({ after: z.coerce.number().int().min(0).default(0) })
      .parse(request.query);
    const board = core.boards.get(params.id);
    if (!board) throw new HttpError(404, `Board not found: ${params.id}`);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");

    let lastId = query.after;
    const listener = (event: { boardId: string; id: number }) => {
      if (event.boardId !== params.id || event.id <= lastId) return;
      lastId = event.id;
      reply.raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    core.events.emitter.on("event", listener);
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
    heartbeat.unref();

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      core.events.emitter.off("event", listener);
      reply.raw.end();
    });
  });

  /**
   * Codex invokes this through `coworker hook codex` (see `coworker install`).
   * The hook payload is untrusted, so every field is optional and validated.
   */
  app.post("/api/hooks/codex", async (request) => {
    const body = z
      .object({
        ppid: z.number().int().optional(),
        cwd: z.string().optional(),
        hook_event_name: z.string().optional(),
        session_id: z.string().optional(),
        thread_id: z.string().optional(),
        conversation_id: z.string().optional(),
      })
      .passthrough()
      .parse(request.body ?? {});

    const threadId = body.thread_id ?? body.conversation_id ?? body.session_id ?? null;
    const resolved = resolveSession(core, {
      ppid: body.ppid ?? null,
      threadId,
      cwd: body.cwd ?? null,
    });
    if (body.ppid != null) {
      core.sessions.upsert({
        ppid: body.ppid,
        codexThreadId: resolved.threadId,
        sessionId: body.session_id ?? null,
        cwd: body.cwd ?? null,
      });
    }
    if (resolved.threadId) {
      core.events.append({
        boardId: resolved.boardId,
        type: "session.updated" satisfies EventType,
        payload: { threadId: resolved.threadId, event: body.hook_event_name ?? null },
      });
    }
    return { ok: true, boardId: resolved.boardId, threadId: resolved.threadId };
  });

  const webExists = webDist != null && existsSync(webDist);
  if (webExists && webDist) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", wildcard: true });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404).send({ error: "not_found", message: `No route for ${request.url}` });
      return;
    }
    if (webExists) {
      reply.type("text/html").sendFile("index.html");
      return;
    }
    reply.type("text/html").send(FALLBACK_HTML);
  });

  app.get("/__coworker", async () => ({
    name: "coworker",
    version: "0.1.0",
    web: webExists,
    home: deps.paths.home,
  }));

  return app;
}

function redactRun(run: Run): Run {
  return {
    ...run,
    prompt: run.prompt.length > 4_000 ? `${run.prompt.slice(0, 4_000)}\n…[truncated]` : run.prompt,
    reviewContext: null,
    diffPatch: null,
  };
}

function redactSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      runs: task.runs.map(redactRun),
      latestRun: task.latestRun ? redactRun(task.latestRun) : null,
    })),
  };
}

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>coworker</title>
    <style>
      body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0b0f17; color: #e5e7eb; }
      main { max-width: 680px; margin: 12vh auto; padding: 0 24px; }
      code, pre { background: #151b26; border-radius: 8px; }
      code { padding: 2px 6px; }
      pre { padding: 16px; overflow: auto; }
      a { color: #7dd3fc; }
    </style>
  </head>
  <body>
    <main>
      <h1>coworker daemon is running</h1>
      <p>The web UI has not been built yet. From the repository root run:</p>
      <pre>pnpm build</pre>
      <p>Then restart <code>coworker start</code>. For development, run <code>pnpm dev</code> and open <a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a>.</p>
      <p>The API is available at <code>/api/health</code>.</p>
    </main>
  </body>
</html>`;
