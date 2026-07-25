# Retro: Local Provisioner bug/UX batch (2026-07-25)

## Backlog (found, not fixed — outside this task's scope)

- **Stale selection after a single-row delete/lifecycle action.** `selectedTaskIds` is
  only cleared on agent-filter change and after a bulk-delete completes — if a task is
  deleted individually via its row menu while it also happens to be checked, it stays in
  `selectedTaskIds` until the next bulk-delete attempt (which then just counts it as
  "skipped" via the 404 path, since `TaskQueueService.deleteTask` throws "not found").
  Degrades gracefully, no data-loss risk, just a slightly confusing stale-count display in
  the interim. Low priority.
