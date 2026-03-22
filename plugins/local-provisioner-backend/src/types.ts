/**
 * TypeScript types and interfaces for the Local Provisioner backend plugin
 */

/**
 * Task status enum
 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Task type enum
 */
export enum TaskType {
  PROVISION_KAFKA = 'provision-kafka',
  PROVISION_POSTGRES = 'provision-postgres',
  PROVISION_REDIS = 'provision-redis',
  PROVISION_MONGODB = 'provision-mongodb',
}

/**
 * Provisioning task database entity
 */
export interface ProvisioningTask {
  task_id: string;
  agent_id: string;
  user_id: string;
  task_type: string;
  resource_name: string;
  config: Record<string, any>;
  status: TaskStatus;
  catalog_entity_ref?: string;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
}

/**
 * Agent registration database entity
 */
export interface AgentRegistration {
  agent_id: string;
  user_id: string;
  hostname?: string; // Machine hostname (e.g., macbook-pro.local)
  machine_name?: string;
  os_platform?: string; // Platform type (darwin, linux, win32)
  platform_version?: string; // Detailed version (macOS 14.2, Ubuntu 22.04)
  agent_version?: string;
  last_seen: Date;
  created_at: Date;
}

/**
 * Task creation request
 */
export interface CreateTaskRequest {
  agent_id: string;
  task_type: string;
  resource_name: string;
  config: Record<string, any>;
}

/**
 * Task update request
 */
export interface UpdateTaskStatusRequest {
  status: TaskStatus;
  metadata?: Record<string, any>;
  error_message?: string;
}

/**
 * Agent authentication request
 */
export interface AgentAuthRequest {
  googleToken: string;
}

/**
 * Agent authentication response
 */
export interface AgentAuthResponse {
  serviceToken: string;
  agentId: string;
  expiresAt: number;
}

/**
 * Agent registration request
 */
export interface AgentRegisterRequest {
  machine_name?: string;
  os_platform?: string;
  agent_version?: string;
}

/**
 * Agent registration response
 */
export interface AgentRegisterResponse {
  agent_id: string;
}

/**
 * SSE task event payload
 */
export interface SSETaskEvent {
  taskId: string;
  type: string;
  config: Record<string, any>;
}

/**
 * Task list response
 */
export interface TaskListResponse {
  tasks: ProvisioningTask[];
  total: number;
}

/**
 * Agent status response
 */
export interface AgentStatusResponse {
  agent_id: string;
  user_id: string;
  machine_name?: string;
  os_platform?: string;
  agent_version?: string;
  last_seen: Date;
  is_connected: boolean;
}

/**
 * Database connection configuration
 */
export interface DatabaseConfig {
  client: 'pg';
  connection: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

/**
 * Plugin configuration
 */
export interface LocalProvisionerConfig {
  enabled: boolean;
  sseHeartbeatInterval: number;
  taskRetentionDays: number;
  supportedResources: string[];
  agent: {
    minimumVersion: string;
  };
}
