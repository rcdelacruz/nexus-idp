/**
 * Stop command - Stop the running agent
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../utils/logger';

export const stopCommand = new Command('stop')
  .description('Stop the running Backstage Agent')
  .action(async () => {
    try {
      const pidFile = path.join(os.homedir(), '.backstage-agent', 'agent.pid');

      if (!fs.existsSync(pidFile)) {
        logger.error('No running agent found (PID file does not exist)');
        process.exit(1);
      }

      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

      // Check if process is actually running
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists
      } catch (error) {
        logger.warn('Agent process not found, cleaning up PID file');
        fs.unlinkSync(pidFile);
        process.exit(0);
      }

      // Send SIGTERM for graceful shutdown
      logger.info(`Stopping agent (PID: ${pid})...`);
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
          logger.info('✓ Agent stopped successfully');
          fs.unlinkSync(pidFile);
          process.exit(0);
        }
      }

      // If still running after 5 seconds, force kill
      logger.warn('Agent did not stop gracefully, forcing shutdown...');
      process.kill(pid, 'SIGKILL');
      fs.unlinkSync(pidFile);
      logger.info('✓ Agent stopped (forced)');
      process.exit(0);

    } catch (error: any) {
      logger.error('Failed to stop agent');
      logger.error(error.message);
      process.exit(1);
    }
  });
