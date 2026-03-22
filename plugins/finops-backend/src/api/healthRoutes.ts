import { Router } from 'express';

export function createHealthRoutes(): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
  router.get('/ready', (_req, res) => res.json({ status: 'ready' }));
  router.get('/live', (_req, res) => res.json({ status: 'alive' }));
  return router;
}
