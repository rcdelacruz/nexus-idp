import { TaskStore } from './database/TaskStore';

/**
 * In-process bridge: the local-provisioner plugin creates TaskStore and resolves this promise.
 * The catalog module (pluginId:'catalog') consumes it to hand TaskStore to the
 * LocalProvisionerEntityProvider without awaiting at init time (avoids startup deadlock — the
 * same pattern dbaas-backend uses).
 */
let _resolve: ((store: TaskStore) => void) | undefined;
let _reject: ((err: Error) => void) | undefined;

export const taskStoreReady = new Promise<TaskStore>((res, rej) => {
  _resolve = res;
  _reject = rej;
});

export function resolveSharedTaskStore(store: TaskStore): void {
  if (!_resolve) throw new Error('taskStoreReady resolver not ready');
  _resolve(store);
}

export function rejectSharedTaskStore(err: Error): void {
  if (_reject) _reject(err);
}

/**
 * Set by the catalog module so the plugin can request an immediate catalog refresh when a
 * resource is provisioned or torn down (rather than waiting for the scheduled cycle).
 */
let _refresh: (() => Promise<void>) | undefined;

export function setCatalogRefresher(fn: () => Promise<void>): void {
  _refresh = fn;
}

export async function refreshCatalog(): Promise<void> {
  if (_refresh) await _refresh();
}
