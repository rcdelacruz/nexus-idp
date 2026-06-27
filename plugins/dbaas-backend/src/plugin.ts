import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { DbaasStore } from './database/DbaasStore';
import { createRouter } from './routes';
import { resolveSharedDbaasStore, rejectSharedDbaasStore } from './sharedStore';

export const dbaasPlugin = createBackendPlugin({
  pluginId: 'dbaas',
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
        logger.info('Initializing DBaaS backend plugin');

        let store: DbaasStore;
        try {
          const knex = await database.getClient();
          store = await DbaasStore.create(knex);
          resolveSharedDbaasStore(store);
        } catch (err: any) {
          rejectSharedDbaasStore(err);
          throw err;
        }

        const router = createRouter({ logger, httpAuth, userInfo, config, store });

        // /providers is unauthenticated — it only lists supported providers
        httpRouter.addAuthPolicy({
          path: '/providers',
          allow: 'unauthenticated',
        });

        // /scaffold/* is called by the scaffolder action (service-to-service).
        // No addAuthPolicy needed — service tokens are accepted by the framework's
        // default auth handling. The handler validates via httpAuth.credentials(req, { allow: ['service'] }).

        httpRouter.use(router as any);
        logger.info('DBaaS backend plugin initialized');
      },
    });
  },
});
