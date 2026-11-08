/**
 * Hard limits for the teardown actions, which delete namespaces, repositories and cloud infrastructure with the portal's own
 * credentials. Targets come from catalog annotations that anyone with push to a repo can write, and from a form field the caller types,
 * so the actions must refuse targets that no app of ours would ever own (audit 2026-11-07: a Component whose project-slug named
 * `engineering-standards`, or whose namespace annotation named `longhorn-system`, had that deleted by a lead running teardown-app;
 * an infra repo was picked by substring, so `app` also matched `myapp-db`).
 */

const GITHUB_PART = /^[A-Za-z0-9_.-]{1,100}$/;

/** A syntactically valid owner or repository name: never a path step (".", ".."), never a slash. */
export function isValidGithubName(name: unknown): name is string {
  return typeof name === 'string' && GITHUB_PART.test(name) && !/^\.+$/.test(name);
}

/** The organizations the portal manages: `organization.githubOwner` and every `catalog.providers.github.*.organization`. */
export function allowedGithubOwners(config: { getOptionalString(key: string): string | undefined; getOptionalConfig(key: string): { keys(): string[]; getOptionalString(key: string): string | undefined } | undefined }): string[] {
  const owners = new Set<string>();
  const primary = config.getOptionalString('organization.githubOwner');
  if (primary) owners.add(primary);
  const providers = config.getOptionalConfig('catalog.providers.github');
  for (const key of providers?.keys() ?? []) {
    const org = providers!.getOptionalString(`${key}.organization`);
    if (org) owners.add(org);
  }
  return [...owners];
}

/** Repositories that must never be deleted by a teardown: the portal, its templates, its public downstream, the docs of the homelab. */
const ALWAYS_PROTECTED_REPOS = ['engineering-standards', 'backstage-main', 'nexus-idp', 'homelab-docs'];

export function assertRepoDeletable(
  repoOwner: unknown,
  repoName: unknown,
  options: { allowedOwners: string[]; portalRepo?: string },
): { repoOwner: string; repoName: string } {
  if (!isValidGithubName(repoOwner) || !isValidGithubName(repoName)) {
    throw new Error('Refusing to delete: the repository owner or name is not a valid GitHub name');
  }
  if (!options.allowedOwners.some(o => o.toLowerCase() === repoOwner.toLowerCase())) {
    throw new Error(`Refusing to delete ${repoOwner}/${repoName}: ${repoOwner} is not an organization this portal manages`);
  }
  const protectedRepos = [...ALWAYS_PROTECTED_REPOS, ...(options.portalRepo ? [options.portalRepo] : [])].map(r => r.toLowerCase());
  if (protectedRepos.includes(repoName.toLowerCase())) {
    throw new Error(`Refusing to delete ${repoOwner}/${repoName}: it is one of the portal's own repositories`);
  }
  return { repoOwner, repoName };
}

const PROTECTED_NAMESPACES = new Set([
  'default', 'backstage', 'devtroncd', 'argocd', 'cert-manager', 'ingress-nginx', 'metallb-system', 'monitoring', 'logging',
  'longhorn-system', 'cnpg-system', 'kube-janitor', 'flux-system', 'traefik', 'istio-system', 'cloudflared',
]);

/** Cluster and platform namespaces: never listed for deletion, never deleted. */
export function isProtectedNamespace(namespace: string): boolean {
  const ns = namespace.trim().toLowerCase();
  return PROTECTED_NAMESPACES.has(ns) || ns.startsWith('kube-') || ns.endsWith('-system');
}

/** The shape every app namespace made from the standard overlays has: `<app>-dev`, `<app>-staging`, `<app>-prod`. */
export function isAppNamespaceName(namespace: string): boolean {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?-(dev|staging|prod)$/.test(namespace);
}

/**
 * Whether a namespace may be deleted: never a protected one, and only one that is an app namespace by name or that the portal itself
 * created (the `managed-by: backstage` label of the infra and three-tier templates).
 */
export function checkNamespaceDeletable(namespace: string, labels?: Record<string, string>): { ok: true } | { ok: false; reason: string } {
  if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(namespace)) return { ok: false, reason: 'not a valid namespace name' };
  if (isProtectedNamespace(namespace)) return { ok: false, reason: 'a cluster or platform namespace' };
  const managedByPortal = labels?.['managed-by'] === 'backstage' || labels?.['app.kubernetes.io/managed-by'] === 'backstage';
  if (!isAppNamespaceName(namespace) && !managedByPortal) {
    return { ok: false, reason: 'neither an app namespace (<app>-dev/-staging/-prod) nor one this portal created' };
  }
  return { ok: true };
}

/** `name` belongs to the app `candidate`: equal, or `candidate-<something>` (so `app` matches `app-db` but not `myapp-db` or `apple`). */
export function nameBelongsToApp(name: string, candidate: string): boolean {
  const n = name.toLowerCase();
  const c = candidate.toLowerCase();
  return c.length > 0 && (n === c || n.startsWith(`${c}-`));
}

/**
 * May this caller tear the entity down? Platform admins and devops always; otherwise the caller must belong to the group that owns the
 * entity (or be the owning user). `ownerRef` is the entity's `spec.owner` as a full reference.
 */
export function callerMayTearDown(caller: { userRef: string; groups: string[]; isPrivileged: boolean }, ownerRef: string | undefined): boolean {
  if (caller.isPrivileged) return true;
  if (!ownerRef) return false;
  const owner = ownerRef.toLowerCase();
  return caller.userRef.toLowerCase() === owner || caller.groups.some(g => g.toLowerCase() === owner);
}
