/**
 * API routes for health checks
 */

import { Router } from 'express';
import { Knex } from 'knex';

/**
 * Create health check API routes
 */
export function createHealthRoutes(db: Knex): Router {
  const router = Router();

  /**
   * GET /health
   * Basic health check endpoint
   */
  router.get('/', async (_req, res) => {
    try {
      // Check database connectivity
      await db.raw('SELECT 1');

      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'ok',
        },
      });
    } catch (error: any) {
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'failed',
        },
        error: error.message,
      });
    }
  });

  /**
   * GET /health/ready
   * Readiness probe
   */
  router.get('/ready', async (_req, res) => {
    try {
      // Check if tables exist
      const hasProvisioningTasks = await db.schema.hasTable('provisioning_tasks');
      const hasAgentRegistrations = await db.schema.hasTable('agent_registrations');

      if (!hasProvisioningTasks || !hasAgentRegistrations) {
        return res.status(503).json({
          status: 'not ready',
          timestamp: new Date().toISOString(),
          message: 'Database tables not initialized',
        });
      }

      return res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      return res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  });

  /**
   * GET /health/live
   * Liveness probe
   */
  router.get('/live', (_req, res) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
