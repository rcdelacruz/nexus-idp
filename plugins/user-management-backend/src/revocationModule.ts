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

/** Decode JWT payload without verifying signature — we only need the `sub` and `iat` claims. */
function decodeJwtClaims(token: string): { sub: string; iat?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, iat: typeof payload.iat === 'number' ? payload.iat : undefined };
  } catch {
    return null;
  }
}

/**
 * The token of an `Authorization: Bearer <token>` header, parsed the way the Backstage framework parses it (scheme case-insensitive,
 * one or more spaces). This used to require the exact string "Bearer ", so `bearer <token>` or `BEARER <token>` skipped the
 * revocation check entirely while the framework accepted the same token (audit 2026-11-07).
 */
export function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer[ ]+(\S+)$/i.exec(header ?? '')?.[1];
}

/** The /api middleware: a revoked user's token gets a 401. Exported for tests. */
export function createRevocationMiddleware(
  getStore: () => { isRevoked(sub: string, iatSeconds?: number): boolean } | null | undefined,
  logger: { info(message: string): void },
) {
  return (req: any, res: any, next: () => void) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) { next(); return; }
    const claims = decodeJwtClaims(token);
    if (!claims) { next(); return; }
    const store = getStore();
    if (!store) { next(); return; } // Plugin not ready yet — skip revocation check
    if (store.isRevoked(claims.sub, claims.iat)) {
      logger.info(`Blocked revoked session for: ${claims.sub}`);
      res.status(401).json({ error: 'Your session has been revoked. Please sign in again.' });
      return;
    }
    next();
  };
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
        rootHttpRouter.use('/api', createRevocationMiddleware(getRevocationStore, logger));

        logger.info('Session revocation middleware mounted at /api');
      },
    });
  },
});

export default sessionRevocationModule;
