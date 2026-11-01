import path from "node:path";
import { type Board, isInternalCodexSource } from "@coworker/shared";
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

  /** Rebind a live board, preserving every task, run, event and cursor. */
  reassociateToPrimary(id: string, targetThreadId: string, pinTitle = false): Board {
    return this.ctx.sqlite
      .transaction(() => {
        const board = this.get(id);
        const targetThread = this.ctx.db
          .select()
          .from(codexThreads)
          .where(eq(codexThreads.id, targetThreadId))
          .get();
        if (!targetThread || targetThread.archived || isInternalCodexSource(targetThread.source)) {
          throw new Error("Target must be an active primary Codex session");
        }
        if (!board) throw new Error(`Board not found: ${id}`);
        if (board.codexThreadId === targetThreadId) return board;
        const sourceThread = board.codexThreadId
          ? this.ctx.db
              .select()
              .from(codexThreads)
              .where(eq(codexThreads.id, board.codexThreadId))
              .get()
          : null;
        if (!sourceThread || !isInternalCodexSource(sourceThread.source)) {
          throw new Error("Only an internal session board can be repaired");
        }
        if (path.resolve(sourceThread.cwd) !== path.resolve(targetThread.cwd)) {
          throw new Error("Source and target must be in the same repository directory");
        }
        const existing = this.getByThreadId(targetThreadId);
        if (existing) {
          const occupied = this.ctx.sqlite
            .prepare("SELECT 1 FROM tasks WHERE board_id = ? LIMIT 1")
            .get(existing.id);
          if (occupied)
            throw new Error(
              "Target board already contains tasks; refusing to move active execution",
            );
          this.ctx.sqlite
            .prepare("UPDATE boards SET codex_thread_id = NULL WHERE id = ?")
            .run(existing.id);
        }
        this.ctx.sqlite
          .prepare("UPDATE boards SET codex_thread_id = ?, title_override = ? WHERE id = ?")
          .run(
            targetThreadId,
            existing?.titleOverride ?? (pinTitle ? targetThread.title : null),
            id,
          );
        if (existing) {
          this.ctx.sqlite
            .prepare("UPDATE boards SET codex_thread_id = ?, title_override = NULL WHERE id = ?")
            .run(sourceThread.id, existing.id);
        }
        const repaired = this.get(id);
        if (!repaired) throw new Error(`Board disappeared during repair: ${id}`);
        return repaired;
      })
      .immediate();
  }

  rename(id: string, titleOverride: string | null): Board | null {
    this.ctx.db.update(boards).set({ titleOverride }).where(eq(boards.id, id)).run();
    return this.get(id);
  }
}
