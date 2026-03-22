/**
 * Google OAuth authentication client for Backstage Agent
 * Handles the OAuth Device Code Flow (RFC 8628) to authenticate with Backstage
 */

import open from 'open';
import fetch from 'node-fetch';
import { AgentAuthResponse, AgentRegisterResponse } from '../types';
import logger from '../utils/logger';
import { getMachineInfo } from '../utils/machineId';

export class GoogleAuthClient {
  private backstageUrl: string;

  constructor(backstageUrl: string) {
    this.backstageUrl = backstageUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Start OAuth Device Code Flow (RFC 8628)
   * Professional CLI authentication flow used by GitHub CLI, AWS CLI, etc.
   */
  async startOAuthFlow(): Promise<{ serviceToken: string; agentId: string; expiresAt: number; reconnected?: boolean }> {
    // Step 1: Get machine info for stable agent ID
    const machineInfo = getMachineInfo();
    logger.info(`Machine ID: ${machineInfo.agentId}`);
    logger.info(`Hostname: ${machineInfo.hostname}`);

    // Step 2: Request device code from backend with machine info
    logger.info('Requesting device code...');

    const codeResponse = await fetch(
      `${this.backstageUrl}/api/local-provisioner/agent/device/code`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: machineInfo.agentId,
          hostname: machineInfo.hostname,
          platform: machineInfo.platform,
          platform_version: machineInfo.platformVersion,
        }),
      }
    );

    if (!codeResponse.ok) {
      throw new Error(`Failed to request device code: ${codeResponse.status}`);
    }

    const {
      device_code,
      user_code,
      verification_uri,
      expires_in,
      interval,
    } = await codeResponse.json() as any;

    // Step 2: Display instructions to user
    // Backend returns full URL (e.g., http://localhost:3000/device)
    // Use it directly if it starts with http, otherwise construct it
    const verificationUrl = verification_uri.startsWith('http')
      ? verification_uri
      : `${this.backstageUrl}${verification_uri}`;

    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('  To authorize this device, please follow these steps:');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    logger.info(`  1. Visit: ${verificationUrl}`);
    logger.info(`  2. Enter code: ${user_code}\n`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Open browser automatically
    await open(verificationUrl).catch(err => {
      logger.warn(`Could not open browser automatically: ${err.message}`);
    });

    logger.info('Waiting for authorization...');

    // Step 3: Poll for token
    const pollInterval = (interval || 5) * 1000; // Convert to milliseconds
    const expiresAt = Date.now() + (expires_in * 1000);

    while (Date.now() < expiresAt) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      try {
        const tokenResponse = await fetch(
          `${this.backstageUrl}/api/local-provisioner/agent/device/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code }),
          }
        );

        if (tokenResponse.ok) {
          const { access_token, agent_id, reconnected, expires_in } = await tokenResponse.json() as any;
          logger.info('\n✓ Device authorized successfully!');
          if (reconnected) {
            logger.info('✓ Reconnected to existing agent');
          }
          const tokenExpiresAt = Date.now() + (expires_in * 1000);
          return { serviceToken: access_token, agentId: agent_id, expiresAt: tokenExpiresAt, reconnected };
        }

        const errorData = await tokenResponse.json() as any;

        if (errorData.error === 'authorization_pending') {
          // Still waiting, continue polling
          continue;
        }

        if (errorData.error === 'expired_token') {
          throw new Error('Device code expired. Please try again.');
        }

        if (errorData.error === 'access_denied') {
          throw new Error('Authorization denied by user.');
        }

        throw new Error(errorData.error_description || errorData.error);
      } catch (error: any) {
        if (error.message.includes('expired') || error.message.includes('denied')) {
          throw error;
        }
        // Network error or other transient issue, continue polling
        logger.debug(`Polling error: ${error.message}`);
      }
    }

    throw new Error('Device code expired. Please try again.');
  }

  /**
   * Exchange Google token for service token
   */
  async exchangeToken(googleToken: string): Promise<AgentAuthResponse> {
    try {
      const response = await fetch(
        `${this.backstageUrl}/api/local-provisioner/agent/auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ googleToken }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${error}`);
      }

      const authResponse = await response.json() as AgentAuthResponse;
      logger.info(`Successfully exchanged token for agent: ${authResponse.agentId}`);

      return authResponse;
    } catch (error: any) {
      logger.error(`Token exchange error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register agent with backend
   */
  async registerAgent(serviceToken: string): Promise<AgentRegisterResponse> {
    try {
      const machineInfo = {
        machine_name: require('os').hostname(),
        os_platform: require('os').platform(),
        agent_version: '0.1.0',
      };

      const response = await fetch(
        `${this.backstageUrl}/api/local-provisioner/agent/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceToken}`,
          },
          body: JSON.stringify(machineInfo),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Agent registration failed: ${response.status} ${error}`);
      }

      const registerResponse = await response.json() as AgentRegisterResponse;
      logger.info(`Agent registered successfully: ${registerResponse.agent_id}`);

      return registerResponse;
    } catch (error: any) {
      logger.error(`Agent registration error: ${error.message}`);
      throw error;
    }
  }

}
