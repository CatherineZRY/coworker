import path from "node:path";
import { readAllCodexThreads } from "@coworker/adapters";
import type { Core } from "@coworker/core";
import { isInternalCodexSource } from "@coworker/shared";

let lastSyncAt = 0;

export interface SyncResult {
  threads: number;
  boards: number;
  skipped: boolean;
}

export function syncCodexThreads(core: Core, force = false): SyncResult {
  const now = Date.now();
  if (!force && now - lastSyncAt < 2_000) {
    return { threads: 0, boards: 0, skipped: true };
  }
  lastSyncAt = now;

  const snapshots = readAllCodexThreads();
  let boards = 0;
  for (const snapshot of snapshots) {
    core.threads.upsert({
      id: snapshot.id,
      title: snapshot.title,
      firstUserMessage: snapshot.firstUserMessage,
      cwd: snapshot.cwd,
      gitBranch: snapshot.gitBranch,
      source: snapshot.source,
      updatedAt: snapshot.updatedAt,
      archived: snapshot.archived,
    });
    core.boards.ensureForThread(snapshot.id);
    boards += 1;
  }
  return { threads: snapshots.length, boards, skipped: false };
}

export interface ResolveSessionInput {
  ppid?: number | null;
  threadId?: string | null;
  cwd?: string | null;
}

export interface SessionContext {
  boardId: string;
  threadId: string | null;
  title: string;
  cwd: string | null;
}

export function resolveSession(core: Core, input: ResolveSessionInput): SessionContext {
  syncCodexThreads(core);

  const mappedThreadId =
    input.threadId ?? (input.ppid ? core.sessions.get(input.ppid)?.codexThreadId : null) ?? null;
  const mappedCwd = input.cwd ?? (input.ppid ? core.sessions.get(input.ppid)?.cwd : null) ?? null;

  const mappedThread = mappedThreadId ? core.threads.get(mappedThreadId) : null;
  const threadId =
    mappedThread && isInternalCodexSource(mappedThread.source)
      ? findThreadIdByCwd(core, mappedThread.cwd)
      : (mappedThreadId ?? findThreadIdByCwd(core, mappedCwd));
  if (threadId) {
    const thread = core.threads.get(threadId) ?? ensureThread(core, threadId, mappedCwd);
    if (thread) {
      const board = core.boards.ensureForThread(thread.id);
      return {
        boardId: board.id,
        threadId: thread.id,
        title: board.title,
        cwd: thread.cwd,
      };
    }
  }

  const board = core.boards.ensureDefault();
  return { boardId: board.id, threadId: null, title: board.title, cwd: mappedCwd };
}

function ensureThread(core: Core, threadId: string, cwd: string | null) {
  if (!cwd) return null;
  return core.threads.upsert({
    id: threadId,
    title: null,
    firstUserMessage: null,
    cwd,
    gitBranch: null,
    source: "codex",
    updatedAt: Date.now(),
    archived: false,
  });
}

function findThreadIdByCwd(core: Core, cwd: string | null): string | null {
  if (!cwd) return null;
  const normalized = path.resolve(cwd);
  const threads = core.threads.list(false);
  const candidates = threads.filter((thread) => {
    if (!thread.cwd || isInternalCodexSource(thread.source)) return false;
    const threadCwd = path.resolve(thread.cwd);
    return normalized === threadCwd || normalized.startsWith(`${threadCwd}${path.sep}`);
  });
  const specificity = Math.max(0, ...candidates.map((thread) => path.resolve(thread.cwd).length));
  const matches = candidates.filter((thread) => path.resolve(thread.cwd).length === specificity);
  if (matches.length > 1) {
    throw new Error(
      "Multiple Codex sessions match this directory. Select a session board explicitly with list_sessions and boardId.",
    );
  }
  return matches[0]?.id ?? null;
}
