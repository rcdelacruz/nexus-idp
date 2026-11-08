import { coreServices, createBackendPlugin, BackstageCredentials } from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { NotAllowedError } from '@backstage/errors';
import { Router } from 'express';
import { BoundedCache } from './releaseInfo';

/**
 * Read-only GitHub access for the CI/CD tab (the GitHub Actions plugin).
 *
 * This replaces the `/github/api` proxy endpoint, which attached the portal's GitHub token to ANY request from ANY signed-in user:
 * every method and every path, so an employee could read the source of any private repo the token sees, or write to it
 * (audit 2026-11-07). The CI/CD tab only reads, and only these things: the repo, its branches, and the workflow, runs, jobs and job
 * logs of a repo. So this route answers GET for exactly those paths, for the organizations the portal is configured for, with the
 * token added here and never returned.
 *
 * And only for a repository that belongs to a catalog entity the caller may read (its `github.com/project-slug` annotation): the tab
 * only exists on such entities. Without that, every signed-in user could read the workflow runs and job logs of every repo in the
 * organizations, private ones and ones whose entity they cannot see, through the portal's token.
 */

const OWNER = '[A-Za-z0-9_.-]+';
const REPO = '[A-Za-z0-9_.-]+';
// repos.get, repos.listBranches, actions.getWorkflow, listWorkflowRunsForRepo, getWorkflowRun, listJobsForWorkflowRun, job logs.
const ALLOWED_PATH = new RegExp(
  `^/repos/(${OWNER})/(${REPO})(?:/branches|/actions/workflows/[0-9]+|/actions/runs|/actions/runs/[0-9]+|/actions/runs/[0-9]+/jobs|/actions/jobs/[0-9]+/logs)?$`,
);
const ALLOWED_QUERY = /^[a-z_]{1,40}$/;
// Job logs are a redirect to a signed download URL on one of these hosts; nothing else is passed back as a redirect.
const LOG_HOSTS = [/\.githubusercontent\.com$/, /\.blob\.core\.windows\.net$/];

/** `owner/repo` (lower case) of an allowed path, or undefined. */
export function slugOf(path: string): string | undefined {
  const m = ALLOWED_PATH.exec(path);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined;
}

const ACCESS_CACHE_MS = 30_000;
const PASS_HEADERS = ['content-type', 'link', 'etag', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal }) => Promise<Response>;

/** The upstream request for an incoming path/query, or the status to refuse with. Exported for tests. */
export function planRequest(
  path: string,
  query: Record<string, unknown>,
  owners: string[],
): { url: string } | { status: number; error: string } {
  const m = ALLOWED_PATH.exec(path);
  if (!m) return { status: 404, error: 'Not available through this route' };
  // "." and ".." match the name pattern but are path steps: URL normalization would turn /repos/<allowed>/../x/y into /repos/x/y.
  if (/^\.+$/.test(m[1]) || /^\.+$/.test(m[2])) return { status: 404, error: 'Not available through this route' };
  if (!owners.some(o => o.toLowerCase() === m[1].toLowerCase())) return { status: 403, error: 'Repository owner not allowed' };
  const names = Object.keys(query);
  if (names.length > 10) return { status: 400, error: 'Too many query parameters' };
  const search = new URLSearchParams();
  for (const name of names) {
    const value = query[name];
    if (!ALLOWED_QUERY.test(name) || typeof value !== 'string' || value.length > 100) return { status: 400, error: 'Unsupported query parameter' };
    search.set(name, value);
  }
  const qs = search.toString();
  return { url: `https://api.github.com${path}${qs ? `?${qs}` : ''}` };
}

export function createGithubActionsRouter(options: {
  owners: string[];
  token?: string;
  /** May this caller read a catalog entity whose `github.com/project-slug` is `slug` (owner/repo, lower case)? */
  canRead: (credentials: unknown, slug: string) => Promise<boolean>;
  now?: () => number;
  fetchImpl?: FetchLike;
  httpAuth: { credentials: (req: any, opts: { allow: string[] }) => Promise<unknown> };
  logger: { warn: (m: string) => void };
}) {
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const router = Router();
  // A tab load makes several requests for one repository: a "yes" is remembered for a short time, a "no" never is.
  const allowed = new BoundedCache<number>(500);
  const now = options.now ?? Date.now;

  router.use(async (req, res) => {
    let credentials: any;
    try {
      credentials = await options.httpAuth.credentials(req, { allow: ['user'] });
    } catch (err: any) {
      res.status(err instanceof NotAllowedError && req.headers.authorization ? 403 : 401).json({ error: 'Sign in to use this route' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405).json({ error: 'Read-only' });
      return;
    }
    const plan = planRequest(req.path, req.query as Record<string, unknown>, options.owners);
    if ('status' in plan) {
      res.status(plan.status).json({ error: plan.error });
      return;
    }
    const slug = slugOf(req.path)!;
    const who = String(credentials?.principal?.userEntityRef ?? '');
    const cacheKey = `${who}|${slug}`;
    const until = who ? allowed.get(cacheKey) : undefined;
    if (until === undefined || until < now()) {
      let permitted: boolean;
      try {
        permitted = await options.canRead(credentials, slug);
      } catch (err: any) {
        options.logger.warn(`github-actions-api: could not check access to ${slug}: ${err.message}`);
        res.status(503).json({ error: 'Could not check access to this repository' });
        return;
      }
      // Same answer as a path that does not exist: no way to ask which repositories exist.
      if (!permitted) {
        res.status(404).json({ error: 'Not available through this route' });
        return;
      }
      if (who) allowed.set(cacheKey, now() + ACCESS_CACHE_MS);
    }
    try {
      const upstream = await doFetch(plan.url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'nexus-idp-github-actions',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get('location') ?? '';
        let host = '';
        try {
          const u = new URL(location);
          host = u.protocol === 'https:' ? u.hostname : '';
        } catch {
          host = '';
        }
        if (!host || !LOG_HOSTS.some(re => re.test(host))) {
          options.logger.warn(`github-actions-api: refused a redirect to ${host || 'an invalid location'}`);
          res.status(502).json({ error: 'Unexpected redirect from GitHub' });
          return;
        }
        res.redirect(upstream.status, location);
        return;
      }
      res.status(upstream.status);
      for (const name of PASS_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err: any) {
      options.logger.warn(`github-actions-api: ${err.message}`);
      res.status(502).json({ error: 'GitHub could not be reached' });
    }
  });

  return router;
}

const githubActionsApiPlugin = createBackendPlugin({
  pluginId: 'github-actions-api',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        logger: coreServices.logger,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
      },
      async init({ config, httpRouter, httpAuth, logger, auth, discovery }) {
        const owners = new Set<string>();
        const primary = config.getOptionalString('organization.githubOwner');
        if (primary) owners.add(primary);
        const providers = config.getOptionalConfig('catalog.providers.github');
        for (const key of providers?.keys() ?? []) {
          const org = providers!.getOptionalString(`${key}.organization`);
          if (org) owners.add(org);
        }
        const token = config
          .getOptionalConfigArray('integrations.github')
          ?.find(c => (c.getOptionalString('host') ?? 'github.com') === 'github.com')
          ?.getOptionalString('token');
        // The catalog decides who may see which entity (and so which repository): ask it as the caller.
        const catalogClient = new CatalogClient({ discoveryApi: discovery });
        const canRead = async (credentials: unknown, slug: string): Promise<boolean> => {
          const { token: catalogToken } = await auth.getPluginRequestToken({
            onBehalfOf: credentials as BackstageCredentials,
            targetPluginId: 'catalog',
          });
          const found = await catalogClient.queryEntities(
            { filter: { 'metadata.annotations.github.com/project-slug': slug }, limit: 1, fields: ['metadata.name'] },
            { token: catalogToken },
          );
          return found.items.length > 0;
        };
        httpRouter.use(createGithubActionsRouter({ owners: [...owners], token, canRead, httpAuth: httpAuth as any, logger }));
        logger.info(`GitHub Actions read-only route initialized for: ${[...owners].join(', ') || '(no organization configured)'}`);
      },
    });
  },
});

export default githubActionsApiPlugin;
