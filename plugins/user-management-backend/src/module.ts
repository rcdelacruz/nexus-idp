import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import { UserEntityProvider } from './provider/UserEntityProvider';
import { userStoreReady } from './sharedStore';

/**
 * Catalog module that registers UserEntityProvider.
 *
 * MUST have pluginId:'catalog' — extension points can only be consumed by modules
 * whose pluginId matches the extension point's plugin ('catalog.processing').
 *
 * Database access goes through `userStoreReady` — a Promise resolved by
 * userManagementPlugin once its UserStore is initialised. This avoids the
 * cross-plugin database scope restriction while staying in-process.
 */
export const userManagementCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'user-management-provider',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        scheduler: coreServices.scheduler,
        logger: coreServices.logger,
      },
      async init({ catalog, scheduler, logger }) {
        // Pass the Promise directly — do NOT await here. Awaiting would block the
        // Backstage startup sequencer, preventing user-management plugin from ever
        // starting (deadlock). The provider resolves the store on first refresh() call.
        const taskRunner = scheduler.createScheduledTaskRunner({
          frequency: { seconds: 60 },
          timeout: { seconds: 30 },
        });

        const provider = new UserEntityProvider(userStoreReady, taskRunner, logger);
        catalog.addEntityProvider(provider);

        logger.info('UserEntityProvider registered with catalog');
      },
    });
  },
});
