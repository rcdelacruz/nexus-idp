import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { LocalProvisionerEntityProvider } from './provider/LocalProvisionerEntityProvider';
import { taskStoreReady, setCatalogRefresher } from './sharedStore';

/** Read `localProvisioner.resourceDocsLinks` (resource type -> catalog entity ref) from config. */
function readResourceDocsLinks(config: import('@backstage/config').Config): Record<string, string> {
  const links = config.getOptionalConfig('localProvisioner')?.getOptionalConfig('resourceDocsLinks');
  if (!links) return {};
  const result: Record<string, string> = {};
  for (const key of links.keys()) {
    result[key] = links.getString(key);
  }
  return result;
}

/**
 * Catalog module that registers LocalProvisionerEntityProvider so provisioned resources appear
 * as catalog Resource entities (with connection details). Fixes the "can't go to the project"
 * 404 — the resource is now a real catalog entity.
 *
 * MUST have pluginId:'catalog' — catalogProcessingExtensionPoint only accepts 'catalog' modules.
 * TaskStore is consumed via the taskStoreReady promise (do NOT await here — deadlock risk); it
 * is resolved by the local-provisioner plugin once TaskStore is created.
 */
export const localProvisionerCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'local-provisioner-provider',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
        config: coreServices.rootConfig,
      },
      async init({ catalog, logger, scheduler, config }) {
        const resourceDocsLinks = readResourceDocsLinks(config);
        const provider = new LocalProvisionerEntityProvider(taskStoreReady, logger, resourceDocsLinks);
        catalog.addEntityProvider(provider);

        // Allow the plugin to trigger an immediate refresh on provision/teardown completion.
        setCatalogRefresher(() => provider.refresh());

        // Background refresh keeps the catalog current even without explicit triggers.
        await scheduler.scheduleTask({
          id: 'local-provisioner-entity-refresh',
          frequency: { minutes: 10 },
          timeout: { minutes: 5 },
          fn: async () => {
            await provider.refresh();
          },
        });

        logger.info(
          'LocalProvisionerEntityProvider registered with catalog (10-min background refresh)',
        );
      },
    });
  },
});
