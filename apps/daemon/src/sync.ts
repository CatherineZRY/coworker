import path from "node:path";
import { readAllCodexThreads } from "@coworker/adapters";
import type { Core } from "@coworker/core";

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

  const threadId = mappedThreadId ?? findThreadIdByCwd(core, mappedCwd);
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
  let best: { id: string; score: number; updatedAt: number } | null = null;
  for (const thread of threads) {
    if (!thread.cwd) continue;
    const threadCwd = path.resolve(thread.cwd);
    let score = 0;
    if (threadCwd === normalized) score = 2;
    else if (normalized.startsWith(`${threadCwd}${path.sep}`)) score = 1;
    if (score === 0) continue;
    const updatedAt = thread.updatedAt ?? 0;
    if (!best || score > best.score || (score === best.score && updatedAt > best.updatedAt)) {
      best = { id: thread.id, score, updatedAt };
    }
  }
  return best?.id ?? null;
}
