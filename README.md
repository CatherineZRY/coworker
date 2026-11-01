# coworker

[English](README.md) | [简体中文](README.zh-CN.md)

A local task board and worker queue for Codex. Keep Codex as the main agent,
delegate scoped work to Claude Code, Codex, or Cursor, and review the result
before bringing it into your branch.

```text
You → Codex → coworker MCP → local daemon → worker in a Git worktree
                ↑                ↓
            review / rework   SQLite events → live web board
```

## Requirements

- macOS or Linux with Node.js 22+, pnpm 12+, and Git.
- A Codex client that supports MCP. Plugin support depends on the client version.
- At least one installed, authenticated worker CLI on `PATH`: `claude`, `codex`,
  or `cursor-agent`. Each worker uses its own CLI login and usage allowance.
- The repository you delegate work in must have at least one Git commit.
  Workers start from committed `HEAD`; local uncommitted changes are not copied.

## First-time setup

### 1. Download and build

```bash
git clone git@github.com:CatherineZRY/coworker.git
cd coworker
pnpm install
pnpm build
```

If you already have this checkout, use it instead of cloning again. A Vite
warning about chunks larger than 500 kB is informational when the build finishes
successfully.

### 2. Make the `coworker` command available

Run from the **coworker repository root**. If `coworker --version` already works,
skip this step.

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$(pwd)/apps/cli/dist/index.js" "$HOME/.local/bin/coworker"
export PATH="$HOME/.local/bin:$PATH"
coworker --version
```

The expected version is `0.1.0`. The link does not overwrite an existing file.
If it reports `File exists`, inspect `ls -l "$HOME/.local/bin/coworker"` before
changing the existing command.

To keep this PATH in new **zsh** terminals (the macOS default):

```bash
printf '%s\n' 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
source "$HOME/.zshrc"
rehash
```

For bash, put that `export` line in the startup file your terminal loads
(typically `~/.bashrc`, or `~/.bash_profile` for a login shell).

This is a source-checkout installation: keep the checkout in place. After moving
it, update the link and run `coworker install` again. Rebuilding in the same
location preserves the link. **Do not use `pnpm link --global`**: it is not
supported by the pnpm 12.15.0 CLI used by this project.

### 3. Install the Codex integration

```bash
coworker install
coworker start --detach
coworker status
```

`start --detach` starts a background daemon and opens an authenticated board URL
(default `http://127.0.0.1:7788`). Closing the terminal does not stop the daemon.
Use `coworker start` without `--detach` for foreground logs; Ctrl+C stops it.

The installer writes or updates:

| Location                         | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `~/.coworker/config.json`        | Runtime settings                             |
| `~/.coworker/token`              | Local API authentication token               |
| `~/.codex/config.toml`           | MCP server and local plugin registration     |
| `~/.codex/hooks.json`            | Session lifecycle hooks for board mapping    |
| `~/.coworker/plugin-marketplace` | Bundled plugin, including the coworker skill |

Existing Codex config/hooks are backed up with a `.coworker-backup-<timestamp>`
suffix when modified. **Restart Codex after installation** and check that the
coworker plugin is enabled and its MCP tools are available.

Without the global command, the same CLI is available from the checkout:

```bash
node apps/cli/dist/index.js install
node apps/cli/dist/index.js start --detach
```

## Everyday use

Start the daemon, then open a Codex session in **the repository you want the
worker to change**. The coworker checkout hosts the tool; it does not have to be
the target project.

```bash
coworker start --detach
coworker open
```

Ask Codex explicitly to use coworker, for example:

> Use the coworker skill to delegate adding tests for `src/add.ts` to Claude
> Code. Cover positive numbers, negative numbers, and zero. Wait for completion,
> inspect the actual diff, run the tests in the worker worktree, and record a
> review. Leave integration into my branch for later.

For supported Codex skill selectors, you can explicitly mention `$coworker`.
You can also ask: “Use coworker to show this session's tasks,” “Check the latest
attempt,” or “Send it back with these review comments.”

Codex follows this workflow:

1. Resolve the current session board and check worker availability.
2. Dispatch a task with its goal, constraints, and verification instructions.
3. Wait on `wait_for_board`, resuming with its cursor if the wait times out.
4. Fetch `get_run`, inspect the actual patch, and verify it in the run worktree.
5. Approve it, or record actionable comments and queue another attempt.

A wait timeout means “still waiting”; it does not mean the worker failed.

## Reading and using the board

Each discovered Codex thread has a board. Use the session picker to switch
boards; **Sync** refreshes discovered Codex sessions. A local board is also
available for tasks created outside a session.

| Column             | Meaning                                                           |
| ------------------ | ----------------------------------------------------------------- |
| Backlog / Ready    | Planned work / ready to dispatch                                  |
| Running            | Queued, starting, or executing a worker                           |
| Review             | Worker exited successfully; review is still needed                |
| Changes Requested  | Review requires changes; an automatic retry may already be queued |
| Done               | Review approved; changes have not been merged automatically       |
| Failed / Cancelled | Execution failed or was cancelled                                 |

Use **New task** to create a Ready task, then dispatch a worker from the task
panel. Creating a card or dragging it to Running does not launch a worker.
The panel is intended for attempts, activity, diff, comments, review, and reruns.
Card-click handling previously failed in a browser smoke test; if the panel does
not open, ask Codex to use `get_task` / `get_run` and the review tools instead.

## Review, rework, and integration

- `submit_review` with `approved` moves a task to Done.
- `submit_review` with `changes_requested` or `rejected` records feedback without
  launching a retry.
- `request_changes` requires at least one comment and automatically queues the
  next attempt, up to `maxAttempts` (default 3).
- Each attempt starts in a fresh worktree from committed code. Review feedback
  and the previous summary are passed along; previous uncommitted edits are not
  automatically carried into the next attempt. Describe the complete desired
  result in the task and verify the full result again after rework.

**Done is approval, not integration.** The result remains in `run.worktreePath`.
Ask Codex to apply the reviewed changes to your current branch, preserve any
existing local changes, and run verification again. Commit and push when you
want to publish the integrated changes. Concurrent patches may conflict.

## The Codex skill

The maintained skill is
[`packages/codex-plugin/plugins/coworker/skills/coworker/SKILL.md`](packages/codex-plugin/plugins/coworker/skills/coworker/SKILL.md).
It covers session selection, dispatch, efficient waiting, review, rework,
recovery after interruption, and the distinction between approval and integration.
`coworker install` distributes it with the plugin. After updating the checkout,
rerun `coworker install` and restart Codex to refresh the installed copy.

If your Codex version cannot load the plugin, register just MCP/hooks:

```bash
coworker install --skip-plugin
```

Then, from the coworker checkout, install the skill separately (choose this
fallback **instead of** a second copy of the enabled plugin skill):

```bash
mkdir -p "$HOME/.agents/skills"
cp -R packages/codex-plugin/plugins/coworker/skills/coworker "$HOME/.agents/skills/"
```

If that destination already exists, inspect it before updating it. Restart Codex
if the skill is not visible. A skill supplies instructions; **MCP must also be
registered** for it to operate the board. Local skill discovery and `$` invocation
are described in the [official Codex skills guide](https://learn.chatgpt.com/docs/build-skills).

## Commands

| Command                             | Use                                                 |
| ----------------------------------- | --------------------------------------------------- |
| `coworker start --detach`           | Start in the background and open the board          |
| `coworker start --detach --no-open` | Start without opening a browser                     |
| `coworker start --port 7799`        | Run in the foreground on another port               |
| `coworker open`                     | Reopen the authenticated board                      |
| `coworker status`                   | Check daemon and API status                         |
| `coworker stop`                     | Stop the daemon                                     |
| `coworker doctor`                   | Check Node, Git, workers, sessions, daemon, and API |
| `coworker config`                   | Show configuration                                  |
| `coworker install`                  | Install or refresh MCP, hooks, and plugin           |
| `coworker mcp`                      | MCP stdio server, normally launched by Codex        |

## Configuration and troubleshooting

Settings are in `~/.coworker/config.json`. Restart the daemon after edits.

| Setting                                           | Default / use                                                |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `host`, `port`                                    | `127.0.0.1`, `7788`                                          |
| `maxConcurrentRuns`                               | `4`                                                          |
| `defaultTimeoutSec`                               | `1800` seconds per run                                       |
| `maxAttempts`                                     | `3` for automatic rework                                     |
| `defaultRepo`                                     | `null`; fallback repository when the board cwd is not a repo |
| `allowedRoots`                                    | `[]`; if set, restrict repository locations                  |
| `workers.claudeCode.command`                      | `claude`                                                     |
| `workers.claudeCode.permissionMode`               | `bypassPermissions` for unattended work                      |
| `workers.codex.command`, `workers.cursor.command` | `codex`, `cursor-agent`                                      |

`COWORKER_HOME` changes the data directory; `CODEX_HOME` changes the Codex config
and session location; `COWORKER_WEB_DIST` overrides the static web build location.
For UI-created local-board tasks, set `defaultRepo` to the target repository if
that board has no repository cwd. It applies as a shared fallback, not per task.

- **Command not found:** check `command -v coworker`, the link, and PATH; in zsh,
  run `rehash`. The build must exist at `apps/cli/dist/index.js`.
- **Board says unauthorized:** use `coworker open` to get the authenticated URL.
- **Wrong session name or Guardian review board:** current versions prefer the primary
  session display name and exclude internal sessions. For older stored board
  associations, see [safe board repair](docs/operations.md#repairing-a-board-attached-to-an-internal-session).
  Do not restart the daemon while workers are active.
- **No coworker tools in Codex:** rerun `coworker install`, restart Codex, and
  check plugin/MCP availability. Use the separate-skill fallback above if needed.
- **Worker unavailable:** install and log into that CLI; `doctor` checks command
  availability, not successful authentication. Unused missing workers may still
  produce failed doctor checks.
- **No Git repo / no commits:** use a committed repository in the session cwd,
  or configure `defaultRepo`. Dirty local edits are not included in worktrees.
- **Daemon won't start:** inspect `~/.coworker/logs/daemon.log`; check for an
  occupied port with `coworker status` and try another port if necessary.

See [operations](docs/operations.md) and [architecture](docs/architecture.md)
for storage paths, recovery, and data flow.

## Security and limitations

The daemon is local by default and protects its API with a bearer token or the
`coworker_token` cookie. Keep tokenized URLs private. State is stored in SQLite
under `~/.coworker`. Workers run as your user with their configured CLI
permissions; worktrees isolate Git changes, not host filesystem permissions.

Codex session discovery reads `~/.codex/state_*.sqlite` and may need adjustment
when Codex changes its schema. Diffs are capped at 5 MB in storage, and MCP
`get_run` truncates patch output after 60,000 characters; inspect the worktree
for complete large changes. Worker code should remain uncommitted until review
so coworker can capture the staged diff.

## Development

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

```text
apps/cli/       CLI, installation, MCP stdio server
apps/daemon/    API, auth, scheduler, session sync, SSE
apps/web/       React kanban, task panel, diff viewer
packages/core/  SQLite schema, repositories, domain services
packages/shared/ Domain types and validation schemas
packages/adapters/ Git worktrees, config, worker runners, Codex hooks
packages/codex-plugin/ Plugin manifests and the coworker skill
tests/          Vitest suites
docs/           Architecture and operations
```
