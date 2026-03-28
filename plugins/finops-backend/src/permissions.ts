import { createPermission } from '@backstage/plugin-permission-common';

/**
 * Permission required to access FinOps dashboards and AWS cost data.
 * Enforced server-side in finops-backend routes and frontend via RequirePermission.
 * Policy: admin-only (see packages/backend/src/plugins/permission.ts).
 */
export const finopsReadPermission = createPermission({
  name: 'finops.read',
  attributes: { action: 'read' },
});

export const finopsPermissions = [finopsReadPermission];
