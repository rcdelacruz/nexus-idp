import { Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CostService } from '../service/CostService';

type Resolver = (accountId: string) => { costService: CostService } | undefined;

export function createRecommendationRoutes(resolver: Resolver, logger: LoggerService): Router {
  const router = Router();

  const resolve = (req: any, res: any) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return undefined; }
    return services.costService;
  };

  router.get('/rightsizing', async (req, res) => {
    const svc = resolve(req, res); if (!svc) return;
    try {
      const data = await svc.getRightsizingRecommendations();
      res.json({ recommendations: data });
    } catch (err: any) {
      logger.error('Failed to get rightsizing recommendations', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/savings-plans', async (req, res) => {
    const svc = resolve(req, res); if (!svc) return;
    try {
      const data = await svc.getSavingsPlansCoverage();
      res.json(data);
    } catch (err: any) {
      logger.error('Failed to get savings plans coverage', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/reserved-instances', async (req, res) => {
    const svc = resolve(req, res); if (!svc) return;
    try {
      const data = await svc.getReservedInstanceCoverage();
      res.json(data);
    } catch (err: any) {
      logger.error('Failed to get RI coverage', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
