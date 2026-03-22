/**
 * Main Agent class that coordinates all components
 * Connects to Backstage backend, receives tasks, executes them, and reports status
 */

import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SSEClient } from './SSEClient';
import { DockerComposeExecutor } from '../executor/DockerComposeExecutor';
import { SSETaskEvent, TaskStatus, ProvisioningTask } from '../types';
import logger from '../utils/logger';

export class Agent {
  private sseClient: SSEClient | null = null;
  private executor: DockerComposeExecutor;
  private backstageUrl: string;
  private agentId: string;
  private serviceToken: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pidFile: string;

  constructor(backstageUrl: string, agentId: string, serviceToken: string) {
    this.backstageUrl = backstageUrl.replace(/\/$/, '');
    this.agentId = agentId;
    this.serviceToken = serviceToken;
    this.executor = new DockerComposeExecutor();
    this.pidFile = path.join(os.homedir(), '.backstage-agent', 'agent.pid');
  }

  /**
   * Write PID file for process management
   */
  private writePidFile(): void {
    try {
      const pidDir = path.dirname(this.pidFile);
      if (!fs.existsSync(pidDir)) {
        fs.mkdirSync(pidDir, { recursive: true });
      }
      fs.writeFileSync(this.pidFile, process.pid.toString(), 'utf-8');
      logger.debug(`PID file written: ${this.pidFile}`);
    } catch (error: any) {
      logger.warn(`Failed to write PID file: ${error.message}`);
    }
  }

  /**
   * Remove PID file
   */
  private removePidFile(): void {
    try {
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
        logger.debug('PID file removed');
      }
    } catch (error: any) {
      logger.warn(`Failed to remove PID file: ${error.message}`);
    }
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    logger.info(`Starting Backstage Agent ${this.agentId}`);
    logger.info(`Backstage URL: ${this.backstageUrl}`);

    // Write PID file for process management
    this.writePidFile();

    // Check Docker availability
    const dockerAvailable = await this.executor.checkDockerAvailable();
    if (!dockerAvailable) {
      logger.error('Docker is not available. Please install Docker and ensure it is running.');
      this.removePidFile();
      process.exit(1);
    }

    // Agent is already registered during login/device code flow
    // No need to register again here

    // Connect to SSE endpoint
    this.sseClient = new SSEClient(
      this.backstageUrl,
      this.agentId,
      this.serviceToken
    );

    this.sseClient.connect(async (task) => {
      await this.handleTask(task);
    });

    // Start heartbeat
    this.startHeartbeat();

    logger.info('Agent started successfully. Waiting for tasks...');
  }

  /**
   * Handle incoming task
   */
  private async handleTask(taskEvent: SSETaskEvent): Promise<void> {
    const taskId = taskEvent.taskId;

    try {
      logger.info(`Processing task ${taskId}`);

      // Update task status to in-progress
      await this.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);

      // Convert SSE event to ProvisioningTask
      const task: ProvisioningTask = {
        task_id: taskId,
        agent_id: this.agentId,
        user_id: '', // Not needed for execution
        task_type: taskEvent.type,
        resource_name: taskEvent.config.resourceName || `resource-${taskId}`,
        config: taskEvent.config,
        status: TaskStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
      };

      // Execute task
      const result = await this.executor.executeTask(task);

      if (result.success) {
        logger.info(`Task ${taskId} completed successfully`);
        await this.updateTaskStatus(
          taskId,
          TaskStatus.COMPLETED,
          result.metadata
        );
      } else {
        logger.error(`Task ${taskId} failed: ${result.error}`);
        await this.updateTaskStatus(
          taskId,
          TaskStatus.FAILED,
          undefined,
          result.error
        );
      }
    } catch (error: any) {
      logger.error(`Task ${taskId} execution error: ${error.message}`);
      await this.updateTaskStatus(
        taskId,
        TaskStatus.FAILED,
        undefined,
        error.message
      );
    }
  }

  /**
   * Update task status in backend
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    metadata?: Record<string, any>,
    errorMessage?: string
  ): Promise<void> {
    try {
      const url = `${this.backstageUrl}/api/local-provisioner/agent/tasks/${taskId}/status`;

      const body: any = { status };
      if (metadata) {
        body.metadata = metadata;
      }
      if (errorMessage) {
        body.error = errorMessage;
      }

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`Failed to update task status: ${response.status} ${error}`);
      } else {
        logger.debug(`Task ${taskId} status updated to ${status}`);
      }
    } catch (error: any) {
      logger.error(`Failed to update task status: ${error.message}`);
    }
  }

  /**
   * Send heartbeat to backend
   */
  private async sendHeartbeat(): Promise<void> {
    try {
      const url = `${this.backstageUrl}/api/local-provisioner/agent/heartbeat`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
        },
        body: JSON.stringify({ agentId: this.agentId }),
      });

      if (!response.ok) {
        logger.warn(`Heartbeat failed: ${response.status}`);
      } else {
        logger.debug('Heartbeat sent successfully');
      }
    } catch (error: any) {
      logger.warn(`Heartbeat error: ${error.message}`);
    }
  }

  /**
   * Start heartbeat interval (every 30 seconds)
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);

    // Send initial heartbeat
    this.sendHeartbeat();
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    logger.info('Stopping agent...');

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Disconnect SSE
    if (this.sseClient) {
      this.sseClient.disconnect();
      this.sseClient = null;
    }

    // Remove PID file
    this.removePidFile();

    logger.info('Agent stopped');
  }

}
