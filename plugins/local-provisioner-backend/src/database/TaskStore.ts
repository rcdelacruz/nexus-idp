/**
 * Database access layer for provisioning tasks and agent registrations
 */

import { Knex } from 'knex';
import { createHash, randomUUID } from 'crypto';
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
  TRAINING_TASK_TYPES,
  PROVISION_TASK_TYPES,
} from '../types';
import { sameUser } from '../util/identity';

/**
 * The agent id a second user gets on a machine whose machine-derived id is already registered to someone else:
 * `<machine id>-<8 hex of sha256(user)>`. Stable per (machine, user), so a re-login finds the same row.
 */
export function derivedAgentId(agentId: string, userId: string): string {
  return `${agentId}-${createHash('sha256').update(userId.trim().toLowerCase()).digest('hex').slice(0, 8)}`;
}

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
    // Progress, output and the step's button belong to a step; a new step starts without them.
    if (!('progress' in fields)) delete merged.progress;
    if (!('output' in fields)) delete merged.output;
    if (!('action' in fields)) delete merged.action;
  } else if ((status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) && last !== status) {
    newStep = status;
    delete merged.progress;
    delete merged.action;
  }
  if (newStep) {
    activity.push({ at: when, step: newStep });
    activity.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  merged.activity = activity.slice(-MAX_ACTIVITY);
  if (typeof merged.output === 'string') merged.output = merged.output.slice(-MAX_OUTPUT_CHARS);
  return { metadata: merged, newStep: newStep && newStep !== status ? newStep : undefined };
}

/** A removed training lab stays in the instructor's Trainees view this long (a trainee's repo work outlives their environment). */
export const DEFAULT_TRAINING_RETENTION_DAYS = 365;
/** How much of a failed check's job log the Trainees view carries (the tail: the end of a log is where it stops). */
export const CHECK_LOG_TAIL_BYTES = 16 * 1024;

/**
 * The exit code of a failed check, read from the agent's own error text ("Job exited with 1", "Check exited with 2"). The agent
 * sends the result of a failed check as an error and a log, not as a result, so this is the only place the code survives.
 */
export function exitCodeFromError(message?: string | null): number | undefined {
  const m = /^(?:Job|Check) exited with (-?\d+)$/.exec((message ?? '').trim());
  return m ? Number(m[1]) : undefined;
}

/** Per lab and per check name, this many of the newest results are never pruned (the hourly checks would otherwise grow without end). */
const KEEP_LATEST_CHECKS = 5;

export interface CleanupOptions {
  trainingRetentionDays?: number;
  keepLatestChecks?: number;
  /** For tests: the date the clean-up behaves as if it were. */
  now?: Date;
}

/** One event of a training lab's timeline; a check event also carries its result. */
export interface TrainingHistoryEvent {
  type: string;
  status: string;
  at: Date;
  check?: { name?: string; exitCode?: number; output?: string; error?: string; logs?: string };
}

/** A training lab with its provisioning task, lifecycle/check timeline and what its agent is doing right now. */
export interface TrainingHistory {
  resource: Resource;
  provision: ProvisioningTask;
  events: TrainingHistoryEvent[];
  /** The lab's task still pending or running (provision or lifecycle), with its current step. */
  current?: { type: string; status: string; step?: string; since: Date };
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
   * Every lab on one agent that has not been torn down, each with its folded resource, the latest
   * provision task (the one lifecycle tasks target) and all its provision attempts. Feeds the
   * "which of my other labs hold the ports this one needs" check before a retry.
   */
  async getLabsForAgent(agentId: string): Promise<{ resource: Resource; provision: ProvisioningTask; provisions: ProvisioningTask[] }[]> {
    const rows = await this.db('provisioning_tasks').where({ agent_id: agentId }).orderBy('created_at', 'asc');
    const byResource = new Map<string, ProvisioningTask[]>();
    for (const t of rows.map(r => this.mapTaskFromDb(r))) {
      const group = byResource.get(t.resource_name);
      if (group) group.push(t);
      else byResource.set(t.resource_name, [t]);
    }
    const out: { resource: Resource; provision: ProvisioningTask; provisions: ProvisioningTask[] }[] = [];
    for (const group of byResource.values()) {
      const resource = foldTasksToResource(group);
      if (!resource || resource.state === ResourceState.REMOVED) continue;
      const provisions = group.filter(t => isProvisionTask(t.task_type));
      const provision = provisions[provisions.length - 1];
      if (provision) out.push({ resource, provision, provisions });
    }
    return out;
  }

  /**
   * The training labs for the instructor list: the same histories as `getTrainingResourceHistory`, but read the cheap way, because this
   * runs for every trainee on every page load. It never reads `logs` or `connection_details`, reads only the groups that have a training
   * provision task, keeps just the few `config` fields the list needs (a provision's config holds compose files and source trees, a
   * check's holds the grader and the answer key), and loads `metadata` only for tasks still open (their activity timeline) and for each
   * lab's newest completed grade (its result decides the hard-fail reason). Check results in these rows carry no log.
   */
  async getTrainingListData(): Promise<TrainingHistory[]> {
    const pg = /pg|postgres/i.test(String((this.db as any).client?.config?.client ?? ''));
    // One small `config` field as text: ->> on Postgres, json_extract on sqlite (the unit tests). Postgres has to decompress a whole
    // stored `config` (compose files, source trees, grader jobs: tens of KB) for every field it reads, so each field is read only for
    // the task types that use it: the lab id and repo URLs from provisions, the check name from checks, nothing from the rest.
    const types = (list: string[]) => list.map(() => '?').join(', ');
    const field = (key: string, alias: string, onlyFor: string[]) =>
      pg
        ? this.db.raw(`CASE WHEN ?? IN (${types(onlyFor)}) THEN ?? ->> ? END as ??`, ['t.task_type', ...onlyFor, 't.config', key, alias])
        : this.db.raw(`CASE WHEN ?? IN (${types(onlyFor)}) THEN json_extract(??, ?) END as ??`, ['t.task_type', ...onlyFor, 't.config', `$.${key}`, alias]);
    const pairs = this.db('provisioning_tasks').whereIn('task_type', TRAINING_TASK_TYPES).distinct('agent_id', 'resource_name').as('k');
    const rows = await this.db('provisioning_tasks as t')
      .join(pairs, function join() {
        this.on('k.agent_id', 't.agent_id').andOn('k.resource_name', 't.resource_name');
      })
      .select(
        't.task_id',
        't.agent_id',
        't.user_id',
        't.task_type',
        't.resource_name',
        't.status',
        't.catalog_entity_ref',
        't.error_message',
        't.created_at',
        't.updated_at',
        't.started_at',
        't.completed_at',
        field('labId', 'cfg_lab_id', PROVISION_TASK_TYPES),
        field('githubRepoUrl', 'cfg_github', PROVISION_TASK_TYPES),
        field('gitlabRepoUrl', 'cfg_gitlab', PROVISION_TASK_TYPES),
        field('checkName', 'cfg_check', [TaskType.RUN_CHECK]),
        this.db.raw('CASE WHEN t.status IN (?, ?) THEN t.metadata END as metadata', [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
      )
      .orderBy('t.created_at', 'asc');

    const tasks = rows.map((r: any) => {
      const config: Record<string, unknown> = {};
      for (const [key, col] of [['labId', 'cfg_lab_id'], ['githubRepoUrl', 'cfg_github'], ['gitlabRepoUrl', 'cfg_gitlab'], ['checkName', 'cfg_check']] as const) {
        if (r[col] !== null && r[col] !== undefined) config[key] = r[col];
      }
      return this.mapTaskFromDb({ ...r, config });
    });

    // The newest completed grade of each lab: only these results are read, in one more small query.
    const newestGrade = new Map<string, ProvisioningTask>();
    for (const t of tasks) {
      if (!isCheckTask(t.task_type) || t.status !== TaskStatus.COMPLETED || !String(t.config?.checkName ?? '').startsWith('grade')) continue;
      const key = `${t.agent_id}::${t.resource_name}`;
      const prev = newestGrade.get(key);
      if (!prev || (t.completed_at ?? t.created_at) >= (prev.completed_at ?? prev.created_at)) newestGrade.set(key, t);
    }
    const byId = new Map([...newestGrade.values()].map(t => [t.task_id, t]));
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 400) {
      for (const r of await this.db('provisioning_tasks').whereIn('task_id', ids.slice(i, i + 400)).select('task_id', 'metadata')) {
        const t = byId.get(r.task_id);
        if (t) t.metadata = this.mapTaskFromDb({ ...r, config: {} }).metadata;
      }
    }
    return this.groupTrainingHistories(tasks);
  }

  /**
   * One training lab with everything the detail needs (all columns, failed-check logs included); undefined when the group is not a
   * training lab. The caller still applies the "removed from the Trainees view" rule, as for the list.
   */
  async getTrainingResourceHistory(agentId: string, resourceName: string): Promise<TrainingHistory | undefined> {
    const rows = await this.db('provisioning_tasks').where({ agent_id: agentId, resource_name: resourceName }).orderBy('created_at', 'asc');
    return this.buildTrainingHistory(rows.map((r: any) => this.mapTaskFromDb(r)));
  }

  /** Agents by id in one query per 400 (instead of one per lab). */
  async getAgentsByIds(agentIds: string[]): Promise<Map<string, AgentRegistration>> {
    const out = new Map<string, AgentRegistration>();
    const ids = [...new Set(agentIds)];
    for (let i = 0; i < ids.length; i += 400) {
      for (const r of await this.db('agent_registrations').whereIn('agent_id', ids.slice(i, i + 400))) {
        const agent = this.mapAgentFromDb(r);
        out.set(agent.agent_id, agent);
      }
    }
    return out;
  }

  private groupTrainingHistories(tasks: ProvisioningTask[]): TrainingHistory[] {
    const byResource = new Map<string, ProvisioningTask[]>();
    for (const t of tasks) {
      const key = `${t.agent_id}::${t.resource_name}`;
      const group = byResource.get(key);
      if (group) group.push(t);
      else byResource.set(key, [t]);
    }
    const out: TrainingHistory[] = [];
    for (const group of byResource.values()) {
      const history = this.buildTrainingHistory(group);
      if (history) out.push(history);
    }
    return out;
  }

  /** The lab fold plus its timeline and check results, for one resource's tasks in creation order; undefined when not a training lab. */
  private buildTrainingHistory(group: ProvisioningTask[]): TrainingHistory | undefined {
    const resource = foldTasksToResource(group);
    if (!resource?.is_training) return undefined;
    const provision = [...group].reverse().find(t => isProvisionTask(t.task_type))!;
    const open = [...group]
      .reverse()
      .find(t => !isCheckTask(t.task_type) && (t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS));
    const activity = Array.isArray(open?.metadata?.activity) ? open!.metadata!.activity : [];
    const lastStep = activity[activity.length - 1];
    return {
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
          ? {
              check: {
                name: t.config?.checkName,
                exitCode: t.metadata?.check?.exitCode ?? exitCodeFromError(t.error_message),
                output: t.metadata?.check?.output ?? t.error_message ?? undefined,
                error: t.error_message ?? undefined,
                // Only a failed check needs its log (a finished one carries its result as `output`).
                logs: t.status === TaskStatus.FAILED && t.logs ? String(t.logs).slice(-CHECK_LOG_TAIL_BYTES) : undefined,
              },
            }
          : {}),
      })),
    };
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

  /**
   * The latest provision task (any state) of `ownerEmail` whose template-forwarded repo URL matches — the lab of a capstone repo.
   * The owner is part of the lookup: `POST /tasks` stores `config.githubRepoUrl` as given, so a task of any other user can name the
   * same repo, and the instructor's checks (manifest, grader, answer key) must only ever go to the enrolled trainee's own lab.
   */
  async findProvisionTaskByRepoUrl(repoUrl: string, ownerEmail: string): Promise<ProvisioningTask | undefined> {
    const norm = (u: unknown) => String(u ?? '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
    const rows = await this.db('provisioning_tasks').whereRaw('lower(user_id) = ?', [String(ownerEmail ?? '').trim().toLowerCase()]).orderBy('created_at', 'desc');
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
   *
   * An agent row is NEVER handed to a different user. The id comes from the caller's request body (`/agent/device/code` is
   * unauthenticated), the login only proves who the CALLER is, and the row's owner decides who receives the agent's tasks, so
   * moving the row to whoever authorizes a login for that id gave them the agent (audit 2026-11-07: anyone who knew or computed a
   * laptop's id could take over its agent and receive its pending tasks). When the row for this id belongs to someone else (an
   * account switch, a laptop handed off) the new user gets a registration of their own under a derived id; the CLI saves whatever
   * id the portal returns, so nothing else changes for them.
   */
  async upsertAgent(
    agentId: string,
    userId: string,
    hostname: string,
    platform: string,
    platformVersion: string,
    machineName?: string,
    agentVersion?: string,
  ): Promise<{ agent: AgentRegistration; reconnected: boolean; separatedFromUser?: string }> {
    // agentId is a hash of hostname + primary network MAC (see packages/backstage-agent/src/utils/machineId.ts) and is meant to be
    // stable per machine, but interface enumeration order isn't guaranteed stable across process runs on a machine with several
    // interfaces (VPN/Tailscale attaching/detaching) — a different MAC gets picked, producing a different agentId for the same
    // physical machine. Falling through to the INSERT below with a "new" agentId then violates idx_agent_hostname_user_unique
    // (500 on every device-code poll) since a row for this hostname+user already exists under the old agentId. So the lookup is
    // by agent_id first, then by (hostname, user_id), the actual DB uniqueness constraint, and the row found is updated in place.
    const byId = await this.getAgentById(agentId);
    const foreign = byId !== null && !sameUser(byId.user_id, userId);
    let wantedId = foreign ? derivedAgentId(agentId, userId) : agentId;
    if (foreign) {
      // The derived id is computable by anyone (it is a hash of public facts), so someone could register it first. That must not
      // block this user's login: take another id instead of failing on the collision.
      const atDerived = await this.getAgentById(wantedId);
      if (atDerived && !sameUser(atDerived.user_id, userId)) wantedId = `${wantedId}-${randomUUID().slice(0, 6)}`;
    }
    const existing =
      (foreign ? await this.getAgentById(wantedId) : byId) ??
      (await this.db('agent_registrations').where({ hostname, user_id: userId }).first().then(
        row => (row ? this.mapAgentFromDb(row) : null),
      ));
    if (existing && !sameUser(existing.user_id, userId)) {
      // Cannot happen with the derived id (it embeds the user), but never move a row to another user whatever the cause.
      throw new Error(`Agent ${existing.agent_id} belongs to another user`);
    }

    if (existing) {
      // Key the update on the row we actually found (existing.agent_id). When it was matched through the (hostname, user_id)
      // fallback its id may differ from the incoming one: a plain reconnect renames it to the freshly-computed id, but when the
      // computed id belongs to someone else (`foreign`) the row keeps the id it has.
      const keepId = foreign ? existing.agent_id : agentId;
      await this.db('agent_registrations')
        .where({ agent_id: existing.agent_id })
        .update({
          agent_id: keepId,
          user_id: userId,
          hostname,
          os_platform: platform,
          platform_version: platformVersion,
          machine_name: machineName,
          agent_version: agentVersion,
          // The backend's own clock: liveness is judged against Date.now() (agentLiveness.ts),
          // so stamping with the database's clock would add its drift to a 45 s window.
          last_seen: new Date(),
        });

      const updated = await this.getAgentById(keepId);
      return {
        agent: updated!,
        reconnected: true,
        separatedFromUser: foreign ? byId!.user_id : undefined,
      };
    }

    // Insert new agent with custom agent_id
    const [agent] = await this.db('agent_registrations')
      .insert({
        agent_id: wantedId, // machine-based ID from the CLI, or the derived one when that id belongs to another user
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
      separatedFromUser: foreign ? byId!.user_id : undefined,
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
        last_seen: new Date(), // backend clock, same one the age is measured with
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
   * Nightly clean-up of finished task rows.
   *
   * It used to delete EVERY completed/failed row older than the retention (30 days). A lab's state is folded from its rows, so that
   * made a lab that was still running vanish from the portal and the catalog, a stopped lab fold back to "running" (only its stop
   * row was gone), a removed training lab disappear from the instructor's Trainees view (a trainee's repo work outlives their
   * environment) and every grade result vanish after a month.
   *
   * Now it works per lab (agent + resource name):
   *  - a lab that still exists keeps every row that says what it is; only old routine check results go, and the newest few of each
   *    check (grades included) always stay;
   *  - a lab that is gone (removed, or a failed attempt that never produced a lab) goes completely, all rows at once, once its
   *    newest row is older than the retention: a year for training labs, `retentionDays` for the rest;
   *  - a lab with something still pending or running is left alone.
   */
  async cleanupOldTasks(retentionDays: number, options: CleanupOptions = {}): Promise<number> {
    const now = (options.now ?? new Date()).getTime();
    const trainingDays = Math.max(options.trainingRetentionDays ?? DEFAULT_TRAINING_RETENTION_DAYS, retentionDays);
    const keepChecks = options.keepLatestChecks ?? KEEP_LATEST_CHECKS;
    const olderThan = (at: number, days: number) => at < now - days * 86_400_000;

    const rows = await this.db('provisioning_tasks').orderBy('created_at', 'asc');
    const groups = new Map<string, ProvisioningTask[]>();
    for (const t of rows.map(r => this.mapTaskFromDb(r))) {
      const key = `${t.agent_id}::${t.resource_name}`;
      const group = groups.get(key);
      if (group) group.push(t);
      else groups.set(key, [t]);
    }

    const terminal = (t: ProvisioningTask) => t.status === TaskStatus.COMPLETED || t.status === TaskStatus.FAILED;
    const endedAt = (t: ProvisioningTask) => (t.completed_at ?? t.updated_at).getTime();
    const doomed: string[] = [];

    for (const group of groups.values()) {
      const resource = foldTasksToResource(group);
      const hadLab = group.some(t => isProvisionTask(t.task_type) && t.status === TaskStatus.COMPLETED);
      const gone = !resource || resource.state === ResourceState.REMOVED || (resource.state === ResourceState.ERROR && !hadLab);

      if (gone) {
        if (!group.every(terminal)) continue;
        const days = resource?.is_training ? trainingDays : retentionDays;
        if (olderThan(Math.max(...group.map(endedAt)), days)) doomed.push(...group.map(t => t.task_id));
        continue;
      }

      // The lab exists: only old routine check results are pruned, the newest few of each check stay.
      const byCheck = new Map<string, ProvisioningTask[]>();
      for (const t of group.filter(g => isCheckTask(g.task_type) && terminal(g))) {
        const name = String(t.config?.checkName ?? '');
        const list = byCheck.get(name);
        if (list) list.push(t);
        else byCheck.set(name, [t]);
      }
      for (const list of byCheck.values()) {
        const newestFirst = [...list].sort((a, b) => endedAt(b) - endedAt(a));
        for (const t of newestFirst.slice(keepChecks)) {
          if (olderThan(endedAt(t), retentionDays)) doomed.push(t.task_id);
        }
      }
    }

    let deleted = 0;
    for (let i = 0; i < doomed.length; i += 500) {
      deleted += await this.db('provisioning_tasks')
        .whereIn('task_id', doomed.slice(i, i + 500))
        .delete();
    }
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
