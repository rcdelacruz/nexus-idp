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

export interface LaunchResult {
  ok: boolean;
  pid?: number;
  reason?: 'already-running' | 'no-auth' | 'expired' | 'failed';
}

/**
 * Launch the agent as a detached background daemon. Idempotent: if a daemon is already running,
 * returns ok:true without starting a second one. Prints user-facing status.
 */
export async function launchDaemon(): Promise<LaunchResult> {
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

  // Log files
  const logDir = path.join(agentDir, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'agent.log');
  const errorLogFile = path.join(logDir, 'agent-error.log');
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(errorLogFile, 'a');

  // Spawn detached daemon
  const daemonScript = path.join(__dirname, '..', 'daemon', 'agentDaemon.js');
  const child = spawn('node', [daemonScript], {
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
