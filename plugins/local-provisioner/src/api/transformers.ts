/**
 * Transformation functions between backend API types and frontend types
 *
 * Backend uses snake_case (aligned with database schema)
 * Frontend uses camelCase (JavaScript/TypeScript convention)
 *
 * This follows Backstage best practices - see @backstage/catalog-client
 * for similar patterns.
 */

import {
  BackendProvisioningTask,
  BackendAgentRegistration,
  BackendAgentStatusResponse,
  BackendTaskStats,
  ProvisioningTask,
  AgentRegistration,
  TaskStats,
} from './types';

/**
 * Transform backend task to frontend task
 *
 * Converts:
 * - snake_case field names to camelCase
 * - ISO date strings remain as strings (components handle formatting)
 */
export function transformTask(
  backendTask: BackendProvisioningTask,
): ProvisioningTask {
  return {
    id: backendTask.task_id,
    agentId: backendTask.agent_id,
    userId: backendTask.user_id,
    taskType: backendTask.task_type,
    resourceName: backendTask.resource_name,
    config: backendTask.config,
    status: backendTask.status,
    catalogEntityRef: backendTask.catalog_entity_ref,
    errorMessage: backendTask.error_message,
    createdAt: backendTask.created_at,
    updatedAt: backendTask.updated_at,
    startedAt: backendTask.started_at,
    completedAt: backendTask.completed_at,
  };
}

/**
 * Transform backend agent registration to frontend agent registration
 */
export function transformAgent(
  backendAgent: BackendAgentRegistration,
): AgentRegistration {
  return {
    id: backendAgent.agent_id,
    userId: backendAgent.user_id,
    hostname: backendAgent.hostname,
    machineName: backendAgent.machine_name,
    osPlatform: backendAgent.os_platform,
    platformVersion: backendAgent.platform_version,
    agentVersion: backendAgent.agent_version,
    lastSeenAt: backendAgent.last_seen,
    createdAt: backendAgent.created_at,
    isConnected: backendAgent.is_connected,
  };
}

/**
 * Transform backend agent status to frontend agent registration
 * (merges agent registration with connection status)
 */
export function transformAgentStatus(
  backendStatus: BackendAgentStatusResponse,
): AgentRegistration {
  return {
    id: backendStatus.agent_id,
    userId: backendStatus.user_id,
    machineName: backendStatus.machine_name,
    osPlatform: backendStatus.os_platform,
    agentVersion: backendStatus.agent_version,
    lastSeenAt: backendStatus.last_seen,
    // CreatedAt not available in status response, use last_seen as fallback
    createdAt: backendStatus.last_seen,
    isConnected: backendStatus.is_connected,
  };
}

/**
 * Transform backend task stats to frontend task stats
 */
export function transformTaskStats(
  backendStats: BackendTaskStats,
): TaskStats {
  return {
    total: backendStats.total,
    pending: backendStats.pending,
    inProgress: backendStats['in-progress'],
    completed: backendStats.completed,
    failed: backendStats.failed,
  };
}

/**
 * Transform array of backend tasks to frontend tasks
 */
export function transformTasks(
  backendTasks: BackendProvisioningTask[],
): ProvisioningTask[] {
  return backendTasks.map(transformTask);
}
