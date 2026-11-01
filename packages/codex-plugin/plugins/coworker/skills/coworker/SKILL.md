---

name: coworker
description: Use when the user asks to use the coworker kanban board, delegate coding work to Claude Code, Codex, or Cursor through coworker, inspect delegated tasks, review a worker diff, or request rework. Not for unrelated project work or general multi-agent requests without coworker context.
---

# coworker: dispatch, track, and review

Keep Codex as the main agent. Workers execute scoped tasks in isolated Git
worktrees; the daemon stores tasks, runs, events, diffs, and reviews. Use the
available coworker MCP tools (their namespace varies by client). The CLI manages
installation and the daemon; it has no task-dispatch subcommand.

## Connect and identify the work

- Call `current_session` to confirm the board and repository context, and
  `get_agents` to check installed workers. Availability does not prove CLI login.
- Omit `boardId` for the current session. When the user requests another board,
  use `list_sessions`, confirm its title/cwd, and pass its id consistently to
  dispatch, list, and wait calls. Retain the returned `boardId`, `taskId`,
  `runId`, and event cursor for later recovery.
- If MCP tools are absent, they cannot be supplied by this skill alone. Setup is
  `coworker install`, restart Codex, and load/enable the coworker plugin/skill.
  If the daemon is stopped, start it with `coworker start --detach` within the
  user's authorized task; otherwise explain the command needed. Do not start a
  second instance when an existing instance is merely unreachable.
- If the CLI is missing, use the built entry from a known coworker checkout:
  `node /absolute/path/to/coworker/apps/cli/dist/index.js --version`, then the
  same entry with `install` or `start --detach`. For persistent CLI setup, read
  that checkout's `README.md` or `README.zh-CN.md`; pnpm 12.15.0 does not support
  `pnpm link --global`. Resolve the actual checkout path rather than guessing.
- Plugin unavailable: `coworker install --skip-plugin` registers MCP/hooks;
  install this skill separately in a supported local skills directory. Do not
  install duplicate enabled copies of the skill.

## Prepare a bounded task

A worker has no conversation history. Include the full desired result,
acceptance criteria, relevant files, constraints, and exact verification
commands. Keep task intent in `description` so automatic rework retains it.
Explicitly tell the worker to stay in its provided worktree and leave changes
uncommitted for diff capture. Do not delegate further unless requested.

The target repository needs a commit. Worktrees start from committed `HEAD`;
local uncommitted edits are not copied. If the task depends on those edits,
resolve the baseline with the user or choose independent work before dispatch.
The scheduler selects the repository from the board cwd, then shared
`defaultRepo`; a `repo` field in the dispatch prompt is not proof that the
scheduler selected it. Verify the returned `run.worktreePath` and repository
before testing or integrating. Do not change shared `defaultRepo` silently to
redirect another session's work.

## Dispatch and wait

Example `dispatch_task` arguments:

```json
{
  "title": "Add tests for add(a, b)",
  "description": "Add tests for positive numbers, negatives, and zero in the existing test suite. Preserve the public API. Run the repository's test command and report the result. Work only in the supplied worktree. Leave changes uncommitted; do not delegate further.",
  "agent": "claude-code",
  "timeoutSec": 600
}
```

Honor a requested worker; otherwise choose an available one (the tool defaults
to `claude-code`). Use `codex` or `cursor` for their respective CLIs. The `fake`
runner is a test fixture, not evidence of a real worker's correctness.

After dispatch, call `wait_for_board` using the retained task and cursor:

```json
{ "taskId": "tsk_…", "afterEventId": 7, "timeoutSec": 240 }
```

- On `completed: false` / `timedOut: true`, repeat the wait with returned
  `latestEventId` as `afterEventId`. The wait timing out is not a run failure.
- On `completed: true`, inspect the run's terminal status; completion can mean
  failure or cancellation as well as success. Fetch it with `get_run`.
- `wait_for_board` accepts `taskId`, not `runId`. Keep per-task cursors when
  supervising multiple authorized tasks. Do not poll `list_board` / `get_task`
  in a loop. Per-call wait time is at most 300 seconds.
- After an interruption, use `current_session`, `list_board`, and `get_task`
  once to recover IDs, latest attempts, and reviews before creating more work.

## Verify and record a review

Call `get_run` for the completed run. Check status, exit code, error, summary,
`diffStat`, and the actual `diffPatch`. Independently verify acceptance criteria
in **that run's worktree**, not the user's unchanged checkout. Install required
project dependencies there only within the authorized scope.

A positive summary alone is insufficient. If the diff is empty, check whether
the task was an investigation or the result already exists; for an expected
code change, inspect the worktree and Git history before approval. Workers that
commit can leave an empty captured diff. For truncated patches (storage cap 5 MB,
MCP output cap 60,000 characters), inspect the complete local change. Report
verification that could not run instead of implying it passed.

Approve only a result that meets the requested criteria:

```json
{
  "runId": "run_…",
  "verdict": "approved",
  "summary": "Reviewed the patch and independently ran <command>: <result>. Acceptance criteria met."
}
```

`submit_review` with `approved` moves the task to Done. With `changes_requested`
or `rejected`, it records a verdict without starting a new run.

For automatic rework, call `request_changes` with at least one actionable
comment:

```json
{
  "runId": "run_…",
  "summary": "The zero case is missing.",
  "comments": [
    {
      "filePath": "src/add.test.ts",
      "lineStart": 12,
      "side": "new",
      "severity": "major",
      "body": "Add zero-operand tests, retain the positive and negative cases, and rerun the full test file."
    }
  ]
}
```

The response contains `newRunId`, `attempt`, and `reviewId`. Keep the original
`taskId`, wait again with that task and the last known cursor (or omit the
cursor to wait from the current board end), then `get_run` with **newRunId**.
Do not dispatch another run after `request_changes`: it already queues one.
Each attempt gets a fresh worktree; previous uncommitted changes are not carried
forward. The new prompt has the task description, prior summary, and the new
review's comments. Ensure feedback preserves the complete desired outcome and
verify the entire result again. Inline locations refer to the previous diff;
the new worktree may not yet contain that file.

Respect configured `maxAttempts` (default 3). If the API refuses more attempts,
report the blocker and options; do not bypass the limit by duplicating tasks.
Retry failures only after a meaningful change to scope, prompt, environment, or
worker. Cancel the matching run when the user requests cancellation; do not
infer cancellation from a long wait alone.

## Finish with the right meaning of Done

Approval does not merge, commit, or push. Report the board/task, attempt,
verification result, and remaining integration step. Changes remain at
`run.worktreePath`. If applying them is already authorized, inspect the target
branch and dirty files, apply the reviewed changes without overwriting user
work, and verify again. Otherwise explain where they are and what remains.
Do not request repeated permission for integration already authorized by the
user, and do not infer publishing authorization from task delegation alone.

## Tool reference

| Tool                               | Use                                                    |
| ---------------------------------- | ------------------------------------------------------ |
| `current_session`, `list_sessions` | Resolve current board or find a requested session      |
| `get_agents`                       | Check worker CLI availability                          |
| `dispatch_task`                    | Create/reuse a task and queue a run                    |
| `wait_for_board`                   | Wait by task and event cursor                          |
| `list_board`, `get_task`           | Inspect board or recover attempts/reviews              |
| `get_run`                          | Inspect patch, summary, worktree, error, and artifacts |
| `submit_review`                    | Record approval or feedback without automatic retry    |
| `request_changes`                  | Record comments and queue the next attempt             |
| `cancel_run`                       | Cancel the selected queued or active run               |

For authentication/CLI failures, identify the affected worker and report setup
needed rather than repeatedly redispatching. Daemon restarts mark active runs
failed; inspect the preserved worktree before retrying. Keep local tokens out of
messages and dispatch prompts. Workers share the host user's filesystem access;
a Git worktree is not a security sandbox.
