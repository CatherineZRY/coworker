import { existsSync } from "node:fs";
import { getPaths, readAllCodexThreads } from "@coworker/adapters";
import { createCore, createDatabase } from "@coworker/core";

/** Maintenance connection only: never instantiate a scheduler or run recovery. */
export async function repairSessionBoard(input: {
  home?: string;
  boardId: string;
  targetThreadId: string;
  pinTitle?: boolean;
}) {
  const paths = getPaths(input.home);
  if (!existsSync(paths.dbPath)) throw new Error(`Database not found: ${paths.dbPath}`);
  const snapshot = readAllCodexThreads().find((thread) => thread.id === input.targetThreadId);
  if (!snapshot) throw new Error(`Codex session not found: ${input.targetThreadId}`);
  const ctx = createDatabase(paths.dbPath);
  try {
    const backupPath = `${paths.dbPath}.session-repair-${Date.now()}.backup`;
    await ctx.sqlite.backup(backupPath);
    const core = createCore(ctx);
    core.threads.upsert(snapshot);
    const board = core.boardService.reassociate(
      input.boardId,
      input.targetThreadId,
      input.pinTitle,
    );
    return { board, backupPath };
  } finally {
    ctx.close();
  }
}
