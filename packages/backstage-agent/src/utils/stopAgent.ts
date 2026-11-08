/**
 * Stop the running agent daemon: SIGTERM, wait up to 5 s, then SIGKILL. Shared by `stop` and `uninstall`.
 */
import * as fs from 'fs';
import { getPidFilePath, safeUnlinkPidFile } from './pidFile';

export type StopResult = { state: 'not-running' } | { state: 'stopped'; pid: number; forced: boolean };

export interface StopDeps {
  pidFile?: string;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function stopAgent(deps: StopDeps = {}): Promise<StopResult> {
  const pidFile = deps.pidFile ?? getPidFilePath();
  const kill = deps.kill ?? ((pid: number, signal: NodeJS.Signals | 0) => void process.kill(pid, signal));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  if (!fs.existsSync(pidFile)) return { state: 'not-running' };
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  // A pid file is a file in the user's home: never signal 0, 1, a negative number (process groups, "every process") or junk.
  if (!Number.isInteger(pid) || pid <= 1) {
    safeUnlinkPidFile(pidFile);
    return { state: 'not-running' };
  }
  try {
    kill(pid, 0); // does the process exist?
  } catch {
    safeUnlinkPidFile(pidFile);
    return { state: 'not-running' };
  }

  kill(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      kill(pid, 0);
    } catch {
      safeUnlinkPidFile(pidFile);
      return { state: 'stopped', pid, forced: false };
    }
    await sleep(100);
  }
  kill(pid, 'SIGKILL');
  safeUnlinkPidFile(pidFile);
  return { state: 'stopped', pid, forced: true };
}
