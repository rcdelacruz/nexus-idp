/**
 * Single source of truth for which local-provisioner routes are public.
 *
 * "Public" means: no Backstage session is required to reach the handler. These are the agent
 * endpoints — they either need no credential yet (device-code bootstrap) or carry a custom
 * HMAC service token that the Backstage auth framework cannot validate and that the route
 * handler verifies itself (see AgentService.verifyServiceToken). Everything else requires a
 * Backstage credential and is deny-by-default.
 *
 * Two enforcement layers consume this list, and they MUST agree — a path public in one layer
 * and protected in the other is exactly the drift this module previously suffered:
 *
 *   Layer 1 — the framework credentials barrier (plugin.ts registers each entry via
 *             httpRouter.addAuthPolicy). Without this, the framework rejects the request
 *             before it reaches the plugin, because agent tokens are not Backstage credentials.
 *   Layer 2 — the router middleware (service/router.ts uses isPublicAgentPath) skips its own
 *             httpAuth.credentials check for these paths.
 *
 * Path patterns use Backstage's `:param` syntax so they can be passed straight to
 * addAuthPolicy. Matching is prefix-with-segment-boundary, mirroring path-to-regexp's
 * `{ end: false }` behaviour that the framework applies — so `/health` covers `/health/ready`
 * but NOT `/healthfoo`.
 */
export const PUBLIC_AGENT_PATHS = [
  '/health',
  '/agent/device/code',
  '/agent/device/token',
  '/agent/register',
  '/agent/poll',
  '/agent/tasks/:taskId/status',
] as const;

function toSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * True if `path` matches `pattern` as a segment prefix.
 * A `:param` segment matches any single non-empty segment.
 * `path` may have MORE segments than the pattern (prefix / `end:false` semantics), so
 * `/health` matches `/health/ready`, but never `/healthfoo`.
 */
function matchesPattern(patternSegments: string[], pathSegments: string[]): boolean {
  if (pathSegments.length < patternSegments.length) {
    return false;
  }
  return patternSegments.every((seg, i) =>
    seg.startsWith(':') ? pathSegments[i].length > 0 : seg === pathSegments[i],
  );
}

const PUBLIC_PATH_SEGMENTS = PUBLIC_AGENT_PATHS.map(toSegments);

/**
 * Whether a request path (relative to the plugin mount) is a public agent endpoint.
 */
export function isPublicAgentPath(path: string): boolean {
  const segments = toSegments(path);
  return PUBLIC_PATH_SEGMENTS.some(pattern => matchesPattern(pattern, segments));
}
