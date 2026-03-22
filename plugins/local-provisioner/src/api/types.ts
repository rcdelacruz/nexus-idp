/**
 * Type definitions for Local Provisioner API
 *
 * This file contains two sets of types:
 * 1. Backend types (snake_case) - as returned by the API
 * 2. Frontend types (camelCase) - used by React components
 *
 * Transformation between these types happens in transformers.ts
 * This follows Backstage best practices for API client design.
 */

// ============================================================================
// BACKEND API TYPES (snake_case - matches database schema)
// ============================================================================

/**
 * Task status as returned by backend
 */
export type BackendTaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

/**
 * Provisioning task as returned by backend API
 */
export interface BackendProvisioningTask {
  task_id: string;
  agent_id: string;
  user_id: string;
  task_type: string;
  resource_name: string;
  config: Record<string, unknown>;
  status: BackendTaskStatus;
  catalog_entity_ref?: string;
  error_message?: string;
  created_at: string; // ISO date string
  updated_at: string;
  started_at?: string;
  completed_at?: string;
}

/**
 * Agent registration as returned by backend API
 */
export interface BackendAgentRegistration {
  agent_id: string;
  user_id: string;
  hostname?: string; // Machine hostname (e.g., "macbook-pro.local")
  machine_name?: string;
  os_platform?: string; // Platform type (darwin, linux, win32)
  platform_version?: string; // Detailed version (e.g., "macOS 14.2")
  agent_version?: string;
  last_seen: string; // ISO date string
  created_at: string;
  is_connected: boolean;
}

/**
 * Agent status as returned by backend API
 */
export interface BackendAgentStatusResponse {
  agent_id: string;
  user_id: string;
  machine_name?: string;
  os_platform?: string;
  agent_version?: string;
  last_seen: string; // ISO date string
  is_connected: boolean;
}

/**
 * Task list response from backend
 */
export interface BackendTaskListResponse {
  tasks: BackendProvisioningTask[];
  total: number;
}

/**
 * Task stats response from backend
 */
export interface BackendTaskStats {
  total: number;
  pending: number;
  'in-progress': number;
  completed: number;
  failed: number;
}

/**
 * Task creation response from backend
 */
export interface BackendCreateTaskResponse {
  task_id: string;
  message: string;
  task: BackendProvisioningTask;
}

// ============================================================================
// FRONTEND TYPES (camelCase - used by React components)
// ============================================================================

/**
 * Task status for frontend components
 * Matches backend statuses exactly
 */
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

/**
 * Provisioning task for frontend components
 */
export interface ProvisioningTask {
  id: string;
  agentId: string;
  userId: string;
  taskType: string;
  resourceName: string;
  config: Record<string, unknown>;
  status: TaskStatus;
  catalogEntityRef?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Agent registration for frontend components
 */
export interface AgentRegistration {
  id: string;
  userId: string;
  hostname?: string; // Machine hostname (e.g., "macbook-pro.local")
  machineName?: string;
  osPlatform?: string; // Platform type (darwin, linux, win32)
  platformVersion?: string; // Detailed version (e.g., "macOS 14.2")
  agentVersion?: string;
  lastSeenAt: string;
  createdAt: string;
  isConnected: boolean;
}

/**
 * Task stats for frontend components
 */
export interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
}

// ============================================================================
// REQUEST TYPES (used by both frontend and backend)
// ============================================================================

/**
 * Request to create a new task
 * Uses snake_case to match backend API
 */
export interface CreateTaskRequest {
  agent_id: string;
  task_type: string;
  resource_name: string;
  config: Record<string, unknown>;
}

/**
 * Request to update task status
 * Uses snake_case to match backend API
 */
export interface UpdateTaskStatusRequest {
  status: BackendTaskStatus;
  metadata?: Record<string, unknown>;
  error_message?: string;
}
