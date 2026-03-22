import { Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CostService } from '../service/CostService';

type Resolver = (accountId: string) => { costService: CostService } | undefined;

export function createBudgetRoutes(resolver: Resolver, logger: LoggerService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    try {
      const budgets = await services.costService.getBudgets();
      res.json({ budgets });
    } catch (err: any) {
      logger.error('Failed to get budgets', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
