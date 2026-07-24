/**
 * TypeScript types for Backstage Agent
 */

/**
 * Agent configuration stored in ~/.backstage-agent/config.json
 */
export interface AgentConfig {
  backstageUrl: string;
  agentId: string;
  serviceToken: string;
  expiresAt: number;
}

/**
 * Task status enum (matches backend)
 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Task type enum (matches backend). Provision types create a resource; lifecycle types act on
 * an existing resource identified by config.targetTaskId / config.targetResourceName.
 */
export enum TaskType {
  PROVISION_KAFKA = 'provision-kafka',
  PROVISION_POSTGRES = 'provision-postgres',
  PROVISION_REDIS = 'provision-redis',
  PROVISION_MONGODB = 'provision-mongodb',
  DEPROVISION = 'deprovision',
  STOP = 'stop',
  START = 'start',
  RESTART = 'restart',
}

const LIFECYCLE_TASK_TYPES: string[] = [
  TaskType.DEPROVISION,
  TaskType.STOP,
  TaskType.START,
  TaskType.RESTART,
];

/** True for lifecycle task types acting on an existing resource (not a fresh provision). */
export function isLifecycleTask(taskType: string): boolean {
  return LIFECYCLE_TASK_TYPES.includes(taskType);
}

/**
 * Provisioning task from backend
 */
export interface ProvisioningTask {
  task_id: string;
  agent_id: string;
  user_id: string;
  task_type: string;
  resource_name: string;
  config: Record<string, any>;
  status: TaskStatus;
  created_at: string;
}

/**
 * SSE event types
 */
export enum SSEEventType {
  TASK = 'task',
  HEARTBEAT = 'heartbeat',
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
 * Task execution result reported back to the backend.
 * `connectionDetails` and `metadata` (container status, ports, pull progress) are surfaced in
 * the UI as "how to connect" and live status.
 */
export interface TaskExecutionResult {
  success: boolean;
  metadata?: Record<string, any>;
  connectionDetails?: ConnectionDetails;
  error?: string;
  logs?: string;
}

/** How to connect to a provisioned resource. */
export interface ConnectionDetails {
  host?: string;
  ports?: Record<string, number>;
  connectionString?: string;
  ui?: string;
  [key: string]: any;
}

/** A locally-provisioned resource tracked in ~/.backstage-agent/resources.json (offline-usable). */
export interface LocalResource {
  resourceName: string;
  taskType: string;
  taskId: string;
  taskDir: string;
  state: 'running' | 'stopped' | 'error';
  ports?: Record<string, number>;
  connectionDetails?: ConnectionDetails;
  provisionedAt: string;
  updatedAt: string;
}

/**
 * Docker Compose template configuration
 */
export interface DockerComposeConfig {
  resourceName: string;
  kafkaVersion?: string;
  port?: number;
  [key: string]: any;
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
 * Agent registration response
 */
export interface AgentRegisterResponse {
  agent_id: string;
  message?: string;
}
