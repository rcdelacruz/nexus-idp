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
  docs_url?: string;
  error_message?: string;
  logs?: string;
  metadata?: Record<string, unknown>;
  connection_details?: ConnectionDetails;
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
  capabilities?: { arch?: string; cpus?: number; dockerMemoryBytes?: number; dockerOs?: string };
  last_seen: string; // ISO date string
  last_seen_age_seconds?: number | null; // server-computed (skew-free)
  created_at: string;
  is_connected: boolean;
  // True once a "Stop Agent" shutdown has actually been delivered and the agent hasn't
  // polled since — distinct from is_connected/age going stale on their own, and permanent
  // (doesn't self-clear with elapsed time) until the agent actually reconnects.
  explicitly_disconnected?: boolean;
  /** npm's latest agent version (cached hourly by the portal), and whether this agent is older. */
  latest_agent_version?: string | null;
  update_available?: boolean;
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

/**
 * A provisioned resource's live lifecycle state, as returned by the backend.
 */
export type BackendResourceState = 'provisioning' | 'running' | 'stopped' | 'error' | 'removed';

/**
 * Resource-centric (folded) view of a provisioned resource, as returned by backend API.
 */
export interface BackendResource {
  resource_name: string;
  resource_type?: string;
  agent_id: string;
  user_id: string;
  state: BackendResourceState;
  connection_details?: ConnectionDetails;
  catalog_entity_ref?: string;
  provisioned_at?: string;
  updated_at: string;
  latest_task_id: string;
}

/**
 * Resources list response from backend
 */
export interface BackendResourcesResponse {
  resources: BackendResource[];
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
 * How to connect to a provisioned resource (surfaced in the UI with copy buttons).
 */
export interface ConnectionDetails {
  host?: string;
  ports?: Record<string, number>;
  connectionString?: string;
  ui?: string;
  [key: string]: unknown;
}

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
  docsUrl?: string;
  errorMessage?: string;
  logs?: string;
  metadata?: Record<string, unknown>;
  connectionDetails?: ConnectionDetails;
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
  /** What the machine can run (agent ≥ 0.1.23): CPU arch, CPUs, memory available to Docker. */
  capabilities?: { arch?: string; cpus?: number; dockerMemoryBytes?: number; dockerOs?: string };
  lastSeenAt: string;
  lastSeenAgeSeconds?: number | null; // server-computed heartbeat age (skew-free)
  createdAt: string;
  isConnected: boolean;
  // Permanent (doesn't decay with elapsed time) — true once a Stop Agent shutdown has
  // actually been delivered. See getConnectivity() in api/connectivity.ts for why this
  // matters distinctly from isConnected/age.
  explicitlyDisconnected: boolean;
  latestAgentVersion?: string;
  updateAvailable?: boolean;
}

/**
 * A provisioned resource's live lifecycle state, for frontend components.
 */
export type ResourceState = 'provisioning' | 'running' | 'stopped' | 'error' | 'removed';

/**
 * Resource-centric (folded) view of a provisioned resource, for frontend components. Reflects
 * the resource's *current* state — unlike a `ProvisioningTask` row, which is a historical log
 * entry and doesn't update once superseded by a later lifecycle task.
 */
export interface Resource {
  resourceName: string;
  resourceType?: string;
  agentId: string;
  userId: string;
  state: ResourceState;
  connectionDetails?: ConnectionDetails;
  catalogEntityRef?: string;
  provisionedAt?: string;
  updatedAt: string;
  latestTaskId: string;
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

/**
 * Instructor Trainees view (GET /tasks/admin/trainees). The backend already returns camelCase,
 * so these mirror TraineeActivityService.TraineeRow directly (no transformer).
 */
export interface TraineeRepoActivity {
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch?: string;
  pushedAt?: string;
  empty: boolean;
  commitCount: number;
  lastCommit?: { sha: string; message: string; date: string; author: string };
  commitsPerDay: { date: string; count: number }[];
  stageFilesWorked: string[];
  aiLogFiles: number;
  corrections: number;
  decisions: number;
  progress?: { done: number; total: number };
  pullRequests: { open: number; merged: number };
  ci?: { status: string; conclusion: string | null; updatedAt: string; htmlUrl: string };
  truncatedTree?: boolean;
}

export interface TraineeRow {
  traineeEmail: string;
  /** The lab's agent (with resourceName, identifies the lab); absent on a capstone-only row. */
  agentId?: string;
  resourceName: string;
  lab?: string;
  taskType: string;
  environment: {
    state: string;
    provisionedAt?: string;
    updatedAt: string;
    agentOnline: boolean;
    agentLastSeen?: string;
    /** What the agent is doing right now (a provision or lifecycle task still running). */
    current?: { type: string; status: string; step?: string; since: string };
  };
  events: { type: string; status: string; at: string }[];
  /** Instructor check results from this lab (newest first). */
  checks?: { name?: string; status: string; at: string; exitCode?: number; output?: string }[];
  catalogEntityRef?: string;
  repoUrl?: string;
  repo?: TraineeRepoActivity;
  repoNote?: string;
  capstone?: {
    id: string;
    capstone: string;
    traineeNo: string;
    status: string;
    handoutPrUrl?: string;
    handoutAt?: string;
    /** Laptop-seeded capstones (Terraform): still waiting for the lab's seed report. */
    awaitingSeedReport?: boolean;
    /** When the laptop reported its seed — trainee-controlled, so unverified. */
    seedReportedAt?: string;
    /** Checks an instructor can run in the trainee's lab (agent ≥ 0.1.23). */
    availableChecks?: { name: string; title: string }[];
  };
}

/** Instructor-only seed outputs of a capstone enrollment (GET /capstones/enrollments/:id/secrets). */
export interface CapstoneSecrets {
  credentials: string;
  answerKey: string;
  seedManifest: unknown;
  gradeCommand?: string;
}
