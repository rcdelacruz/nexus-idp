import { Router } from 'express';
import express from 'express';
import { LoggerService, HttpAuthService, CacheService, PermissionsService } from '@backstage/backend-plugin-api';
import { MetadataStore } from './MetadataStore';
import { Config } from '@backstage/config';
import { AwsClientFactory } from './AwsClientFactory';
import { CostService } from './CostService';
import { ResourceService } from './ResourceService';
import { createHealthRoutes } from '../api/healthRoutes';
import { createCostRoutes } from '../api/costRoutes';
import { createBudgetRoutes } from '../api/budgetRoutes';
import { createResourceRoutes } from '../api/resourceRoutes';
import { createRecommendationRoutes } from '../api/recommendationRoutes';
import { AuthorizeResult, BasicPermission } from '@backstage/plugin-permission-common';

export interface RouterOptions {
  logger: LoggerService;
  config: Config;
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  cache: CacheService;
  metadataStore: MetadataStore;
  finopsReadPermission: BasicPermission;
}

interface AccountConfig {
  id: string;
  name: string;
  profile: string;
}

export type AccountServices = { costService: CostService; resourceService: ResourceService };
export type ServiceResolver = (accountId: string) => AccountServices | undefined;

export async function createRouter(options: RouterOptions): Promise<Router> {
  const { logger, config, httpAuth, permissions, cache, metadataStore, finopsReadPermission } = options;

  const finopsConfig = config.getOptionalConfig('finops');
  const cacheTtlSeconds = finopsConfig?.getOptionalNumber('aws.cacheTtlSeconds') ?? 300;
  const defaultRegion = finopsConfig?.getOptionalString('aws.region') ?? 'us-east-1';

  // Build per-account service instances
  const accountConfigs: AccountConfig[] = (finopsConfig?.getOptionalConfigArray('aws.accounts') ?? [])
    .map(acc => ({
      id: acc.getString('id'),
      name: acc.getString('name'),
      profile: acc.getString('profile'),
    }));

  const accountServices = new Map<string, AccountServices>();
  for (const account of accountConfigs) {
    const factory = new AwsClientFactory(account.profile, defaultRegion, account.id);
    const costService = new CostService(factory, logger, cache, metadataStore, cacheTtlSeconds, account.id);
    const resourceService = new ResourceService(factory, logger, cache, cacheTtlSeconds * 1000, account.id);
    accountServices.set(account.id, { costService, resourceService });
    logger.info(`FinOps: registered account "${account.name}" (${account.id}) with profile "${account.profile}"`);
  }

  const defaultAccountId = accountConfigs[0]?.id ?? '';
  const resolver: ServiceResolver = (accountId: string) =>
    accountServices.get(accountId || defaultAccountId);

  const router = Router();
  router.use(express.json());

  router.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Auth + permission middleware — health is public, everything else requires
  // an authenticated user with finops.read permission (admin-only by policy).
  router.use(async (req, res, next) => {
    if (req.path.startsWith('/health')) return next();

    let credentials;
    try {
      credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [decision] = await permissions.authorize(
      [{ permission: finopsReadPermission }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      res.status(403).json({ error: 'Forbidden: finops.read permission required' });
      return;
    }

    (req as any).user = { userEntityRef: credentials.principal.userEntityRef };
    next();
  });

  router.use('/health', createHealthRoutes());

  // Return configured accounts list
  router.get('/accounts', (_req, res) => {
    res.json({ accounts: accountConfigs.map(a => ({ id: a.id, name: a.name })) });
  });

  router.use('/cost', createCostRoutes(resolver, logger));
  router.use('/budgets', createBudgetRoutes(resolver, logger));
  router.use('/resources', createResourceRoutes(resolver, logger));
  router.use('/recommendations', createRecommendationRoutes(resolver, logger));

  router.use((err: any, _req: any, res: any, _next: any) => {
    logger.error('FinOps router error', { error: err.message });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  return router;
}
