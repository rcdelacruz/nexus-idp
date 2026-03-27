import { createApiRef, DiscoveryApi, IdentityApi } from '@backstage/core-plugin-api';
import { UserManagementApi } from './UserManagementApi';

export const userManagementApiRef = createApiRef<UserManagementApi>({
  id: 'plugin.user-management.service',
});

export { UserManagementApi as UserManagementApiImpl };
