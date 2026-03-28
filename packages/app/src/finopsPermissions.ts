import { createPermission } from '@backstage/plugin-permission-common';

/**
 * finops.read permission — mirrors the definition in plugins/finops-backend/src/permissions.ts.
 * Defined here separately to avoid importing the backend package (Node.js deps) into the
 * frontend bundle. Keep both in sync by name: 'finops.read'.
 */
export const finopsReadPermission = createPermission({
  name: 'finops.read',
  attributes: { action: 'read' },
});
