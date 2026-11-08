/**
 * Release info for Settings → About: which published release includes the commit this portal
 * was built from, worked out when the page is opened.
 *
 * GET /api/release-info/release?commit=<sha>  →  { includedIn?: "v1.6.0", after?: "v1.6.0" }
 *
 * The build only records its commit; the release tag used to be fixed at build time too (`git
 * describe`), so a release tagged after the deploy (v1.6.0, 2026-10-31) showed the previous one
 * until the next rebuild. Releases on the default branch are linear, so walking them newest
 * first, the oldest one whose tag contains the commit is the release it shipped in. GitHub calls
 * are cached per commit (10 min, errors 1 min); the repo comes from organization.githubOwner /
 * githubRepo and the token from integrations.github, so nothing here is deployment-specific.
 */
import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Router } from 'express';

/** GitHub compare status of `commit` relative to a release tag. */
export type CompareStatus = 'identical' | 'behind' | 'ahead' | 'diverged';

export interface ReleaseAnswer {
  /** The first release that contains the commit. */
  includedIn?: string;
  /** No release contains it yet: the newest release it is built on top of. */
  after?: string;
}

/**
 * `releases`: tag names, newest first. `compare(tag)`: where the commit stands against that tag
 * (GitHub `compare/{tag}...{commit}`: "behind"/"identical" = the tag contains the commit).
 */
export async function findRelease(
  releases: string[],
  compare: (tag: string) => Promise<CompareStatus>,
): Promise<ReleaseAnswer> {
  let includedIn: string | undefined;
  for (const tag of releases) {
    const status = await compare(tag);
    if (status === 'identical' || status === 'behind') {
      includedIn = tag; // contained here; an older release may contain it too
      continue;
    }
    if (includedIn) return { includedIn };
    return status === 'ahead' ? { after: tag } : {};
  }
  return includedIn ? { includedIn } : {};
}

const CACHE_MS = 10 * 60_000;
const ERROR_CACHE_MS = 60_000;
const SHA = /^[0-9a-f]{7,40}$/i;
const MAX_CACHED_COMMITS = 200;
const LOOKUPS_PER_MINUTE = 20;

/**
 * Any signed-in user can send any commit id. Each new one used to add a cache entry for good and cost up to 21 GitHub calls on the
 * portal's token, so a loop of random ids could grow memory and use up the token's hourly limit for every other feature
 * (audit 2026-11-07). The cache now holds at most `max` commits (the oldest goes first), and new lookups are capped per minute.
 */
export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    return this.entries.get(key);
  }
  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }
  get size(): number {
    return this.entries.size;
  }
}

/** Allows `limit` things per `windowMs`; false once the budget is used up, until the window has passed. */
export function createBudget(limit: number, windowMs: number, now: () => number = Date.now): () => boolean {
  let windowStart = now();
  let used = 0;
  return () => {
    const t = now();
    if (t - windowStart >= windowMs) {
      windowStart = t;
      used = 0;
    }
    if (used >= limit) return false;
    used++;
    return true;
  };
}

export interface ReleaseRouterOptions {
  owner?: string;
  repo?: string;
  /** GET on the portal's repo (`/releases?...`, `/compare/...`, `/commits/...`): parsed JSON, or throws. */
  gh: (path: string) => Promise<any>;
  logger: { warn(message: string): void };
  now?: () => number;
  maxCachedCommits?: number;
  lookupsPerMinute?: number;
}

type CacheEntry = { at: number; ttl: number; value: Promise<ReleaseAnswer> };

export function createReleaseRouter(options: ReleaseRouterOptions): Router {
  const { owner, repo, gh, logger } = options;
  const now = options.now ?? Date.now;
  const cache = new BoundedCache<CacheEntry>(options.maxCachedCommits ?? MAX_CACHED_COMMITS);
  const budget = createBudget(options.lookupsPerMinute ?? LOOKUPS_PER_MINUTE, 60_000, now);

  const lookup = async (commit: string): Promise<ReleaseAnswer> => {
    // An id that is not a commit of this repository costs ONE call, not a walk through twenty releases.
    await gh(`/commits/${encodeURIComponent(commit)}`);
    const releases = (await gh('/releases?per_page=20')) as Array<{ tag_name: string; draft: boolean }>;
    const tags = releases.filter(r => !r.draft).map(r => r.tag_name);
    return findRelease(tags, async tag => (await gh(`/compare/${encodeURIComponent(tag)}...${commit}`)).status);
  };

  const router = Router();
  router.get('/release', async (req, res) => {
    const commit = String(req.query.commit ?? '');
    if (!SHA.test(commit)) return res.status(400).json({ error: 'commit must be a git sha' });
    if (!owner || !repo) return res.status(200).json({});
    const key = commit.toLowerCase();
    let entry = cache.get(key);
    if (!entry || now() - entry.at > entry.ttl) {
      // New lookups are limited; the page falls back to the build-time tag when it gets nothing.
      if (!budget()) return res.status(200).json({});
      const fresh: CacheEntry = { at: now(), ttl: CACHE_MS, value: lookup(key) };
      fresh.value.catch(e => {
        fresh.ttl = ERROR_CACHE_MS;
        logger.warn(`Release lookup for ${key} failed: ${e.message}`);
      });
      cache.set(key, fresh);
      entry = fresh;
    }
    try {
      return res.status(200).json(await entry.value);
    } catch {
      return res.status(200).json({}); // the page falls back to the build-time tag
    }
  });
  return router;
}

export const releaseInfoPlugin = createBackendPlugin({
  pluginId: 'release-info',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ config, httpRouter, logger }) {
        const owner = config.getOptionalString('organization.githubOwner');
        const repo = config.getOptionalString('organization.githubRepo');
        const token = config
          .getOptionalConfigArray('integrations.github')
          ?.find(c => (c.getOptionalString('host') ?? 'github.com') === 'github.com')
          ?.getOptionalString('token');
        const gh = async (path: string) => {
          const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}${path}`, {
            headers: {
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'nexus-idp-release-info',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(`GitHub ${path.split('?')[0]} → ${res.status}`);
          return res.json();
        };

        const router = createReleaseRouter({ owner, repo, gh, logger });
        httpRouter.use(router);
      },
    });
  },
});

export default releaseInfoPlugin;
