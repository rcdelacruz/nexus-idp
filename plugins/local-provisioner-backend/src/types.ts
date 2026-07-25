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
 * Task type enum.
 *
 * Provision tasks create a resource; lifecycle tasks (deprovision/stop/start/restart) act on an
 * already-provisioned resource identified by `config.targetTaskId` / `config.targetResourceName`.
 */
export enum TaskType {
  PROVISION_KAFKA = 'provision-kafka',
  PROVISION_KAFKA_TRAINING = 'provision-kafka-training',
  PROVISION_POSTGRES = 'provision-postgres',
  PROVISION_REDIS = 'provision-redis',
  PROVISION_MONGODB = 'provision-mongodb',
  // Lifecycle operations on an existing resource
  DEPROVISION = 'deprovision',
  STOP = 'stop',
  START = 'start',
  RESTART = 'restart',
}

/** Resource types that can be provisioned. */
export enum ResourceType {
  KAFKA = 'kafka',
  KAFKA_TRAINING = 'kafka-training',
  POSTGRES = 'postgres',
  REDIS = 'redis',
  MONGODB = 'mongodb',
}

/** Lifecycle state of a provisioned resource, derived from its latest task. */
export enum ResourceState {
  PROVISIONING = 'provisioning',
  RUNNING = 'running',
  STOPPED = 'stopped',
  ERROR = 'error',
  REMOVED = 'removed',
}

const PROVISION_TASK_TYPES: string[] = [
  TaskType.PROVISION_KAFKA,
  TaskType.PROVISION_KAFKA_TRAINING,
  TaskType.PROVISION_POSTGRES,
  TaskType.PROVISION_REDIS,
  TaskType.PROVISION_MONGODB,
];

const LIFECYCLE_TASK_TYPES: string[] = [
  TaskType.DEPROVISION,
  TaskType.STOP,
  TaskType.START,
  TaskType.RESTART,
];

/** True for provision-* task types (creating a resource). */
export function isProvisionTask(taskType: string): boolean {
  return PROVISION_TASK_TYPES.includes(taskType);
}

/** True for lifecycle task types acting on an existing resource. */
export function isLifecycleTask(taskType: string): boolean {
  return LIFECYCLE_TASK_TYPES.includes(taskType);
}

/** Map a provision task type to its resource type (e.g. provision-kafka -> kafka). */
export function resourceTypeForTask(taskType: string): ResourceType | undefined {
  switch (taskType) {
    case TaskType.PROVISION_KAFKA:
      return ResourceType.KAFKA;
    case TaskType.PROVISION_KAFKA_TRAINING:
      return ResourceType.KAFKA_TRAINING;
    case TaskType.PROVISION_POSTGRES:
      return ResourceType.POSTGRES;
    case TaskType.PROVISION_REDIS:
      return ResourceType.REDIS;
    case TaskType.PROVISION_MONGODB:
      return ResourceType.MONGODB;
    default:
      return undefined;
  }
}

/**
 * Connection details for a provisioned resource, surfaced to the user ("how to connect").
 */
export interface ConnectionDetails {
  host?: string;
  ports?: Record<string, number>; // service -> host port
  connectionString?: string;
  ui?: string; // e.g. a management UI URL
  [key: string]: any;
}

/**
 * Provisioning task database entity.
 *
 * `logs` and `metadata` (container status, ports, pull progress, connection details) are
 * reported by the agent and persisted so the UI can show live output and connection info.
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
  logs?: string;
  metadata?: Record<string, any>;
  connection_details?: ConnectionDetails;
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
}

/**
 * A provisioned resource — the folded view of all tasks for one resource_name on one agent.
 * This is the resource-centric model the UI and catalog present, rather than raw task rows.
 */
export interface Resource {
  resource_name: string;
  resource_type?: ResourceType;
  agent_id: string;
  user_id: string;
  state: ResourceState;
  connection_details?: ConnectionDetails;
  catalog_entity_ref?: string;
  provisioned_at?: Date;
  updated_at: Date;
  latest_task_id: string;
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
 * Agent authentication response (device code flow)
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
