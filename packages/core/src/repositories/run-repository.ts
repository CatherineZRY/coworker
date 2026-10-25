import type { AgentId, Run, RunStatus } from "@coworker/shared";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { runFromRow } from "../db/mappers.js";
import { runs } from "../db/schema.js";
import { newId } from "../domain/ids.js";

export interface CreateRunRecord {
  taskId: string;
  parentRunId?: string | null;
  attempt: number;
  agent: AgentId;
  model?: string | null;
  timeoutSec?: number | null;
  prompt: string;
  reviewContext?: string | null;
  status?: RunStatus;
}

export interface UpdateRunRecord {
  status?: RunStatus;
  worktreePath?: string | null;
  baseRef?: string | null;
  headSha?: string | null;
  sessionId?: string | null;
  pid?: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  exitCode?: number | null;
  summary?: string | null;
  diffStat?: string | null;
  diffPatch?: string | null;
  usage?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
}

export class RunRepository {
  constructor(private readonly ctx: DbContext) {}

  create(input: CreateRunRecord): Run {
    const id = newId("run");
    this.ctx.db
      .insert(runs)
      .values({
        id,
        taskId: input.taskId,
        parentRunId: input.parentRunId ?? null,
        attempt: input.attempt,
        agent: input.agent,
        model: input.model ?? null,
        timeoutSec: input.timeoutSec ?? null,
        prompt: input.prompt,
        reviewContextJson: input.reviewContext ?? null,
        status: input.status ?? "queued",
        createdAt: Date.now(),
      })
      .run();
    const run = this.get(id);
    if (!run) throw new Error("Run disappeared after creation");
    return run;
  }

  get(id: string): Run | null {
    const row = this.ctx.db.select().from(runs).where(eq(runs.id, id)).get();
    return row ? runFromRow(row) : null;
  }

  listByTask(taskId: string): Run[] {
    return this.ctx.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(asc(runs.createdAt))
      .all()
      .map(runFromRow);
  }

  latestForTask(taskId: string): Run | null {
    const row = this.ctx.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(desc(runs.createdAt))
      .get();
    return row ? runFromRow(row) : null;
  }

  update(id: string, patch: UpdateRunRecord): Run | null {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (key === "usage") set.usageJson = value === null ? null : JSON.stringify(value);
      else if (key === "error") set.errorJson = value === null ? null : JSON.stringify(value);
      else set[key] = value;
    }
    if (Object.keys(set).length > 0) {
      this.ctx.db.update(runs).set(set).where(eq(runs.id, id)).run();
    }
    return this.get(id);
  }

  listActive(): Run[] {
    return this.ctx.db
      .select()
      .from(runs)
      .where(inArray(runs.status, ["queued", "starting", "running"]))
      .all()
      .map(runFromRow);
  }

  countActiveByBoard(boardId: string): number {
    const row = this.ctx.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM runs r
         JOIN tasks t ON t.id = r.task_id
         WHERE t.board_id = ? AND r.status IN ('queued','starting','running')`,
      )
      .get(boardId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  reviewCounts(taskId: string): { reviewCount: number; unresolvedCommentCount: number } {
    const row = this.ctx.sqlite
      .prepare(
        `SELECT
           COUNT(DISTINCT rv.id) AS review_count,
           COALESCE(SUM(CASE WHEN rc.resolved = 0 THEN 1 ELSE 0 END), 0) AS unresolved
         FROM runs r
         LEFT JOIN reviews rv ON rv.run_id = r.id
         LEFT JOIN review_comments rc ON rc.review_id = rv.id
         WHERE r.task_id = ?`,
      )
      .get(taskId) as { review_count: number; unresolved: number } | undefined;
    return {
      reviewCount: row?.review_count ?? 0,
      unresolvedCommentCount: row?.unresolved ?? 0,
    };
  }

  /** Raw update helper used when a migration adds columns. */
  setRaw(id: string, column: string, value: unknown): void {
    this.ctx.sqlite.prepare(`UPDATE runs SET ${column} = ? WHERE id = ?`).run(value as never, id);
  }
}
