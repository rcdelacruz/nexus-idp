import { UserStore } from './database/UserStore';

/**
 * In-process bridge: the user-management plugin creates the UserStore (scoped to
 * its own database) and resolves this promise. The catalog module (which must have
 * pluginId:'catalog' to use catalogProcessingExtensionPoint) awaits it, side-stepping
 * the cross-plugin database scope restriction.
 *
 * This is safe because Backstage runs as a single Node.js process.
 */
let _resolve: ((store: UserStore) => void) | undefined;

export const userStoreReady = new Promise<UserStore>(res => {
  _resolve = res;
});

export function resolveSharedUserStore(store: UserStore): void {
  if (!_resolve) throw new Error('sharedStore resolver not ready');
  _resolve(store);
}
