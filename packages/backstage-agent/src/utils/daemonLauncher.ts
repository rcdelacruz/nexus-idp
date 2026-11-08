/**
 * Shared detached-daemon launcher.
 *
 * Both `start` and `login`'s auto-start use this so the agent always runs as a background daemon
 * that survives Ctrl+C and closing the terminal. (Previously `login` ran the agent in the
 * foreground via startAgent(), so exiting the login command dropped the agent offline.)
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TokenManager } from '../auth/TokenManager';
import { displaySuccess, displayInfo, displayError, displayDetails, displayCommands } from './logo';
import { dockerHelp, dockerState, DockerState } from './dockerCheck';

export interface LaunchResult {
  ok: boolean;
  pid?: number;
  reason?: 'already-running' | 'no-auth' | 'expired' | 'failed' | 'no-docker';
}

/** Replaceable in tests. */
export interface LaunchDeps {
  docker?: () => Promise<DockerState>;
  spawnFn?: typeof spawn;
}

/**
 * Launch the agent as a detached background daemon. Idempotent: if a daemon is already running,
 * returns ok:true without starting a second one. Prints user-facing status.
 */
export async function launchDaemon(deps: LaunchDeps = {}): Promise<LaunchResult> {
  const spawnFn = deps.spawnFn ?? spawn;
  const agentDir = path.join(os.homedir(), '.backstage-agent');
  const pidFile = path.join(agentDir, 'agent.pid');

  // Already running?
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0); // exists?
      displayInfo(`The agent is already running (PID ${pid}). Check it with: backstage-agent status`);
      console.log('');
      return { ok: true, pid, reason: 'already-running' };
    } catch {
      fs.unlinkSync(pidFile); // stale pid file
    }
  }

  // Verify auth
  const tokenManager = new TokenManager();
  const config = tokenManager.loadTokens();
  if (!config) {
    displayError('Not signed in. Run: backstage-agent login');
    console.log('');
    return { ok: false, reason: 'no-auth' };
  }
  if (tokenManager.areTokensExpired()) {
    displayError('Your session expired. Run: backstage-agent login');
    console.log('');
    return { ok: false, reason: 'expired' };
  }

  // The daemon exits at once when Docker is not ready: say so here, with what to install, instead of
  // starting something that dies and sends the user to a log file.
  const docker = await (deps.docker ?? dockerState)();
  if (docker !== 'ok') {
    displayError('Docker is not ready, so the agent cannot start.');
    for (const line of dockerHelp(docker)) displayInfo(line);
    displayInfo('You stay signed in. Start the agent when Docker is ready: backstage-agent start');
    console.log('');
    return { ok: false, reason: 'no-docker' };
  }

  // Log files
  const logDir = path.join(agentDir, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'agent.log');
  const errorLogFile = path.join(logDir, 'agent-error.log');
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(errorLogFile, 'a');

  // Spawn detached daemon
  const daemonScript = path.join(__dirname, '..', 'daemon', 'agentDaemon.js');
  // process.execPath, not 'node': the terminal that runs `start` may have no node on its PATH (the
  // agent can be started through a launcher that pinned the Node it was installed with).
  const child = spawnFn(process.execPath, [daemonScript], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
  });
  child.unref(); // let the parent (start/login command) exit

  // Give it a moment and confirm it wrote its PID file
  await new Promise(resolve => setTimeout(resolve, 1200));
  if (!fs.existsSync(pidFile)) {
    displayError('The agent did not start. Details are in the logs:');
    displayDetails([
      ['Log', logFile],
      ['Errors', errorLogFile],
    ]);
    console.log('');
    return { ok: false, reason: 'failed' };
  }

  const daemonPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  displaySuccess('Agent is running in the background. It keeps running after you close this terminal.');
  console.log('');
  displayDetails([
    ['Portal', config.backstageUrl],
    ['Agent ID', config.agentId],
    ['Process', String(daemonPid)],
    ['Logs', logFile],
  ]);
  console.log('');
  displayCommands('Commands', [
    ['backstage-agent status', 'check the agent and its connection'],
    ['backstage-agent stop', 'stop the agent'],
    ['backstage-agent logout', 'sign out and stop the agent'],
  ]);
  console.log('');
  return { ok: true, pid: daemonPid };
}
