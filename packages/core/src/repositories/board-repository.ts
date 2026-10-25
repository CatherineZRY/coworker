import type { Board } from "@coworker/shared";
import { desc, eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { boardFromRow } from "../db/mappers.js";
import { boards, codexThreads, settings as settingsTable } from "../db/schema.js";
import { newId } from "../domain/ids.js";

const DEFAULT_BOARD_SETTING = "default_board_id";

export class BoardRepository {
  constructor(private readonly ctx: DbContext) {}

  get(id: string): Board | null {
    const result = this.ctx.db
      .select({ board: boards, thread: codexThreads })
      .from(boards)
      .leftJoin(codexThreads, eq(boards.codexThreadId, codexThreads.id))
      .where(eq(boards.id, id))
      .get();
    return result ? boardFromRow(result.board, result.thread) : null;
  }

  list(): Board[] {
    const results = this.ctx.db
      .select({ board: boards, thread: codexThreads })
      .from(boards)
      .leftJoin(codexThreads, eq(boards.codexThreadId, codexThreads.id))
      .orderBy(desc(boards.createdAt))
      .all();
    return results.map((result) => boardFromRow(result.board, result.thread));
  }

  getByThreadId(threadId: string): Board | null {
    const result = this.ctx.db
      .select({ board: boards, thread: codexThreads })
      .from(boards)
      .leftJoin(codexThreads, eq(boards.codexThreadId, codexThreads.id))
      .where(eq(boards.codexThreadId, threadId))
      .get();
    return result ? boardFromRow(result.board, result.thread) : null;
  }

  ensureForThread(threadId: string): Board {
    const existing = this.getByThreadId(threadId);
    if (existing) return existing;

    const id = newId("brd");
    this.ctx.db
      .insert(boards)
      .values({ id, codexThreadId: threadId, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
    const board = this.getByThreadId(threadId);
    if (!board) throw new Error(`Could not create board for thread ${threadId}`);
    return board;
  }

  /**
   * Boards created from the web UI or without a Codex session still need a
   * stable home. The setting table keeps this single across restarts.
   */
  ensureDefault(): Board {
    const setting = this.ctx.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, DEFAULT_BOARD_SETTING))
      .get();
    if (setting) {
      const board = this.get(JSON.parse(setting.valueJson) as string);
      if (board) return board;
    }

    const id = newId("brd");
    this.ctx.db.insert(boards).values({ id, createdAt: Date.now() }).run();
    this.ctx.db
      .insert(settingsTable)
      .values({ key: DEFAULT_BOARD_SETTING, valueJson: JSON.stringify(id) })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { valueJson: JSON.stringify(id) },
      })
      .run();
    const board = this.get(id);
    if (!board) throw new Error("Could not create default board");
    return board;
  }

  rename(id: string, titleOverride: string | null): Board | null {
    this.ctx.db.update(boards).set({ titleOverride }).where(eq(boards.id, id)).run();
    return this.get(id);
  }
}
