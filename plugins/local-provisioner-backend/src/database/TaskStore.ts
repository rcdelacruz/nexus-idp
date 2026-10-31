/**
 * Database access layer for provisioning tasks and agent registrations
 */

import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import {
  ProvisioningTask,
  AgentRegistration,
  AgentCapabilities,
  TaskStatus,
  TaskType,
  CreateTaskRequest,
  Resource,
  ResourceState,
  isProvisionTask,
  isCheckTask,
  isTrainingTask,
  resourceTypeForTask,
} from '../types';

/** Most steps one task keeps in its activity timeline, and the most live output it stores. */
const MAX_ACTIVITY = 200;
const MAX_OUTPUT_CHARS = 4000;

export interface ActivityEntry {
  at: string;
  step: string;
}

/**
 * Merge an agent status update into the task's stored metadata. Agents send only the current step
 * (`phase`, plus optional `progress`/`output`), so the timeline is kept here: a new step is
 * appended with its time, a repeated one only refreshes its progress, and completion/failure close
 * it. Fields from earlier updates (catalogEntityRef, vm, workspace, check) are kept, not replaced.
 * `incoming.at` (agent clock, ≥ 0.1.26) orders steps that arrive out of order; otherwise `now`.
 */
export function mergeTaskMetadata(
  previous: Record<string, any> | undefined,
  incoming: Record<string, any> | undefined,
  status: TaskStatus,
  now: Date,
): { metadata: Record<string, any>; newStep?: string } {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const { at, ...fields } = incoming && typeof incoming === 'object' ? incoming : ({} as Record<string, any>);
  const agentAt = typeof at === 'string' ? Date.parse(at) : NaN;
  const when = new Date(Number.isFinite(agentAt) && Math.abs(agentAt - now.getTime()) < 86_400_000 ? agentAt : now.getTime()).toISOString();

  const activity: ActivityEntry[] = Array.isArray(prev.activity) ? prev.activity.filter((e: any) => e && typeof e.step === 'string') : [];
  // Updates are sent without waiting for each other, so the last output of one step can arrive
  // after the next step began. One stamped (agent ≥ 0.1.26) earlier than the latest step is stale.
  // It never changes the current step, progress or output; a step the timeline doesn't have yet
  // (step changes reordered on the way) is still slotted in at its time.
  const latestAt = Date.parse(activity[activity.length - 1]?.at ?? '');
  if (status === TaskStatus.IN_PROGRESS && Number.isFinite(agentAt) && Number.isFinite(latestAt) && agentAt < latestAt) {
    const stalePhase = typeof fields.phase === 'string' ? fields.phase.trim().slice(0, 200) : '';
    if (!stalePhase || activity.some(e => e.step === stalePhase)) return { metadata: prev };
    const slotted = [...activity, { at: when, step: stalePhase }].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { metadata: { ...prev, activity: slotted.slice(-MAX_ACTIVITY) }, newStep: stalePhase };
  }
  const merged: Record<string, any> = { ...prev, ...fields };
  const last = activity[activity.length - 1]?.step;
  const phase = typeof fields.phase === 'string' ? fields.phase.trim().slice(0, 200) : '';
  let newStep: string | undefined;
  if (status === TaskStatus.IN_PROGRESS && phase && phase !== last) {
    newStep = phase;
    // Progress and output belong to a step; a new step starts without the last one's.
    if (!('progress' in fields)) delete merged.progress;
    if (!('output' in fields)) delete merged.output;
  } else if ((status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) && last !== status) {
    newStep = status;
    delete merged.progress;
  }
  if (newStep) {
    activity.push({ at: when, step: newStep });
    activity.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  merged.activity = activity.slice(-MAX_ACTIVITY);
  if (typeof merged.output === 'string') merged.output = merged.output.slice(-MAX_OUTPUT_CHARS);
  return { metadata: merged, newStep: newStep && newStep !== status ? newStep : undefined };
}

/**
 * Fold a resource's task history (chronological) into its current state. The latest completed
 * task drives state: deprovision → removed, stop → stopped, start/restart/provision → running,
 * a failed latest task → error, an in-flight task → provisioning.
 */
export function foldTasksToResource(allTasks: ProvisioningTask[]): Resource | undefined {
  // Instructor checks (run-check) observe a resource; they must never move its state (a check on a
  // stopped lab would otherwise fold to "running").
  const tasks = allTasks.filter(t => !isCheckTask(t.task_type));
  if (tasks.length === 0) return undefined;
  const provision = [...tasks].reverse().find(t => isProvisionTask(t.task_type));
  if (!provision) return undefined; // no provision task → not a resource we own

  const latest = tasks[tasks.length - 1];
  const latestCompleted = [...tasks]
    .reverse()
    .find(t => t.status === TaskStatus.COMPLETED);

  let state: ResourceState;
  if (latest.status === TaskStatus.PENDING || latest.status === TaskStatus.IN_PROGRESS) {
    state = ResourceState.PROVISIONING;
  } else if (latest.status === TaskStatus.FAILED) {
    state = ResourceState.ERROR;
  } else if (!latestCompleted) {
    state = ResourceState.ERROR;
  } else if (latestCompleted.task_type === TaskType.DEPROVISION) {
    state = ResourceState.REMOVED;
  } else if (latestCompleted.task_type === TaskType.STOP) {
    state = ResourceState.STOPPED;
  } else {
    state = ResourceState.RUNNING; // provision / start / restart
  }

  const connProvision = [...tasks]
    .reverse()
    .find(t => isProvisionTask(t.task_type) && t.connection_details);

  return {
    resource_name: provision.resource_name,
    resource_type: resourceTypeForTask(provision.task_type, provision.config),
    is_training: isTrainingTask(provision.task_type),
    agent_id: provision.agent_id,
    user_id: provision.user_id,
    state,
    connection_details: connProvision?.connection_details,
    catalog_entity_ref: provision.catalog_entity_ref,
    provisioned_at: provision.completed_at ?? provision.created_at,
    updated_at: latest.updated_at,
    latest_task_id: latest.task_id,
  };
}

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
   * Get tasks across ALL users (admin activity view), most recent first. Unlike
   * `getTasksByUser`, this has no per-user WHERE clause unless `userId` is passed to
   * scope down to one user — callers must gate access to this at the permission layer.
   */
  async listAllTasks(options?: {
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ProvisioningTask[]> {
    let query = this.db('provisioning_tasks').orderBy('created_at', 'desc');

    if (options?.userId) {
      query = query.where({ user_id: options.userId });
    }

    query = query.limit(options?.limit ?? 200).offset(options?.offset ?? 0);

    const tasks = await query;
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
    extra?: { logs?: string; connectionDetails?: Record<string, any> },
  ): Promise<{ newStep?: string; resourceName?: string }> {
    const updateData: any = {
      status,
      updated_at: this.db.fn.now(),
    };

    // Set started_at only on the first transition to in-progress (idempotent across interim
    // progress updates that now carry metadata).
    if (status === TaskStatus.IN_PROGRESS) {
      updateData.started_at = this.db.raw('COALESCE(started_at, NOW())');
    }

    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
      updateData.completed_at = this.db.fn.now();
    }

    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    if (metadata?.catalogEntityRef) {
      updateData.catalog_entity_ref = metadata.catalogEntityRef;
    }

    if (extra?.logs) {
      updateData.logs = extra.logs;
    }

    if (extra?.connectionDetails) {
      updateData.connection_details = JSON.stringify(extra.connectionDetails);
    }

    // Read-merge-write under a row lock: an agent can send two step updates milliseconds apart.
    return this.db.transaction(async trx => {
      const row = await trx('provisioning_tasks')
        .where({ task_id: taskId })
        .forUpdate()
        .first('metadata', 'resource_name', 'status', 'task_type', 'agent_id');
      // A late progress report (throttled, or delayed on the network) must never reopen a finished task.
      if (status === TaskStatus.IN_PROGRESS && (row?.status === TaskStatus.COMPLETED || row?.status === TaskStatus.FAILED)) {
        return { resourceName: row.resource_name };
      }
      const previous = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata;
      const { metadata: merged, newStep } = mergeTaskMetadata(previous, metadata, status, new Date());
      updateData.metadata = JSON.stringify(merged);
      await trx('provisioning_tasks').where({ task_id: taskId }).update(updateData);
      // A removed lab has nothing left to run: close its tasks still marked pending/running (a
      // setup whose agent was restarted, say), so they don't show "in progress" forever.
      if (status === TaskStatus.COMPLETED && row?.task_type === TaskType.DEPROVISION) {
        await trx('provisioning_tasks')
          .where({ agent_id: row.agent_id, resource_name: row.resource_name })
          .whereNot({ task_id: taskId })
          .whereIn('status', [TaskStatus.PENDING, TaskStatus.IN_PROGRESS])
          .update({
            status: TaskStatus.FAILED,
            error_message: 'Cancelled: the lab was removed',
            completed_at: this.db.fn.now(),
            updated_at: this.db.fn.now(),
          });
      }
      return { newStep, resourceName: row?.resource_name };
    });
  }

  /**
   * Fold all tasks into the current set of provisioned resources (resource-centric view).
   * A resource is keyed by (agent_id, resource_name); its state is derived from the latest
   * completed lifecycle task. Torn-down resources are excluded.
   */
  async getActiveProvisionedResources(): Promise<Resource[]> {
    const rows = await this.db('provisioning_tasks').orderBy('created_at', 'asc');
    const tasks = rows.map(r => this.mapTaskFromDb(r));

    const byResource = new Map<string, ProvisioningTask[]>();
    for (const t of tasks) {
      const key = `${t.agent_id}::${t.resource_name}`;
      const group = byResource.get(key);
      if (group) group.push(t);
      else byResource.set(key, [t]);
    }

    const resources: Resource[] = [];
    for (const group of byResource.values()) {
      const resource = foldTasksToResource(group);
      if (resource && resource.state !== ResourceState.REMOVED) {
        resources.push(resource);
      }
    }
    return resources;
  }

  /**
   * Every training resource across all users, removed ones included (a trainee's repo work
   * outlives their environment), with the provisioning task (its `config` carries the
   * template-forwarded repo URL) and the lifecycle history. Same grouping and fold as
   * `getActiveProvisionedResources`. Feeds the instructor Trainees view.
   */
  async getTrainingResourceHistories(): Promise<
    {
      resource: Resource;
      provision: ProvisioningTask;
      events: { type: string; status: string; at: Date; check?: { name?: string; exitCode?: number; output?: string } }[];
      /** The lab's task still pending or running (provision or lifecycle), with its current step. */
      current?: { type: string; status: string; step?: string; since: Date };
    }[]
  > {
    const rows = await this.db('provisioning_tasks').orderBy('created_at', 'asc');
    const byResource = new Map<string, ProvisioningTask[]>();
    for (const t of rows.map(r => this.mapTaskFromDb(r))) {
      const key = `${t.agent_id}::${t.resource_name}`;
      const group = byResource.get(key);
      if (group) group.push(t);
      else byResource.set(key, [t]);
    }

    const out: {
      resource: Resource;
      provision: ProvisioningTask;
      events: { type: string; status: string; at: Date; check?: { name?: string; exitCode?: number; output?: string } }[];
      current?: { type: string; status: string; step?: string; since: Date };
    }[] = [];
    for (const group of byResource.values()) {
      const resource = foldTasksToResource(group);
      if (!resource?.is_training) continue;
      const provision = [...group].reverse().find(t => isProvisionTask(t.task_type))!;
      const open = [...group]
        .reverse()
        .find(t => !isCheckTask(t.task_type) && (t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS));
      const activity = Array.isArray(open?.metadata?.activity) ? open!.metadata!.activity : [];
      const lastStep = activity[activity.length - 1];
      out.push({
        resource,
        provision,
        current: open
          ? {
              type: open.task_type,
              status: open.status,
              step: typeof open.metadata?.phase === 'string' ? open.metadata.phase : undefined,
              since: lastStep?.at ? new Date(lastStep.at) : open.started_at ?? open.created_at,
            }
          : undefined,
        events: group.map(t => ({
          type: t.task_type,
          status: t.status,
          at: t.completed_at ?? t.created_at,
          ...(isCheckTask(t.task_type)
            ? { check: { name: t.config?.checkName, exitCode: t.metadata?.check?.exitCode, output: t.metadata?.check?.output ?? t.error_message } }
            : {}),
        })),
      });
    }
    return out;
  }

  /** Whether a task of this type is still pending or running for this resource. */
  async hasOpenTask(agentId: string, resourceName: string, taskType: string): Promise<boolean> {
    const row = await this.db('provisioning_tasks')
      .where({ agent_id: agentId, resource_name: resourceName, task_type: taskType })
      .whereIn('status', [TaskStatus.PENDING, TaskStatus.IN_PROGRESS])
      .first('task_id');
    return Boolean(row);
  }

  /** Instructor "Remove trainee": hides the lab from the Trainees view; the row is the audit record. */
  async recordTraineeRemoval(r: {
    agentId?: string;
    resourceName?: string;
    enrollmentId?: string;
    traineeEmail: string;
    repoUrl?: string;
    repoDeleted: boolean;
    removedBy: string;
  }): Promise<void> {
    await this.db('trainee_removals').insert({
      id: randomUUID(),
      agent_id: r.agentId ?? null,
      resource_name: r.resourceName ?? null,
      enrollment_id: r.enrollmentId ?? null,
      trainee_email: r.traineeEmail,
      repo_url: r.repoUrl ?? null,
      repo_deleted: r.repoDeleted,
      removed_by: r.removedBy,
      removed_at: new Date().toISOString(),
    });
  }

  /** `agent_id::resource_name` of every lab removed from the Trainees view. */
  async removedTraineeLabs(): Promise<Set<string>> {
    const rows = await this.db('trainee_removals').whereNotNull('agent_id').select('agent_id', 'resource_name');
    return new Set(rows.map(r => `${r.agent_id}::${r.resource_name}`));
  }

  /** The latest provision task (any state) whose template-forwarded repo URL matches — the lab of a capstone repo. */
  async findProvisionTaskByRepoUrl(repoUrl: string): Promise<ProvisioningTask | undefined> {
    const norm = (u: unknown) => String(u ?? '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
    const rows = await this.db('provisioning_tasks').orderBy('created_at', 'desc');
    return rows
      .map(r => this.mapTaskFromDb(r))
      .find(t => isProvisionTask(t.task_type) && norm(t.config?.githubRepoUrl ?? t.config?.gitlabRepoUrl) === norm(repoUrl));
  }

  /**
   * Fold one resource's task history into its current state. Scoped version of
   * `getActiveProvisionedResources` for callers that only need to validate a single
   * (agent_id, resource_name) pair (e.g. a lifecycle-transition guard).
   */
  async getResourceState(agentId: string, resourceName: string): Promise<Resource | undefined> {
    const rows = await this.db('provisioning_tasks')
      .where({ agent_id: agentId, resource_name: resourceName })
      .orderBy('created_at', 'asc');

    if (rows.length === 0) return undefined;

    const tasks = rows.map(r => this.mapTaskFromDb(r));
    return foldTasksToResource(tasks);
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
    // agent_id has no DB default (migration 004 made it a NOT NULL varchar), so generate one —
    // otherwise the insert violates the not-null constraint (was a 500 on POST /agent/register).
    const [agent] = await this.db('agent_registrations')
      .insert({
        agent_id: randomUUID(),
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
    // Check if agent already exists — by agent_id first, then by (hostname, user_id), the
    // actual DB uniqueness constraint. agentId is a hash of hostname + primary network MAC
    // (see packages/backstage-agent/src/utils/machineId.ts) and is meant to be stable per
    // machine, but interface enumeration order isn't guaranteed stable across process runs
    // on a machine with multiple interfaces (VPN/Tailscale attaching/detaching, etc.) — a
    // different MAC gets picked, producing a different agentId for the same physical machine.
    // Falling through to the INSERT below with a "new" agentId then violates
    // idx_agent_hostname_user_unique (500 on every device-code poll) since a row for this
    // hostname+user already exists under the old agentId. Checking (hostname, user_id) too
    // catches that case and updates the existing row in place instead of colliding.
    const existing =
      (await this.getAgentById(agentId)) ??
      (await this.db('agent_registrations').where({ hostname, user_id: userId }).first().then(
        row => (row ? this.mapAgentFromDb(row) : null),
      ));

    if (existing) {
      // Update existing agent. Also reassign user_id: agent_id is machine-derived, so
      // re-authorizing the CLI on a laptop previously owned by a different Backstage user
      // (e.g. account switch, laptop handed off) must transfer ownership to whoever just
      // authorized it — otherwise getAgentsByUser() for the new owner returns nothing,
      // which silently breaks the Agent List UI and every heartbeat/SSE call afterward
      // (found 2026-07-26: a new user's heartbeats 500'd with "Agent not found for user").
      // Key the update on the row we actually found (existing.agent_id) — it may differ
      // from the incoming agentId if this row was matched via the (hostname, user_id)
      // fallback above, in which case agent_id needs renaming to the freshly-computed one.
      await this.db('agent_registrations')
        .where({ agent_id: existing.agent_id })
        .update({
          agent_id: agentId,
          user_id: userId,
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
  async updateAgentLastSeen(agentId: string, agentVersion?: string, capabilities?: AgentCapabilities): Promise<void> {
    await this.db('agent_registrations')
      .where({ agent_id: agentId })
      .update({
        last_seen: this.db.fn.now(),
        // Agents ≥ 0.1.23 report their real version on every poll, so an `update` is picked up
        // without re-login (registration alone used to record a hard-coded 0.1.0).
        ...(agentVersion ? { agent_version: agentVersion } : {}),
        ...(capabilities ? { capabilities: JSON.stringify(capabilities) } : {}),
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
    const parseJson = (v: any) => {
      if (v === null || v === undefined) return undefined;
      return typeof v === 'string' ? JSON.parse(v) : v;
    };
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
      logs: row.logs ?? undefined,
      metadata: parseJson(row.metadata),
      connection_details: parseJson(row.connection_details),
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
      capabilities: typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities ?? undefined,
      last_seen: new Date(row.last_seen),
      created_at: new Date(row.created_at),
    };
  }
}
