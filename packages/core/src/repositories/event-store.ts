import { EventEmitter } from "node:events";
import type { EventType, RunEvent } from "@coworker/shared";
import { and, asc, eq, gt } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { eventFromRow } from "../db/mappers.js";
import { runEvents } from "../db/schema.js";

export interface AppendEventInput {
  boardId: string;
  taskId?: string | null;
  runId?: string | null;
  type: EventType;
  payload?: Record<string, unknown>;
}

/**
 * `run_events` is the single source of truth for board changes. The in-memory
 * notifier only shortens waits; a missed notification is recovered by the next
 * cursor read, so a crash or restart can never strand a waiting MCP call.
 */
export class EventStore {
  readonly emitter = new EventEmitter();
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly ctx: DbContext) {
    this.emitter.setMaxListeners(0);
  }

  append(input: AppendEventInput): RunEvent {
    const createdAt = Date.now();
    const result = this.ctx.sqlite
      .prepare(
        `INSERT INTO run_events (board_id, task_id, run_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.boardId,
        input.taskId ?? null,
        input.runId ?? null,
        input.type,
        JSON.stringify(input.payload ?? {}),
        createdAt,
      );

    const event: RunEvent = {
      id: Number(result.lastInsertRowid),
      boardId: input.boardId,
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      type: input.type,
      payload: input.payload ?? {},
      createdAt,
    };
    this.emitter.emit("event", event);
    this.notify(input.boardId);
    return event;
  }

  latestId(boardId: string): number {
    const row = this.ctx.sqlite
      .prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM run_events WHERE board_id = ?`)
      .get(boardId) as { id: number } | undefined;
    return row?.id ?? 0;
  }

  listAfter(boardId: string, afterEventId: number, limit = 500): RunEvent[] {
    return this.ctx.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.boardId, boardId), gt(runEvents.id, afterEventId)))
      .orderBy(asc(runEvents.id))
      .limit(limit)
      .all()
      .map(eventFromRow);
  }

  async waitForEvents(
    boardId: string,
    afterEventId: number,
    timeoutSec: number,
    signal?: AbortSignal,
  ): Promise<RunEvent[]> {
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
      if (signal?.aborted) return [];
      const events = this.listAfter(boardId, afterEventId);
      if (events.length > 0) return events;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return [];
      await this.waitForChange(boardId, remaining, signal);
    }
  }

  private notify(boardId: string): void {
    const listeners = this.waiters.get(boardId);
    if (!listeners) return;
    for (const listener of [...listeners]) listener();
  }

  private waitForChange(boardId: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let listeners = this.waiters.get(boardId);
      if (!listeners) {
        listeners = new Set();
        this.waiters.set(boardId, listeners);
      }

      const cleanup = () => {
        clearTimeout(timer);
        listenerSet.delete(done);
        signal?.removeEventListener("abort", onAbort);
        if (listenerSet.size === 0) this.waiters.delete(boardId);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = () => done();
      const listenerSet = listeners;
      const timer = setTimeout(done, timeoutMs);

      if (signal?.aborted) {
        done();
        return;
      }
      listeners.add(done);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
