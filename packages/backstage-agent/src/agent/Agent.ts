/**
 * Main Agent class that coordinates all components
 * Connects to Backstage backend, receives tasks, executes them, and reports status
 */

import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DockerComposeExecutor } from '../executor/DockerComposeExecutor';
import { MultipassExecutor } from '../executor/MultipassExecutor';
import { ConfigManager } from '../config/ConfigManager';
import { ensureWorkspace, WorkspaceResult } from '../executor/workspaceClone';
import { capabilitiesQuery, getCapabilities } from '../utils/capabilities';
import { LocalResourceRegistry } from '../registry/LocalResourceRegistry';
import { OutboxQueue } from '../registry/OutboxQueue';
import {
  AgentTaskEvent,
  TaskStatus,
  TaskType,
  ProvisioningTask,
  TaskExecutionResult,
  isLifecycleTask,
} from '../types';
import logger from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { AGENT_VERSION } from '../utils/version';
import { recordContact, recordPollError, recordStart, describePollError } from '../utils/connectionState';
import { clearRunning, INTERRUPTED_MESSAGE, markRunning, takeInterrupted } from '../utils/runningTasks';
import { throttledReporter } from '../executor/progress';

// Bounded well under Cloudflare's ~100s ceiling on how long it holds a connection open
// waiting for an origin response — must match (or stay under) the backend's own
// localProvisioner.pollTimeoutSeconds; the server times out and responds empty at its own
// limit regardless, but keeping this the same avoids a client-side abort racing a real
// response.
const POLL_TIMEOUT_MS = 25_000;
// After a poll fails (network error, non-2xx, timeout not from our own AbortSignal), wait
// this long before retrying — avoids hammering a genuinely-down server in a tight loop.
const POLL_RETRY_DELAY_MS = 5_000;

export class Agent {
  private executor: DockerComposeExecutor;
  /** VM labs (Linux capstone). Lifecycle ops route here when the target task is a VM. */
  private vm: MultipassExecutor;
  private registry: LocalResourceRegistry;
  private outbox: OutboxQueue;
  private backstageUrl: string;
  private agentId: string;
  private serviceToken: string;
  // Task IDs currently being processed — dedups in case a task somehow shows up in more than
  // one poll response (shouldn't happen, but cheap to guard).
  private processing = new Set<string>();
  private pidFile: string;
  private polling = false;
  private pollAbortController: AbortController | null = null;

  constructor(backstageUrl: string, agentId: string, serviceToken: string) {
    this.backstageUrl = backstageUrl.replace(/\/$/, '');
    this.agentId = agentId;
    this.serviceToken = serviceToken;
    this.executor = new DockerComposeExecutor();
    this.vm = new MultipassExecutor(new ConfigManager());
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

    // Long-polling is the single mechanism for task delivery, the shutdown signal, and
    // liveness — replaces SSE + the separate heartbeat entirely. SSE required one persistent
    // connection held open indefinitely, which the Cloudflare tunnel does not reliably keep
    // alive (a wedged/dropped SSE stream could silently never deliver a task or the disconnect
    // signal, even though the server "sent" it successfully — found 2026-07-26). Long-polling
    // uses many short-lived requests instead, each bounded by POLL_TIMEOUT_MS, so there is no
    // long-lived connection state to silently lose: a request either gets its answer or times
    // out and is immediately reissued. The first iteration of this loop covers what the old
    // startup check did (pick up anything already pending) — no separate call needed.
    recordStart();
    // Anything the previous run was in the middle of will never finish: say so in the portal.
    for (const t of takeInterrupted()) {
      logger.warn(`Task ${t.taskId} (${t.resourceName ?? 'unknown'}) was interrupted by the last agent stop; reporting it failed`);
      await this.updateTaskStatus(t.taskId, TaskStatus.FAILED, undefined, INTERRUPTED_MESSAGE).catch(() => undefined);
    }
    this.polling = true;
    this.pollLoop();

    logger.info('Agent started successfully. Waiting for tasks...');
  }

  /**
   * Continuously long-poll for work. Each call either returns promptly (something was already
   * pending, or notifyAgent woke it server-side) or after POLL_TIMEOUT_MS with an empty
   * result — either way, immediately reissue. On failure (network error, non-2xx), back off
   * POLL_RETRY_DELAY_MS before retrying so a genuinely-down server isn't hammered.
   */
  private async pollLoop(): Promise<void> {
    while (this.polling) {
      this.pollAbortController = new AbortController();
      try {
        // version: lets the portal know what this agent supports (e.g. run-check needs ≥ 0.1.23)
        // and picks up a `backstage-agent update` without a re-login.
        // capabilities: arch + Docker's memory/CPUs, so labs can refuse early with a fix.
        const caps = capabilitiesQuery(await getCapabilities());
        const url = `${this.backstageUrl}/api/local-provisioner/agent/poll?agentId=${encodeURIComponent(this.agentId)}&version=${encodeURIComponent(AGENT_VERSION)}&${caps}`;
        const timeout = setTimeout(() => this.pollAbortController?.abort(), POLL_TIMEOUT_MS + 5_000);
        let response;
        try {
          response = await fetch(url, {
            headers: { Authorization: `Bearer ${this.serviceToken}` },
            signal: this.pollAbortController.signal as any,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          if (response.status === 401) {
            logger.error('Service token invalid or expired — run "backstage-agent login" again');
            this.polling = false;
            process.exit(1);
          }
          logger.warn(`Poll failed: ${response.status}`);
          recordPollError(`The portal answered ${response.status}`);
          await this.delay(POLL_RETRY_DELAY_MS);
          continue;
        }

        recordContact();
        // A live connection just proved we're online — drain anything queued while offline.
        if (this.outbox.size() > 0) {
          await this.outbox.flush((taskId, body) => this.sendStatus(taskId, body));
        }

        const body = (await response.json()) as { tasks?: any[]; shouldShutdown?: boolean };
        for (const t of body.tasks || []) {
          if (this.processing.has(t.task_id)) continue;
          logger.info(`Picked up task ${t.task_id} via poll`);
          this.handleTask({ taskId: t.task_id, type: t.task_type, resourceName: t.resource_name, config: t.config || {} }).catch(
            err => logger.error(`Task ${t.task_id} failed: ${err.message}`),
          );
        }

        if (body.shouldShutdown) {
          logger.info('Server requested shutdown (Stop Agent). Stopping...');
          this.polling = false;
          process.kill(process.pid, 'SIGTERM');
        }
      } catch (error: any) {
        if (error.name === 'AbortError' && !this.polling) {
          // Our own stop() aborted the in-flight poll — not a failure, just exit the loop.
          break;
        }
        logger.warn(`Poll error (offline?): ${error.message}`);
        recordPollError(describePollError(error, this.backstageUrl));
        await this.delay(POLL_RETRY_DELAY_MS);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handle incoming task
   */
  private async handleTask(taskEvent: AgentTaskEvent): Promise<void> {
    const taskId = taskEvent.taskId;

    // Dedup: SSE and polling can both deliver the same task; run it once.
    if (this.processing.has(taskId)) {
      logger.debug(`Task ${taskId} already being processed, skipping duplicate`);
      return;
    }
    this.processing.add(taskId);
    markRunning(taskId, taskEvent.resourceName || taskEvent.config.resourceName || '');

    try {
      logger.info(`Processing task ${taskId} (${taskEvent.type})`);
      await this.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);

      const task: ProvisioningTask = {
        task_id: taskId,
        agent_id: this.agentId,
        user_id: '',
        task_type: taskEvent.type,
        // The portal's name for the resource: what the trainee sees, the VM's name, and the key the
        // offline `resources` commands (and Stop/Remove from the portal) use.
        resource_name: taskEvent.resourceName || taskEvent.config.resourceName || `resource-${taskId}`,
        config: taskEvent.config,
        status: TaskStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
      };

      const result = await this.dispatch(taskEvent.type, task, taskEvent.config);

      // Auto-clone the trainee's companion repo after a successful provision (never for lifecycle
      // ops, never fails the task). The portal shows "Your code: <path>" from metadata.workspace.
      if (result.success && !isLifecycleTask(taskEvent.type)) {
        const repoUrl = taskEvent.config.githubRepoUrl || taskEvent.config.gitlabRepoUrl;
        if (repoUrl && taskEvent.config.autoClone !== false) {
          const workspace: WorkspaceResult = await ensureWorkspace(repoUrl).catch(
            (e: any): WorkspaceResult => ({ status: 'failed', repoUrl, error: e.message }),
          );
          logger.info(`Workspace for ${task.resource_name}: ${workspace.status}${workspace.path ? ` → ${workspace.path}` : ''}`);
          result.metadata = { ...(result.metadata ?? {}), workspace };
        }
      }

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
      clearRunning(taskId);
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
      if (this.vm.isVmTask(targetTaskId)) {
        switch (taskType) {
          case TaskType.DEPROVISION:
            return this.vm.cleanupTask(targetTaskId);
          case TaskType.STOP:
            return this.vm.stopResource(targetTaskId);
          case TaskType.START:
            return this.vm.startResource(targetTaskId);
          case TaskType.RESTART:
            return this.vm.restartResource(targetTaskId);
          case TaskType.RUN_CHECK:
            return config.job ? this.vm.runJob(targetTaskId, config.job) : { success: false, error: 'VM labs support job checks only' };
          default:
            return { success: false, error: `Unknown lifecycle task type: ${taskType}` };
        }
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
        case TaskType.RUN_CHECK:
          return config.job
            ? this.executor.runJob(targetTaskId, config.job)
            : this.executor.runCheck(targetTaskId, config.service, config.argv, config.timeoutMs);
        default:
          return { success: false, error: `Unknown lifecycle task type: ${taskType}` };
      }
    }

    // Every step goes to the portal's activity timeline at once; percent/output updates within a
    // step at most every 3 s (a seed or build prints thousands of lines).
    const progress = throttledReporter((phase, detail) => {
      this.updateTaskStatus(task.task_id, TaskStatus.IN_PROGRESS, { phase, ...detail }).catch(() => undefined);
    });
    // VM labs (config.executor = multipass): an Ubuntu VM instead of Docker Compose.
    if (config.executor === 'multipass') return this.vm.executeTask(task, progress);
    return this.executor.executeTask(task, progress);
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
   * Stop the agent
   */
  async stop(): Promise<void> {
    logger.info('Stopping agent...');

    // Stop the poll loop. Setting the flag first means the AbortError this triggers is
    // recognized as an intentional stop rather than a real failure (see pollLoop's catch).
    this.polling = false;
    this.pollAbortController?.abort();

    // Remove PID file
    this.removePidFile();

    logger.info('Agent stopped');
  }

}
