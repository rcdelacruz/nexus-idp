#!/usr/bin/env node
/**
 * Agent Daemon Runner
 *
 * This file is executed as a detached child process when running `backstage-agent start`.
 * It runs the agent in the background, independent of the parent terminal.
 *
 * Lifecycle:
 * - Started by: `backstage-agent start` (spawns this as detached process)
 * - Stopped by: `backstage-agent stop` (sends SIGTERM via PID)
 * - Stopped by: UI disconnect/revoke (sends SIGTERM via SSE or deletes agent)
 *
 * Signal Handling:
 * - SIGTERM: Graceful shutdown (from stop command or disconnect)
 * - NO SIGINT: User pressing Ctrl+C should not stop the daemon
 */

import { Agent } from '../agent/Agent';
import { TokenManager } from '../auth/TokenManager';
import logger from '../utils/logger';

async function main() {
  try {
    logger.info('Starting Backstage Agent daemon...');

    // Load configuration
    const tokenManager = new TokenManager();
    const config = tokenManager.loadTokens();

    if (!config) {
      logger.error('No authentication found. Please run "backstage-agent login" first.');
      process.exit(1);
    }

    if (tokenManager.areTokensExpired()) {
      logger.error('Authentication token expired. Please run "backstage-agent login" again.');
      process.exit(1);
    }

    // Initialize agent
    const agent = new Agent(
      config.backstageUrl,
      config.agentId,
      config.serviceToken
    );

    // Setup graceful shutdown (SIGTERM only, no SIGINT)
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal} signal. Shutting down gracefully...`);
      await agent.stop();
      process.exit(0);
    };

    // Only handle SIGTERM (from stop command or disconnect)
    // Do NOT handle SIGINT (user Ctrl+C should not stop daemon)
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start the agent
    await agent.start();

    logger.info('Agent daemon started successfully');
    logger.info('Agent is now running in the background');
    logger.info('Use "backstage-agent stop" to stop the agent');

  } catch (error: any) {
    logger.error('Failed to start agent daemon:', error);
    process.exit(1);
  }
}

main();
