# Session identity repair implementation plan

Goal: show primary Codex session names, avoid ambiguous/internal session routing,
and rebind existing task boards without touching running workers.

- [x] Add failing regression tests for name/title schema compatibility, internal
  sessions, ambiguous directories, persisted board selection, and live repair.
- [x] Prefer Codex name with title fallback; retain source metadata. Exclude
  internal/exec sessions from automatic selection and visible session boards.
  Refuse ambiguous directory matches and retain explicit primary thread IDs.
- [x] Add a transactional board-reassociation service and a maintenance CLI with
  SQLite backup. Preserve board/task/run/event IDs, processes and worktrees.
  Refuse a different repository or a target board already containing tasks.
- [x] Verify all tests, type checks, lint and build; inspect independently.
- [x] Back up and repair the identified live board without restarting the daemon;
  compare immutable execution metadata and verify API result. Commit and push.

Deployment constraint: do not restart a daemon while any run is active. Existing
processes retain old code until a safe later restart. The optional --pin-title repair flag pins the primary session name if a legacy
daemon must remain running; clear that override after upgrading. Prefer upgrading
at an idle point before repair so automatic name following remains enabled.


## Verification

- 47 tests passed across 12 suites; typecheck, lint and builds passed.
- Independent review found no remaining blockers after adding stale internal-board
  dispatch rejection and planning an idle-only backend upgrade.
- Live repair preserved all 7 task rows, 10 run metadata rows and 131 event identity
  rows. SQLite integrity check passed; database backup was created before repair.
- Previous workers completed naturally before shutdown. The service was upgraded
  only after the database reported no queued, starting or running jobs.
- New API discovery excludes internal sessions and resolves the repaired primary
  session to the original task board ID. The display name follows the Codex name.
