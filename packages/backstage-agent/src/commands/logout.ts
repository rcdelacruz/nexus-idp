/**
 * Logout command - Clear authentication and stop agent
 */

import { Command } from 'commander';
import { TokenManager } from '../auth/TokenManager';
import * as fs from 'fs';
import { displaySuccess, displayInfo, displayError } from '../utils/logo';
import { getPidFilePath, safeUnlinkPidFile } from '../utils/pidFile';

export const logoutCommand = new Command('logout')
  .description('Logout and clear authentication tokens')
  .option('--keep-running', 'Keep agent running after logout (default: stop agent)')
  .action(async (options) => {
    try {
      const tokenManager = new TokenManager();
      const pidFile = getPidFilePath();

      // Check if agent is running
      const isRunning = fs.existsSync(pidFile);

      if (isRunning && !options.keepRunning) {
        // Stop agent first
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

        try {
          process.kill(pid, 0);
          process.kill(pid, 'SIGTERM');

          // Wait briefly for graceful shutdown
          await new Promise(resolve => setTimeout(resolve, 1000));

          try {
            process.kill(pid, 0);
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already stopped
          }

          safeUnlinkPidFile(pidFile);
          displaySuccess('Agent stopped');
        } catch {
          // Process not running, just clean up
          safeUnlinkPidFile(pidFile);
        }
      }

      // Clear authentication tokens
      tokenManager.clearTokens();

      displaySuccess('Signed out. This machine no longer receives tasks from the portal.');
      displayInfo('Sign in again with: backstage-agent login');
      console.log('');

    } catch (error: any) {
      displayError(`Sign-out failed: ${error.message}`);
      process.exit(1);
    }
  });
