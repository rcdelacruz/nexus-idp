import { createBackendModule, coreServices } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { CatalogPermissionPolicy } from './permission';

/**
 * Custom permission backend module that uses our CatalogPermissionPolicy
 */
export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'custom-policy',
  register(reg) {
    reg.registerInit({
      deps: {
        policy: policyExtensionPoint,
        database: coreServices.database,
      },
      async init({ policy, database }) {
        policy.setPolicy(new CatalogPermissionPolicy(database));
      },
    });
  },
});
