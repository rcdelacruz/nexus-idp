/**
 * Database access layer for provisioning tasks and agent registrations
 */

import { Knex } from 'knex';
import {
  ProvisioningTask,
  AgentRegistration,
  TaskStatus,
  CreateTaskRequest,
} from '../types';

/**
 * TaskStore handles all database operations for provisioning tasks and agents
 */
export class TaskStore {
  constructor(private readonly db: Knex) {}

  /**
   * Create a new provisioning task
   */
  async createTask(
    userId: string,
    request: CreateTaskRequest,
  ): Promise<ProvisioningTask> {
    const [task] = await this.db('provisioning_tasks')
      .insert({
        agent_id: request.agent_id,
        user_id: userId,
        task_type: request.task_type,
        resource_name: request.resource_name,
        config: JSON.stringify(request.config),
        status: TaskStatus.PENDING,
      })
      .returning('*');

    return this.mapTaskFromDb(task);
  }

  /**
   * Get task by ID
   */
  async getTaskById(taskId: string): Promise<ProvisioningTask | null> {
    const task = await this.db('provisioning_tasks')
      .where({ task_id: taskId })
      .first();

    return task ? this.mapTaskFromDb(task) : null;
  }

  /**
   * Get all tasks for a user
   */
  async getTasksByUser(userId: string): Promise<ProvisioningTask[]> {
    const tasks = await this.db('provisioning_tasks')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc');

    return tasks.map(task => this.mapTaskFromDb(task));
  }

  /**
   * Get pending tasks for a specific agent
   */
  async getPendingTasksForAgent(agentId: string): Promise<ProvisioningTask[]> {
    const tasks = await this.db('provisioning_tasks')
      .where({
        agent_id: agentId,
        status: TaskStatus.PENDING,
      })
      .orderBy('created_at', 'asc');

    return tasks.map(task => this.mapTaskFromDb(task));
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
    const updateData: any = {
      status,
      updated_at: this.db.fn.now(),
    };

    if (status === TaskStatus.IN_PROGRESS && !metadata) {
      updateData.started_at = this.db.fn.now();
    }

    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
      updateData.completed_at = this.db.fn.now();
    }

    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    if (metadata && metadata.catalogEntityRef) {
      updateData.catalog_entity_ref = metadata.catalogEntityRef;
    }

    await this.db('provisioning_tasks')
      .where({ task_id: taskId })
      .update(updateData);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.db('provisioning_tasks')
      .where({ task_id: taskId })
      .delete();
  }

  /**
   * Register a new agent
   */
  async registerAgent(
    userId: string,
    machineName?: string,
    osPlatform?: string,
    agentVersion?: string,
  ): Promise<AgentRegistration> {
    const [agent] = await this.db('agent_registrations')
      .insert({
        user_id: userId,
        machine_name: machineName,
        os_platform: osPlatform,
        agent_version: agentVersion,
      })
      .returning('*');

    return this.mapAgentFromDb(agent);
  }

  /**
   * Upsert agent with machine-based ID
   * If agent exists (by agent_id), update it. Otherwise, insert new agent.
   */
  async upsertAgent(
    agentId: string,
    userId: string,
    hostname: string,
    platform: string,
    platformVersion: string,
    machineName?: string,
    agentVersion?: string,
  ): Promise<{ agent: AgentRegistration; reconnected: boolean }> {
    // Check if agent already exists
    const existing = await this.getAgentById(agentId);

    if (existing) {
      // Update existing agent
      await this.db('agent_registrations')
        .where({ agent_id: agentId })
        .update({
          hostname,
          os_platform: platform,
          platform_version: platformVersion,
          machine_name: machineName,
          agent_version: agentVersion,
          last_seen: this.db.fn.now(),
        });

      const updated = await this.getAgentById(agentId);
      return {
        agent: updated!,
        reconnected: true,
      };
    }

    // Insert new agent with custom agent_id
    const [agent] = await this.db('agent_registrations')
      .insert({
        agent_id: agentId, // Custom machine-based ID from CLI
        user_id: userId,
        hostname,
        os_platform: platform,
        platform_version: platformVersion,
        machine_name: machineName,
        agent_version: agentVersion,
      })
      .returning('*');

    return {
      agent: this.mapAgentFromDb(agent),
      reconnected: false,
    };
  }

  /**
   * Get agent by ID
   */
  async getAgentById(agentId: string): Promise<AgentRegistration | null> {
    const agent = await this.db('agent_registrations')
      .where({ agent_id: agentId })
      .first();

    return agent ? this.mapAgentFromDb(agent) : null;
  }

  /**
   * Get all agents for a user
   */
  async getAgentsByUser(userId: string): Promise<AgentRegistration[]> {
    const agents = await this.db('agent_registrations')
      .where({ user_id: userId })
      .orderBy('last_seen', 'desc');

    return agents.map(agent => this.mapAgentFromDb(agent));
  }

  /**
   * Update agent last seen timestamp
   */
  async updateAgentLastSeen(agentId: string): Promise<void> {
    await this.db('agent_registrations')
      .where({ agent_id: agentId })
      .update({
        last_seen: this.db.fn.now(),
      });
  }

  /**
   * Delete agent from database
   */
  async deleteAgent(agentId: string): Promise<void> {
    await this.db('agent_registrations')
      .where({ agent_id: agentId })
      .delete();
  }

  /**
   * Delete old completed/failed tasks based on retention period
   */
  async cleanupOldTasks(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deleted = await this.db('provisioning_tasks')
      .whereIn('status', [TaskStatus.COMPLETED, TaskStatus.FAILED])
      .where('completed_at', '<', cutoffDate)
      .delete();

    return deleted;
  }

  /**
   * Map database row to ProvisioningTask
   */
  private mapTaskFromDb(row: any): ProvisioningTask {
    return {
      task_id: row.task_id,
      agent_id: row.agent_id,
      user_id: row.user_id,
      task_type: row.task_type,
      resource_name: row.resource_name,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      status: row.status,
      catalog_entity_ref: row.catalog_entity_ref,
      error_message: row.error_message,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      started_at: row.started_at ? new Date(row.started_at) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  /**
   * Map database row to AgentRegistration
   */
  private mapAgentFromDb(row: any): AgentRegistration {
    return {
      agent_id: row.agent_id,
      user_id: row.user_id,
      hostname: row.hostname,
      machine_name: row.machine_name,
      os_platform: row.os_platform,
      platform_version: row.platform_version,
      agent_version: row.agent_version,
      last_seen: new Date(row.last_seen),
      created_at: new Date(row.created_at),
    };
  }
}
