/**
 * API routes for task management
 */

import { Request, Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { TaskQueueService } from '../service/TaskQueueService';
import { AgentService } from '../service/AgentService';
import { CreateTaskRequest } from '../types';

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
): Router {
  const router = Router();

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
        tasks: filteredTasks,
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

      return res.status(200).json(task);
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

      const task = await taskQueueService.createTask(userId, createRequest);

      logger.info('Task created, notifying agent via SSE', {
        taskId: task.task_id,
        agentId: createRequest.agent_id,
        userId,
      });

      // Notify agent immediately (fire-and-forget, don't block response)
      // Add small delay to ensure database transaction is committed
      if (agentService) {
        setTimeout(() => {
          agentService.sendPendingTasks(createRequest.agent_id).catch(err => {
            logger.warn('Failed to send immediate SSE notification to agent', {
              agentId: createRequest.agent_id,
              taskId: task.task_id,
              error: err.message,
              note: 'Agent will receive task on next heartbeat/reconnect',
            });
          });
        }, 100); // 100ms delay to ensure DB commit completes
      }

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
      if (!agentService.isAgentConnected(task.agent_id)) {
        return res.status(409).json({
          error: 'Agent not connected',
          message:
            'The target agent is not currently connected. Start the agent (`backstage-agent start`), then retry.',
        });
      }

      await agentService.sendPendingTasks(task.agent_id);
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
