import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { CatalogClient } from '@backstage/catalog-client';
import { AuthService, DiscoveryService } from '@backstage/backend-plugin-api';
import * as https from 'https';
import { getClusterConfig, buildApiPath, k8sRequest } from '../lib/k8sClient';

const CNPG_API_VERSION = 'postgresql.cnpg.io/v1';
const ARGOCD_API_VERSION = 'argoproj.io/v1alpha1';

/**
 * Known GitHub orgs to fall back to when a repo's slug can't be resolved from
 * the catalog. Set via TEARDOWN_GITHUB_ORGS (comma-separated). Same list
 * scripts/teardown.sh reads — keep in sync.
 */
const KNOWN_GITHUB_ORGS = (process.env.TEARDOWN_GITHUB_ORGS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

/** AWS Resource spec.types created by the infra-aws-* scaffolder templates. */
const AWS_RESOURCE_TYPES = ['rds-instance', 'ecs-cluster', 'eks-cluster', 'aws-ec2-instance'];

/**
 * Scaffolder action: teardown:discover-resources
 *
 * Live-discovers every resource an app owns, mirroring scripts/teardown.sh
 * Phase 1: never trusts stored deploymentTarget annotations, queries the
 * actual cluster/catalog/GitHub instead. Output feeds both the dry-run
 * report and — when the template runs in destroy mode — the delete steps.
 *
 * K8s namespace/ArgoCD app naming has no single guaranteed source: the repo
 * name, the catalog entity's own name, and the actual provisioned resource
 * name can all diverge (confirmed live — a repo renamed after provisioning
 * left the namespace/ArgoCD app still named after the catalog entity, not
 * the repo). So this does NOT rely on a single guessed name. It uses two
 * complementary strategies, both environment-scoped (`environment` input —
 * exact `<candidate>-<env>` match, never an open '-*' wildcard, so selecting
 * one environment can never find, and therefore never delete, another):
 * (1) authoritative — Component entities carry `backstage.io/kubernetes-namespace`
 * / `argocd/app-name` annotations recorded at creation time, read directly,
 * no guessing, filtered to the selected environment; (2) exact-match
 * fallback — against every `<candidate>-<env>` combination (repo name +
 * every discovered entity's own name, crossed with the selected
 * environment's suffix), to catch anything an older app might be missing
 * annotations for. A bare, unsuffixed name (no -dev/-staging/-prod) is only
 * matched when environment="all", since it can't be attributed to one
 * specific environment.
 */
export function createTeardownDiscoverResourcesAction(options: {
  discovery: DiscoveryService;
  auth: AuthService;
}) {
  const { discovery, auth } = options;

  return createTemplateAction({
    id: 'teardown:discover-resources',
    description: 'Discover all K8s, ArgoCD, GitHub, and catalog resources owned by an app, by live cluster/catalog query',
    schema: {
      input: z =>
        z.object({
          appName: z.string().describe('Name candidate for namespace/ArgoCD-app matching — typically the repo name'),
          githubRepoSlug: z.string().optional().describe('owner/repo, e.g. from catalog:fetch-entity-info — used directly instead of guessing an entity name'),
          environment: z.enum(['dev', 'staging', 'prod', 'all']).default('dev')
            .describe('Which namespace/ArgoCD-app environment suffix to match — exact match against <candidate>-<environment>, never an open wildcard, so selecting one environment never touches the others'),
        }),
      output: z =>
        z.object({
          namespaces: z.array(z.string()),
          cnpgClusters: z.array(z.object({ namespace: z.string(), name: z.string(), backupDestination: z.string().optional() })),
          cnpgBackups: z.array(z.object({
            namespace: z.string(),
            name: z.string(),
            destinationPath: z.string(),
            endpointUrl: z.string().optional(),
            accessKeyId: z.string(),
            secretAccessKey: z.string(),
          })).describe('Resolved S3/MinIO credentials for each CNPG backup — never included in the summary text'),
          argocdApps: z.array(z.object({ namespace: z.string(), name: z.string() })),
          githubRepoSlug: z.string().optional(),
          githubRepoExists: z.boolean(),
          catalogEntityRefs: z.array(z.string()),
          awsInfraRepos: z.array(z.object({ repoOwner: z.string(), repoName: z.string(), resourceType: z.string() })),
          summary: z.string().describe('Human-readable report of everything found — surfaced in dry-run mode'),
        }),
    },
    async handler(ctx) {
      const { appName, githubRepoSlug: inputGithubRepoSlug } = ctx.input;
      // zod's schema-level .default() is a type/UI contract only — Backstage
      // does not apply it to ctx.input for unpassed fields at runtime
      // (confirmed live in deleteArgocdApp.ts's timeoutSeconds). This one
      // matters most: environment drives the whole cross-environment-safety
      // guarantee, so an unnoticed undefined here would silently produce
      // `<candidate>-undefined` targets instead of a loud failure.
      const environment = ctx.input.environment ?? 'dev';
      const lines: string[] = [];
      const config = await getClusterConfig();

      // Exact suffixes to match, never an open '-*' wildcard — selecting one
      // environment must never find (and therefore never delete) another.
      const envSuffixes = environment === 'all' ? ['dev', 'staging', 'prod'] : [environment];
      lines.push(`Environment scope: ${environment}`);

      // ── Backstage catalog entities (two-pass, by annotation) — FIRST ─────
      // Run before namespace/ArgoCD discovery: this is where the authoritative
      // kubernetes-namespace/argocd-app-name annotations and the additional
      // name candidates (each entity's own metadata.name) come from.
      const catalogClient = new CatalogClient({ discoveryApi: discovery });
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: 'catalog',
      });

      // Prefer the caller-supplied slug (from catalog:fetch-entity-info's
      // repoOwner/repoName — already known, no need to guess). Guessing an
      // entity named exactly `appName` only worked by coincidence when
      // appName was still the Component's own name; a repo can back
      // multiple Components, so that guess is unreliable now that appName
      // is the repo name.
      let githubRepoSlug: string | undefined = inputGithubRepoSlug;
      const catalogEntityRefs: string[] = [];
      const seenUids = new Set<string>();

      // Name candidates for namespace/ArgoCD prefix-matching — starts with
      // the input appName (repo name), grows with every discovered entity's
      // own name (they can diverge from the repo name and from each other).
      const nameCandidates = new Set<string>([appName]);
      // Authoritative hints read directly off Component annotations.
      const namespaceHints = new Set<string>();
      const argocdAppHints = new Set<string>();

      const inScope = (name: string) => envSuffixes.some(s => name.endsWith(`-${s}`));

      const collectHints = (entity: any) => {
        nameCandidates.add(entity.metadata.name);
        const annotations = entity.metadata.annotations ?? {};
        const ns = annotations['backstage.io/kubernetes-namespace'];
        const argocdApp = annotations['argocd/app-name'];
        if (ns && inScope(ns)) namespaceHints.add(ns);
        if (argocdApp && inScope(argocdApp)) argocdAppHints.add(argocdApp);
      };

      if (!githubRepoSlug) {
        for (const kind of ['component', 'system']) {
          try {
            const entity = await catalogClient.getEntityByRef(`${kind}:default/${appName}`, { token });
            const slug = entity?.metadata.annotations?.['github.com/project-slug'];
            if (slug) {
              githubRepoSlug = slug;
              break;
            }
          } catch {
            // not found under this kind — try the next
          }
        }
      }

      if (githubRepoSlug) {
        // Pass 1: entities carrying the project-slug annotation directly
        const { items: pass1 } = await catalogClient.getEntities(
          { filter: { 'metadata.annotations.github.com/project-slug': githubRepoSlug } },
          { token },
        );
        for (const entity of pass1) {
          const uid = entity.metadata.uid;
          if (!uid || seenUids.has(uid)) continue;
          seenUids.add(uid);
          const ref = `${entity.kind}:${entity.metadata.namespace ?? 'default'}/${entity.metadata.name}`;
          catalogEntityRefs.push(ref);
          collectHints(entity);
          lines.push(`Catalog entity: ${ref}`);
        }

        // Pass 2: co-located entities sharing the same origin location
        const originLocation = pass1[0]?.metadata.annotations?.['backstage.io/managed-by-origin-location'];
        if (originLocation) {
          const { items: pass2 } = await catalogClient.getEntities(
            { filter: { 'metadata.annotations.backstage.io/managed-by-origin-location': originLocation } },
            { token },
          );
          for (const entity of pass2) {
            const uid = entity.metadata.uid;
            if (!uid || seenUids.has(uid)) continue;
            seenUids.add(uid);
            const ref = `${entity.kind}:${entity.metadata.namespace ?? 'default'}/${entity.metadata.name}`;
            catalogEntityRefs.push(ref);
            collectHints(entity);
            lines.push(`Catalog entity: ${ref}`);
          }
        }
      }

      if (catalogEntityRefs.length === 0) lines.push(`No catalog entities found for ${appName}`);
      if (namespaceHints.size > 0) lines.push(`Namespace hints from catalog annotations: ${[...namespaceHints].join(', ')}`);
      if (argocdAppHints.size > 0) lines.push(`ArgoCD app hints from catalog annotations: ${[...argocdAppHints].join(', ')}`);

      // ── Namespaces — exact <candidate>-<envSuffix> targets ∪ annotation hints ──
      // No open prefix wildcard: selecting environment=dev must never match a
      // -staging or -prod namespace, even if one exists for this same app.
      const exactTargets = new Set<string>();
      for (const c of nameCandidates) {
        for (const s of envSuffixes) {
          exactTargets.add(`${c}-${s}`);
        }
        // Bare, unsuffixed name (no -dev/-staging/-prod) — ambiguous which
        // environment it belongs to, so only in scope for an explicit "all",
        // never silently swept into a single-environment run.
        if (environment === 'all') exactTargets.add(c);
      }
      const namespaces = await listMatching(config, 'v1', 'Namespace', undefined, exactTargets);
      for (const hint of namespaceHints) {
        if (!namespaces.includes(hint)) {
          const exists = await namespaceExists(config, hint);
          if (exists) namespaces.push(hint);
        }
      }
      namespaces.forEach(ns => lines.push(`Namespace: ${ns}`));
      if (namespaces.length === 0) lines.push(`No namespaces found for environment "${environment}" (checked: ${[...exactTargets].join(', ')})`);

      // ── CNPG clusters per namespace ─────────────────────────────────────
      // S3/MinIO credentials are resolved NOW, while the namespace still exists —
      // the secret is gone once kubernetes:delete-namespace runs. Never logged or
      // added to `lines` (which ends up in the task-log-visible summary).
      const cnpgClusters: Array<{ namespace: string; name: string; backupDestination?: string }> = [];
      const cnpgBackups: Array<{
        namespace: string; name: string; destinationPath: string;
        endpointUrl?: string; accessKeyId: string; secretAccessKey: string;
      }> = [];
      for (const namespace of namespaces) {
        const listUrl = `${config.server}${buildApiPath(CNPG_API_VERSION, 'Cluster', namespace)}`;
        try {
          const list = await k8sRequest(listUrl, 'GET', undefined, config);
          for (const item of list.items ?? []) {
            const name = item.metadata.name;
            const barman = item.spec?.backup?.barmanObjectStore;
            const backupDestination: string | undefined = barman?.destinationPath;
            cnpgClusters.push({ namespace, name, backupDestination });
            lines.push(
              `CNPG cluster with data: ${namespace}/${name}${backupDestination ? ` (backup: ${backupDestination})` : ''}`,
            );

            if (backupDestination) {
              const credentials = await resolveS3Credentials(config, namespace, barman, ctx.logger);
              if (credentials) {
                cnpgBackups.push({
                  namespace,
                  name,
                  destinationPath: backupDestination,
                  endpointUrl: barman?.endpointURL,
                  ...credentials,
                });
              } else {
                lines.push(`  Could not resolve backup credentials for ${namespace}/${name} — manual cleanup needed`);
              }
            }
          }
        } catch {
          // no CNPG CRD or no clusters in this namespace — not an error
        }
      }

      // ── ArgoCD applications (cluster-wide) — annotation hints ∪ prefix-match ──
      const argocdAppRefs: Array<{ namespace: string; name: string }> = [];
      {
        const listUrl = `${config.server}${buildApiPath(ARGOCD_API_VERSION, 'Application')}`;
        try {
          const list = await k8sRequest(listUrl, 'GET', undefined, config);
          for (const item of list.items ?? []) {
            const name = item.metadata.name as string;
            const matchesTarget = exactTargets.has(name);
            const matchesHint = argocdAppHints.has(name);
            if (matchesTarget || matchesHint) {
              argocdAppRefs.push({ namespace: item.metadata.namespace, name });
              const finalizers: string[] = item.metadata.finalizers ?? [];
              const cascade = finalizers.some(f => f.includes('resources-finalizer'));
              lines.push(`ArgoCD app: ${item.metadata.namespace}/${name}${cascade ? ' (has resources-finalizer — will cascade-delete)' : ''}`);
            }
          }
        } catch (err: any) {
          lines.push(`Could not list ArgoCD applications: ${err.message}`);
        }
      }
      if (argocdAppRefs.length === 0) lines.push(`No ArgoCD applications found for ${[...nameCandidates].join(', ')}`);

      // ── AWS infra repos (tofu-managed resources) ─────────────────────────
      // Strategy 1: Resource entities among catalogEntityRefs already found (Pass 1/2 above)
      // Strategy 2: direct catalog query for Resource entities whose name contains a candidate
      // Strategy 3: GitHub topic search fallback if the catalog yielded nothing
      const awsInfraRepos: Array<{ repoOwner: string; repoName: string; resourceType: string }> = [];
      const seenAwsRepoSlugs = new Set<string>();

      const checkAwsResourceEntity = async (namespace: string, name: string) => {
        const entity = await catalogClient.getEntityByRef(`resource:${namespace}/${name}`, { token }).catch(() => undefined);
        const specType = entity?.spec?.type as string | undefined;
        if (!specType || !AWS_RESOURCE_TYPES.includes(specType)) return;

        const repoSlug = entity?.metadata.annotations?.['github.com/project-slug'];
        if (!repoSlug || seenAwsRepoSlugs.has(repoSlug)) return;
        seenAwsRepoSlugs.add(repoSlug);

        const [repoOwner, repoName] = repoSlug.split('/');
        if (!repoOwner || !repoName) return;
        awsInfraRepos.push({ repoOwner, repoName, resourceType: specType });
        lines.push(`AWS infra repo: ${repoSlug} (${specType})`);

        const uid = entity!.metadata.uid;
        if (uid && !seenUids.has(uid)) {
          seenUids.add(uid);
          catalogEntityRefs.push(`Resource:${namespace}/${name}`);
        }
      };

      for (const ref of catalogEntityRefs) {
        const [kind, rest] = ref.split(':');
        if (kind.toLowerCase() !== 'resource') continue;
        const [ns, name] = rest.split('/');
        // eslint-disable-next-line no-await-in-loop
        await checkAwsResourceEntity(ns, name);
      }

      try {
        const { items: allResources } = await catalogClient.getEntities(
          { filter: { kind: 'Resource' }, limit: 500 } as any,
          { token },
        );
        for (const entity of allResources) {
          const matches = [...nameCandidates].some(c => entity.metadata.name.includes(c));
          if (!matches) continue;
          // eslint-disable-next-line no-await-in-loop
          await checkAwsResourceEntity(entity.metadata.namespace ?? 'default', entity.metadata.name);
        }
      } catch {
        // catalog query failed — fall through to GitHub topic search below
      }

      if (awsInfraRepos.length === 0) {
        const githubTokenForTopics = process.env.GITHUB_TOKEN;
        if (githubTokenForTopics) {
          for (const org of KNOWN_GITHUB_ORGS) {
            // eslint-disable-next-line no-await-in-loop
            const repos = await searchReposByTopic(org, 'backstage-infra', githubTokenForTopics);
            for (const repoName of repos) {
              const matches = [...nameCandidates].some(c => repoName.includes(c));
              if (!matches) continue;
              const repoSlug = `${org}/${repoName}`;
              if (seenAwsRepoSlugs.has(repoSlug)) continue;
              // eslint-disable-next-line no-await-in-loop
              const topics = await fetchRepoTopics(org, repoName, githubTokenForTopics);
              let resourceType = 'aws-infra';
              if (topics.includes('aws-rds')) resourceType = 'rds-instance';
              else if (topics.includes('aws-ecs-cluster')) resourceType = 'ecs-cluster';
              else if (topics.includes('aws-eks-cluster')) resourceType = 'eks-cluster';
              else if (topics.includes('aws-ec2')) resourceType = 'aws-ec2-instance';

              seenAwsRepoSlugs.add(repoSlug);
              awsInfraRepos.push({ repoOwner: org, repoName, resourceType });
              lines.push(`AWS infra repo (GitHub): ${repoSlug} (${resourceType})`);
            }
          }
        }
      }

      if (awsInfraRepos.length === 0) lines.push(`No AWS infra repos found for ${[...nameCandidates].join(', ')}`);

      // ── GitHub repo existence ────────────────────────────────────────────
      let githubRepoExists = false;
      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken) {
        const candidates = githubRepoSlug
          ? [githubRepoSlug]
          : KNOWN_GITHUB_ORGS.flatMap(org => [...nameCandidates].map(c => `${org}/${c}`));
        for (const slug of candidates) {
          // eslint-disable-next-line no-await-in-loop
          const exists = await githubRepoExistsCheck(slug, githubToken);
          if (exists) {
            githubRepoSlug = slug;
            githubRepoExists = true;
            lines.push(`GitHub repo: ${slug}`);
            break;
          }
        }
        if (!githubRepoExists) lines.push('GitHub repo (not found in catalog or known orgs)');
      } else {
        lines.push('GITHUB_TOKEN not set — GitHub repo existence not checked');
      }

      const summary = lines.join('\n');
      ctx.logger.info(`Discovery for "${appName}":\n${summary}`);

      ctx.output('namespaces', namespaces);
      ctx.output('cnpgClusters', cnpgClusters);
      ctx.output('cnpgBackups', cnpgBackups);
      ctx.output('argocdApps', argocdAppRefs);
      ctx.output('githubRepoSlug', githubRepoSlug);
      ctx.output('githubRepoExists', githubRepoExists);
      ctx.output('catalogEntityRefs', catalogEntityRefs);
      ctx.output('awsInfraRepos', awsInfraRepos);
      ctx.output('summary', summary);
    },
  });
}

/** List resources of a kind (optionally namespaced) and return names that exactly match one of `exactTargets`. */
async function listMatching(
  config: Awaited<ReturnType<typeof getClusterConfig>>,
  apiVersion: string,
  kind: string,
  namespace: string | undefined,
  exactTargets: Set<string>,
): Promise<string[]> {
  const listUrl = `${config.server}${buildApiPath(apiVersion, kind, namespace)}`;
  try {
    const list = await k8sRequest(listUrl, 'GET', undefined, config);
    return (list.items ?? [])
      .map((item: any) => item.metadata.name as string)
      .filter((name: string) => exactTargets.has(name));
  } catch {
    return [];
  }
}

/** Check whether a specific namespace exists (for annotation-hinted names not already in exactTargets). */
async function namespaceExists(
  config: Awaited<ReturnType<typeof getClusterConfig>>,
  namespace: string,
): Promise<boolean> {
  const url = `${config.server}${buildApiPath('v1', 'Namespace', undefined, namespace)}`;
  try {
    await k8sRequest(url, 'GET', undefined, config);
    return true;
  } catch {
    return false;
  }
}

/** Resolve CNPG barman S3/MinIO credentials from the secret referenced in spec.backup, while the namespace still exists. */
async function resolveS3Credentials(
  config: Awaited<ReturnType<typeof getClusterConfig>>,
  namespace: string,
  barman: any,
  logger: { warn: (m: string) => void },
): Promise<{ accessKeyId: string; secretAccessKey: string } | undefined> {
  const secretName = barman?.s3Credentials?.accessKeyId?.name;
  const accessKeyField = barman?.s3Credentials?.accessKeyId?.key;
  const secretKeyField = barman?.s3Credentials?.secretAccessKey?.key;
  if (!secretName || !accessKeyField || !secretKeyField) return undefined;

  const fetchSecret = async (ns: string) => {
    const url = `${config.server}${buildApiPath('v1', 'Secret', ns, secretName)}`;
    return k8sRequest(url, 'GET', undefined, config);
  };

  let secret: any;
  try {
    secret = await fetchSecret(namespace);
  } catch {
    try {
      secret = await fetchSecret('default');
    } catch (err: any) {
      logger.warn(`Could not read backup credentials secret ${secretName}: ${err.message}`);
      return undefined;
    }
  }

  const accessKeyRaw = secret?.data?.[accessKeyField];
  const secretKeyRaw = secret?.data?.[secretKeyField];
  if (!accessKeyRaw || !secretKeyRaw) return undefined;

  return {
    accessKeyId: Buffer.from(accessKeyRaw, 'base64').toString('utf-8'),
    secretAccessKey: Buffer.from(secretKeyRaw, 'base64').toString('utf-8'),
  };
}

/** GitHub search API — repo names in `org` carrying `topic`. */
function searchReposByTopic(org: string, topic: string, token: string): Promise<string[]> {
  return new Promise(resolve => {
    const q = encodeURIComponent(`org:${org} topic:${topic}`);
    const req = https.request({
      hostname: 'api.github.com',
      path: `/search/repositories?q=${q}&per_page=100`,
      method: 'GET',
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'backstage-scaffolder',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if ((res.statusCode ?? 0) !== 200) { resolve([]); return; }
        try {
          const parsed = JSON.parse(data);
          resolve((parsed.items ?? []).map((r: any) => r.name as string));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}

/** GitHub REST API — topics on a single repo. */
function fetchRepoTopics(org: string, repoName: string, token: string): Promise<string[]> {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${org}/${repoName}`,
      method: 'GET',
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'backstage-scaffolder',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if ((res.statusCode ?? 0) !== 200) { resolve([]); return; }
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.topics ?? []);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}

function githubRepoExistsCheck(slug: string, token: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${slug}`,
      method: 'GET',
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'backstage-scaffolder',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, res => {
      res.resume();
      resolve((res.statusCode ?? 0) === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
