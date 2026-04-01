import { Router } from 'express';
import { db } from '../db/connection';

export const healthRoutes = Router();

healthRoutes.get('/health', async (_req, res) => {
  try {
    await db.raw('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: '${{ values.appName }}-backend',
      version: process.env.APP_VERSION ?? '1.0.0',
    });
  } catch {
    res.status(503).json({ status: 'unhealthy', error: 'Database unreachable' });
  }
});

healthRoutes.get('/ready', async (_req, res) => {
  try {
    await db.raw('SELECT 1');
    res.status(200).send('OK');
  } catch {
    res.status(503).send('NOT READY');
  }
});

healthRoutes.get('/live', (_req, res) => {
  res.status(200).send('OK');
});
