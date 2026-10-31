import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Tasks this agent is in the middle of, one marker file each (~/.backstage-agent/running/<id>).
 * A marker left behind means the agent stopped mid-task (restart, update, crash, reboot): nothing
 * will ever finish that task, so the next start reports it failed instead of leaving the lab
 * "in progress" in the portal forever.
 */
const dir = () => path.join(os.homedir(), '.backstage-agent', 'running');
const SAFE_ID = /^[A-Za-z0-9-]{1,100}$/;

export function markRunning(taskId: string, resourceName: string): void {
  if (!SAFE_ID.test(taskId)) return;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), taskId), JSON.stringify({ resourceName, startedAt: new Date().toISOString() }));
  } catch {
    // best-effort: never block a task over bookkeeping
  }
}

export function clearRunning(taskId: string): void {
  if (!SAFE_ID.test(taskId)) return;
  fs.rmSync(path.join(dir(), taskId), { force: true });
}

/** Tasks interrupted by the last stop; their markers are removed. */
export function takeInterrupted(): Array<{ taskId: string; resourceName?: string; startedAt?: string }> {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(dir()).filter(n => SAFE_ID.test(n));
  } catch {
    return [];
  }
  return ids.map(taskId => {
    let info: { resourceName?: string; startedAt?: string } = {};
    try {
      info = JSON.parse(fs.readFileSync(path.join(dir(), taskId), 'utf8'));
    } catch {
      // unreadable marker: still report the task
    }
    fs.rmSync(path.join(dir(), taskId), { force: true });
    return { taskId, ...info };
  });
}

export const INTERRUPTED_MESSAGE =
  'The agent stopped while this was running (restarted, updated or the machine slept/rebooted), so it did not finish. ' +
  'Remove the lab (⋮ → Stop & remove) and start it again.';
