/**
 * Retry that first removes the user's other labs holding a port the retried lab needs.
 *
 * The agent runs the tasks it receives side by side, so the removals must be finished (not just
 * queued) before the retry is queued: otherwise the retried lab can start while the old one still
 * holds the port and fail the same way again.
 */
import { LabConflict, ProvisioningTask, RetryLeftover } from './types';

export const REMOVAL_TIMEOUT_MS = 4 * 60_000;
export const POLL_INTERVAL_MS = 2_000;
/** Consecutive failed status reads tolerated before giving up (a network blip must not abandon a teardown). */
const MAX_READ_FAILURES = 3;

/** A task the agent reported as failed (distinct from a failed read of its status). */
class TaskFailed extends Error {}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Poll a task until it completes. Throws with the task's own error if it fails, or on timeout. */
export async function waitForCompletion(
  getTask: (taskId: string) => Promise<ProvisioningTask>,
  taskId: string,
  options: WaitOptions = {},
): Promise<ProvisioningTask> {
  const {
    timeoutMs = REMOVAL_TIMEOUT_MS,
    intervalMs = POLL_INTERVAL_MS,
    sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;
  const deadline = now() + timeoutMs;
  let failures = 0;
  for (;;) {
    try {
      const task = await getTask(taskId);
      failures = 0;
      if (task.status === 'completed') return task;
      if (task.status === 'failed') throw new TaskFailed(task.errorMessage || 'the agent reported a failure');
    } catch (err: any) {
      if (err instanceof TaskFailed) throw new Error(err.message);
      failures += 1;
      if (failures >= MAX_READ_FAILURES) throw err;
    }
    if (now() >= deadline) {
      throw new Error(
        `it did not finish within ${Math.round(timeoutMs / 1000)} seconds (the task stays queued and runs when your agent is back)`,
      );
    }
    await sleep(intervalMs);
  }
}

/** What a teardown needs: the lab's name and its provision task. */
export type RemovalTarget = Pick<LabConflict, 'resourceName' | 'provisionTaskId'>;

export interface RetryApi {
  getRetryConflicts(taskId: string): Promise<LabConflict[]>;
  removeLab(agentId: string, target: RemovalTarget): Promise<ProvisioningTask>;
  waitForTask(taskId: string): Promise<ProvisioningTask>;
  retryTask(task: ProvisioningTask): Promise<ProvisioningTask>;
}

const quoted = (names: string[]) => names.map(n => `"${n}"`).join(', ');

/**
 * Remove each conflicting lab the user confirmed, wait for each removal to complete, then retry.
 *
 * The labs in the way are asked again right before anything is removed: time has passed since the
 * dialog opened. A lab that is already gone is skipped; a lab the user has not seen stops the whole
 * thing before anything is removed. If a removal fails nothing is retried, and the error names the
 * lab and any lab already removed.
 */
export async function removeConflictsThenRetry(
  api: RetryApi,
  task: ProvisioningTask,
  confirmed: LabConflict[],
  report: (message: string) => void = () => undefined,
): Promise<ProvisioningTask> {
  report('Checking again…');
  let current: LabConflict[];
  try {
    current = await api.getRetryConflicts(task.id);
  } catch (err: any) {
    throw new Error(`Could not check again before removing anything, so nothing was removed: ${err.message}`);
  }
  const isConfirmed = (c: LabConflict) => confirmed.some(k => k.provisionTaskId === c.provisionTaskId);
  const unseen = current.filter(c => !isConfirmed(c));
  if (unseen.length > 0) {
    throw new Error(
      `${quoted(unseen.map(c => c.resourceName))} also ${unseen.length === 1 ? 'uses' : 'use'} the port now. Nothing was removed; press Retry again to review.`,
    );
  }
  const toRemove = confirmed.filter(c => current.some(k => k.provisionTaskId === c.provisionTaskId));

  const removed: string[] = [];
  for (const conflict of toRemove) {
    report(`Removing "${conflict.resourceName}"…`);
    try {
      const removal = await api.removeLab(task.agentId, conflict);
      await api.waitForTask(removal.id);
      removed.push(conflict.resourceName);
    } catch (err: any) {
      const alreadyRemoved = removed.length > 0 ? ` Already removed: ${quoted(removed)}.` : '';
      throw new Error(
        `Could not remove "${conflict.resourceName}": ${err.message}. It may still be using the port: stop it in Docker Desktop, then press Retry again.${alreadyRemoved}`,
      );
    }
  }
  report(`Retrying "${task.resourceName}"…`);
  try {
    return await api.retryTask(task);
  } catch (err: any) {
    throw new Error(
      `${removed.length > 0 ? `Removed ${quoted(removed)}, but the` : 'The'} retry could not be queued: ${err.message}. Press Retry again.`,
    );
  }
}

/**
 * A failed VM lab may have left its half-made VM on the machine (agents up to 0.1.30 do), and the
 * retry would stop at "instance already exists". Remove it, wait until it is gone, then retry. No
 * question is asked: it is the failed attempt's own unfinished VM, and the portal only offers it when
 * the lab's latest provision failed.
 */
export async function removeLeftoverThenRetry(
  api: Pick<RetryApi, 'removeLab' | 'waitForTask' | 'retryTask'>,
  task: ProvisioningTask,
  leftover: RetryLeftover,
  report: (message: string) => void = () => undefined,
): Promise<ProvisioningTask> {
  report('Removing the unfinished VM from the failed attempt…');
  try {
    const removal = await api.removeLab(task.agentId, leftover);
    await api.waitForTask(removal.id);
  } catch (err: any) {
    throw new Error(
      `Could not remove the unfinished VM of "${leftover.resourceName}": ${err.message}. It may still be on your machine: remove it with Multipass (multipass list, then multipass delete --purge <name>), then press Retry again.`,
    );
  }
  report(`Retrying "${task.resourceName}"…`);
  try {
    return await api.retryTask(task);
  } catch (err: any) {
    throw new Error(`The unfinished VM was removed, but the retry could not be queued: ${err.message}. Press Retry again.`);
  }
}

/** The sentence the confirmation shows. */
export function describeConflicts(task: ProvisioningTask, conflicts: LabConflict[]): string {
  const ports = (c: LabConflict) => `port${c.ports.length === 1 ? '' : 's'} ${c.ports.join(', ')}`;
  const list = conflicts.map(c => `"${c.resourceName}" (${ports(c)})`).join(', ');
  return (
    `"${task.resourceName}" needs ${conflicts.length === 1 ? 'a port' : 'ports'} that ${conflicts.length === 1 ? 'another lab is' : 'other labs are'} using on your machine: ${list}. ` +
    `Retrying will first remove ${conflicts.length === 1 ? 'that lab' : 'those labs'} (docker compose down -v: ` +
    `${conflicts.length === 1 ? 'its' : 'their'} containers and data volumes are deleted), wait until ${conflicts.length === 1 ? 'it is' : 'they are'} gone, then retry "${task.resourceName}".`
  );
}
