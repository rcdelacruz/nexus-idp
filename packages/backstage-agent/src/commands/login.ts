/**
 * Login command - Authenticate with Backstage and save tokens
 */

import { Command } from 'commander';
import { GoogleAuthClient } from '../auth/GoogleAuthClient';
import { TokenManager } from '../auth/TokenManager';
import { launchDaemon } from '../utils/daemonLauncher';
import { displaySuccess, displayInfo, displayDetails, displayError } from '../utils/logo';

export const loginCommand = new Command('login')
  .description('Authenticate with Backstage using Google OAuth')
  .requiredOption('--url <url>', 'Backstage instance URL (e.g., http://localhost:7007)')
  .option('--no-start', 'Skip auto-starting the agent after login')
  .action(async (options) => {
    try {
      const backstageUrl = options.url;
      const shouldStart = options.start !== false; // Default to true unless --no-start is specified


      // Initialize auth client
      const authClient = new GoogleAuthClient(backstageUrl);
      const tokenManager = new TokenManager();

      // Step 1: Device-code sign-in (the agent is registered during this flow)
      const authResponse = await authClient.startOAuthFlow();

      // Step 2: Save tokens to config file
      tokenManager.saveTokens(
        backstageUrl,
        authResponse.agentId,
        authResponse.serviceToken,
        authResponse.expiresAt
      );

      console.log('');
      displaySuccess(authResponse.reconnected ? 'Signed in. This machine is already registered, so it reconnected.' : 'Signed in. This machine is now registered with the portal.');
      displayDetails([
        ['Agent ID', authResponse.agentId],
        ['Signed in until', new Date(authResponse.expiresAt).toLocaleString()],
      ]);
      console.log('');

      // Auto-start agent as a DETACHED daemon unless --no-start is specified. This keeps the
      // agent online after the login command exits / the terminal closes (it used to run in the
      // foreground, so Ctrl+C dropped you offline).
      if (shouldStart) {
        const result = await launchDaemon();
        process.exit(result.ok ? 0 : 1);
      } else {
        displayInfo('Start the agent when you are ready: backstage-agent start');
        console.log('');
        process.exit(0);
      }
    } catch (error: any) {
      displayError(`Sign-in failed: ${error.message}`);
      console.log('');
      process.exit(1);
    }
  });
