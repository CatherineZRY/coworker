# coworker

Local-first delegation for Codex. Codex stays the main agent; coworker gives it a
kanban board, a task queue, and isolated workers that can be Claude Code, Codex,
or Cursor.

```
Codex session ──MCP──▶ coworker daemon ──▶ worker CLI (isolated git worktree)
      ▲                      │
      └──── wait_for_board ──┴──▶ SQLite event log ──▶ local web board
```

The daemon runs on `127.0.0.1`, stores everything in SQLite under
`~/.coworker`, and serves a board for every Codex thread. Codex dispatches a
task, blocks on a long-poll MCP tool instead of polling, inspects the diff,
writes review comments, and either approves the work or sends it back for
another attempt.

## What it does

- **Per-session boards.** Codex threads are discovered from `~/.codex`, and each
  thread gets its own board titled after the thread. The board picker switches
  between sessions; a "Local board" exists for tasks created from the UI.
- **Isolated workers.** Every run gets a fresh `git worktree` so a worker cannot
  stomp on your checkout. The diff is captured from the worktree when the
  process exits.
- **Review and rework.** A successful run moves its task to **Review**. Codex
  can approve it (moves to **Done**), reject it, or request changes with inline
  comments. Requesting changes records the review and queues a new attempt whose
  prompt contains every comment.
- **No busy polling.** Progress is persisted as events in SQLite. The MCP
  `wait_for_board` call waits on the event log (with a cursor), consuming
  progress events internally until the run reaches a terminal state.
- **Local web UI.** A React kanban board with drag-and-drop status changes, a
  run activity feed, and a unified diff viewer with line-anchored review
  comments. Live updates use SSE; polling is only a fallback.

## Requirements

- Node.js 22+
- pnpm 12+
- `git`
- At least one worker CLI on `PATH`: `claude`, `codex`, or `cursor-agent`

## Build and run

```bash
pnpm install
pnpm build

# Optional: make the `coworker` command available globally
cd apps/cli && pnpm link --global && cd ../..

# Install the Codex integration (MCP server, hooks, local plugin marketplace)
coworker install

# Start the daemon and open the board
coworker start
```

`coworker install` writes:

- `~/.coworker/config.json` — runtime configuration (created on first use)
- `~/.coworker/token` — per-install bearer token for the local API
- `~/.codex/config.toml` — `[mcp_servers.coworker]` and the
  `coworker@coworker-local` plugin entry
- `~/.codex/hooks.json` — `SessionStart`, `Stop`, and `SessionEnd` hooks that map
  a Codex process to its thread board
- `~/.coworker/plugin-marketplace` — a copy of the bundled plugin

Each modified file is backed up with a `.coworker-backup-<timestamp>` suffix
before it is changed. Restart Codex after installing so it reloads the MCP
server and plugin.

## Codex workflow

1. Ask Codex to delegate a task. With the plugin's skill loaded, it calls
   `dispatch_task`.
2. Codex calls `wait_for_board` with the returned `afterEventId` and
   `taskId`. The call returns when the run finishes (or after the timeout).
3. Codex calls `get_run` and reviews the actual patch, not just the summary.
4. Codex calls `submit_review` with `approved`, or `request_changes` with
   comments. The latter creates attempt N+1 automatically and keeps the review
   on the board.
5. The board shows every attempt, event, review, and open comment.

The daemon resolves the right board automatically from the Codex thread id, the
hook-recorded parent process, or the session working directory. `boardId` is
only needed to target a different session.

### MCP tools

| Tool              | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `dispatch_task`   | Create a task and queue a worker run                |
| `wait_for_board`  | Long-poll until a run changes state                 |
| `get_run`         | Prompt, summary, exit code, diff stat, unified diff |
| `get_task`        | Task with all attempts, reviews, and comments       |
| `list_board`      | Tasks grouped by status on a board                  |
| `list_sessions`   | Discover Codex threads and their board ids          |
| `current_session` | Resolve the board for this Codex session            |
| `get_agents`      | Worker availability                                 |
| `submit_review`   | Record an approve/reject verdict                    |
| `request_changes` | Record comments and queue a new attempt             |
| `cancel_run`      | Abort an active worker                              |

## Configuration

`~/.coworker/config.json` is created with defaults on first start:

```json
{
  "host": "127.0.0.1",
  "port": 7788,
  "maxConcurrentRuns": 4,
  "defaultTimeoutSec": 1800,
  "maxAttempts": 3,
  "allowedRoots": [],
  "defaultRepo": null,
  "workers": {
    "claudeCode": { "enabled": true, "command": "claude", "permissionMode": "bypassPermissions" },
    "codex": { "enabled": true, "command": "codex" },
    "cursor": { "enabled": true, "command": "cursor-agent" }
  }
}
```

- `allowedRoots` — if non-empty, worker repositories must live under one of
  these paths.
- `defaultRepo` — repository used when the Codex session is not inside one.
- `maxAttempts` — maximum attempts before `request_changes` is refused. Codex can
  still approve, reject, or you can dispatch a new attempt from the board.
- `workers.<name>.permissionMode` — passed to Claude Code. The default
  `bypassPermissions` lets the worker edit files without interactive prompts;
  change it if you want a stricter worker.
- `COWORKER_HOME` overrides `~/.coworker`.
- `COWORKER_WEB_DIST` overrides the static board directory.

The worker is expected to have its own CLI login (for example, run `claude`
once and sign in).

## CLI

```text
coworker start [--port 7788] [--host 127.0.0.1] [--detach] [--no-open]
coworker stop
coworker status
coworker open
coworker install [--skip-hooks] [--skip-mcp] [--skip-plugin]
coworker doctor
coworker config
coworker mcp
```

`COWORKER_HOME=/tmp/coworker-test coworker start --port 7800 --no-open` gives
you an isolated instance for experiments.

## Development

```bash
pnpm install
pnpm dev          # web dev server + package watchers
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Layout:

```
apps/
  cli/       coworker command, install/doctor, MCP stdio server
  daemon/    Fastify API, auth, SSE, scheduler, Codex session sync
  web/       React kanban board and diff viewer
packages/
  core/      SQLite schema, repositories, domain services, state machine
  shared/    Domain types, Zod schemas, shared constants
  adapters/  Config, git worktrees, Codex discovery/hooks, worker runners
  codex-plugin/  Codex plugin + skill + .mcp.json
tests/       Vitest suites for the state machine, services, events, sessions, git
docs/        Architecture and operations notes
```

See [docs/architecture.md](docs/architecture.md) for data flow and failure
handling, and [docs/operations.md](docs/operations.md) for troubleshooting.

## Security model

- The daemon binds to `127.0.0.1` by default. Requests need the bearer token,
  the `coworker_session` cookie set by the authenticated URL, or a `?token=`
  query parameter for the initial page load.
- The token is stored at `~/.coworker/token` with mode `0600`.
- Workers run as your user with whatever permissions their CLI grants. Review
  `workers.claudeCode.permissionMode` before delegating unattended work.
- Approved work stays in the run's worktree. coworker does not merge or commit
  to your branch; apply the patch intentionally.
- Diffs are capped at 5 MB. Larger changes are marked truncated.

## Limitations

- Codex thread discovery reads `~/.codex/state_*.sqlite`; if Codex changes that
  schema, boards fall back to the session working directory or the local board.
- Plugin support varies by Codex version. The MCP server and global hooks are
  the reliable path; `--skip-plugin` installs without the marketplace.
- A run belongs to one worktree. Concurrent tasks from the same repository are
  isolated from each other, but applying both patches can conflict.
