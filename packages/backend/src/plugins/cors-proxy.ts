import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Router } from 'express';

const corsProxyPlugin = createBackendPlugin({
  pluginId: 'cors-proxy',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
      },
      async init({ logger, httpRouter }) {
        const router = Router();

        httpRouter.addAuthPolicy({ path: '/forward', allow: 'unauthenticated' });

        router.all('/forward', async (req, res) => {
          const targetUrl = req.query.url as string | undefined;
          if (!targetUrl) { res.status(400).json({ error: 'Missing url' }); return; }

          let parsed: URL;
          try { parsed = new URL(targetUrl); } catch { res.status(400).json({ error: 'Invalid URL' }); return; }
          if (!['http:', 'https:'].includes(parsed.protocol)) { res.status(400).json({ error: 'Only http/https' }); return; }

          try {
            const fwdHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) {
              if (['host','origin','referer','connection'].includes(k)) continue;
              if (typeof v === 'string') fwdHeaders[k] = v;
            }
            const body = ['POST','PUT','PATCH'].includes(req.method)
              ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
              : undefined;

            const response = await fetch(targetUrl, { method: req.method, headers: fwdHeaders, body });
            res.status(response.status);
            const stripHeaders = new Set([
              'transfer-encoding', 'content-encoding', 'connection',
              'access-control-allow-origin', 'access-control-allow-methods',
              'access-control-allow-headers', 'access-control-allow-credentials',
              'access-control-expose-headers', 'access-control-max-age',
            ]);
            response.headers.forEach((v, k) => {
              if (!stripHeaders.has(k)) res.setHeader(k, v);
            });
            res.send(await response.text());
          } catch (err: any) {
            logger.warn(`CORS proxy error: ${err.message}`);
            res.status(502).json({ error: err.message });
          }
        });

        httpRouter.use(router as any);
        logger.info('CORS proxy initialized');
      },
    });
  },
});

export default corsProxyPlugin;
