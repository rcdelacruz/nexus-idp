/**
 * Express router setup for Local Provisioner backend plugin
 */

import { Router } from 'express';
import express from 'express';
import {
  DatabaseService,
  DiscoveryService,
  LoggerService,
  HttpAuthService,
  PermissionsService,
  SchedulerService,
} from '@backstage/backend-plugin-api';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { Config } from '@backstage/config';

import { TaskStore } from '../database/TaskStore';
import { resolveSharedTaskStore } from '../sharedStore';
import { DefaultGithubCredentialsProvider, ScmIntegrations } from '@backstage/integration';
import { TraineeActivityService } from './traineeActivity/TraineeActivityService';
import { CapstoneStore } from '../capstones/CapstoneStore';
import { TaskType } from '../types';
import { createCapstoneRoutes, LabOps, queueEnrollmentCheck } from '../capstones/capstoneRoutes';
import { capstoneById } from '../capstones/definitions';
import { createSeedReportRoute } from '../capstones/seedReportRoute';
import {
  taskCreatePermission,
  taskReadPermission,
  taskReadAllPermission,
  traineesReadPermission,
  traineesManagePermission,
  capstonesEnrollPermission,
  capstonesManagePermission,
  taskDeletePermission,
} from '../permissions';
import { TaskQueueService } from './TaskQueueService';
import { AgentService } from './AgentService';
// import { CatalogService } from './CatalogService'; // Reserved for future use
import { createAgentRoutes } from '../api/agentRoutes';
import { createTaskRoutes } from '../api/taskRoutes';
import { createHealthRoutes } from '../api/healthRoutes';
import { extractEmailFromEntityRef } from '../util/identity';
import { isPublicAgentPath } from '../util/publicPaths';
import { readResourceDocsUrls } from '../util/resourceDocsLinks';

/**
 * Router dependencies
 */
export interface RouterOptions {
  logger: LoggerService;
  database: DatabaseService;
  discovery: DiscoveryService;
  config: Config;
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  /** For scheduled capstone checks; optional so tests can build the router without it. */
  scheduler?: SchedulerService;
}

/**
 * Map a task-route request to the permission it requires, or undefined if none applies.
 * Only the UI-facing `/tasks` surface is permission-gated; agent endpoints use service tokens.
 * Paths here are relative to the plugin mount (the middleware runs before `/tasks` prefixing,
 * so `req.path` includes it).
 */
export function permissionForRequest(method: string, path: string) {
  if (path === '/capstones' || path.startsWith('/capstones/')) {
    // Self-enrollment (and linking your own repo) is open to signed-in users; every other
    // capstone route exposes seeds/credentials/answer keys, so it defaults to manage.
    const p = path.replace(/\/+$/, '');
    if (method === 'POST' && p === '/capstones/enrollments') return capstonesEnrollPermission;
    if (method === 'PUT' && /^\/capstones\/enrollments\/[^/]+\/repo$/.test(p)) return capstonesEnrollPermission;
    return capstonesManagePermission;
  }
  if (!path.startsWith('/tasks')) return undefined;
  // Every /tasks/admin/* route is cross-user: writes there must never fall through to the
  // per-user task permissions below (a POST would otherwise need only task.create).
  if (method !== 'GET' && path.startsWith('/tasks/admin')) {
    if (method === 'POST' && path.replace(/\/+$/, '') === '/tasks/admin/trainees/remove') return traineesManagePermission;
    return taskReadAllPermission;
  }
  switch (method) {
    case 'POST':
      // Covers create (/tasks) and re-dispatch (/tasks/:id/dispatch).
      return taskCreatePermission;
    case 'DELETE':
      return taskDeletePermission;
    case 'GET':
      // /tasks/admin/all has no per-user scoping in the handler — it requires the
      // separate, admin-only taskReadAllPermission rather than the regular
      // (own-tasks-only) taskReadPermission. Must be checked before the generic case.
      // Every /tasks/admin/* route is cross-user, so it defaults to the strict read-all
      // permission; a trailing slash must not fall through to taskReadPermission.
      if (path.replace(/\/+$/, '') === '/tasks/admin/trainees') return traineesReadPermission;
      if (path.startsWith('/tasks/admin')) return taskReadAllPermission;
      return taskReadPermission;
    default:
      return undefined;
  }
}

/**
 * Create the Express router for the Local Provisioner plugin
 */
export async function createRouter(
  options: RouterOptions,
): Promise<Router> {
  const { logger, database, config, httpAuth, permissions, discovery, scheduler } = options;

  logger.info('Initializing Local Provisioner plugin router');

  // Get database client
  // Note: Database migrations are now handled separately:
  // - Production: Init container runs migrations before main app starts
  // - Development: Run `node scripts/run-migrations.js` manually or via npm script
  const db = await database.getClient();

  // Verify database connection and that migrations have been run
  logger.info('Verifying database connection and schema...');
  try {
    await db.raw('SELECT 1');

    // Check if required tables exist
    const hasTasksTable = await db.schema.hasTable('provisioning_tasks');
    const hasAgentsTable = await db.schema.hasTable('agent_registrations');

    if (!hasTasksTable || !hasAgentsTable) {
      throw new Error(
        'Database tables are missing. Please run migrations using the init container or manually with `node scripts/run-migrations.js`'
      );
    }

    logger.info('Database schema verified - all required tables exist');
  } catch (error: any) {
    logger.error('Database verification failed', error);
    throw error;
  }

  // Get plugin configuration
  const pluginConfig = config.getOptionalConfig('localProvisioner');
  // Long-poll timeout — comfortably under Cloudflare's ~100s ceiling on how long it holds a
  // connection open waiting for an origin response (see AgentService.longPoll).
  const pollTimeoutSeconds = pluginConfig?.getOptionalNumber('pollTimeoutSeconds') ?? 25;
  const taskRetentionDays = pluginConfig?.getOptionalNumber('taskRetentionDays') ?? 30;
  const resourceDocsUrls = readResourceDocsUrls(config);

  logger.info('Plugin configuration loaded', {
    pollTimeoutSeconds,
    taskRetentionDays,
  });

  // Initialize services
  const taskStore = new TaskStore(db);
  // Bridge TaskStore to the catalog module's EntityProvider (resolves taskStoreReady).
  resolveSharedTaskStore(taskStore);
  const taskQueueService = new TaskQueueService(logger, taskStore);
  const agentService = new AgentService(
    logger,
    taskStore,
    taskQueueService,
    config,
    pollTimeoutSeconds,
  );
  // Instructor Trainees view: GitHub repo activity read with the configured integration
  // credentials (integrations.github). Only github.com URLs are ever fetched (see
  // parseGithubRepoUrl), so the token can't be sent to a host named in task config.
  const githubCredentials = DefaultGithubCredentialsProvider.fromIntegrations(
    ScmIntegrations.fromConfig(config),
  );
  const getGithubToken = async (url: string) => (await githubCredentials.getCredentials({ url })).token;
  const capstoneStore = new CapstoneStore(db);
  const traineeActivity = new TraineeActivityService(
    taskStore,
    getGithubToken,
    logger,
    undefined,
    undefined,
    capstoneStore,
    config.getOptionalString('organization.githubOwner'),
  );
  // CatalogService will be used for future catalog integration
  // const catalogService = new CatalogService(logger, discovery);

  logger.info('Services initialized successfully');

  // Create Express router
  const router = Router();

  // Middleware
  // Default 100kb limit is too small for tasks carrying a base64-encoded source tree
  // (stratpoint:local-provision's sourceFiles, e.g. devops/devsecops-capstone-training).
  // Public, token-authenticated seed reports: before the 10 MB parser below, with their own small
  // limit and the token checked before any body is read.
  router.use('/capstones/seed-report', createSeedReportRoute({ store: capstoneStore, logger, getGithubToken }));
  router.use(express.json({ limit: '10mb' }));

  // Log all requests
  router.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      query: req.query,
    });
    next();
  });

  // Authentication middleware (layer 2). Public agent paths are defined once in
  // util/publicPaths and shared with the framework barrier in plugin.ts so the two cannot
  // drift. Everything not public requires a Backstage credential; identity is attached to
  // req.user for downstream handlers.
  router.use(async (req, res, next) => {
    if (isPublicAgentPath(req.path)) {
      logger.debug('Skipping authentication for public path', {
        path: req.path,
      });
      return next();
    }

    // For protected routes, authentication is required
    try {
      const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });

      // Attach user info to request for downstream handlers.
      //
      // `email` is required: task rows are keyed on user email (`user_id`), and taskRoutes
      // reads `req.user.email`. Before 2026-07-24 this object carried only `userEntityRef`,
      // so every task operation silently fell back to a hardcoded address and all users
      // shared one identity.
      (req as any).user = {
        userEntityRef: credentials.principal.userEntityRef,
        email: extractEmailFromEntityRef(credentials.principal.userEntityRef),
      };

      // RBAC (layer 3): map the UI-facing task routes to a permission and enforce it. The
      // permission framework's policy decides ALLOW/DENY (previously these were defined but
      // never enforced). Agent endpoints are excluded — they authenticate via service token.
      const permission = permissionForRequest(req.method, req.path);
      if (permission) {
        const [decision] = await permissions.authorize([{ permission }], { credentials });
        if (decision.result !== AuthorizeResult.ALLOW) {
          logger.warn('Authorization denied', { path: req.path, permission: permission.name });
          res.status(403).json({
            error: 'Forbidden',
            message: `You do not have permission: ${permission.name}`,
          });
          return undefined;
        }
      }

      logger.debug('Authentication successful', {
        path: req.path,
        userEntityRef: credentials.principal.userEntityRef,
      });

      return next();
    } catch (error: any) {
      logger.warn('Authentication failed', {
        path: req.path,
        error: error.message,
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid Backstage authentication required',
      });
      return undefined;
    }
  });

  // Mount route handlers
  // Health endpoints are public (configured via httpRouter.addAuthPolicy in plugin.ts)
  router.use('/health', createHealthRoutes(db));
  // Agent and task endpoints require authentication (enforced by middleware above)
  router.use('/agent', createAgentRoutes(agentService, logger, taskQueueService));
  router.use('/tasks', createTaskRoutes(taskQueueService, logger, agentService, resourceDocsUrls, traineeActivity));
  // Instructor lab checks (run-check via the trainee's agent) — shared by the Trainees view's Run
  // buttons and the scheduled checks below.
  const labs: LabOps = {
    findLabTask: repoUrl => taskStore.findProvisionTaskByRepoUrl(repoUrl),
    resourceState: async (agentId, name) => (await taskStore.getResourceState(agentId, name))?.state,
    isAgentOnline: agentId => agentService.isAgentOnline(agentId),
  hasPendingCheck: (agentId, name) => taskStore.hasOpenTask(agentId, name, TaskType.RUN_CHECK),
  fetchSourceFile: async (sourceRepo, branch, filePath) => {
    const token = await getGithubToken(`https://github.com/${sourceRepo}`);
    const res = await fetch(`https://api.github.com/repos/${sourceRepo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nexus-idp-local-provisioner',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`Could not read ${sourceRepo}/${filePath} (${res.status})`);
    return String(((await res.json()) as any).content ?? '').replace(/\n/g, '');
  },
    agentVersion: async agentId => (await taskStore.getAgentById(agentId))?.agent_version,
    queueCheck: async ({ userId, agentId, resourceName, config: checkConfig }) => {
      const task = await taskQueueService.createTask(userId, {
        agent_id: agentId,
        task_type: TaskType.RUN_CHECK,
        resource_name: resourceName,
        config: checkConfig,
      } as any);
      agentService.notifyAgent(agentId);
      return task;
    },
  };

  // Scheduled capstone checks: every `localProvisioner.capstoneChecks.intervalMinutes` (default 60,
  // 0 disables) run each capstone's checks on every running lab whose agent supports them, so
  // instructors see a hard fail without clicking. Same guards as the Run button; skips a lab that
  // still has a check pending, so a slow or offline agent never piles up tasks.
  const checkInterval = config.getOptionalNumber('localProvisioner.capstoneChecks.intervalMinutes') ?? 60;
  if (scheduler && checkInterval > 0) {
    await scheduler.scheduleTask({
      id: 'local-provisioner-capstone-checks',
      frequency: { minutes: checkInterval },
      timeout: { minutes: 5 },
      initialDelay: { minutes: 5 },
      fn: async () => {
        let queued = 0;
        for (const e of await capstoneStore.list()) {
          if (e.status !== 'active' || e.awaitingSeedReport) continue;
          const checks = capstoneById(e.capstone)?.checks ?? {};
          for (const name of Object.keys(checks).filter(n => checks[n].scheduled !== false)) {
            const r = await queueEnrollmentCheck(capstoneStore, labs, e.id, name, { skipIfPending: true }).catch(err => ({ status: 500, error: String(err) }));
            if (r.status === 202) queued++;
          }
        }
        if (queued) logger.info(`Scheduled capstone checks: queued ${queued}`);
      },
    });
  }

  router.use(
    '/capstones',
    createCapstoneRoutes({
      store: capstoneStore,
      logger,
      getGithubToken,
      externalBaseUrl: () => discovery.getExternalBaseUrl('local-provisioner'),
      labs,
    }),
  );


  // Error handling middleware
  router.use((err: any, req: any, res: any, _next: any) => {
    logger.error('Error handling request', {
      error: err.message,
      stack: err.stack,
      method: req.method,
      path: req.path,
    });

    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  });

  // Schedule periodic task cleanup
  const cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(async () => {
    try {
      logger.info('Starting periodic task cleanup');
      const deletedCount = await taskQueueService.cleanupOldTasks(taskRetentionDays);
      logger.info(`Periodic cleanup completed: ${deletedCount} tasks deleted`);
    } catch (error: any) {
      logger.error('Periodic cleanup failed', error);
    }
  }, cleanupInterval);

  logger.info('Local Provisioner router initialized successfully');

  return router;
}
