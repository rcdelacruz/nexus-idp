import { UserStore } from './database/UserStore';

/**
 * In-process bridge: the user-management plugin creates the UserStore (scoped to
 * its own database) and resolves this promise. The catalog module (which must have
 * pluginId:'catalog' to use catalogProcessingExtensionPoint) awaits it, side-stepping
 * the cross-plugin database scope restriction.
 *
 * This is safe because Backstage runs as a single Node.js process (replicaCount: 1).
 *
 * ORDERING DEPENDENCY: user-management plugin must initialize before any module
 * that calls userStoreReady.then(...). If user-management fails to init (e.g. DB
 * migration error), userStoreReady will never resolve and callers will silently hang.
 * Callers must use a .catch() that logs the failure rather than swallowing it.
 */
let _resolve: ((store: UserStore) => void) | undefined;
let _reject: ((err: Error) => void) | undefined;

export const userStoreReady = new Promise<UserStore>((res, rej) => {
  _resolve = res;
  _reject = rej;
});

export function resolveSharedUserStore(store: UserStore): void {
  if (!_resolve) throw new Error('sharedStore resolver not ready');
  _resolve(store);
}

export function rejectSharedUserStore(err: Error): void {
  if (_reject) _reject(err);
}
