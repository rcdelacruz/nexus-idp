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
