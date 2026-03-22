/**
 * API client for Local Provisioner backend
 *
 * This client handles communication with the backend API and transforms
 * backend responses (snake_case) to frontend types (camelCase).
 *
 * Following Backstage best practices for API client design.
 */

import { DiscoveryApi, IdentityApi } from '@backstage/core-plugin-api';
import { createApiRef } from '@backstage/core-plugin-api';
import {
  ProvisioningTask,
  AgentRegistration,
  TaskStats,
  CreateTaskRequest,
  BackendTaskListResponse,
  BackendProvisioningTask,
  BackendCreateTaskResponse,
  BackendTaskStats,
  BackendAgentRegistration,
} from './types';
import {
  transformTask,
  transformTasks,
  transformAgent,
  transformTaskStats,
} from './transformers';

/**
 * API reference for Local Provisioner service
 */
export const localProvisionerApiRef = createApiRef<LocalProvisionerApi>({
  id: 'plugin.local-provisioner.service',
});

/**
 * Local Provisioner API interface
 */
export interface LocalProvisionerApi {
  getTasks(): Promise<ProvisioningTask[]>;
  getTasksByAgent(agentId: string): Promise<ProvisioningTask[]>;
  getTaskById(taskId: string): Promise<ProvisioningTask>;
  createTask(request: CreateTaskRequest): Promise<ProvisioningTask>;
  deleteTask(taskId: string): Promise<void>;
  getTaskStats(): Promise<TaskStats>;
  getAgentStatus(): Promise<AgentRegistration | null>;
  getAgents(): Promise<AgentRegistration[]>;
  disconnectAgent(agentId: string): Promise<void>;
  revokeAgent(agentId: string): Promise<void>;
}

/**
 * Default implementation of Local Provisioner API client
 */
export class LocalProvisionerClient implements LocalProvisionerApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly identityApi: IdentityApi;

  constructor(options: {
    discoveryApi: DiscoveryApi;
    identityApi: IdentityApi;
  }) {
    this.discoveryApi = options.discoveryApi;
    this.identityApi = options.identityApi;
  }

  private async getBaseUrl(): Promise<string> {
    return await this.discoveryApi.getBaseUrl('local-provisioner');
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    const { token } = await this.identityApi.getCredentials();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Get all tasks for the current user
   *
   * Backend returns: { tasks: BackendProvisioningTask[], total: number }
   * This method transforms to: ProvisioningTask[]
   */
  async getTasks(): Promise<ProvisioningTask[]> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/tasks`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tasks: ${response.statusText}`);
    }

    // Backend returns { tasks, total }
    const data: BackendTaskListResponse = await response.json();

    // Transform backend tasks to frontend tasks
    return transformTasks(data.tasks);
  }

  /**
   * Get a specific task by ID
   *
   * Backend returns: BackendProvisioningTask
   * This method transforms to: ProvisioningTask
   */
  async getTaskById(taskId: string): Promise<ProvisioningTask> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/tasks/${taskId}`, {
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (response.status === 403) {
        throw new Error('Access denied: You do not have permission to view this task');
      }
      throw new Error(`Failed to fetch task: ${response.statusText}`);
    }

    // Backend returns task directly (not wrapped)
    const backendTask: BackendProvisioningTask = await response.json();

    // Transform to frontend type
    return transformTask(backendTask);
  }

  /**
   * Create a new provisioning task
   *
   * Backend returns: { task_id, message, task: BackendProvisioningTask }
   * This method transforms to: ProvisioningTask
   */
  async createTask(request: CreateTaskRequest): Promise<ProvisioningTask> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      if (response.status === 400) {
        const error = await response.json();
        throw new Error(error.error || 'Invalid request');
      }
      throw new Error(`Failed to create task: ${response.statusText}`);
    }

    // Backend returns { task_id, message, task }
    const data: BackendCreateTaskResponse = await response.json();

    // Transform the task to frontend type
    return transformTask(data.task);
  }

  /**
   * Delete a task
   *
   * Note: Backend uses DELETE /tasks/:taskId, not POST /tasks/:taskId/cancel
   */
  async deleteTask(taskId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/tasks/${taskId}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (response.status === 403) {
        throw new Error('Access denied: You do not have permission to delete this task');
      }
      throw new Error(`Failed to delete task: ${response.statusText}`);
    }
  }

  /**
   * Get task statistics
   *
   * Backend returns: BackendTaskStats (with 'in-progress' key)
   * This method transforms to: TaskStats (with inProgress key)
   */
  async getTaskStats(): Promise<TaskStats> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/tasks/stats/summary`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch task stats: ${response.statusText}`);
    }

    // Backend returns stats with 'in-progress' key
    const backendStats: BackendTaskStats = await response.json();

    // Transform to frontend type with inProgress key
    return transformTaskStats(backendStats);
  }

  /**
   * Get all agents for current user
   *
   * Backend returns: { agents: BackendAgentRegistration[], total: number }
   * This method transforms to: AgentRegistration[]
   */
  async getAgents(): Promise<AgentRegistration[]> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/agent`, {
      headers,
    });

    if (response.status === 404) {
      return []; // No agents registered yet
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }

    // Backend returns { agents: BackendAgentRegistration[], total: number }
    const data = await response.json();
    const agents: BackendAgentRegistration[] = data.agents || [];

    // Transform to frontend type
    return agents.map(transformAgent);
  }

  /**
   * Get agent status for current user (returns first agent for backward compatibility)
   *
   * Backend returns: BackendAgentRegistration[] (array of agents)
   * This method transforms to: AgentRegistration | null (first agent or null)
   */
  async getAgentStatus(): Promise<AgentRegistration | null> {
    const agents = await this.getAgents();
    return agents.length > 0 ? agents[0] : null;
  }

  /**
   * Get tasks filtered by agent ID
   *
   * Backend returns: { tasks: BackendProvisioningTask[], total: number }
   * This method transforms to: ProvisioningTask[]
   */
  async getTasksByAgent(agentId: string): Promise<ProvisioningTask[]> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/tasks?agentId=${encodeURIComponent(agentId)}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tasks for agent: ${response.statusText}`);
    }

    // Backend returns { tasks, total }
    const data: BackendTaskListResponse = await response.json();

    // Transform backend tasks to frontend tasks
    return transformTasks(data.tasks);
  }

  /**
   * Disconnect agent (send disconnect signal via SSE)
   *
   * POST /agent/:agentId/disconnect
   */
  async disconnectAgent(agentId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/agent/${encodeURIComponent(agentId)}/disconnect`, {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || `Failed to disconnect agent: ${response.statusText}`);
    }
  }

  /**
   * Revoke agent (delete from database)
   *
   * DELETE /agent/:agentId/revoke
   */
  async revokeAgent(agentId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${baseUrl}/agent/${encodeURIComponent(agentId)}/revoke`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || `Failed to revoke agent: ${response.statusText}`);
    }
  }
}
