/**
 * Business logic for task queue management
 */

import { LoggerService } from '@backstage/backend-plugin-api';
import { TaskStore } from '../database/TaskStore';
import {
  ProvisioningTask,
  TaskStatus,
  CreateTaskRequest,
} from '../types';

/**
 * TaskQueueService manages the provisioning task queue
 */
export class TaskQueueService {
  constructor(
    private readonly logger: LoggerService,
    private readonly taskStore: TaskStore,
  ) {}

  /**
   * Create a new provisioning task
   */
  async createTask(
    userId: string,
    request: CreateTaskRequest,
  ): Promise<ProvisioningTask> {
    this.logger.info('Creating provisioning task', {
      userId,
      taskType: request.task_type,
      resourceName: request.resource_name,
      agentId: request.agent_id,
    });

    const task = await this.taskStore.createTask(userId, request);

    this.logger.info(`Provisioning task created: ${task.task_id}`, {
      taskId: task.task_id,
      userId,
      taskType: task.task_type,
      resourceName: task.resource_name,
    });

    return task;
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<ProvisioningTask | null> {
    this.logger.debug(`Fetching task: ${taskId}`);
    return this.taskStore.getTaskById(taskId);
  }

  /**
   * Get all tasks for a user
   */
  async getTasksForUser(userId: string): Promise<ProvisioningTask[]> {
    this.logger.debug(`Fetching tasks for user: ${userId}`);
    return this.taskStore.getTasksByUser(userId);
  }

  /**
   * Get pending tasks for a specific agent
   */
  async getPendingTasksForAgent(agentId: string): Promise<ProvisioningTask[]> {
    this.logger.info(`[DB] Querying pending tasks for agent: ${agentId}`, { agentId });
    const tasks = await this.taskStore.getPendingTasksForAgent(agentId);
    this.logger.info(`[DB] Found ${tasks.length} pending tasks for agent ${agentId}`, {
      agentId,
      taskCount: tasks.length,
      taskIds: tasks.map(t => t.task_id),
    });
    return tasks;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    metadata?: Record<string, any>,
    errorMessage?: string,
  ): Promise<void> {
    this.logger.info(`Updating task ${taskId} status to ${status}`, {
      taskId,
      status,
      hasMetadata: !!metadata,
      hasError: !!errorMessage,
    });

    await this.taskStore.updateTaskStatus(taskId, status, metadata, errorMessage);

    if (status === TaskStatus.COMPLETED) {
      this.logger.info(`Task ${taskId} completed successfully`, {
        taskId,
        metadata,
      });
    } else if (status === TaskStatus.FAILED) {
      this.logger.error(`Task ${taskId} failed`, {
        taskId,
        errorMessage,
      });
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string, userId: string): Promise<void> {
    // Verify task belongs to user before deleting
    const task = await this.taskStore.getTaskById(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.user_id !== userId) {
      throw new Error(`Task ${taskId} does not belong to user ${userId}`);
    }

    this.logger.info(`Deleting task: ${taskId}`, {
      taskId,
      userId,
    });

    await this.taskStore.deleteTask(taskId);

    this.logger.info(`Task ${taskId} deleted successfully`);
  }

  /**
   * Clean up old completed/failed tasks
   */
  async cleanupOldTasks(retentionDays: number): Promise<number> {
    this.logger.info(`Starting task cleanup (retention: ${retentionDays} days)`);

    const deletedCount = await this.taskStore.cleanupOldTasks(retentionDays);

    this.logger.info(`Cleaned up ${deletedCount} old tasks`, {
      deletedCount,
      retentionDays,
    });

    return deletedCount;
  }

  /**
   * Get task statistics for a user
   */
  async getTaskStats(userId: string): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  }> {
    const tasks = await this.taskStore.getTasksByUser(userId);

    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === TaskStatus.PENDING).length,
      inProgress: tasks.filter(t => t.status === TaskStatus.IN_PROGRESS).length,
      completed: tasks.filter(t => t.status === TaskStatus.COMPLETED).length,
      failed: tasks.filter(t => t.status === TaskStatus.FAILED).length,
    };
  }
}
