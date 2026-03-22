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
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';

import { TaskStore } from '../database/TaskStore';
import { TaskQueueService } from './TaskQueueService';
import { AgentService } from './AgentService';
// import { CatalogService } from './CatalogService'; // Reserved for future use
import { createAgentRoutes } from '../api/agentRoutes';
import { createTaskRoutes } from '../api/taskRoutes';
import { createHealthRoutes } from '../api/healthRoutes';

/**
 * Router dependencies
 */
export interface RouterOptions {
  logger: LoggerService;
  database: DatabaseService;
  discovery: DiscoveryService;
  config: Config;
  httpAuth: HttpAuthService;
}

/**
 * Create the Express router for the Local Provisioner plugin
 */
export async function createRouter(
  options: RouterOptions,
): Promise<Router> {
  const { logger, database, config, httpAuth } = options;
  // discovery reserved for future CatalogService integration

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
  const sseHeartbeatInterval = pluginConfig?.getOptionalNumber('sseHeartbeatInterval') ?? 30;
  const taskRetentionDays = pluginConfig?.getOptionalNumber('taskRetentionDays') ?? 30;

  logger.info('Plugin configuration loaded', {
    sseHeartbeatInterval,
    taskRetentionDays,
  });

  // Initialize services
  const taskStore = new TaskStore(db);
  const taskQueueService = new TaskQueueService(logger, taskStore);
  const agentService = new AgentService(
    logger,
    taskStore,
    taskQueueService,
    config,
    sseHeartbeatInterval,
  );
  // CatalogService will be used for future catalog integration
  // const catalogService = new CatalogService(logger, discovery);

  logger.info('Services initialized successfully');

  // Create Express router
  const router = Router();

  // Middleware
  router.use(express.json());

  // Log all requests
  router.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      query: req.query,
    });
    next();
  });

  // Authentication middleware for protected routes
  // Public paths: /health/*, / (root info endpoint), /agent/auth-start (OAuth entry point), /agent/auth-callback (OAuth callback), /agent/device/* (device flow), /agent/register (accepts service token), /agent/events/* (SSE, validates service token), /agent/heartbeat (accepts service token), /agent/tasks/*/status (task status updates)
  // Protected paths: /tasks/* (UI-facing task management)
  router.use(async (req, res, next) => {
    // Skip authentication for public paths
    const isPublicPath =
      req.path === '/' ||
      req.path.startsWith('/health') ||
      req.path === '/agent/auth-start' ||
      req.path === '/agent/auth-callback' ||
      req.path === '/agent/device/code' ||
      req.path === '/agent/device/token' ||
      req.path === '/agent/register' ||
      req.path.startsWith('/agent/events/') ||
      req.path === '/agent/heartbeat' ||
      req.path.match(/^\/agent\/tasks\/[^/]+\/status$/);

    if (isPublicPath) {
      logger.debug('Skipping authentication for public path', {
        path: req.path,
      });
      return next();
    }

    // For protected routes, authentication is required
    try {
      const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });

      // Attach user info to request for downstream handlers
      (req as any).user = {
        userEntityRef: credentials.principal.userEntityRef,
      };

      logger.debug('Authentication successful', {
        path: req.path,
        userEntityRef: credentials.principal.userEntityRef,
      });

      next();
    } catch (error: any) {
      logger.warn('Authentication failed', {
        path: req.path,
        error: error.message,
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid Backstage authentication required',
      });
    }
  });

  // Mount route handlers
  // Health endpoints are public (configured via httpRouter.addAuthPolicy in plugin.ts)
  router.use('/health', createHealthRoutes(db));
  // Agent and task endpoints require authentication (enforced by middleware above)
  router.use('/agent', createAgentRoutes(agentService, logger, httpAuth));
  router.use('/tasks', createTaskRoutes(taskQueueService, logger, agentService));


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
