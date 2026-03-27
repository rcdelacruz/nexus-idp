/**
 * In-process bridge for RevocationStore.
 *
 * The user-management plugin sets the store on init.
 * The revocation middleware checks synchronously — if the store isn't ready yet,
 * it skips the check and lets the request through (safe: no revocations active).
 */
import { RevocationStore } from './database/RevocationStore';

let _store: RevocationStore | null = null;

export function getRevocationStore(): RevocationStore | null {
  return _store;
}

export function setRevocationStore(store: RevocationStore): void {
  _store = store;
}
