import type { Task, TaskStatus } from "@coworker/shared";
import { asc, eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { taskFromRow } from "../db/mappers.js";
import { tasks } from "../db/schema.js";
import { newId } from "../domain/ids.js";

export interface CreateTaskRecord {
  boardId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  createdBy?: Task["createdBy"];
  labels?: string[];
}

export interface UpdateTaskRecord {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  labels?: string[];
}

export class TaskRepository {
  constructor(private readonly ctx: DbContext) {}

  create(input: CreateTaskRecord): Task {
    const now = Date.now();
    const id = newId("tsk");
    this.ctx.db
      .insert(tasks)
      .values({
        id,
        boardId: input.boardId,
        title: input.title,
        description: input.description ?? "",
        status: input.status ?? "ready",
        priority: input.priority ?? 0,
        createdBy: input.createdBy ?? "codex",
        labelsJson: JSON.stringify(input.labels ?? []),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const task = this.get(id);
    if (!task) throw new Error("Task disappeared after creation");
    return task;
  }

  get(id: string): Task | null {
    const row = this.ctx.db.select().from(tasks).where(eq(tasks.id, id)).get();
    return row ? taskFromRow(row) : null;
  }

  listByBoard(boardId: string): Task[] {
    return this.ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.boardId, boardId))
      .orderBy(asc(tasks.createdAt))
      .all()
      .map(taskFromRow);
  }

  update(id: string, patch: UpdateTaskRecord): Task | null {
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.labels !== undefined) set.labelsJson = JSON.stringify(patch.labels);
    this.ctx.db.update(tasks).set(set).where(eq(tasks.id, id)).run();
    return this.get(id);
  }

  setStatus(id: string, status: TaskStatus): Task | null {
    return this.update(id, { status });
  }

  delete(id: string): void {
    this.ctx.db.delete(tasks).where(eq(tasks.id, id)).run();
  }
}
