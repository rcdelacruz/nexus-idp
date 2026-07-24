/**
 * Backend plugin registration for Local Provisioner
 */

import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './service/router';
import { PUBLIC_AGENT_PATHS } from './util/publicPaths';
import { resolveEmailDomainFromConfig, setEmailDomain } from './util/identity';

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
        permissions: coreServices.permissions,
      },
      async init({
        logger,
        database,
        httpRouter,
        config,
        discovery,
        httpAuth,
        permissions,
      }) {
        logger.info('Initializing Local Provisioner backend plugin');

        // Resolve the org email domain from config once, before any request is served. This
        // keeps entity-ref → email translation config-driven (no hardcoded org domain) while
        // preserving existing identities (the deployment's Google allowedDomains).
        const resolvedDomain = resolveEmailDomainFromConfig(config);
        setEmailDomain(resolvedDomain);
        logger.info(
          `Local Provisioner identity domain: ${resolvedDomain ?? 'localhost (unconfigured)'}`,
        );

        // Create router with all routes
        const router = await createRouter({
          logger,
          database,
          discovery,
          config,
          httpAuth,
          permissions,
        });

        // Framework credentials barrier (layer 1). Deny-by-default: every route requires a
        // Backstage credential UNLESS it is one of the public agent endpoints below. The
        // agent endpoints carry a custom HMAC service token that the framework cannot
        // validate, so they must be marked unauthenticated here and verified in the handler.
        //
        // Previously a blanket `{ path: '/', allow: 'unauthenticated' }` was registered, which
        // path-to-regexp resolves to a match-everything predicate — disabling framework auth
        // for the entire plugin. That is removed; PUBLIC_AGENT_PATHS is now the sole public
        // surface, shared with the router middleware (layer 2) so the two cannot drift.
        for (const path of PUBLIC_AGENT_PATHS) {
          httpRouter.addAuthPolicy({ path, allow: 'unauthenticated' });
        }

        // Mount the router
        httpRouter.use(router as any);

        logger.info('Local Provisioner backend plugin initialized successfully');
      },
    });
  },
});
