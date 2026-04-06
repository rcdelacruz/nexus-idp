import { Router } from 'express';
import express from 'express';
import { LoggerService, HttpAuthService, CacheService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { SourceRegistry } from './SourceRegistry';
import { DocSourceConfig } from './GitHubDocsService';
import { createHealthRoutes } from '../api/healthRoutes';
import { createDocsRoutes } from '../api/docsRoutes';

export interface RouterOptions {
  logger: LoggerService;
  config: Config;
  httpAuth: HttpAuthService;
  cache: CacheService;
}

export async function createRouter(options: RouterOptions): Promise<Router> {
  const { logger, config, httpAuth, cache } = options;
  const cacheClient = cache.withOptions({ defaultTtl: 30 * 60 * 1000 }); // 30 minutes
  const registry = new SourceRegistry(logger, config, cacheClient);

  const router = Router();
  router.use(express.json());

  router.use(async (req, res, next) => {
    if (req.path.startsWith('/health')) return next();
    try {
      await httpAuth.credentials(req as any, { allow: ['user'] });
      return next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return undefined;
    }
  });

  router.use('/health', createHealthRoutes());

  // List all configured sources
  router.get('/docs/sources', (_req, res) => {
    res.json({ sources: registry.list() });
  });

  // Per-configured-source routes: /docs/sources/:sourceId/nav|content
  router.use('/docs/sources/:sourceId', (req: any, res, next) => {
    const source = registry.get(req.params.sourceId);
    if (!source) {
      res.status(404).json({ error: `Source '${req.params.sourceId}' not found` });
      return;
    }
    req.docsService = source.service;
    next();
  }, createDocsRoutes(logger));

  // Entity inline-repo routes: /docs/entity/nav|content?repo=owner/repo&branch=main&base=docs
  router.use('/docs/entity', (req: any, res, next) => {
    const repo = (req.query.repo as string) ?? '';
    const branch = (req.query.branch as string) ?? 'main';
    const contentBase = (req.query.base as string) ?? 'docs';
    const [repoOwner, repoName] = repo.split('/');
    if (!repoOwner || !repoName) {
      res.status(400).json({ error: 'Missing or invalid ?repo=owner/repo query param' });
      return;
    }
    const sourceConfig: DocSourceConfig = { repoOwner, repoName, branch, contentBase };
    req.docsService = registry.getOrCreateAdHoc(sourceConfig);
    next();
  }, createDocsRoutes(logger));

  // Backward-compat: /docs/nav and /docs/content → default source
  router.use('/docs', (req: any, _res, next) => {
    req.docsService = registry.getDefault().service;
    next();
  }, createDocsRoutes(logger));

  router.use((err: any, _req: any, res: any, _next: any) => {
    logger.error('Engineering Docs error', { error: err.message });
    res.status(500).json({ error: err.message });
  });

  // Warm nav cache for all configured sources on startup (fire-and-forget)
  Promise.allSettled(
    registry.list().map(({ id }) => {
      const source = registry.get(id);
      if (!source) return Promise.resolve();
      return source.service.buildNav()
        .then(() => logger.info(`[engineering-docs] nav cache warmed for source: ${id}`))
        .catch(e => logger.warn(`[engineering-docs] nav cache warm failed for source: ${id} — ${e.message}`));
    })
  );

  return router;
}
