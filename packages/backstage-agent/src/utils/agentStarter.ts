/**
 * Shared agent startup logic
 */

import { Agent } from '../agent/Agent';
import { TokenManager } from '../auth/TokenManager';
import logger from './logger';
import { displayLogo, displaySuccess, displayInfo } from './logo';

export interface StartAgentOptions {
  showLogo?: boolean;
}

export async function startAgent(options: StartAgentOptions = {}): Promise<void> {
  const { showLogo = true } = options;

  const tokenManager = new TokenManager();

  // Load configuration
  logger.info('Loading agent configuration...');
  const config = tokenManager.loadTokens();

  if (!config) {
    logger.error('No configuration found. Please run "backstage-agent login" first.');
    process.exit(1);
  }

  // Check if token is expired
  if (tokenManager.areTokensExpired()) {
    logger.error('Authentication token has expired. Please run "backstage-agent login" again.');
    process.exit(1);
  }

  // Display logo
  if (showLogo) {
    console.log('');
    displayLogo();
    console.log('');
  }

  displaySuccess('Configuration loaded successfully');
  displayInfo(`Agent ID: ${config.agentId}`);
  displayInfo(`Backstage URL: ${config.backstageUrl}`);
  console.log('');

  // Create and start agent
  const agent = new Agent(
    config.backstageUrl,
    config.agentId,
    config.serviceToken
  );

  await agent.start();

  // Keep process running
  // Agent will handle SIGINT/SIGTERM for graceful shutdown
}
