/**
 * Status command - Show agent status and configuration
 */

import { Command } from 'commander';
import { TokenManager } from '../auth/TokenManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fetch from 'node-fetch';
import logger from '../utils/logger';
import { getMachineInfo } from '../utils/machineId';

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

      // Check backend connection if authenticated
      let backendStatus: 'connected' | 'disconnected' | 'unknown' = 'unknown';
      let agentDetails: any = null;

      if (config) {
        try {
          const response = await fetch(
            `${config.backstageUrl}/api/local-provisioner/agent`,
            {
              headers: {
                'Authorization': `Bearer ${config.serviceToken}`,
              },
            }
          );

          if (response.ok) {
            const agents = await response.json() as any[];
            agentDetails = agents.find(a => a.agent_id === config.agentId);
            backendStatus = agentDetails ? 'connected' : 'disconnected';
          } else {
            backendStatus = 'disconnected';
          }
        } catch {
          backendStatus = 'disconnected';
        }
      }

      const status = {
        authenticated: !!config,
        running: isRunning,
        pid: pid,
        backendConnection: backendStatus,
        agentId: config?.agentId || machineInfo.agentId,
        backstageUrl: config?.backstageUrl || 'not configured',
        tokenExpires: config?.expiresAt ? new Date(config.expiresAt).toLocaleString() : 'N/A',
        tokenExpired: config ? tokenManager.areTokensExpired() : true,
        machineInfo: {
          hostname: machineInfo.hostname,
          platform: machineInfo.platform,
          platformVersion: machineInfo.platformVersion,
        },
        lastSeen: agentDetails?.last_seen ? new Date(agentDetails.last_seen).toLocaleString() : 'N/A',
      };

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      // Human-readable output
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║               Backstage Agent Status                       ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');

      console.log('Authentication:');
      console.log(`  Status:          ${status.authenticated ? '✓ Authenticated' : '✗ Not authenticated'}`);
      console.log(`  Agent ID:        ${status.agentId}`);
      console.log(`  Backstage URL:   ${status.backstageUrl}`);
      console.log(`  Token Expires:   ${status.tokenExpires}`);
      console.log(`  Token Expired:   ${status.tokenExpired ? '✗ Yes' : '✓ No'}\n`);

      console.log('Agent Process:');
      console.log(`  Running:         ${status.running ? `✓ Yes (PID: ${status.pid})` : '✗ No'}`);
      console.log(`  Backend Status:  ${status.backendConnection === 'connected' ? '✓ Connected' : status.backendConnection === 'disconnected' ? '✗ Disconnected' : '? Unknown'}`);
      console.log(`  Last Seen:       ${status.lastSeen}\n`);

      console.log('Machine Info:');
      console.log(`  Hostname:        ${status.machineInfo.hostname}`);
      console.log(`  Platform:        ${status.machineInfo.platform}`);
      console.log(`  Version:         ${status.machineInfo.platformVersion}\n`);

      // Recommendations
      if (!status.authenticated) {
        console.log('ℹ  Run "backstage-agent login" to authenticate\n');
      } else if (status.tokenExpired) {
        console.log('⚠  Token expired. Run "backstage-agent login" to re-authenticate\n');
      } else if (!status.running) {
        console.log('ℹ  Run "backstage-agent start" to start the agent\n');
      } else {
        console.log('✓ Agent is running and ready to receive tasks\n');
      }

    } catch (error: any) {
      logger.error('Failed to get agent status');
      logger.error(error.message);
      process.exit(1);
    }
  });
