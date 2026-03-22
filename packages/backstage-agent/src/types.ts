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
 * Task execution result
 */
export interface TaskExecutionResult {
  success: boolean;
  metadata?: Record<string, any>;
  error?: string;
  logs?: string;
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
