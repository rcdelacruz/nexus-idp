/**
 * Stop command - Stop the running agent
 */

import { Command } from 'commander';
import * as fs from 'fs';
import { displaySuccess, displayInfo, displayError } from '../utils/logo';
import { getPidFilePath, safeUnlinkPidFile as safeUnlink } from '../utils/pidFile';

export const stopCommand = new Command('stop')
  .description('Stop the running Backstage Agent')
  .action(async () => {
    try {
      const pidFile = getPidFilePath();

      if (!fs.existsSync(pidFile)) {
        // Not running is the state "stop" wants, so it succeeds (keeps `stop && start` working).
        displayInfo('The agent is not running.');
        process.exit(0);
      }

      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

      // Check if process is actually running
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists
      } catch (error) {
        displayInfo('The agent is not running.');
        safeUnlink(pidFile);
        process.exit(0);
      }

      // Send SIGTERM for graceful shutdown
      process.kill(pid, 'SIGTERM');

      // Wait for process to stop (max 5 seconds)
      let attempts = 0;
      const maxAttempts = 50;
      while (attempts < maxAttempts) {
        try {
          process.kill(pid, 0);
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        } catch (error) {
          // Process stopped
          displaySuccess(`Agent stopped (PID ${pid})`);
          safeUnlink(pidFile);
          process.exit(0);
        }
      }

      // If still running after 5 seconds, force kill
      process.kill(pid, 'SIGKILL');
      safeUnlink(pidFile);
      displaySuccess(`Agent stopped (PID ${pid}, forced after 5 s)`);
      process.exit(0);

    } catch (error: any) {
      displayError(`Could not stop the agent: ${error.message}`);
      process.exit(1);
    }
  });
