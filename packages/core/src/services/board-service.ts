import {
  type Board,
  type BoardSnapshot,
  isInternalCodexSource,
  type SessionSummary,
} from "@coworker/shared";
import type { BoardRepository } from "../repositories/board-repository.js";
import type { RunRepository } from "../repositories/run-repository.js";
import type { TaskRepository } from "../repositories/task-repository.js";
import type { ThreadRepository } from "../repositories/thread-repository.js";
import type { TaskService } from "./task-service.js";

export interface BoardServiceDeps {
  boards: BoardRepository;
  threads: ThreadRepository;
  tasks: TaskRepository;
  runs: RunRepository;
  taskService: TaskService;
}

export class BoardService {
  constructor(private readonly deps: BoardServiceDeps) {}

  defaultBoard(): Board {
    return this.deps.boards.ensureDefault();
  }

  boardForThread(threadId: string): Board {
    return this.deps.boards.ensureForThread(threadId);
  }

  snapshot(boardId?: string): BoardSnapshot {
    const board = boardId ? this.deps.boards.get(boardId) : this.defaultBoard();
    if (!board) throw new Error(`Board not found: ${boardId}`);
    return this.deps.taskService.snapshot(board.id);
  }

  sessions(includeArchived = false): SessionSummary[] {
    const threads = this.deps.threads
      .list(includeArchived)
      .filter((thread) => !isInternalCodexSource(thread.source));
    return threads.map((thread) => {
      const board = this.deps.boards.ensureForThread(thread.id);
      const tasks = this.deps.tasks.listByBoard(board.id);
      return {
        thread,
        boardId: board.id,
        activeRuns: this.deps.runs.countActiveByBoard(board.id),
        taskCount: tasks.length,
        updatedAt: thread.updatedAt ?? thread.syncedAt,
      };
    });
  }

  listBoards(): Board[] {
    return this.deps.boards
      .list()
      .filter(
        (board) =>
          !board.codexThreadId ||
          !isInternalCodexSource(this.deps.threads.get(board.codexThreadId)?.source),
      );
  }

  reassociate(boardId: string, targetThreadId: string, pinTitle = false): Board {
    return this.deps.boards.reassociateToPrimary(boardId, targetThreadId, pinTitle);
  }

  rename(boardId: string, title: string | null): Board | null {
    return this.deps.boards.rename(boardId, title);
  }
}
