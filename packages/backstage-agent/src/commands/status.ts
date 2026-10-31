/**
 * Status command - Show agent status and configuration
 */

import { Command } from 'commander';
import { TokenManager } from '../auth/TokenManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import logger from '../utils/logger';
import { getMachineInfo } from '../utils/machineId';
import { displayDetails, displayInfo, displaySuccess, displayWarning } from '../utils/logo';
import { AGENT_VERSION } from '../utils/version';
import { readConnectionState, isConnected, isConnecting } from '../utils/connectionState';

/** "12s ago", "4m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const statusCommand = new Command('status')
  .description('Show agent status and configuration')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    try {
      const tokenManager = new TokenManager();
      const config = tokenManager.loadTokens();
      const pidFile = path.join(os.homedir(), '.backstage-agent', 'agent.pid');
      const machineInfo = getMachineInfo();

      // Check if agent process is running
      let isRunning = false;
      let pid: number | null = null;

      if (fs.existsSync(pidFile)) {
        pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
        try {
          process.kill(pid, 0); // Check if process exists
          isRunning = true;
        } catch {
          // Process not running, clean up stale PID file
          fs.unlinkSync(pidFile);
          pid = null;
        }
      }

      // Connection: the daemon records every successful poll (the portal's agent list needs a
      // signed-in user, so this command can't ask the portal with the agent token).
      const connection = readConnectionState();
      const connected = isRunning && isConnected(connection);
      const connecting = isRunning && !connected && isConnecting(connection);
      const backendStatus: 'connected' | 'disconnected' | 'unknown' = !config ? 'unknown' : connected ? 'connected' : 'disconnected';
      const tokenExpired = config ? tokenManager.areTokensExpired() : true;

      const status = {
        version: AGENT_VERSION,
        authenticated: !!config,
        running: isRunning,
        pid: pid,
        backendConnection: backendStatus,
        lastContact: connection.lastContactAt ?? null,
        lastError: connection.lastError ?? null,
        agentId: config?.agentId || machineInfo.agentId,
        backstageUrl: config?.backstageUrl || 'not configured',
        tokenExpires: config?.expiresAt ? new Date(config.expiresAt).toISOString() : null,
        tokenExpired,
        machineInfo: {
          hostname: machineInfo.hostname,
          platform: machineInfo.platform,
          platformVersion: machineInfo.platformVersion,
        },
      };

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      const yes = (ok: boolean, good: string, bad: string) => (ok ? chalk.green(`● ${good}`) : chalk.red(`● ${bad}`));
      const contactText = connection.lastContactAt ? `last contact ${timeAgo(connection.lastContactAt)}` : 'no contact yet';
      displayDetails([
        ['Agent', isRunning ? yes(true, `running (PID ${pid})`, '') : yes(false, '', 'not running')],
        ['Portal', !config ? chalk.dim('not signed in') : connecting ? chalk.yellow('● connecting (the first answer can take up to 25 s)') : `${connected ? yes(true, 'connected', '') : yes(false, '', 'not reaching the portal')} ${chalk.dim(`· ${contactText}`)}`],
        ['URL', status.backstageUrl],
        ['Signed in', !config ? chalk.dim('no') : tokenExpired ? chalk.red('session expired') : `until ${new Date(config.expiresAt).toLocaleString()}`],
        ['Agent ID', status.agentId],
        ['Machine', `${machineInfo.hostname} · ${machineInfo.platformVersion}`],
        ['Version', AGENT_VERSION],
      ]);
      if (!connected && isRunning && connection.lastError) {
        console.log('');
        displayWarning(`Last error: ${connection.lastError} (${timeAgo(connection.lastErrorAt!)})`);
      }
      console.log('');

      if (!status.authenticated) displayInfo('Next: backstage-agent login');
      else if (tokenExpired) displayWarning('Your session expired. Next: backstage-agent login');
      else if (!isRunning) displayInfo('Next: backstage-agent start');
      else if (connected) displaySuccess('Ready to receive tasks from the portal');
      else if (connecting) displayInfo('Starting up. Run backstage-agent status again in a moment.');
      else displayWarning('Running, but not reaching the portal. Check your network or VPN; logs: ~/.backstage-agent/logs/agent.log');
      console.log('');

    } catch (error: any) {
      logger.error('Failed to get agent status');
      logger.error(error.message);
      process.exit(1);
    }
  });
