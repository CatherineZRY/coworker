import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const codexThreads = sqliteTable("codex_threads", {
  id: text("id").primaryKey(),
  title: text("title"),
  firstUserMessage: text("first_user_message"),
  cwd: text("cwd").notNull(),
  gitBranch: text("git_branch"),
  source: text("source"),
  updatedAt: integer("updated_at"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  syncedAt: integer("synced_at").notNull(),
});

export const boards = sqliteTable(
  "boards",
  {
    id: text("id").primaryKey(),
    codexThreadId: text("codex_thread_id").references(() => codexThreads.id, {
      onDelete: "cascade",
    }),
    titleOverride: text("title_override"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("boards_codex_thread_idx").on(table.codexThreadId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull(),
    priority: integer("priority").notNull().default(0),
    createdBy: text("created_by").notNull(),
    labelsJson: text("labels_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("tasks_board_status_idx").on(table.boardId, table.status)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    parentRunId: text("parent_run_id"),
    attempt: integer("attempt").notNull().default(1),
    agent: text("agent").notNull(),
    model: text("model"),
    timeoutSec: integer("timeout_sec"),
    prompt: text("prompt").notNull(),
    reviewContextJson: text("review_context_json"),
    status: text("status").notNull(),
    worktreePath: text("worktree_path"),
    baseRef: text("base_ref"),
    headSha: text("head_sha"),
    sessionId: text("session_id"),
    pid: integer("pid"),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    exitCode: integer("exit_code"),
    summary: text("summary"),
    diffStat: text("diff_stat"),
    diffPatch: text("diff_patch"),
    usageJson: text("usage_json"),
    errorJson: text("error_json"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("runs_task_idx").on(table.taskId, table.createdAt),
    index("runs_status_idx").on(table.status),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("run_events_board_idx").on(table.boardId, table.id)],
);

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  reviewerType: text("reviewer_type").notNull(),
  reviewerName: text("reviewer_name"),
  verdict: text("verdict").notNull(),
  summary: text("summary"),
  createdAt: integer("created_at").notNull(),
});

export const reviewComments = sqliteTable(
  "review_comments",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    filePath: text("file_path"),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    side: text("side"),
    severity: text("severity").notNull(),
    body: text("body").notNull(),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("review_comments_review_idx").on(table.reviewId)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    mime: text("mime"),
    sizeBytes: integer("size_bytes"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("artifacts_run_idx").on(table.runId)],
);

export const agentSessions = sqliteTable("agent_sessions", {
  ppid: integer("ppid").primaryKey(),
  codexThreadId: text("codex_thread_id"),
  sessionId: text("session_id"),
  cwd: text("cwd"),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

export type CodexThreadRow = typeof codexThreads.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type ReviewCommentRow = typeof reviewComments.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
