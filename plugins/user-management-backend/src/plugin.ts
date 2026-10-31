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
        scheduler: coreServices.scheduler,
      },
      async init({ logger, httpRouter, database, httpAuth, userInfo, config, scheduler }) {
        logger.info('Initializing User Management backend plugin');

        const orgDomain = config.getString('organization.domain');
        // The organization's own GitHub account (owns every repo the portal creates) — never a
        // user's linked account: GitHub won't add a repo's owner as its collaborator.
        const githubOwner = config.getOptionalString('organization.githubOwner');

        const knex = await database.getClient();
        const userStore = await UserStore.create(knex);
        const revocationStore = await RevocationStore.create(knex);
        resolveSharedUserStore(userStore);
        setRevocationStore(revocationStore);

        await scheduler.scheduleTask({
          id: 'user-management-revocation-purge',
          frequency: { hours: 1 },
          timeout: { minutes: 1 },
          fn: async () => {
            await revocationStore.purgeExpired();
            logger.debug('Purged expired token revocations');
          },
        });

        const router = await createRouter({ logger, httpAuth, userInfo, userStore, revocationStore, orgDomain, githubOwner });

        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        httpRouter.use(router as any);
      },
    });
  },
});
