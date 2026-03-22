/**
 * Backend plugin registration for Local Provisioner
 */

import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './service/router';

/**
 * Local Provisioner backend plugin
 *
 * This plugin provides:
 * - Task queue management for local resource provisioning
 * - Agent communication via Server-Sent Events (SSE)
 * - Software Catalog integration for provisioned resources
 * - RESTful API for agent and task management
 */
export const localProvisionerPlugin = createBackendPlugin({
  pluginId: 'local-provisioner',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        config: coreServices.rootConfig,
        discovery: coreServices.discovery,
        httpAuth: coreServices.httpAuth,
      },
      async init({
        logger,
        database,
        httpRouter,
        config,
        discovery,
        httpAuth,
      }) {
        logger.info('Initializing Local Provisioner backend plugin');

        // Create router with all routes
        const router = await createRouter({
          logger,
          database,
          discovery,
          config,
          httpAuth,
        });

        // Configure auth policies for httpRouter service
        // NOTE: These policies work at the httpRouter level for Backstage's auth framework.
        // However, custom Express middleware inside router.ts must also check paths
        // to properly skip authentication for public endpoints.
        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        httpRouter.addAuthPolicy({
          path: '/',
          allow: 'unauthenticated',
        });

        // OAuth start endpoint must be public (initiates auth flow)
        httpRouter.addAuthPolicy({
          path: '/agent/auth-start',
          allow: 'unauthenticated',
        });

        // OAuth callback endpoint must be public (receives redirect after Google OAuth)
        httpRouter.addAuthPolicy({
          path: '/agent/auth-callback',
          allow: 'unauthenticated',
        });

        // Device code flow endpoints - public
        httpRouter.addAuthPolicy({
          path: '/agent/device/code',
          allow: 'unauthenticated',
        });

        httpRouter.addAuthPolicy({
          path: '/agent/device/token',
          allow: 'unauthenticated',
        });

        // Agent registration endpoint - accepts service token from device flow
        httpRouter.addAuthPolicy({
          path: '/agent/register',
          allow: 'unauthenticated',
        });

        // SSE endpoint - accepts service token
        httpRouter.addAuthPolicy({
          path: '/agent/events/:agentId',
          allow: 'unauthenticated',
        });

        // Heartbeat endpoint - accepts service token
        httpRouter.addAuthPolicy({
          path: '/agent/heartbeat',
          allow: 'unauthenticated',
        });

        // Task status update endpoint - accepts service token
        httpRouter.addAuthPolicy({
          path: '/agent/tasks/:taskId/status',
          allow: 'unauthenticated',
        });

        // Device authorize endpoint requires authentication (user must be logged in)
        // No need for explicit policy - default is authenticated

        // Mount the router
        httpRouter.use(router as any);

        logger.info('Local Provisioner backend plugin initialized successfully');
      },
    });
  },
});
