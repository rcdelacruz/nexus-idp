/**
 * Root HTTP middleware module — enforces session revocation across ALL plugins.
 *
 * Mounts at /api (all Backstage plugin routes) and checks every Bearer token
 * against the RevocationStore before the request reaches any plugin handler.
 *
 * When a user is deleted, their userEntityRef is added to the revocation list.
 * Their very next request gets a 401 — no waiting for token expiry.
 */
import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { getRevocationStore } from './sharedRevocationStore';

/** Decode JWT payload without verifying signature — we only need the `sub` claim. */
function decodeJwtSub(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export const sessionRevocationModule = createBackendModule({
  pluginId: 'root',
  moduleId: 'session-revocation',
  register(env) {
    env.registerInit({
      deps: {
        rootHttpRouter: coreServices.rootHttpRouter,
        logger: coreServices.rootLogger,
        scheduler: coreServices.rootLifecycle,
      },
      async init({ rootHttpRouter, logger }) {
        // Mount revocation middleware on /api — covers every plugin endpoint.
        // Synchronous store check: if the user-management plugin hasn't initialized
        // yet, getRevocationStore() returns null and we let the request through.
        // This prevents any startup race condition from blocking login or API calls.
        rootHttpRouter.use('/api', (req, res, next) => {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith('Bearer ')) { next(); return undefined; }

          const token = authHeader.slice(7);
          const sub = decodeJwtSub(token);
          if (!sub) { next(); return undefined; }

          const store = getRevocationStore();
          if (!store) { next(); return undefined; } // Plugin not ready yet — skip revocation check

          if (store.isRevoked(sub)) {
            logger.info(`Blocked revoked session for: ${sub}`);
            res.status(401).json({
              error: 'Your session has been revoked. Please sign in again.',
            });
            return undefined;
          }

          next();
          return undefined;
        });

        logger.info('Session revocation middleware mounted at /api');
      },
    });
  },
});

export default sessionRevocationModule;
