# Operations and troubleshooting

## Files and environment

| Path                                    | Contents                                    |
| --------------------------------------- | ------------------------------------------- |
| `~/.coworker/config.json`               | Runtime configuration                       |
| `~/.coworker/coworker.db`               | SQLite boards, tasks, runs, reviews, events |
| `~/.coworker/token`                     | Local API token                             |
| `~/.coworker/daemon.pid`, `daemon.port` | Running daemon address                      |
| `~/.coworker/worktrees/`                | Disposable per-run worktrees                |
| `~/.coworker/logs/daemon.log`           | Detached daemon log                         |
| `~/.coworker/plugin-marketplace/`       | Installed copy of the Codex plugin          |
| `~/.codex/config.toml`                  | MCP server and plugin registration          |
| `~/.codex/hooks.json`                   | Session lifecycle hooks                     |

`COWORKER_HOME` moves the coworker home. `CODEX_HOME` moves the Codex config and
state directory (used by tests and by installations with a custom Codex home).
`COWORKER_DEBUG=1` or `--verbose` enables debug logging.

## Common problems

### `coworker start` says the port is in use

```bash
coworker status
coworker stop
```

If the process is not coworker, choose another port: `coworker start --port 7799`
and pass that port to the board URL. The MCP server finds the daemon through
`daemon.port` in the coworker home, so `coworker install` does not need to be
rerun when you change ports.

### The board is blank, or the API returns 401

Open the board with `coworker open`, which appends the current token. The token
is rotated only if `~/.coworker/token` is deleted; restart the daemon after
removing it. API clients must send `Authorization: Bearer <token>`.

### Codex does not see the coworker tools

1. `coworker install` must be run from a built CLI so it can resolve the MCP
   command. `coworker doctor` prints whether workers and the daemon are
   reachable.
2. Restart Codex after install.
3. Check `~/.codex/config.toml` for `[mcp_servers.coworker]`. The command must
   be an absolute path if `coworker` is not on `PATH` when Codex starts.
4. To avoid touching the real Codex config, test the install with
   `CODEX_HOME=/tmp/codex-test COWORKER_HOME=/tmp/coworker-test coworker install`.
5. If plugin support is unavailable in your Codex build, use
   `coworker install --skip-plugin`; the MCP server and hooks still work.

### Workers are reported as unavailable

Run `coworker doctor`. Each worker CLI must be on `PATH` (or configured with an
absolute `command` in `config.json`) and already authenticated. Common commands:

```bash
claude --version
codex --version
cursor-agent --version
```

### A run fails with “No git repository found”

The Codex session's `cwd` is not inside a git repository. Start Codex inside the
repository, or set `defaultRepo` in `~/.coworker/config.json` to a repository
path. Repositories must have at least one commit:

```bash
git commit --allow-empty -m "initial commit"
```

Repositories outside a non-empty `allowedRoots` list are rejected.

### The board does not switch to the right Codex session

The mapping order is thread id → hook parent process → cwd → local board. Open
the session picker and press **Sync Codex sessions**. If a new Codex thread has
not been written to `~/.codex/state_*.sqlite` yet, its board cannot appear.
Starting the daemon from the same directory as the Codex session is the
fallback. You can inspect the resolved board with the `current_session` MCP tool
or `GET /api/resolve-session`.

### `wait_for_board` returns `timedOut: true`

That is normal for long runs. Call it again with the returned
`latestEventId`. The per-call limit is 300 seconds and the default is 240, kept
below the MCP server's `tool_timeout_sec = 300`. Reducing the worker timeout
does not change this; increase MCP timeouts only in the plugin `.mcp.json` copy
under `~/.coworker/plugin-marketplace` (or your own `.mcp.json`), not in the
repository template.

### A run was interrupted by a daemon restart

Active runs are marked failed on startup with
`coworker daemon restarted while this run was active; start it again.` The
worktree is left in place for inspection. Move the task back to Ready and
dispatch a new attempt.

## Inspecting state

```bash
TOKEN=$(cat ~/.coworker/token)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7788/api/health
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7788/api/sessions
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7788/api/boards/default
```

The web UI is a React SPA served by the daemon from `apps/web/dist`. For UI
development, run the daemon and `pnpm --filter @coworker/web dev`, which proxies
`/api` to `COWORKER_DAEMON_URL` (default `http://127.0.0.1:7788`). Set
`COWORKER_WEB_DIST` only when you want the daemon to serve a different build.

## Cleaning up

```bash
coworker stop
rm -rf ~/.coworker/worktrees/*     # discard worker checkouts
rm ~/.coworker/coworker.db*        # discard all boards and history
```

Removing the database does not delete worktrees or Codex config. To uninstall
the Codex integration, remove `[mcp_servers.coworker]`, `[marketplaces.coworker-local]`,
and `[plugins."coworker@coworker-local"]` from `~/.codex/config.toml`, remove the
coworker hook entries from `~/.codex/hooks.json`, and delete
`~/.coworker/plugin-marketplace`. Restore the `.coworker-backup-*` files if you
want the previous configuration verbatim.

## Tests

```bash
pnpm test        # Vitest: state machine, tasks/reviews, events, sessions, git worktrees
pnpm typecheck
pnpm lint
```

The suites use in-memory SQLite and temporary git repositories. They do not
touch `~/.coworker` or `~/.codex`; `CODEX_HOME` is redirected to a temp
directory.
