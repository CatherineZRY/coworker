import type { DbContext } from "./db/client.js";
import { ArtifactRepository } from "./repositories/artifact-repository.js";
import { BoardRepository } from "./repositories/board-repository.js";
import { EventStore } from "./repositories/event-store.js";
import { ReviewRepository } from "./repositories/review-repository.js";
import { RunRepository } from "./repositories/run-repository.js";
import { SessionRepository } from "./repositories/session-repository.js";
import { SettingsRepository } from "./repositories/settings-repository.js";
import { TaskRepository } from "./repositories/task-repository.js";
import { ThreadRepository } from "./repositories/thread-repository.js";
import { BoardService } from "./services/board-service.js";
import { ReviewService } from "./services/review-service.js";
import { RunService } from "./services/run-service.js";
import { TaskService } from "./services/task-service.js";

export interface Core {
  ctx: DbContext;
  threads: ThreadRepository;
  boards: BoardRepository;
  tasks: TaskRepository;
  runs: RunRepository;
  reviews: ReviewRepository;
  artifacts: ArtifactRepository;
  events: EventStore;
  sessions: SessionRepository;
  settings: SettingsRepository;
  taskService: TaskService;
  runService: RunService;
  reviewService: ReviewService;
  boardService: BoardService;
}

export function createCore(ctx: DbContext): Core {
  const threads = new ThreadRepository(ctx);
  const boards = new BoardRepository(ctx);
  const tasks = new TaskRepository(ctx);
  const runs = new RunRepository(ctx);
  const reviews = new ReviewRepository(ctx);
  const artifacts = new ArtifactRepository(ctx);
  const events = new EventStore(ctx);
  const sessions = new SessionRepository(ctx);
  const settings = new SettingsRepository(ctx);

  const taskService = new TaskService({ boards, tasks, runs, reviews, events });
  const runService = new RunService({ tasks, runs, artifacts, events });
  const reviewService = new ReviewService({ tasks, runs, reviews, events });
  const boardService = new BoardService({ boards, threads, tasks, runs, taskService });

  return {
    ctx,
    threads,
    boards,
    tasks,
    runs,
    reviews,
    artifacts,
    events,
    sessions,
    settings,
    taskService,
    runService,
    reviewService,
    boardService,
  };
}
