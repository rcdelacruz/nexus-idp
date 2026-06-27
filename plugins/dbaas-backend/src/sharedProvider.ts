import { DbaasEntityProvider } from './provider/DbaasEntityProvider';

/**
 * In-process bridge: the catalog module creates DbaasEntityProvider and resolves
 * this promise. The HTTP plugin routes call triggerProviderRefresh() after any
 * connection change to push updated entities into the catalog.
 */
let _provider: DbaasEntityProvider | undefined;
let _resolve: ((p: DbaasEntityProvider) => void) | undefined;

const providerReady = new Promise<DbaasEntityProvider>(res => {
  _resolve = res;
});

export function resolveSharedProvider(provider: DbaasEntityProvider): void {
  _provider = provider;
  _resolve?.(provider);
}

/**
 * Trigger a full refresh of all DBaaS connections and re-emit catalog entities.
 * Safe to call before the provider is ready — waits for it.
 * Does NOT await the refresh to complete (fire-and-forget, errors are logged in provider).
 */
export function triggerProviderRefresh(): void {
  if (_provider) {
    _provider.refresh().catch(() => { /* logged inside provider */ });
  } else {
    providerReady.then(p => p.refresh()).catch(() => { /* logged inside provider */ });
  }
}
