import { DbaasStore } from './database/DbaasStore';

/**
 * In-process bridge: dbaasPlugin creates DbaasStore and resolves this promise.
 * The catalog module (pluginId:'catalog') consumes it to pass to DbaasEntityProvider
 * without awaiting at init time (prevents startup deadlock).
 */
let _resolve: ((store: DbaasStore) => void) | undefined;
let _reject: ((err: Error) => void) | undefined;

export const dbaasStoreReady = new Promise<DbaasStore>((res, rej) => {
  _resolve = res;
  _reject = rej;
});

export function resolveSharedDbaasStore(store: DbaasStore): void {
  if (!_resolve) throw new Error('dbaasStoreReady resolver not ready');
  _resolve(store);
}

export function rejectSharedDbaasStore(err: Error): void {
  if (_reject) _reject(err);
}
