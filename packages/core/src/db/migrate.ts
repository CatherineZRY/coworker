export const INITIAL_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS codex_threads (
  id                 TEXT PRIMARY KEY,
  title              TEXT,
  first_user_message TEXT,
  cwd                TEXT NOT NULL,
  git_branch         TEXT,
  source             TEXT,
  updated_at         INTEGER,
  archived           INTEGER NOT NULL DEFAULT 0,
  synced_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id               TEXT PRIMARY KEY,
  codex_thread_id  TEXT UNIQUE REFERENCES codex_threads(id) ON DELETE CASCADE,
  title_override   TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL,
  labels_json  TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_board_status_idx ON tasks(board_id, status);

CREATE TABLE IF NOT EXISTS runs (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_run_id       TEXT REFERENCES runs(id),
  attempt             INTEGER NOT NULL DEFAULT 1,
  agent               TEXT NOT NULL,
  model               TEXT,
  timeout_sec         INTEGER,
  prompt              TEXT NOT NULL,
  review_context_json TEXT,
  status              TEXT NOT NULL,
  worktree_path       TEXT,
  base_ref            TEXT,
  head_sha            TEXT,
  session_id          TEXT,
  pid                 INTEGER,
  started_at          INTEGER,
  ended_at            INTEGER,
  exit_code           INTEGER,
  summary             TEXT,
  diff_stat           TEXT,
  diff_patch          TEXT,
  usage_json          TEXT,
  error_json          TEXT,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_task_idx ON runs(task_id, created_at);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);

CREATE TABLE IF NOT EXISTS run_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  run_id       TEXT REFERENCES runs(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_board_idx ON run_events(board_id, id);

CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  reviewer_type  TEXT NOT NULL,
  reviewer_name  TEXT,
  verdict        TEXT NOT NULL,
  summary        TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS review_comments (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  file_path   TEXT,
  line_start  INTEGER,
  line_end    INTEGER,
  side        TEXT,
  severity    TEXT NOT NULL,
  body        TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS review_comments_review_idx ON review_comments(review_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  mime        TEXT,
  size_bytes  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_run_idx ON artifacts(run_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
  ppid            INTEGER PRIMARY KEY,
  codex_thread_id TEXT,
  session_id      TEXT,
  cwd             TEXT,
  last_seen_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

export function migrate(sqlite: { exec: (sql: string) => unknown }): void {
  sqlite.exec(INITIAL_SCHEMA_SQL);
}
