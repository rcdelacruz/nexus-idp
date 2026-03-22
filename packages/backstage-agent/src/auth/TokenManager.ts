/**
 * Token manager for storing and retrieving authentication tokens
 */

import { ConfigManager } from '../config/ConfigManager';
import { AgentConfig } from '../types';
import logger from '../utils/logger';

export class TokenManager {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  /**
   * Save authentication tokens
   */
  saveTokens(
    backstageUrl: string,
    agentId: string,
    serviceToken: string,
    expiresAt: number
  ): void {
    const config: AgentConfig = {
      backstageUrl,
      agentId,
      serviceToken,
      expiresAt,
    };

    this.configManager.saveConfig(config);
    logger.info(`Authentication tokens saved for agent: ${agentId}`);
  }

  /**
   * Load authentication tokens
   */
  loadTokens(): AgentConfig | null {
    return this.configManager.loadConfig();
  }

  /**
   * Check if tokens are expired
   */
  areTokensExpired(): boolean {
    const config = this.loadTokens();
    if (!config) {
      return true;
    }

    return this.configManager.isTokenExpired(config);
  }

  /**
   * Clear tokens (logout)
   */
  clearTokens(): void {
    this.configManager.clearConfig();
    logger.info('Authentication tokens cleared');
  }

  /**
   * Get current agent ID
   */
  getAgentId(): string | null {
    const config = this.loadTokens();
    return config?.agentId || null;
  }

  /**
   * Get service token
   */
  getServiceToken(): string | null {
    const config = this.loadTokens();
    return config?.serviceToken || null;
  }

  /**
   * Get Backstage URL
   */
  getBackstageUrl(): string | null {
    const config = this.loadTokens();
    return config?.backstageUrl || null;
  }
}
