/**
 * API routes for task management
 */

import { Request, Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { TaskQueueService } from '../service/TaskQueueService';
import { AgentService } from '../service/AgentService';
import { CreateTaskRequest, ProvisioningTask, ResourceState, TaskType, isLifecycleTask, resourceTypeForTask } from '../types';

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
 * Create task-related API routes
 */
export function createTaskRoutes(
  taskQueueService: TaskQueueService,
  logger: LoggerService,
  agentService?: AgentService,
  resourceDocsUrls: Record<string, string> = {},
): Router {
  const router = Router();

  /**
   * Attach `docs_url` (e.g. training materials) for the task's resource type, if configured via
   * `localProvisioner.resourceDocsUrls`. Only provision-* task types have a resource type
   * (`resourceTypeForTask` returns undefined for lifecycle tasks), so lifecycle rows pass through
   * unchanged — same scoping as `catalog_entity_ref`, which is likewise only meaningful on the
   * task that provisioned the resource.
   */
  const withDocsLink = (task: ProvisioningTask): ProvisioningTask => {
    const resourceType = resourceTypeForTask(task.task_type);
    const docsUrl = resourceType ? resourceDocsUrls[resourceType] : undefined;
    return docsUrl ? { ...task, docs_url: docsUrl } : task;
  };

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
        tasks: filteredTasks.map(withDocsLink),
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

      return res.status(200).json(withDocsLink(task));
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to fetch task',
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

      // Single chokepoint guard: refuse to queue ANY task (provision or lifecycle stop/start/
      // restart/deprovision) to an offline agent — it would sit "pending" forever. Every path
      // (scaffolder, direct API, UI lifecycle buttons) creates tasks here, so this one check
      // covers them all.
      if (agentService && !(await agentService.isAgentOnline(createRequest.agent_id))) {
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
