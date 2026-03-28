import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './service/router';
import { MetadataStore } from './service/MetadataStore';
import { finopsReadPermission } from './permissions';

export const finopsPlugin = createBackendPlugin({
  pluginId: 'finops',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        permissions: coreServices.permissions,
        cache: coreServices.cache,
        database: coreServices.database,
      },
      async init({ logger, httpRouter, config, httpAuth, permissions, cache, database }) {
        logger.info('Initializing FinOps backend plugin');

        const metadataStore = new MetadataStore(database);
        await metadataStore.init();

        const router = await createRouter({ logger, config, httpAuth, permissions, cache, metadataStore, finopsReadPermission });

        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        httpRouter.use(router as any);

        logger.info('FinOps backend plugin initialized successfully');
      },
    });
  },
});
