/**
 * API routes for task management
 */

import { Request, Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CheckRowProtectedError, TaskQueueService } from '../service/TaskQueueService';
import { AgentService } from '../service/AgentService';
import { findLeftover, findPortConflicts } from '../service/portConflicts';
import { TraineeActivityService } from '../service/traineeActivity/TraineeActivityService';
import { MIN_CHECK_AGENT, MIN_WORKSPACE_MOUNT_AGENT, supportsChecks } from '../capstones/capstoneRoutes';
import {
  CreateTaskRequest,
  ProvisioningTask,
  ResourceState,
  TaskType,
  isCheckTask,
  isLifecycleTask,
  lookupByResourceType,
  resourceTypeForTask,
  validateTrainingTask,
  isVmLabTask,
} from '../types';
import { sameUser } from '../util/identity';

/**
 * Lifecycle transitions that are no-ops or invalid given a resource's current state — e.g.
 * clicking "Start" on a resource that's already running. Keyed by task_type, valued by the
 * ResourceStates it's valid to run from. `deprovision` is valid from anything except `removed`
 * (already-torn-down); the others require a specific starting state.
 */
const VALID_FROM_STATE: Partial<Record<TaskType, ResourceState[]>> = {
  [TaskType.STOP]: [ResourceState.RUNNING],
  [TaskType.START]: [ResourceState.STOPPED],
  [TaskType.RESTART]: [ResourceState.RUNNING, ResourceState.STOPPED],
  [TaskType.DEPROVISION]: [
    ResourceState.RUNNING,
    ResourceState.STOPPED,
    ResourceState.ERROR,
    ResourceState.PROVISIONING,
  ],
};

/**
 * Resolve the authenticated user's email, as attached by the auth middleware in
 * `service/router.ts`. Task rows are keyed on email (`user_id`).
 *
 * Returns undefined rather than defaulting: these routes are all behind authentication, so a
 * missing identity means something is wrong, and substituting a placeholder would silently
 * merge every user's tasks into one account (which is exactly what happened before
 * 2026-07-24).
 */
function getUserId(req: Request): string | undefined {
  return (req as any).user?.email;
}

/**
 * A check task (an instructor's grade or probe) is queued on the trainee's lab, so it sits in the trainee's own task list. Its
 * config holds the grader and the answer key (job files), its logs and result hold the hidden expected values: instructors read
 * those through the Trainees view (store level), never through the trainee's list, so they are removed from the routes that
 * answer the task's owner (`GET /tasks`, `GET /tasks/:taskId`).
 */
export function hideCheckInternals(task: ProvisioningTask): ProvisioningTask {
  const exitCode = task.metadata?.check?.exitCode;
  const generic = /^(Check|Job) exited with -?\d+$/.test(task.error_message ?? '');
  return {
    ...task,
    config: { checkName: task.config?.checkName, targetTaskId: task.config?.targetTaskId },
    logs: undefined,
    metadata: exitCode === undefined ? {} : { check: { exitCode } },
    error_message: task.error_message && !generic ? 'The check did not complete.' : task.error_message,
  };
}

/** Most rows one `activity` call may name, and most for the full level (nine to eleven GitHub calls each). */
export const TRAINEE_ACTIVITY_MAX_KEYS = 50;
export const TRAINEE_ACTIVITY_MAX_FULL_KEYS = 5;
/** `lab:<agent>::<name>`: resource names are free text, so the key has a cap of its own. */
export const TRAINEE_KEY_MAX_LENGTH = 400;

/**
 * Create task-related API routes
 */
export function createTaskRoutes(
  taskQueueService: TaskQueueService,
  logger: LoggerService,
  agentService?: AgentService,
  resourceDocsUrls: Record<string, string> = {},
  traineeActivity?: TraineeActivityService,
): Router {
  const router = Router({ caseSensitive: true }); // see service/router.ts: the permission mapping is keyed on the exact path

  /**
   * Attach `docs_url` (e.g. training materials) for the task's resource type, if configured via
   * `localProvisioner.resourceDocsUrls`. Only provision-* task types have a resource type
   * (`resourceTypeForTask` returns undefined for lifecycle tasks), so lifecycle rows pass through
   * unchanged — same scoping as `catalog_entity_ref`, which is likewise only meaningful on the
   * task that provisioned the resource.
   */
  const withDocsLink = (task: ProvisioningTask): ProvisioningTask => {
    const resourceType = resourceTypeForTask(task.task_type, task.config);
    const docsUrl = lookupByResourceType(resourceDocsUrls, resourceType);
    return docsUrl ? { ...task, docs_url: docsUrl } : task;
  };

  /**
   * What the owner of a task is allowed to see: check rows (an instructor's grade or probe, queued on the trainee's lab) are
   * reduced by `hideCheckInternals`. `GET /admin/all` (admins) keeps the full rows.
   */
  const forOwner = (task: ProvisioningTask): ProvisioningTask =>
    isCheckTask(task.task_type) ? hideCheckInternals(task) : withDocsLink(task);

  /**
   * GET /tasks
   * Get all tasks for current user
   *
   * Query parameters:
   * - agentId: Filter tasks by agent ID (optional)
   */
  router.get('/', async (req, res) => {
    try {
      // Identity is resolved by the auth middleware in service/router.ts.
      // No fallback: an unresolved user must fail loudly, not silently share one identity.
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }

      const tasks = await taskQueueService.getTasksForUser(userId);

      // Filter by agentId if provided
      const { agentId } = req.query;
      const filteredTasks = agentId
        ? tasks.filter(task => task.agent_id === agentId)
        : tasks;

      return res.status(200).json({
        tasks: filteredTasks.map(forOwner),
        total: filteredTasks.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to fetch tasks',
        message: error.message,
      });
    }
  });

  /**
   * GET /tasks/resources
   * Get the resource-centric (folded) view of the current user's provisioned resources —
   * used by the UI to know each resource's live state (running/stopped/etc.) rather than
   * inferring it from a single historical task row.
   */
  router.get('/resources', async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }

      const resources = await taskQueueService.getResourcesForUser(userId);

      return res.status(200).json({ resources });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to fetch resources',
        message: error.message,
      });
    }
  });

  /**
   * GET /tasks/admin/all
   * Admin activity view: tasks across ALL users, most recent first. Gated by
   * `taskReadAllPermission` in the auth middleware (service/router.ts) — reachable
   * here only because that check already passed.
   *
   * Query parameters:
   * - userId: scope to one user's tasks (optional)
   * - limit, offset: pagination (optional, default limit 200)
   */
  router.get('/admin/all', async (req, res) => {
    try {
      const { userId, limit, offset } = req.query;

      const tasks = await taskQueueService.getAllTasks({
        userId: typeof userId === 'string' ? userId : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });

      return res.status(200).json({
        tasks: tasks.map(withDocsLink),
        total: tasks.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to fetch tasks',
        message: error.message,
      });
    }
  });

  /**
   * The instructor Trainees view, in three calls (all gated by `traineesReadPermission` in the auth middleware, service/router.ts, so
   * admins + instructors only; registered before `/:taskId` so they are not shadowed):
   *
   * GET  /tasks/admin/trainees/list      every training lab and capstone, database only (no GitHub), small rows, most serious first
   * POST /tasks/admin/trainees/activity  { keys[<=50], level: brief|full, refresh? } GitHub activity of the rows named by key
   * GET  /tasks/admin/trainees/detail?key=  one trainee in full (timeline and every check result), database only
   *
   * Keys are the opaque `key` of a list row; the repository, lab and enrollment are looked up from the portal's own records.
   */
  router.get('/admin/trainees/list', async (_req, res) => {
    if (!traineeActivity) {
      return res.status(501).json({ error: 'Trainee activity is not configured' });
    }
    try {
      const trainees = await traineeActivity.listTrainees();
      return res.status(200).json({ trainees, generatedAt: new Date().toISOString() });
    } catch (error: any) {
      logger.error('Failed to build the trainee list', error);
      return res.status(500).json({ error: 'Failed to load trainees', message: error.message });
    }
  });

  router.post('/admin/trainees/activity', async (req, res) => {
    if (!traineeActivity) {
      return res.status(501).json({ error: 'Trainee activity is not configured' });
    }
    const b = req.body ?? {};
    if (!Array.isArray(b.keys) || b.keys.length === 0 || b.keys.length > TRAINEE_ACTIVITY_MAX_KEYS) {
      return res.status(400).json({ error: `keys must be a list of 1 to ${TRAINEE_ACTIVITY_MAX_KEYS} row keys` });
    }
    if (b.keys.some((k: unknown) => typeof k !== 'string' || k.length === 0 || k.length > TRAINEE_KEY_MAX_LENGTH)) {
      return res.status(400).json({ error: 'every key must be a text of at most 400 characters' });
    }
    if (b.level !== undefined && b.level !== 'brief' && b.level !== 'full') {
      return res.status(400).json({ error: 'level must be "brief" or "full"' });
    }
    const level = b.level === 'full' ? 'full' : 'brief';
    if (level === 'full' && b.keys.length > TRAINEE_ACTIVITY_MAX_FULL_KEYS) {
      return res.status(400).json({ error: `the full level takes at most ${TRAINEE_ACTIVITY_MAX_FULL_KEYS} keys` });
    }
    try {
      const activity = await traineeActivity.activity(b.keys, level, b.refresh === true);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ activity });
    } catch (error: any) {
      logger.error('Failed to read trainee activity', error);
      return res.status(500).json({ error: 'Failed to load trainee activity', message: error.message });
    }
  });

  router.get('/admin/trainees/detail', async (req, res) => {
    if (!traineeActivity) {
      return res.status(501).json({ error: 'Trainee activity is not configured' });
    }
    const key = req.query.key;
    if (typeof key !== 'string' || key.length === 0 || key.length > TRAINEE_KEY_MAX_LENGTH) {
      return res.status(400).json({ error: 'key must be the key of a row of the list' });
    }
    try {
      const trainee = await traineeActivity.detail(key);
      if (!trainee) return res.status(404).json({ error: 'Trainee not found' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ trainee });
    } catch (error: any) {
      logger.error('Failed to read the trainee', error);
      return res.status(500).json({ error: 'Failed to load the trainee', message: error.message });
    }
  });

  /**
   * POST /tasks/admin/trainees/remove  { agentId?, resourceName?, enrollmentId?, deleteRepo }
   * Instructor "Remove trainee": hides the lab and/or withdraws the capstone enrollment, and can
   * delete the trainee's repo (only after it is proven to be their lab repo). Gated by
   * `traineesManagePermission` in the auth middleware — admins + instructors only.
   */
  router.post('/admin/trainees/remove', async (req, res) => {
    if (!traineeActivity) {
      return res.status(501).json({ error: 'Trainee activity is not configured' });
    }
    const b = req.body ?? {};
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    try {
      const r = await traineeActivity.removeTrainee(
        { agentId: str(b.agentId), resourceName: str(b.resourceName), enrollmentId: str(b.enrollmentId), deleteRepo: b.deleteRepo === true },
        getUserId(req) ?? 'unknown',
      );
      if (r.status !== 200) return res.status(r.status).json({ error: r.error });
      return res.status(200).json({ removed: true, repoDeleted: r.repoDeleted ?? null });
    } catch (error: any) {
      logger.error('Failed to remove trainee', error);
      return res.status(500).json({ error: 'Failed to remove trainee', message: error.message });
    }
  });

  /**
   * GET /tasks/:taskId
   * Get specific task by ID
   */
  router.get('/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;

      const task = await taskQueueService.getTask(taskId);

      if (!task) {
        return res.status(404).json({
          error: 'Task not found',
          taskId,
        });
      }

      // Verify task belongs to user.
      // No fallback: without a resolved identity this ownership check is meaningless.
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }
      if (task.user_id !== userId) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view this task',
        });
      }

      return res.status(200).json(forOwner(task));
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to fetch task',
        message: error.message,
      });
    }
  });

  /**
   * GET /tasks/:taskId/retry-conflicts
   * What Retry has to deal with first: `conflicts` = the caller's other running labs on this task's
   * agent that hold a host port the task needs (offer to remove them: a port can be held by one
   * container only); `leftover` = the half-made VM a failed attempt of this same lab may have left
   * (removed before the retry, or it would stop at "instance already exists").
   */
  router.get('/:taskId/retry-conflicts', async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }
      const task = await taskQueueService.getTask(req.params.taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found', taskId: req.params.taskId });
      }
      if (task.user_id !== userId) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view this task',
        });
      }
      // One read of the agent's labs (it loads the agent's whole task history) shared by both checks.
      const labs = await taskQueueService.getLabsForAgent(task.agent_id);
      const source = { getLabsForAgent: async () => labs };
      const [conflicts, leftover] = await Promise.all([
        findPortConflicts(task, userId, source),
        findLeftover(task, userId, source),
      ]);
      return res.status(200).json({ conflicts, leftover: leftover ?? null });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to check port conflicts',
        message: error.message,
      });
    }
  });

  /**
   * POST /tasks
   * Create a new provisioning task
   */
  router.post('/', async (req, res) => {
    try {
      // Identity is resolved by the auth middleware in service/router.ts.
      // No fallback: an unresolved user must fail loudly, not silently share one identity.
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }

      const createRequest: CreateTaskRequest = req.body;

      // Validate request
      if (!createRequest.agent_id) {
        return res.status(400).json({
          error: 'Missing agent_id in request body',
        });
      }

      if (!createRequest.task_type) {
        return res.status(400).json({
          error: 'Missing task_type in request body',
        });
      }

      if (!createRequest.resource_name) {
        return res.status(400).json({
          error: 'Missing resource_name in request body',
        });
      }

      if (!createRequest.config) {
        return res.status(400).json({
          error: 'Missing config in request body',
        });
      }

      // Generic training labs: labId shape + dockerCompose presence. Before the offline-agent
      // check — a malformed request is a 400 whatever the agent's state.
      // Instructor checks run inside a trainee's lab: only the instructor endpoint
      // (POST /capstones/enrollments/:id/checks/:name, capstones.manage) may queue them.
      if (createRequest.task_type === TaskType.RUN_CHECK) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Checks are queued by instructors from the Trainees view',
        });
      }

      const trainingError = validateTrainingTask(createRequest);
      if (trainingError) {
        return res.status(400).json({
          error: 'Invalid training task',
          message: trainingError,
        });
      }

      // A task runs on the laptop of the agent's owner: only that person may queue one there. (Before this check, anyone who knew
      // another person's agent id could queue their own compose file onto that person's machine.) An unknown agent id falls through
      // to the existing checks below; this is placed before the ones that look the agent up and echo its details back.
      if (agentService) {
        const targetAgent = await agentService.getAgentById(createRequest.agent_id);
        if (targetAgent && !sameUser(targetAgent.user_id, userId)) {
          logger.warn(`Refused a task for agent ${createRequest.agent_id}: it belongs to another user than ${userId}`);
          return res.status(403).json({
            error: 'Forbidden',
            message: 'This agent belongs to another user',
          });
        }
      }

      // Single chokepoint guard: refuse to queue ANY task (provision or lifecycle stop/start/
      // restart/deprovision) to an offline agent — it would sit "pending" forever. Every path
      // (scaffolder, direct API, UI lifecycle buttons) creates tasks here, so this one check
      // covers them all.
      // An agent older than 0.1.23 doesn't know VM labs and would provision its bundled Docker
      // template instead, so VM labs only go to agents that support them.
      if (isVmLabTask(createRequest) && agentService) {
        const agent = await agentService.getAgentById(createRequest.agent_id);
        if (!supportsChecks(agent?.agent_version)) {
          return res.status(409).json({
            error: 'Agent too old',
            message: `This lab runs a VM and needs backstage-agent ${MIN_CHECK_AGENT}+ (yours: ${agent?.agent_version ?? 'unknown'}). Run \`backstage-agent update\`, then retry.`,
          });
        }
      }

      // A lab that mounts the trainee's repo needs the agent to clone it first; an older agent
      // would start the container with an empty mount path and fail with a Docker error.
      if ((createRequest.config as any)?.workspaceMount === true && agentService) {
        const agent = await agentService.getAgentById(createRequest.agent_id);
        if (!supportsChecks(agent?.agent_version, MIN_WORKSPACE_MOUNT_AGENT)) {
          return res.status(409).json({
            error: 'Agent too old',
            message: `This lab works on your cloned repo and needs backstage-agent ${MIN_WORKSPACE_MOUNT_AGENT}+ (yours: ${agent?.agent_version ?? 'unknown'}). Run \`backstage-agent update\`, then retry.`,
          });
        }
      }

      // Confirmed, not inferred: queueing a lab to an agent that has already gone leaves the
      // trainee with a half-made lab (AgentService.confirmAgentOnline wakes the agent's poll and
      // needs it to answer; a live agent takes about a second).
      if (agentService && !(await agentService.confirmAgentOnline(createRequest.agent_id))) {
        return res.status(409).json({
          error: 'Agent offline',
          message:
            'The target agent is not online, so this task cannot run. Start it with ' +
            '`backstage-agent start` (or `backstage-agent login` if your session expired), then retry.',
        });
      }

      // Same chokepoint: reject a lifecycle action that doesn't make sense for the resource's
      // current state (e.g. "Start" on an already-running resource, "Stop" on one that's already
      // stopped). Provision tasks aren't covered by VALID_FROM_STATE and pass through unchecked.
      const validFromStates = VALID_FROM_STATE[createRequest.task_type as TaskType];
      if (isLifecycleTask(createRequest.task_type) && validFromStates) {
        const resource = await taskQueueService.getResourceState(
          createRequest.agent_id,
          createRequest.resource_name,
        );
        const currentState = resource?.state ?? ResourceState.ERROR;
        if (!validFromStates.includes(currentState)) {
          return res.status(409).json({
            error: 'Invalid resource state',
            message: `Cannot ${createRequest.task_type} "${createRequest.resource_name}" — it is currently ${currentState}.`,
          });
        }
      }

      const task = await taskQueueService.createTask(userId, createRequest);

      logger.info('Task created, notifying agent', {
        taskId: task.task_id,
        agentId: createRequest.agent_id,
        userId,
      });

      // Wakes the agent's parked long-poll immediately if one is open — purely in-memory (no
      // DB/network call of its own), so no artificial delay is needed the way the old SSE path
      // needed one for the write to land first: createTask() above has already resolved, and
      // the agent's own re-check of pending tasks reads from the same primary. If nothing is
      // parked (agent between poll cycles), this is a no-op — the agent picks the task up on
      // its next poll regardless, within POLL_TIMEOUT_MS.
      agentService?.notifyAgent(createRequest.agent_id);

      return res.status(201).json({
        task_id: task.task_id,
        message: 'Task created successfully',
        task,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to create task',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /tasks/:taskId
   * Delete a task
   */
  router.delete('/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;

      // Identity is resolved by the auth middleware in service/router.ts.
      // No fallback: an unresolved user must fail loudly, not silently share one identity.
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }

      await taskQueueService.deleteTask(taskId, userId);

      return res.status(200).json({
        message: 'Task deleted successfully',
        taskId,
      });
    } catch (error: any) {
      // First: by type, not by message (the messages below are matched by substring).
      if (error instanceof CheckRowProtectedError) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Instructor checks cannot be deleted',
        });
      }

      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: 'Task not found',
          taskId: req.params.taskId,
        });
      }

      if (error.message.includes('does not belong to user')) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to delete this task',
        });
      }

      if (error.message.includes('cannot be deleted')) {
        return res.status(409).json({
          error: 'Resource still active',
          message: error.message,
        });
      }

      return res.status(500).json({
        error: 'Failed to delete task',
        message: error.message,
      });
    }
  });

  /**
   * POST /tasks/:taskId/dispatch
   * Re-send a task to its agent (stuck-task recovery). If a task is stuck in pending/in-progress
   * because its SSE delivery was missed (e.g. the backend restarted mid-flight), this re-triggers
   * delivery to the connected agent — the one-click fix for the strand-on-restart failure.
   */
  router.post('/:taskId/dispatch', async (req, res) => {
    try {
      const { taskId } = req.params;
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }

      const task = await taskQueueService.getTask(taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found', taskId });
      }
      if (task.user_id !== userId) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to dispatch this task',
        });
      }

      if (!agentService) {
        return res.status(503).json({ error: 'Agent service unavailable' });
      }
      if (!(await agentService.isAgentOnline(task.agent_id))) {
        return res.status(409).json({
          error: 'Agent not connected',
          message:
            'The target agent is not currently connected. Start the agent (`backstage-agent start`), then retry.',
        });
      }

      agentService.notifyAgent(task.agent_id);
      logger.info(`Re-dispatched task ${taskId} to agent ${task.agent_id}`, { taskId, userId });

      return res.status(200).json({ message: 'Task re-dispatched to agent', taskId });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to dispatch task',
        message: error.message,
      });
    }
  });

  /**
   * GET /tasks/stats
   * Get task statistics for current user
   */
  router.get('/stats/summary', async (req, res) => {
    try {
      // Identity is resolved by the auth middleware in service/router.ts.
      // No fallback: an unresolved user must fail loudly, not silently share one identity.
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Could not resolve authenticated user',
        });
      }

      const stats = await taskQueueService.getTaskStats(userId);

      return res.status(200).json(stats);
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to fetch task stats',
        message: error.message,
      });
    }
  });

  return router;
}
