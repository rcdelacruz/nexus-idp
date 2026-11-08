import { Router } from 'express';
import { INSTALL_SCRIPT } from './installScript.generated';

const PLACEHOLDER = "PORTAL_URL='__PORTAL_URL__'";

/**
 * The installer with this portal's address filled in, so its "Next:" lines name the right portal.
 * The address goes into a single-quoted shell string of a script people pipe into `sh`, so only a
 * plain http(s) host (optional port, no path) is accepted; anything else leaves the script as
 * written, which prints "<your portal address>".
 */
export function renderInstallScript(portalUrl?: string): string {
  const url = (portalUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(url)) return INSTALL_SCRIPT;
  return INSTALL_SCRIPT.replace(PLACEHOLDER, `PORTAL_URL='${url}'`);
}

/**
 * GET /install.sh (mounted at /agent, public): the script behind
 *   curl -fsSL <portal>/api/local-provisioner/agent/install.sh | sh
 * It is plain text, not a download, so anyone can read it before running it.
 */
export function createInstallRoute(options: { portalUrl?: string }): Router {
  const router = Router({ caseSensitive: true });
  router.get('/install.sh', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(renderInstallScript(options.portalUrl));
  });
  return router;
}
