/**
 * Google OAuth authentication client for Backstage Agent
 * Handles the OAuth Device Code Flow (RFC 8628) to authenticate with Backstage
 */

import open from 'open';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { AgentRegisterResponse } from '../types';
import logger from '../utils/logger';
import { getMachineInfo } from '../utils/machineId';

// The real package version (was hard-coded '0.1.0', which made every agent look ancient).
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { AGENT_VERSION } from '../utils/version';

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
    // Step 2: Request device code from backend with machine info

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
          agent_version: AGENT_VERSION,
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

    console.log(`  ${chalk.bold('Sign in to connect this machine')}  ${chalk.dim(`(${machineInfo.hostname})`)}`);
    console.log('');
    console.log(`    1. Open   ${chalk.cyan(verificationUrl)}`);
    console.log(`    2. Enter  ${chalk.bold.yellow(user_code)}`);
    console.log(`    3. Sign in with your ${chalk.bold('Google work account')}`);
    console.log('');

    // Open browser automatically
    await open(verificationUrl).catch(err => {
      console.log(chalk.dim(`  (Could not open the browser automatically: ${err.message}. Open the link above.)`));
    });

    console.log(chalk.dim(`  Waiting for you to approve in the browser (the code expires in ${Math.round(expires_in / 60)} minutes)...`));

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
   * Register agent with backend
   */
  async registerAgent(serviceToken: string): Promise<AgentRegisterResponse> {
    try {
      const machineInfo = {
        machine_name: require('os').hostname(),
        os_platform: require('os').platform(),
        agent_version: AGENT_VERSION,
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
