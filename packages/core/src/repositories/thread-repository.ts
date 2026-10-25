import type { CodexThread } from "@coworker/shared";
import { desc, eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { threadFromRow } from "../db/mappers.js";
import { codexThreads } from "../db/schema.js";

export interface ThreadUpsertInput {
  id: string;
  title: string | null;
  firstUserMessage: string | null;
  cwd: string;
  gitBranch: string | null;
  source: string | null;
  updatedAt: number | null;
  archived: boolean;
}

export class ThreadRepository {
  constructor(private readonly ctx: DbContext) {}

  upsert(input: ThreadUpsertInput): CodexThread {
    const syncedAt = Date.now();
    this.ctx.db
      .insert(codexThreads)
      .values({ ...input, syncedAt })
      .onConflictDoUpdate({
        target: codexThreads.id,
        set: {
          title: input.title,
          firstUserMessage: input.firstUserMessage,
          cwd: input.cwd,
          gitBranch: input.gitBranch,
          source: input.source,
          updatedAt: input.updatedAt,
          archived: input.archived,
          syncedAt,
        },
      })
      .run();
    const row = this.ctx.db.select().from(codexThreads).where(eq(codexThreads.id, input.id)).get();
    if (!row) throw new Error(`Thread ${input.id} disappeared after upsert`);
    return threadFromRow(row);
  }

  get(id: string): CodexThread | null {
    const row = this.ctx.db.select().from(codexThreads).where(eq(codexThreads.id, id)).get();
    return row ? threadFromRow(row) : null;
  }

  list(includeArchived = false): CodexThread[] {
    const rows = includeArchived
      ? this.ctx.db.select().from(codexThreads).orderBy(desc(codexThreads.updatedAt)).all()
      : this.ctx.db
          .select()
          .from(codexThreads)
          .where(eq(codexThreads.archived, false))
          .orderBy(desc(codexThreads.updatedAt))
          .all();
    return rows.map(threadFromRow);
  }
}
