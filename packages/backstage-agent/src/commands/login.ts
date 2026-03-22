/**
 * Login command - Authenticate with Backstage and save tokens
 */

import { Command } from 'commander';
import { GoogleAuthClient } from '../auth/GoogleAuthClient';
import { TokenManager } from '../auth/TokenManager';
import { startAgent } from '../utils/agentStarter';
import { displaySuccess, displayInfo, displayBanner } from '../utils/logo';
import logger from '../utils/logger';

export const loginCommand = new Command('login')
  .description('Authenticate with Backstage using Google OAuth')
  .requiredOption('--url <url>', 'Backstage instance URL (e.g., http://localhost:7007)')
  .option('--no-start', 'Skip auto-starting the agent after login')
  .action(async (options) => {
    try {
      const backstageUrl = options.url;
      const shouldStart = options.start !== false; // Default to true unless --no-start is specified

      logger.info('Starting authentication flow...');
      logger.info(`Backstage URL: ${backstageUrl}`);

      // Initialize auth client
      const authClient = new GoogleAuthClient(backstageUrl);
      const tokenManager = new TokenManager();

      // Step 1: Start OAuth flow - agent is automatically registered during this flow
      logger.info('Opening browser for Google OAuth...');
      logger.info('Please sign in with your Stratpoint Google account');
      const authResponse = await authClient.startOAuthFlow();

      // Step 2: Save tokens to config file
      tokenManager.saveTokens(
        backstageUrl,
        authResponse.agentId,
        authResponse.serviceToken,
        authResponse.expiresAt
      );

      console.log('');
      displayBanner('Authentication Successful!');
      console.log('');

      if (authResponse.reconnected) {
        displaySuccess('Reconnected to existing agent');
      } else {
        displaySuccess('Agent registered with Backstage');
      }

      displayInfo(`Agent ID: ${authResponse.agentId}`);
      displayInfo(`Token expires: ${new Date(authResponse.expiresAt).toLocaleString()}`);
      console.log('');

      // Auto-start agent unless --no-start is specified
      if (shouldStart) {
        console.log('');
        logger.info('Starting agent automatically...');
        logger.info('(Use --no-start flag to skip auto-start)');
        console.log('');

        // Start the agent (will show logo and connect)
        await startAgent({ showLogo: true });

        // Note: startAgent keeps the process running, so we never reach here
      } else {
        console.log('');
        displayInfo('Agent ready! Run "backstage-agent start" when you\'re ready to connect.');
        console.log('');
        process.exit(0);
      }
    } catch (error: any) {
      logger.error('Authentication failed');
      logger.error(error.message);
      process.exit(1);
    }
  });
