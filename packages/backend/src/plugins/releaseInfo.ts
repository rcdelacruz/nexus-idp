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
        const cache = new Map<string, { at: number; ttl: number; value: Promise<ReleaseAnswer> }>();

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

        const lookup = async (commit: string): Promise<ReleaseAnswer> => {
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
          const hit = cache.get(key);
          if (!hit || Date.now() - hit.at > hit.ttl) {
            const entry = { at: Date.now(), ttl: CACHE_MS, value: lookup(key) };
            entry.value.catch(e => {
              entry.ttl = ERROR_CACHE_MS;
              logger.warn(`Release lookup for ${key} failed: ${e.message}`);
            });
            cache.set(key, entry);
          }
          try {
            return res.status(200).json(await cache.get(key)!.value);
          } catch {
            return res.status(200).json({}); // the page falls back to the build-time tag
          }
        });
        httpRouter.use(router);
      },
    });
  },
});

export default releaseInfoPlugin;
