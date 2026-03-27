import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { createRouter } from './service/router';
import { UserStore } from './database/UserStore';
import { RevocationStore } from './database/RevocationStore';
import { resolveSharedUserStore } from './sharedStore';
import { setRevocationStore } from './sharedRevocationStore';

export const userManagementPlugin = createBackendPlugin({
  pluginId: 'user-management',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
      },
      async init({ logger, httpRouter, database, httpAuth, userInfo, config }) {
        logger.info('Initializing User Management backend plugin');

        const orgDomain = config.getString('organization.domain');

        const knex = await database.getClient();
        const userStore = await UserStore.create(knex);
        const revocationStore = await RevocationStore.create(knex);
        resolveSharedUserStore(userStore);
        setRevocationStore(revocationStore);

        const router = await createRouter({ logger, httpAuth, userInfo, userStore, revocationStore, orgDomain });

        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        httpRouter.use(router as any);
      },
    });
  },
});
