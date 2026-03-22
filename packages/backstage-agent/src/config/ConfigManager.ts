/**
 * Configuration manager for Backstage Agent
 * Handles loading and saving agent configuration to ~/.backstage-agent/config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentConfig } from '../types';
import logger from '../utils/logger';

export class ConfigManager {
  private configDir: string;
  private configPath: string;

  constructor() {
    // Config stored in user's home directory
    this.configDir = path.join(os.homedir(), '.backstage-agent');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  /**
   * Ensure config directory exists
   */
  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      logger.debug(`Created config directory: ${this.configDir}`);
    }
  }

  /**
   * Save agent configuration
   */
  saveConfig(config: AgentConfig): void {
    try {
      this.ensureConfigDir();
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      );
      logger.info(`Configuration saved to ${this.configPath}`);
    } catch (error) {
      logger.error(`Failed to save configuration: ${error}`);
      throw new Error(`Failed to save configuration: ${error}`);
    }
  }

  /**
   * Load agent configuration
   */
  loadConfig(): AgentConfig | null {
    try {
      if (!fs.existsSync(this.configPath)) {
        logger.debug('No configuration file found');
        return null;
      }

      const configData = fs.readFileSync(this.configPath, 'utf-8');
      const config = JSON.parse(configData) as AgentConfig;

      logger.debug('Configuration loaded successfully');
      return config;
    } catch (error) {
      logger.error(`Failed to load configuration: ${error}`);
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(config: AgentConfig): boolean {
    const now = Date.now();
    return config.expiresAt < now;
  }

  /**
   * Clear configuration (logout)
   */
  clearConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath);
        logger.info('Configuration cleared');
      }
    } catch (error) {
      logger.error(`Failed to clear configuration: ${error}`);
      throw new Error(`Failed to clear configuration: ${error}`);
    }
  }

  /**
   * Get tasks directory for a specific task
   */
  getTaskDir(taskId: string): string {
    const tasksDir = path.join(this.configDir, 'tasks', taskId);
    if (!fs.existsSync(tasksDir)) {
      fs.mkdirSync(tasksDir, { recursive: true });
    }
    return tasksDir;
  }
}
