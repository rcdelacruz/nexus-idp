import { Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { GitHubDocsService } from '../service/GitHubDocsService';

/**
 * Creates nav + content routes. The calling middleware must set req.docsService
 * to the appropriate GitHubDocsService instance before these routes are reached.
 */
export function createDocsRoutes(logger: LoggerService): Router {
  const router = Router();

  router.get('/nav', async (req: any, res) => {
    const service: GitHubDocsService = req.docsService;
    try {
      const nav = await service.buildNav();
      res.json({ nav });
    } catch (e: any) {
      logger.error('Failed to build nav', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/content', async (req: any, res) => {
    const service: GitHubDocsService = req.docsService;
    const docPath = req.query['path'] as string;
    if (!docPath) {
      res.status(400).json({ error: 'Missing required query param: path' });
      return;
    }
    if (docPath.includes('..') || docPath.startsWith('/')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    try {
      const doc = await service.getDocContent(docPath);
      res.set('Cache-Control', 'no-store');
      res.json(doc);
    } catch (e: any) {
      logger.error(`Failed to get content for ${docPath}`, { error: e.message });
      res.status(404).json({ error: e.message });
    }
  });

  router.post('/refresh/doc', async (req: any, res) => {
    const service: GitHubDocsService = req.docsService;
    const docPath = req.query['path'] as string;
    if (!docPath) {
      res.status(400).json({ error: 'Missing required query param: path' });
      return;
    }
    if (docPath.includes('..') || docPath.startsWith('/')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    try {
      const doc = await service.refreshDocContent(docPath);
      res.set('Cache-Control', 'no-store');
      res.json(doc);
    } catch (e: any) {
      logger.error(`Failed to refresh doc ${docPath}`, { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/refresh/nav', async (req: any, res) => {
    const service: GitHubDocsService = req.docsService;
    try {
      const nav = await service.refreshNav();
      res.set('Cache-Control', 'no-store');
      res.json({ nav });
    } catch (e: any) {
      logger.error('Failed to refresh nav', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
