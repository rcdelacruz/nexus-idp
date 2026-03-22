import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { createRouter } from './service/router';

export const engineeringDocsPlugin = createBackendPlugin({
  pluginId: 'engineering-docs',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        cache: coreServices.cache,
      },
      async init({ logger, httpRouter, config, httpAuth, cache }) {
        logger.info('Initializing Engineering Hub backend plugin');

        const router = await createRouter({ logger, config, httpAuth, cache });

        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        httpRouter.use(router as any);

        logger.info('Engineering Hub backend plugin initialized');
      },
    });
  },
});
