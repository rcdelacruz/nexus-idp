import { Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CostService } from '../service/CostService';
import { ResourceService } from '../service/ResourceService';

type Resolver = (accountId: string) => { costService: CostService; resourceService: ResourceService } | undefined;

const resolve = (resolver: Resolver, req: any, res: any) => {
  const accountId = String(req.query.account ?? '');
  const services = resolver(accountId);
  if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return undefined; }
  return services;
};

export function createCostRoutes(resolver: Resolver, logger: LoggerService): Router {
  const router = Router();

  router.get('/account', async (req, res) => {
    const services = resolve(resolver, req, res); if (!services) return;
    try {
      const data = await services.costService.getAccountInfo();
      const lastFetchedAt = await services.costService.getLastFetchedAt();
      res.json({ ...data, last_fetched_at: lastFetchedAt });
    } catch (err: any) {
      logger.error('Failed to get account info', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/monthly-trend', async (req, res) => {
    const services = resolve(resolver, req, res); if (!services) return;
    try {
      const months = parseInt(String(req.query.months ?? '6'), 10);
      const data = await services.costService.getMonthlyCostTrend(months);
      res.json({ data });
    } catch (err: any) {
      logger.error('Failed to get monthly trend', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/by-service', async (req, res) => {
    const services = resolve(resolver, req, res); if (!services) return;
    try {
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      const startStr = String(req.query.start ?? start.toISOString().slice(0, 10));
      const endStr = String(req.query.end ?? end.toISOString().slice(0, 10));
      const data = await services.costService.getCostByService(startStr, endStr);
      res.json({ data, period: { start: startStr, end: endStr } });
    } catch (err: any) {
      logger.error('Failed to get cost by service', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/by-tag', async (req, res) => {
    const services = resolve(resolver, req, res); if (!services) return;
    try {
      const tagKey = String(req.query.tagKey ?? 'team');
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      const startStr = String(req.query.start ?? start.toISOString().slice(0, 10));
      const endStr = String(req.query.end ?? end.toISOString().slice(0, 10));
      const data = await services.costService.getCostByTag(tagKey, startStr, endStr);
      res.json({ data, tag_key: tagKey, period: { start: startStr, end: endStr } });
    } catch (err: any) {
      logger.error('Failed to get cost by tag', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/cache/invalidate', async (req, res) => {
    const services = resolve(resolver, req, res); if (!services) return;
    try {
      await Promise.all([
        services.costService.invalidateCache(),
        services.resourceService.invalidateCache(),
      ]);
      res.json({ ok: true, message: 'Cache invalidated' });
    } catch (err: any) {
      logger.error('Failed to invalidate cache', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
