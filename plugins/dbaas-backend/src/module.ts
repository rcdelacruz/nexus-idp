import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { DbaasEntityProvider } from './provider/DbaasEntityProvider';
import { dbaasStoreReady } from './sharedStore';
import { resolveSharedProvider } from './sharedProvider';

/**
 * Catalog module that registers DbaasEntityProvider.
 *
 * MUST have pluginId:'catalog' — catalogProcessingExtensionPoint only accepts
 * modules whose pluginId matches 'catalog'.
 *
 * Database access goes through dbaasStoreReady — a Promise resolved by dbaasPlugin
 * once DbaasStore is initialized. Do NOT await here (deadlock risk).
 */
export const dbaasBackendCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'dbaas-provider',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, logger, config, scheduler }) {
        const backendSecret = config.getConfigArray('backend.auth.keys')[0].getString('secret');

        // Pass Promise — do NOT await. Awaiting would deadlock startup sequencer.
        const provider = new DbaasEntityProvider(dbaasStoreReady, backendSecret, logger);
        catalog.addEntityProvider(provider);
        resolveSharedProvider(provider);

        // M5: Background refresh so catalog stays current even when users don't
        // manually trigger syncs (external DB additions/deletions auto-appear).
        await scheduler.scheduleTask({
          id: 'dbaas-entity-refresh',
          frequency: { minutes: 30 },
          timeout: { minutes: 5 },
          fn: async () => {
            await provider.refresh();
          },
        });

        logger.info('DbaasEntityProvider registered with catalog (30-min background refresh scheduled)');
      },
    });
  },
});
