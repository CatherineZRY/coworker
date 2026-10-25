# Architecture

coworker is a local daemon plus a thin MCP surface. Codex owns the conversation;
coworker owns task state, worker processes, worktrees, and the event log.

## Components

| Component               | Responsibility                                                      |
| ----------------------- | ------------------------------------------------------------------- |
| `apps/cli`              | `coworker` command, install/doctor, MCP stdio server, hook receiver |
| `apps/daemon`           | Fastify REST API, SSE stream, auth, scheduler, Codex thread sync    |
| `apps/web`              | React board, task drawer, diff viewer, review forms                 |
| `packages/core`         | Drizzle schema, repositories, domain services, state machine        |
| `packages/adapters`     | Config/paths, git worktrees, Codex state and hooks, worker runners  |
| `packages/codex-plugin` | Codex plugin manifest, skill, and `.mcp.json`                       |

The daemon serves a single SQLite database at `~/.coworker/coworker.db`. There is
no remote service and no separate workspace checkout per project.

## Data model

```
codex_threads 1─1 boards 1─n tasks 1─n runs 1─n reviews 1─n review_comments
                                      │        └─n artifacts
                                      └─n run_events (board/task/run scoped)
agent_sessions  (ppid → codex_thread_id/cwd)
settings        (default board id)
```

- A **board** is the unit of a Codex session. A board either references a Codex
  thread or is the single local board used by the UI.
- A **task** moves through the kanban columns and accumulates runs.
- A **run** is one worker attempt. It records the agent, model, prompt, base
  ref, worktree path, process id, exit code, summary, diff stat, diff patch, and
  error.
- A **review** belongs to a run and contains optional line-anchored comments.
- **run_events** is the source of truth for board changes and the wake-up
  mechanism for long polls. The in-memory `EventEmitter` only shortens waits; a
  missed signal is recovered from the cursor.

## Session and board resolution

`resolveSession` is called with whichever context a caller has:

1. `CODEX_THREAD_ID` / `CODEX_SESSION_ID` passed by the MCP client.
2. A hook row keyed by parent process id (`agent_sessions.ppid`).
3. The working directory: exact match first, then the nearest containing thread
   directory, preferring the most recently updated thread.
4. The default local board.

Threads are synced from `~/.codex/state_*.sqlite` (read-only, tolerant of schema
drift). A board title is the manual override, then the Codex thread title, then
the first line of the thread's first user message, then `Local board`.

Hooks (`SessionStart`, `Stop`, `SessionEnd`) post to `/api/hooks/codex` and fail
silently. They improve mapping but are never required: the MCP server and cwd
fallback keep working without them.

## Dispatch and execution

1. `dispatch_task` resolves the board, creates or reuses a task, and creates a
   run with `attempt = previous attempts + 1`.
2. `TaskService.dispatch` moves the task to **Running** and appends
   `run.queued`.
3. `Scheduler` observes `run.queued`, respects `maxConcurrentRuns`, and starts
   the worker:
   - resolve the repository from the board cwd, then `defaultRepo`
   - enforce `allowedRoots`
   - create a detached `git worktree` at the base ref
   - `run.started`
   - spawn the worker CLI inside the worktree
4. Progress is appended as `run.progress` events. The latest event id is the
   cursor Codex uses.
5. The worker process exiting is authoritative:
   - exit 0 → stage the worktree, capture `git diff --cached`, record the
     patch/summary, move the task to **Review**, append `run.completed`
   - non-zero/timeout → record the error, move the task to **Failed**, append
     `run.failed`
   - cancellation → **Cancelled**
6. Daemon restart marks previously active runs as failed. Queued runs are
   re-enqueued.

Worker CLIs run in non-interactive mode within the worktree. `claude-code` gets
`--permission-mode <permissionMode>`; Codex and Cursor runners use their
respective headless flags. See `packages/adapters/src/runners/`.

## Review and rework

- `submit_review` requires a terminal run.
  - `approved` → task **Done**, with open comments on earlier attempts resolved.
  - `changes_requested` / `rejected` → task **Changes Requested**, no new run.
- `request_changes` requires at least one comment. It records the review, moves
  the task to **Changes Requested**, and queues attempt N+1 immediately. The
  generated prompt includes every comment body, severity, file, and line, plus
  the previous summary. Once a task reaches `maxAttempts`, the API refuses
  further automatic rework; Codex must submit a final review or a new attempt
  must be dispatched manually.
- Run completion moves the task to **Running → Review** asynchronously, so the
  scheduler's status move always wins over UI moves once work starts.
- Moves that the state machine would reject are still applied when they come
  from run completion or review, and are marked `forced: true` in the event
  payload for auditability.

## Waiting without polling

`wait_for_board` with a `taskId`:

1. Returns immediately if the latest run is terminal.
2. Otherwise POSTs `/api/wait` with a board cursor.
3. Wakes on any new event, appends the progress events to its result, re-reads
   the task, and loops until the run is terminal or its budget expires.
4. Returns compact task state, the collected events, and the latest cursor on
   timeout.

`POST /api/wait` resolves `EventStore.waitForEvents`, which uses SQLite as the
durable cursor and an in-process waiter map for immediate wakeups. The web UI
uses the same event stream over SSE and invalidates queries; it excludes
`run.progress` from full board invalidation.

## Security

- Bind host defaults to `127.0.0.1`.
- Auth accepts a bearer token, a cookie set from the tokenized URL, or a
  `?token=` query parameter on initial page load. API responses redact the
  token.
- Files under `~/.coworker` are created mode `0600` where they hold secrets.
- Worktrees live under `~/.coworker/worktrees/<repo>/<runId>` and are not
  applied automatically. Approved diffs must be applied deliberately.
- Workers have the permissions of the user account. Restrict
  `workers.claudeCode.permissionMode` if that is not desired.
