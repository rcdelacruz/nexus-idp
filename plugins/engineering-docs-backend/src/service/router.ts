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

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const PATH_LIKE = /^[A-Za-z0-9_./-]{0,200}$/;

/** The organizations the portal manages: `organization.githubOwner` and every `catalog.providers.github.*.organization`. */
export function managedOwners(config: Config): string[] {
  const owners = new Set<string>();
  const primary = config.getOptionalString('organization.githubOwner');
  if (primary) owners.add(primary);
  const providers = config.getOptionalConfig('catalog.providers.github');
  for (const key of providers?.keys() ?? []) {
    const org = providers!.getOptionalString(`${key}.organization`);
    if (org) owners.add(org);
  }
  return [...owners];
}

/**
 * The repo, branch and base of an entity's inline docs, or the reason to refuse. The shared GitHub token reads whatever it is pointed
 * at, and any signed-in user may send these values (audit 2026-11-07: `repo=<owner>/<private capstone repo>` returned its
 * instructor markdown, the answer keys), so: only the organizations the portal manages (not the capstone organization), real names
 * only, no path steps. Repositories in other organizations are served only as configured sources (`engineeringDocs.sources`).
 */
export function parseAdHocSource(
  query: { repo?: unknown; branch?: unknown; base?: unknown },
  owners: string[],
): { ok: true; source: DocSourceConfig } | { ok: false; status: number; error: string } {
  const repo = typeof query.repo === 'string' ? query.repo : '';
  const branch = query.branch === undefined ? 'main' : query.branch;
  const base = query.base === undefined ? 'docs' : query.base;
  const parts = repo.split('/');
  if (parts.length !== 2 || !NAME.test(parts[0]) || !NAME.test(parts[1]) || /^\.+$/.test(parts[0]) || /^\.+$/.test(parts[1])) {
    return { ok: false, status: 400, error: 'Missing or invalid ?repo=owner/repo query param' };
  }
  if (typeof branch !== 'string' || !PATH_LIKE.test(branch) || branch === '' || branch.split('/').some(s => s === '..' || s === '.')) {
    return { ok: false, status: 400, error: 'Invalid ?branch query param' };
  }
  if (typeof base !== 'string' || !PATH_LIKE.test(base) || base.split('/').some(s => s === '..')) {
    return { ok: false, status: 400, error: 'Invalid ?base query param' };
  }
  if (!owners.some(o => o.toLowerCase() === parts[0].toLowerCase())) {
    return { ok: false, status: 403, error: 'This repository is not available as entity documentation' };
  }
  return { ok: true, source: { repoOwner: parts[0], repoName: parts[1], branch, contentBase: base } };
}

export async function createRouter(options: RouterOptions): Promise<Router> {
  const { logger, config, httpAuth, cache } = options;
  const cacheClient = cache.withOptions({ defaultTtl: 30 * 60 * 1000 }); // 30 minutes
  const registry = new SourceRegistry(logger, config, cacheClient);
  const owners = managedOwners(config);

  const router = Router({ caseSensitive: true });
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
    const parsed = parseAdHocSource(req.query, owners);
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }
    req.docsService = registry.getOrCreateAdHoc(parsed.source);
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
