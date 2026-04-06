import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './service/router';
import { ProjectStore } from './service/ProjectStore';

export const projectRegistrationPlugin = createBackendPlugin({
  pluginId: 'project-registration',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
      },
      async init({ logger, database, httpRouter, httpAuth, userInfo }) {
        logger.info('Initializing Project Registration backend plugin');

        const projectStore = await ProjectStore.create(database);

        const router = createRouter({ logger, httpAuth, userInfo, projectStore });

        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        httpRouter.use(router as any);

        logger.info('Project Registration backend plugin initialized successfully');
      },
    });
  },
});
