/**
 * Permission definitions for the Local Provisioner plugin
 */

import { createPermission } from '@backstage/plugin-permission-common';

/**
 * Permission to create provisioning tasks
 */
export const taskCreatePermission = createPermission({
  name: 'local-provisioner.task.create',
  attributes: { action: 'create' },
});

/**
 * Permission to read provisioning tasks
 */
export const taskReadPermission = createPermission({
  name: 'local-provisioner.task.read',
  attributes: { action: 'read' },
});

/**
 * Permission to read provisioning tasks across ALL users (admin activity view).
 * Distinct from `taskReadPermission`, which only ever governs a user's own tasks —
 * the route handler for this permission has no per-user scoping at all, so it must
 * be gated separately. See `packages/backend/src/plugins/permission.ts` for the
 * admin-only enforcement.
 */
export const taskReadAllPermission = createPermission({
  name: 'local-provisioner.task.read-all',
  attributes: { action: 'read' },
});

/**
 * Permission to read the instructor Trainees view (GET /tasks/admin/trainees): every trainee's
 * training environments plus their GitHub repo activity. Admins + the `instructors` group only —
 * see `packages/backend/src/plugins/permission.ts`.
 */
export const traineesReadPermission = createPermission({
  name: 'local-provisioner.trainees.read',
  attributes: { action: 'read' },
});

/**
 * Remove a trainee from the Trainees view, optionally deleting their lab repo
 * (POST /tasks/admin/trainees/remove). Admins + the `instructors` group only — see
 * `packages/backend/src/plugins/permission.ts`.
 */
export const traineesManagePermission = createPermission({
  name: 'local-provisioner.trainees.manage',
  attributes: { action: 'delete' },
});

/**
 * Enroll yourself in a brownfield capstone (POST /capstones/enrollments) and record your own trainee
 * repo. Any signed-in user; the handlers scope everything to the caller.
 */
export const capstonesEnrollPermission = createPermission({
  name: 'local-provisioner.capstones.enroll',
  attributes: { action: 'create' },
});

/**
 * Manage capstone enrollments: list, reveal seeded credentials/answer key, Day-4 handout. Admins +
 * the `instructors` group only — see `packages/backend/src/plugins/permission.ts`.
 */
export const capstonesManagePermission = createPermission({
  name: 'local-provisioner.capstones.manage',
  attributes: {},
});

/**
 * Permission to update provisioning tasks
 */
export const taskUpdatePermission = createPermission({
  name: 'local-provisioner.task.update',
  attributes: { action: 'update' },
});

/**
 * Permission to delete provisioning tasks
 */
export const taskDeletePermission = createPermission({
  name: 'local-provisioner.task.delete',
  attributes: { action: 'delete' },
});

/**
 * Permission to register an agent
 */
export const agentRegisterPermission = createPermission({
  name: 'local-provisioner.agent.register',
  attributes: { action: 'create' },
});

/**
 * All local provisioner permissions
 */
export const localProvisionerPermissions = {
  taskCreate: taskCreatePermission,
  taskRead: taskReadPermission,
  taskReadAll: taskReadAllPermission,
  traineesRead: traineesReadPermission,
  traineesManage: traineesManagePermission,
  capstonesEnroll: capstonesEnrollPermission,
  capstonesManage: capstonesManagePermission,
  taskUpdate: taskUpdatePermission,
  taskDelete: taskDeletePermission,
  agentRegister: agentRegisterPermission,
};

/**
 * Array of all permissions for easy iteration
 */
export const localProvisionerPermissionsList = Object.values(
  localProvisionerPermissions,
);
