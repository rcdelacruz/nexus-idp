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
import { LocalResourceRegistry } from '../registry/LocalResourceRegistry';
import { OutboxQueue } from '../registry/OutboxQueue';
import {
  SSETaskEvent,
  TaskStatus,
  TaskType,
  ProvisioningTask,
  TaskExecutionResult,
  isLifecycleTask,
} from '../types';
import logger from '../utils/logger';

export class Agent {
  private sseClient: SSEClient | null = null;
  private executor: DockerComposeExecutor;
  private registry: LocalResourceRegistry;
  private outbox: OutboxQueue;
  private backstageUrl: string;
  private agentId: string;
  private serviceToken: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  // Task IDs currently being processed — dedups delivery via SSE, heartbeat, or the startup
  // check so a task never runs twice.
  private processing = new Set<string>();
  private pidFile: string;

  constructor(backstageUrl: string, agentId: string, serviceToken: string) {
    this.backstageUrl = backstageUrl.replace(/\/$/, '');
    this.agentId = agentId;
    this.serviceToken = serviceToken;
    this.executor = new DockerComposeExecutor();
    this.registry = new LocalResourceRegistry();
    this.outbox = new OutboxQueue();
    this.pidFile = path.join(os.homedir(), '.backstage-agent', 'agent.pid');
  }

  /**
   * Record the resource in the local (offline-usable) registry so it can be listed and managed
   * with the `resources` / `resource` CLI commands even when the portal is unreachable.
   */
  private recordResource(
    taskType: string,
    task: ProvisioningTask,
    result: TaskExecutionResult,
  ): void {
    try {
      const targetName: string = task.config.targetResourceName || task.resource_name;
      if (taskType === TaskType.DEPROVISION) {
        this.registry.remove(targetName);
        return;
      }
      if (taskType === TaskType.STOP) {
        this.registry.setState(targetName, 'stopped');
        return;
      }
      if (taskType === TaskType.START || taskType === TaskType.RESTART) {
        this.registry.setState(targetName, 'running');
        return;
      }
      // Provision
      this.registry.upsert({
        resourceName: task.resource_name,
        taskType,
        taskId: task.task_id,
        taskDir: path.join(os.homedir(), '.backstage-agent', 'tasks', task.task_id),
        state: 'running',
        ports: result.connectionDetails?.ports,
        connectionDetails: result.connectionDetails,
        provisionedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.warn(`Failed to update local resource registry: ${error.message}`);
    }
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

    // Start heartbeat — task delivery is folded into the heartbeat response (see sendHeartbeat),
    // so there is no separate polling loop. This is the cheapest, most proxy-friendly design:
    // one short request/response every 30s carries both liveness and pending tasks.
    this.startHeartbeat();

    // One immediate check on startup so a task queued before this agent connected starts right
    // away instead of waiting for the first heartbeat tick.
    this.checkPendingOnce();

    logger.info('Agent started successfully. Waiting for tasks...');
  }

  /** One-shot check for pending tasks (startup only). Steady-state delivery is via heartbeat. */
  private async checkPendingOnce(): Promise<void> {
    try {
      const url = `${this.backstageUrl}/api/local-provisioner/agent/tasks/pending?agentId=${encodeURIComponent(this.agentId)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.serviceToken}` } });
      if (!res.ok) return;
      const body = (await res.json()) as { tasks?: any[] };
      for (const t of body.tasks || []) {
        if (this.processing.has(t.task_id)) continue;
        logger.info(`Picked up task ${t.task_id} on startup`);
        this.handleTask({ taskId: t.task_id, type: t.task_type, config: t.config || {} }).catch(
          err => logger.error(`Task ${t.task_id} failed: ${err.message}`),
        );
      }
    } catch (error: any) {
      logger.debug(`Startup task check failed (offline?): ${error.message}`);
    }
  }

  /**
   * Handle incoming task
   */
  private async handleTask(taskEvent: SSETaskEvent): Promise<void> {
    const taskId = taskEvent.taskId;

    // Dedup: SSE and polling can both deliver the same task; run it once.
    if (this.processing.has(taskId)) {
      logger.debug(`Task ${taskId} already being processed, skipping duplicate`);
      return;
    }
    this.processing.add(taskId);

    try {
      logger.info(`Processing task ${taskId} (${taskEvent.type})`);
      await this.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);

      const task: ProvisioningTask = {
        task_id: taskId,
        agent_id: this.agentId,
        user_id: '',
        task_type: taskEvent.type,
        resource_name: taskEvent.config.resourceName || `resource-${taskId}`,
        config: taskEvent.config,
        status: TaskStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
      };

      const result = await this.dispatch(taskEvent.type, task, taskEvent.config);

      if (result.success) {
        logger.info(`Task ${taskId} completed successfully`);
        this.recordResource(taskEvent.type, task, result);
        await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, result.metadata, undefined, {
          connectionDetails: result.connectionDetails,
          logs: result.logs,
        });
      } else {
        logger.error(`Task ${taskId} failed: ${result.error}`);
        await this.updateTaskStatus(taskId, TaskStatus.FAILED, undefined, result.error, {
          logs: result.logs,
        });
      }
    } catch (error: any) {
      logger.error(`Task ${taskId} execution error: ${error.message}`);
      await this.updateTaskStatus(taskId, TaskStatus.FAILED, undefined, error.message);
    } finally {
      this.processing.delete(taskId);
    }
  }

  /**
   * Dispatch a task to the right executor operation by type. Provision runs the full
   * pull+up flow with progress reporting; lifecycle ops (deprovision/stop/start/restart) act on
   * the target resource's provision task directory (config.targetTaskId).
   */
  private async dispatch(
    taskType: string,
    task: ProvisioningTask,
    config: Record<string, any>,
  ): Promise<TaskExecutionResult> {
    const targetTaskId: string | undefined = config.targetTaskId;

    if (isLifecycleTask(taskType)) {
      if (!targetTaskId) {
        return { success: false, error: `${taskType} requires config.targetTaskId` };
      }
      switch (taskType) {
        case TaskType.DEPROVISION:
          return this.executor.cleanupTask(targetTaskId);
        case TaskType.STOP:
          return this.executor.stopResource(targetTaskId);
        case TaskType.START:
          return this.executor.startResource(targetTaskId);
        case TaskType.RESTART:
          return this.executor.restartResource(targetTaskId);
        default:
          return { success: false, error: `Unknown lifecycle task type: ${taskType}` };
      }
    }

    // Provision: stream interim progress to the portal so slow pulls don't look stuck.
    return this.executor.executeTask(task, (phase, detail) => {
      this.updateTaskStatus(task.task_id, TaskStatus.IN_PROGRESS, { phase, ...detail }).catch(
        () => undefined,
      );
    });
  }

  /**
   * Update task status in backend. Extra fields (connectionDetails, logs) are persisted so the
   * UI can show "how to connect" and live output.
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    metadata?: Record<string, any>,
    errorMessage?: string,
    extra?: { connectionDetails?: Record<string, any>; logs?: string },
  ): Promise<void> {
    const body: any = { status };
    if (metadata) body.metadata = metadata;
    if (errorMessage) body.error = errorMessage;
    if (extra?.connectionDetails) body.connectionDetails = extra.connectionDetails;
    if (extra?.logs) body.logs = extra.logs;

    const delivered = await this.sendStatus(taskId, body);
    if (!delivered) {
      // Portal unreachable — queue so the completion isn't lost; flushed on the next heartbeat.
      this.outbox.enqueue(taskId, body);
    }
  }

  /** POST a status update. Returns true if delivered, false if the portal is unreachable. */
  private async sendStatus(taskId: string, body: Record<string, any>): Promise<boolean> {
    try {
      const url = `${this.backstageUrl}/api/local-provisioner/agent/tasks/${taskId}/status`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (response.status === 401) {
          logger.error('Service token invalid or expired — run "backstage-agent login" again');
          return true;
        }
        // A 4xx is a real rejection (not offline) — don't queue those forever.
        if (response.status >= 400 && response.status < 500) {
          logger.error(`Status update rejected for task ${taskId}: ${response.status}`);
          return true;
        }
        return false;
      }
      logger.debug(`Task ${taskId} status updated`);
      return true;
    } catch (error: any) {
      logger.warn(`Status update could not be delivered (offline?): ${error.message}`);
      return false;
    }
  }

  /**
   * Send heartbeat to backend
   */
  private async sendHeartbeat(): Promise<void> {
    let online = false;
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
        if (response.status === 401) {
          logger.error('Service token invalid or expired — run "backstage-agent login" again');
        } else {
          logger.warn(`Heartbeat failed: ${response.status}`);
        }
      } else {
        online = true;
        logger.debug('Heartbeat sent successfully');
        // Task delivery is folded into the heartbeat response — no separate poll needed.
        // This is a short request/response that works through proxies (SSE does not) and adds
        // zero extra requests.
        try {
          const body = (await response.json()) as { tasks?: any[] };
          for (const t of body.tasks || []) {
            if (this.processing.has(t.task_id)) continue;
            logger.info(`Picked up task ${t.task_id} via heartbeat`);
            this.handleTask({
              taskId: t.task_id,
              type: t.task_type,
              config: t.config || {},
            }).catch(err => logger.error(`Task ${t.task_id} failed: ${err.message}`));
          }
        } catch {
          // ignore malformed body — heartbeat itself still succeeded
        }
      }
    } catch (error: any) {
      logger.warn(`Heartbeat error (offline?): ${error.message}`);
    }

    // When connectivity is confirmed, drain any status updates queued while offline.
    if (online && this.outbox.size() > 0) {
      await this.outbox.flush((taskId, body) => this.sendStatus(taskId, body));
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
