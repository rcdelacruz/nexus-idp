/**
 * Docker Compose executor for provisioning resources
 * Handles execution of docker-compose up/down commands
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import Mustache from 'mustache';
import { ProvisioningTask, TaskExecutionResult, DockerComposeConfig } from '../types';
import { ConfigManager } from '../config/ConfigManager';
import logger from '../utils/logger';

const execAsync = promisify(exec);

export class DockerComposeExecutor {
  private configManager: ConfigManager;
  private templatesDir: string;

  constructor() {
    this.configManager = new ConfigManager();
    // Templates are in the package directory
    this.templatesDir = path.join(__dirname, '../../templates');
  }

  /**
   * Check if Docker is installed and running
   */
  async checkDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker --version');
      await execAsync('docker ps');
      logger.debug('Docker is available and running');
      return true;
    } catch (error: any) {
      logger.error('Docker is not available or not running');
      logger.error(error.message);
      return false;
    }
  }

  /**
   * Execute provisioning task
   */
  async executeTask(task: ProvisioningTask): Promise<TaskExecutionResult> {
    try {
      logger.info(`Executing task ${task.task_id} for resource: ${task.resource_name}`);

      // Check Docker availability
      const dockerAvailable = await this.checkDockerAvailable();
      if (!dockerAvailable) {
        return {
          success: false,
          error: 'Docker is not available or not running. Please install Docker and ensure it is running.',
        };
      }

      // Get task directory
      const taskDir = this.configManager.getTaskDir(task.task_id);
      logger.debug(`Task directory: ${taskDir}`);

      // Get docker-compose.yml content from task config (single source of truth: engineering-standards repo)
      const composeContent = this.getDockerComposeContent(task);
      const composePath = path.join(taskDir, 'docker-compose.yml');

      // Write docker-compose.yml
      fs.writeFileSync(composePath, composeContent, 'utf-8');
      logger.info(`Docker Compose file written to: ${composePath}`);

      // Execute docker-compose up
      const result = await this.dockerComposeUp(taskDir, task.resource_name);

      return result;
    } catch (error: any) {
      logger.error(`Task execution failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        logs: error.stack,
      };
    }
  }

  /**
   * Get docker-compose.yml content from task config
   * The content is pre-rendered by the Backstage scaffolder template
   * Single source of truth: engineering-standards repository
   */
  private getDockerComposeContent(task: ProvisioningTask): string {
    if (task.config.dockerCompose) {
      logger.debug('Using pre-rendered docker-compose.yml from task config');
      return task.config.dockerCompose;
    }

    // Fallback: Check if local templates exist (for backward compatibility)
    const templateName = this.getTemplateForTaskType(task.task_type);
    const templatePath = path.join(this.templatesDir, templateName, 'docker-compose.yml');

    if (fs.existsSync(templatePath)) {
      logger.warn('DEPRECATED: Using local template. Templates should be in engineering-standards repo.');
      const template = fs.readFileSync(templatePath, 'utf-8');

      // Render with Mustache if template exists
      const templateData: DockerComposeConfig = {
        resourceName: task.resource_name,
        kafkaVersion: task.config.kafkaVersion || '7.5.0',
        port: task.config.port || 9092,
        zookeeperPort: task.config.zookeeperPort || 2181,
        uiPort: task.config.uiPort || 8080,
        autoCreateTopics: task.config.autoCreateTopics !== undefined ? task.config.autoCreateTopics : true,
        numPartitions: task.config.numPartitions || 3,
        replicationFactor: task.config.replicationFactor || 1,
        ...task.config,
      };

      return Mustache.render(template, templateData);
    }

    throw new Error(
      'No docker-compose.yml found in task config. ' +
      'Templates must be defined in engineering-standards repository and passed via scaffolder.'
    );
  }

  /**
   * Execute docker-compose up -d
   */
  private async dockerComposeUp(
    taskDir: string,
    resourceName: string
  ): Promise<TaskExecutionResult> {
    try {
      logger.info(`Starting Docker Compose for resource: ${resourceName}`);

      // Execute docker-compose up -d
      const { stdout, stderr } = await execAsync('docker-compose up -d', {
        cwd: taskDir,
      });

      logger.info(`Docker Compose output:\n${stdout}`);
      if (stderr) {
        logger.warn(`Docker Compose warnings:\n${stderr}`);
      }

      // Validate containers are running
      const containersRunning = await this.validateContainers(taskDir);

      if (!containersRunning) {
        throw new Error('Docker containers failed to start');
      }

      // Get container info
      const containerInfo = await this.getContainerInfo(taskDir);

      return {
        success: true,
        metadata: {
          resourceName,
          containers: containerInfo,
          directory: taskDir,
        },
        logs: stdout,
      };
    } catch (error: any) {
      logger.error(`Docker Compose execution failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        logs: error.stderr || error.stdout || error.stack,
      };
    }
  }

  /**
   * Validate that containers are running
   */
  private async validateContainers(taskDir: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('docker-compose ps --format json', {
        cwd: taskDir,
      });

      // Parse container status
      const containers = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));

      const allRunning = containers.every(
        (container: any) => container.State === 'running'
      );

      if (allRunning) {
        logger.info(`All ${containers.length} containers are running`);
      } else {
        logger.error('Some containers are not running');
      }

      return allRunning;
    } catch (error: any) {
      logger.error(`Failed to validate containers: ${error.message}`);
      return false;
    }
  }

  /**
   * Get container information
   */
  private async getContainerInfo(taskDir: string): Promise<any[]> {
    try {
      const { stdout } = await execAsync('docker-compose ps --format json', {
        cwd: taskDir,
      });

      const containers = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));

      return containers;
    } catch (error: any) {
      logger.warn(`Failed to get container info: ${error.message}`);
      return [];
    }
  }

  /**
   * Get template name for task type
   */
  private getTemplateForTaskType(taskType: string): string {
    const templateMap: Record<string, string> = {
      'provision-kafka': 'kafka',
      'provision-postgres': 'postgres',
      'provision-redis': 'redis',
      'provision-mongodb': 'mongodb',
    };

    return templateMap[taskType] || 'kafka';
  }

  /**
   * Stop and remove containers for a task
   */
  async cleanupTask(taskId: string): Promise<void> {
    try {
      const taskDir = this.configManager.getTaskDir(taskId);

      if (!fs.existsSync(taskDir)) {
        logger.warn(`Task directory not found: ${taskDir}`);
        return;
      }

      logger.info(`Cleaning up task ${taskId}`);
      await execAsync('docker-compose down -v', { cwd: taskDir });
      logger.info('Task cleanup completed');
    } catch (error: any) {
      logger.error(`Task cleanup failed: ${error.message}`);
    }
  }
}
