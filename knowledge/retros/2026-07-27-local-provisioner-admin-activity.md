# Local Provisioner — Admin Activity View (2026-07-27)

## What shipped
- New `local-provisioner.task.read-all` permission, admin-only (gated in `packages/backend/src/plugins/permission.ts`, must precede the generic `local-provisioner.` prefix ALLOWs — both the unassigned-user and assigned-user blocks match on prefix and would otherwise leak all-user task data to any authenticated user).
- `TaskStore.listAllTasks()` / `TaskQueueService.getAllTasks()` / `GET /tasks/admin/all` — cross-user task listing, optional `userId` scope, no migration needed (`user_id` was already populated per task).
- Frontend: "Activity" tab added to the existing `UserManagementPage.tsx` (chosen over a separate admin page — single admin surface, reuses existing admin-gating UX). Required exporting `ProvisioningTask` from `plugins/local-provisioner/src/index.ts` (wasn't public before) and adding `@internal/plugin-local-provisioner` as a workspace dep of `plugins/user-management`.

## Backlog (not done, deliberately deferred)
- **No automated test for `TaskStore.listAllTasks`.** `TaskStore.test.ts` only unit-tests the pure `foldTasksToResource` function — there is no DB-backed test harness for ANY live Knex query method on `TaskStore` (`getTasksByUser`, `deleteTask`, etc. are equally untested). Building that harness is bigger than this feature; worth doing once, then backfilling coverage for the whole class.
