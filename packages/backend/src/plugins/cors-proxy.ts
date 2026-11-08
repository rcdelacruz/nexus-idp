import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { NotAllowedError } from '@backstage/errors';
import { Router } from 'express';
import { BlockedTargetError, ResponseTooLargeError, proxyFetch } from './corsProxySafeFetch';

/**
 * CORS proxy for the API docs "Try it out" button (SwaggerUI calls an API on another origin through this route).
 *
 * Signed-in users only (no auth policy is added, so the framework's default applies, and the handler additionally refuses
 * service tokens). It can only reach public internet addresses (see corsProxySafeFetch.ts). Until 2026-11 the route was
 * registered as unauthenticated and filtered the host name as text, so anyone on the internet could read internal services
 * through the portal.
 */

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const TIMEOUT_MS = 20_000; // idle gap on one connection
const TOTAL_TIMEOUT_MS = 30_000; // the whole request, redirects included
const MAX_REDIRECTS = 3;

/** Request headers that must never be passed to the target: they identify the portal user or the hop in front of the portal. */
function isDroppedRequestHeader(name: string): boolean {
  return (
    ['host', 'origin', 'referer', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', 'upgrade', 'te', 'cookie',
      'authorization', 'forwarded', 'via', 'x-real-ip', 'x-target-authorization'].includes(name) ||
    ['x-forwarded-', 'cf-', 'sec-', 'proxy-', 'backstage-', 'x-backstage-'].some(prefix => name.startsWith(prefix))
  );
}

/**
 * The portal's own login token travels in `Authorization`, so the credential meant for the target API is carried in
 * `X-Target-Authorization` (the app's SwaggerUI interceptor moves it there). The portal token is never forwarded.
 */
export function buildTargetHeaders(incoming: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming)) {
    const key = name.toLowerCase();
    if (typeof value !== 'string' || isDroppedRequestHeader(key)) continue;
    out[key] = value;
  }
  const target = incoming['x-target-authorization'];
  if (typeof target === 'string' && target) out.authorization = target;
  out['accept-encoding'] = 'identity';
  return out;
}

// Response headers that must not be passed back: hop-by-hop framing, the target's CORS and cookie headers (a cookie set here
// would belong to the portal's origin) and policy headers that would apply to the portal's origin.
const DROPPED_RESPONSE_HEADERS = new Set([
  'transfer-encoding', 'content-encoding', 'content-length', 'connection', 'keep-alive', 'set-cookie', 'set-cookie2',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-allow-credentials',
  'access-control-expose-headers', 'access-control-max-age', 'content-security-policy', 'strict-transport-security',
  'location', 'refresh', 'clear-site-data', 'service-worker-allowed',
]);

/** The target's response headers that are safe to pass on to the browser (see DROPPED_RESPONSE_HEADERS). */
export function passableResponseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

const corsProxyPlugin = createBackendPlugin({
  pluginId: 'cors-proxy',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
      },
      async init({ logger, httpRouter, httpAuth }) {
        const router = Router();

        router.all('/forward', async (req, res) => {
          try {
            await httpAuth.credentials(req as any, { allow: ['user'] });
          } catch (err: any) {
            // A service token is a valid credential but not a person: refuse it (403). No credential at all is 401.
            res.status(err instanceof NotAllowedError && req.headers.authorization ? 403 : 401).json({ error: 'Sign in to use the proxy' });
            return;
          }

          const targetUrl = req.query.url;
          if (typeof targetUrl !== 'string' || !targetUrl) {
            res.status(400).json({ error: 'Missing url' });
            return;
          }
          let parsed: URL;
          try {
            parsed = new URL(targetUrl);
          } catch {
            res.status(400).json({ error: 'Invalid URL' });
            return;
          }
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            res.status(400).json({ error: 'Only http/https' });
            return;
          }

          let body: string | undefined;
          if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body !== undefined) {
            body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          }

          try {
            const result = await proxyFetch({
              url: targetUrl,
              method: req.method,
              headers: buildTargetHeaders(req.headers),
              body,
              maxBytes: MAX_RESPONSE_BYTES,
              timeoutMs: TIMEOUT_MS,
              totalTimeoutMs: TOTAL_TIMEOUT_MS,
              maxRedirects: MAX_REDIRECTS,
            });

            res.status(result.status);
            for (const [name, value] of Object.entries(passableResponseHeaders(result.headers))) {
              res.setHeader(name, value);
            }
            // The target's content is served from the portal's origin: it must never be able to run as a page there.
            res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            res.setHeader('X-Content-Type-Options', 'nosniff');
            logger.info(`CORS proxy: ${req.method} ${parsed.hostname}${parsed.pathname} → ${result.status}`);
            res.send(result.body);
          } catch (err: any) {
            if (err instanceof BlockedTargetError) {
              logger.warn(`CORS proxy refused a target: ${parsed.hostname} (${err.message})`);
              res.status(403).json({ error: 'Target host not allowed' });
              return;
            }
            if (err instanceof ResponseTooLargeError) {
              res.status(413).json({ error: 'Response too large (limit: 10 MB)' });
              return;
            }
            logger.warn(`CORS proxy error for ${parsed.hostname}: ${err.message}`);
            res.status(502).json({ error: 'The target could not be reached' });
          }
        });

        httpRouter.use(router as any);
        logger.info('CORS proxy initialized');
      },
    });
  },
});

export default corsProxyPlugin;
