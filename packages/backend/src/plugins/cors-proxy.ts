import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Router } from 'express';

/** Block SSRF targets: private IP ranges, loopback, and cloud metadata endpoints. */
function isBlockedHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  // Cloud metadata services
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true;
  const parts = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (parts) {
    const [a, b] = [Number(parts[1]), Number(parts[2])];
    if (a === 127) return true;                          // 127.0.0.0/8 loopback
    if (a === 10) return true;                           // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  }
  return false;
}

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
          if (isBlockedHost(parsed.hostname)) {
            logger.warn(`CORS proxy blocked SSRF attempt to: ${parsed.hostname}`);
            res.status(403).json({ error: 'Target host not allowed' });
            return;
          }

          const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

          try {
            const fwdHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) {
              if (['host','origin','referer','connection'].includes(k)) continue;
              if (typeof v === 'string') fwdHeaders[k] = v;
            }
            let body: string | undefined;
            if (['POST','PUT','PATCH'].includes(req.method)) {
              body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            }

            const response = await fetch(targetUrl, { method: req.method, headers: fwdHeaders, body });

            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
              res.status(413).json({ error: 'Response too large (limit: 10 MB)' });
              return;
            }

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

            const text = await response.text();
            if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
              res.status(413).json({ error: 'Response too large (limit: 10 MB)' });
              return;
            }

            logger.info(`CORS proxy: ${req.method} ${parsed.hostname}${parsed.pathname} → ${response.status}`);
            res.send(text);
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
