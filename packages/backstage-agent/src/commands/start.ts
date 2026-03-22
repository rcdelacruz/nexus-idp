/**
 * Start command - Start the agent as a background daemon
 */

import { Command } from 'commander';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TokenManager } from '../auth/TokenManager';
import { displayLogo, displaySuccess, displayInfo, displayError } from '../utils/logo';

export const startCommand = new Command('start')
  .description('Start the Backstage Agent as a background daemon')
  .action(async () => {
    try {
      // Check if agent is already running
      const pidFile = path.join(os.homedir(), '.backstage-agent', 'agent.pid');

      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

        // Check if process is actually running
        try {
          process.kill(pid, 0); // Signal 0 checks if process exists
          console.log('');
          displayError('Agent is already running');
          displayInfo(`PID: ${pid}`);
          displayInfo('Use "backstage-agent status" to check status');
          displayInfo('Use "backstage-agent stop" to stop the agent');
          console.log('');
          process.exit(1);
        } catch (error) {
          // Process not running, clean up stale PID file
          fs.unlinkSync(pidFile);
        }
      }

      // Verify authentication
      const tokenManager = new TokenManager();
      const config = tokenManager.loadTokens();

      if (!config) {
        console.log('');
        displayError('No authentication found');
        displayInfo('Please run "backstage-agent login" first');
        console.log('');
        process.exit(1);
      }

      if (tokenManager.areTokensExpired()) {
        console.log('');
        displayError('Authentication token expired');
        displayInfo('Please run "backstage-agent login" again');
        console.log('');
        process.exit(1);
      }

      // Display logo
      console.log('');
      displayLogo();
      console.log('');

      // Setup log directory
      const agentDir = path.join(os.homedir(), '.backstage-agent');
      const logDir = path.join(agentDir, 'logs');

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logFile = path.join(logDir, 'agent.log');
      const errorLogFile = path.join(logDir, 'agent-error.log');

      // Spawn agent daemon as detached process
      const daemonScript = path.join(__dirname, '..', 'daemon', 'agentDaemon.js');

      const out = fs.openSync(logFile, 'a');
      const err = fs.openSync(errorLogFile, 'a');

      const child = spawn('node', [daemonScript], {
        detached: true,
        stdio: ['ignore', out, err],
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'production',
        },
      });

      // Unref so parent can exit
      child.unref();

      // Wait a moment to check if daemon started successfully
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify PID file was created
      if (!fs.existsSync(pidFile)) {
        console.log('');
        displayError('Failed to start agent daemon');
        displayInfo('Check logs for details:');
        displayInfo(`  ${logFile}`);
        displayInfo(`  ${errorLogFile}`);
        console.log('');
        process.exit(1);
      }

      const daemonPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

      console.log('');
      displaySuccess('Agent started successfully!');
      console.log('');
      displayInfo(`Agent ID: ${config.agentId}`);
      displayInfo(`Backstage URL: ${config.backstageUrl}`);
      displayInfo(`Process ID: ${daemonPid}`);
      console.log('');
      displayInfo('The agent is now running in the background.');
      displayInfo('It will continue running even if you close this terminal.');
      console.log('');
      displayInfo('Useful commands:');
      displayInfo('  backstage-agent status  - Check agent status');
      displayInfo('  backstage-agent stop    - Stop the agent');
      displayInfo('  backstage-agent logout  - Logout and stop the agent');
      console.log('');
      displayInfo('Logs:');
      displayInfo(`  ${logFile}`);
      displayInfo(`  ${errorLogFile}`);
      console.log('');

    } catch (error: any) {
      console.log('');
      displayError('Failed to start agent');
      displayInfo(error.message);
      console.log('');
      process.exit(1);
    }
  });
