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
  PROVISION_DEVOPS_CAPSTONE_TRAINING = 'provision-devops-capstone-training',
  PROVISION_DEVSECOPS_CAPSTONE_TRAINING = 'provision-devsecops-capstone-training',
  // Generic training lab: the lab identity is `config.labId` (see resourceTypeForTask). New labs
  // use this type, so adding one needs only a template — no new enum member or switch case here.
  PROVISION_TRAINING = 'provision-training',
  // Lifecycle operations on an existing resource
  DEPROVISION = 'deprovision',
  STOP = 'stop',
  START = 'start',
  RESTART = 'restart',
  /** Instructor check run inside a lab container (agent ≥ 0.1.23). Never changes resource state. */
  RUN_CHECK = 'run-check',
}

/** Resource types that can be provisioned. */
export enum ResourceType {
  KAFKA = 'kafka',
  KAFKA_TRAINING = 'kafka-training',
  POSTGRES = 'postgres',
  REDIS = 'redis',
  MONGODB = 'mongodb',
  DEVOPS_CAPSTONE_TRAINING = 'devops-capstone-training',
  DEVSECOPS_CAPSTONE_TRAINING = 'devsecops-capstone-training',
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
  TaskType.PROVISION_DEVOPS_CAPSTONE_TRAINING,
  TaskType.PROVISION_DEVSECOPS_CAPSTONE_TRAINING,
  TaskType.PROVISION_TRAINING,
];

const TRAINING_TASK_TYPES: string[] = [
  TaskType.PROVISION_KAFKA_TRAINING,
  TaskType.PROVISION_DEVOPS_CAPSTONE_TRAINING,
  TaskType.PROVISION_DEVSECOPS_CAPSTONE_TRAINING,
  TaskType.PROVISION_TRAINING,
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

/** True for instructor check tasks: they act on a resource but never change its state. */
export function isCheckTask(taskType: string): boolean {
  return taskType === TaskType.RUN_CHECK;
}

/** True for training-lab provision types — the generic one and the legacy per-lab ones. */
export function isTrainingTask(taskType: string): boolean {
  return TRAINING_TASK_TYPES.includes(taskType);
}

/**
 * A generic lab's id becomes a catalog tag, the entity's spec.type and a config-map key, so it
 * follows Backstage's tag rule: [a-z0-9] runs separated by single hyphens ("a--b" would fail
 * entity validation on every catalog refresh). Capped well under the 63-char tag limit.
 */
const LAB_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LAB_ID_MAX_LENGTH = 40;

/**
 * Legacy resource types are reserved: a generic lab named e.g. `kafka` would silently inherit that
 * type's docs link and merge with it in catalog type filters.
 */
const RESERVED_LAB_IDS = new Set<string>(Object.values(ResourceType));

/** True when `value` is a usable generic-lab id (see LAB_ID_PATTERN and RESERVED_LAB_IDS). */
export function isValidLabId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= LAB_ID_MAX_LENGTH &&
    LAB_ID_PATTERN.test(value) &&
    !RESERVED_LAB_IDS.has(value)
  );
}

/**
 * Validate a create-task request for the generic training type. Returns an error message, or
 * undefined when the request is fine (other task types are not checked here).
 *
 * dockerCompose is required: without it the agent falls back to its bundled template, whose
 * default is kafka (DockerComposeExecutor.getTemplateForTaskType) — a generic lab would silently
 * start Kafka. The legacy *-training types share that fallback; existing rows rely on it, so they
 * are deliberately left unchecked.
 */
export function validateTrainingTask(request: Pick<CreateTaskRequest, 'task_type' | 'config'>): string | undefined {
  if (request.task_type !== TaskType.PROVISION_TRAINING) return undefined;
  const config = request.config as unknown;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return 'config must be an object';
  }
  const { labId, dockerCompose, executor, vm } = config as Record<string, unknown>;
  if (!isValidLabId(labId)) {
    return `config.labId must be a lowercase slug (a-z, 0-9, single hyphens, max ${LAB_ID_MAX_LENGTH} chars) and not a reserved type (${[...RESERVED_LAB_IDS].join(', ')})`;
  }
  // VM labs (Multipass, agent ≥ 0.1.23): a VM spec instead of a compose file.
  if (executor === 'multipass') {
    if (typeof vm !== 'object' || vm === null || Array.isArray(vm)) return 'config.vm is required for a multipass lab';
    return undefined;
  }
  if (typeof dockerCompose !== 'string' || dockerCompose.trim() === '') {
    return 'config.dockerCompose is required for provision-training';
  }
  return undefined;
}

/** True for a VM lab task (needs agent ≥ 0.1.23: older agents would fall back to the bundled Docker template). */
export function isVmLabTask(request: Pick<CreateTaskRequest, 'task_type' | 'config'>): boolean {
  return request.task_type === TaskType.PROVISION_TRAINING && (request.config as any)?.executor === 'multipass';
}

/** Own-key lookup in a config-driven map — a plain `map[key]` returns a Function for e.g. "constructor". */
export function lookupByResourceType(map: Record<string, string>, resourceType: string | undefined): string | undefined {
  return resourceType && Object.prototype.hasOwnProperty.call(map, resourceType) ? map[resourceType] : undefined;
}

/**
 * Map a provision task to its resource type (e.g. provision-kafka -> kafka). For the generic
 * provision-training type the resource type is the task's `config.labId` (undefined if invalid).
 */
export function resourceTypeForTask(taskType: string, config?: Record<string, any>): string | undefined {
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
    case TaskType.PROVISION_DEVOPS_CAPSTONE_TRAINING:
      return ResourceType.DEVOPS_CAPSTONE_TRAINING;
    case TaskType.PROVISION_DEVSECOPS_CAPSTONE_TRAINING:
      return ResourceType.DEVSECOPS_CAPSTONE_TRAINING;
    case TaskType.PROVISION_TRAINING:
      return isValidLabId(config?.labId) ? config!.labId : undefined;
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
  /**
   * Computed at response time from `localProvisioner.resourceDocsUrls` config (not a DB
   * column) — a direct link (e.g. `/engineering-docs?source=...&path=index`) to related
   * documentation (e.g. training materials) for this task's resource type, if configured.
   * See `util/resourceDocsLinks.ts`.
   */
  docs_url?: string;
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
  /** A ResourceType value, or a generic lab's `config.labId`. */
  resource_type?: string;
  /** Provisioned by a training task (generic or legacy per-lab). */
  is_training?: boolean;
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
  /** Reported by agents ≥ 0.1.23 (migration 007). */
  capabilities?: AgentCapabilities;
  last_seen: Date;
  created_at: Date;
}

/** What an agent's machine can run, as reported on its poll. */
export interface AgentCapabilities {
  /** Node's process.arch: x64, arm64, … */
  arch?: string;
  cpus?: number;
  /** Memory Docker can use (Docker Desktop's VM limit on Mac/Windows). */
  dockerMemoryBytes?: number;
  /** linux, or windows for Windows-container mode. */
  dockerOs?: string;
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
  pollTimeoutSeconds: number;
  taskRetentionDays: number;
  supportedResources: string[];
  agent: {
    minimumVersion: string;
  };
}
