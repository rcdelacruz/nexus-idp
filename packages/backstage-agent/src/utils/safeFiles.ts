/**
 * Small guards for everything the agent writes or deletes on the user's own machine.
 *  - task ids come from the portal and become folder names: only plain id characters are accepted, so `../..` cannot point a delete or a
 *    write at the user's home folder (audit 2026-11-07: a lifecycle task with a traversal `targetTaskId` made the agent remove an
 *    arbitrary folder);
 *  - the agent's state (service token, outbox, registry, task folders) is private to the user: 0700 folders, 0600 files.
 */
import * as fs from 'fs';

const SAFE_TASK_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function isSafeTaskId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_TASK_ID.test(id);
}

export function assertSafeTaskId(id: unknown): string {
  if (!isSafeTaskId(id)) throw new Error('Invalid task id');
  return id;
}

/** mkdir -p with mode 0700, and tighten a folder that already exists from an older version. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Windows and some filesystems do not support modes: nothing to tighten there.
  }
}

/** Write a file readable by the user only, tightening one that already exists from an older version. */
export function writePrivateFile(file: string, data: string): void {
  fs.writeFileSync(file, data, { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // see ensurePrivateDir
  }
}
