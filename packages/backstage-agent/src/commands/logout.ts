/**
 * Logout command - Clear authentication and stop agent
 */

import { Command } from 'commander';
import { TokenManager } from '../auth/TokenManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../utils/logger';

export const logoutCommand = new Command('logout')
  .description('Logout and clear authentication tokens')
  .option('--keep-running', 'Keep agent running after logout (default: stop agent)')
  .action(async (options) => {
    try {
      const tokenManager = new TokenManager();
      const pidFile = path.join(os.homedir(), '.backstage-agent', 'agent.pid');

      // Check if agent is running
      const isRunning = fs.existsSync(pidFile);

      if (isRunning && !options.keepRunning) {
        // Stop agent first
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

        try {
          process.kill(pid, 0);
          logger.info('Stopping agent...');
          process.kill(pid, 'SIGTERM');

          // Wait briefly for graceful shutdown
          await new Promise(resolve => setTimeout(resolve, 1000));

          try {
            process.kill(pid, 0);
            logger.warn('Force killing agent...');
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already stopped
          }

          fs.unlinkSync(pidFile);
          logger.info('✓ Agent stopped');
        } catch {
          // Process not running, just clean up
          fs.unlinkSync(pidFile);
        }
      }

      // Clear authentication tokens
      tokenManager.clearTokens();

      console.log('\n╔══════════════════════════╗');
      console.log('║  Logged Out Successfully  ║');
      console.log('╚══════════════════════════╝\n');

      logger.info('✓ Authentication cleared');
      logger.info('ℹ Run "backstage-agent login" to authenticate again\n');

    } catch (error: any) {
      logger.error('Failed to logout');
      logger.error(error.message);
      process.exit(1);
    }
  });
