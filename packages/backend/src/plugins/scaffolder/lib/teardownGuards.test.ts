import { ConfigReader } from '@backstage/config';
import { allowedGithubOwners, assertRepoDeletable, checkNamespaceDeletable, isAppNamespaceName, isProtectedNamespace, isValidGithubName, nameBelongsToApp } from './teardownGuards';

const OPTIONS = { allowedOwners: ['example-org', 'example-team'], portalRepo: 'backstage-main' };

describe('repository deletion targets', () => {
  it('accepts an ordinary app repository in a managed organization', () => {
    expect(assertRepoDeletable('example-org', 'my-app', OPTIONS)).toEqual({ repoOwner: 'example-org', repoName: 'my-app' });
    expect(assertRepoDeletable('EXAMPLE-TEAM', 'My.App_2', OPTIONS)).toBeTruthy();
  });

  it.each(['engineering-standards', 'backstage-main', 'nexus-idp', 'homelab-docs', 'Engineering-Standards'])('never the portal\'s own repository: %s', name => {
    expect(() => assertRepoDeletable('example-org', name, OPTIONS)).toThrow(/portal's own repositories/);
  });

  it('never an organization the portal does not manage', () => {
    expect(() => assertRepoDeletable('some-other-org', 'app', OPTIONS)).toThrow(/not an organization this portal manages/);
    expect(() => assertRepoDeletable('example-org-evil', 'app', OPTIONS)).toThrow(/not an organization/);
  });

  it.each([['example-org', '..'], ['..', 'x'], ['example-org', 'a/b'], ['example-org', 'x/../../orgs/y'], ['example-org', ''], ['example-org', 'a b'], [undefined, 'x'], ['example-org', 5]])(
    'never a name that is a path or not a name: %j / %j',
    (owner, name) => {
      expect(() => assertRepoDeletable(owner, name, OPTIONS)).toThrow(/not a valid GitHub name/);
    },
  );

  it('isValidGithubName', () => {
    expect(isValidGithubName('a.b-c_d')).toBe(true);
    for (const bad of ['.', '..', '...', 'a/b', '', 'a'.repeat(101), 'a%2e', null, undefined, 3]) expect(isValidGithubName(bad)).toBe(false);
  });

  it('reads the managed organizations from the portal configuration', () => {
    const config = new ConfigReader({
      organization: { githubOwner: 'example-org' },
      catalog: { providers: { github: { a: { organization: 'example-org' }, b: { organization: 'example-team' } } } },
    });
    expect(allowedGithubOwners(config).sort()).toEqual(['example-org', 'example-team']);
    expect(allowedGithubOwners(new ConfigReader({}))).toEqual([]);
  });
});

describe('namespace deletion targets', () => {
  it.each(['default', 'kube-system', 'kube-public', 'kube-node-lease', 'kube-anything', 'backstage', 'devtroncd', 'argocd', 'longhorn-system', 'cnpg-system', 'cert-manager', 'monitoring', 'ingress-nginx', 'some-system', 'Backstage'])(
    '%s is protected',
    ns => {
      expect(isProtectedNamespace(ns)).toBe(true);
      expect(checkNamespaceDeletable(ns.toLowerCase(), { 'managed-by': 'backstage' })).toMatchObject({ ok: false });
    },
  );

  it.each(['my-app-dev', 'my-app-staging', 'my-app-prod', 'a-dev', 'app2-prod'])('%s is an app namespace and may be deleted', ns => {
    expect(isAppNamespaceName(ns)).toBe(true);
    expect(checkNamespaceDeletable(ns)).toEqual({ ok: true });
  });

  it('a namespace that is not named like an app is deletable only when the portal created it', () => {
    expect(checkNamespaceDeletable('team-sandbox')).toMatchObject({ ok: false });
    expect(checkNamespaceDeletable('team-sandbox', { 'app.kubernetes.io/managed-by': 'helm' })).toMatchObject({ ok: false });
    expect(checkNamespaceDeletable('team-sandbox', { 'managed-by': 'backstage' })).toEqual({ ok: true });
    expect(checkNamespaceDeletable('team-sandbox', { 'app.kubernetes.io/managed-by': 'backstage' })).toEqual({ ok: true });
  });

  it.each(['', 'UPPER-dev', 'a_b-dev', '-x-dev', 'x-dev-', 'a'.repeat(64), '../kube-system', 'a/b'])('%j is not a valid namespace name', ns => {
    expect(checkNamespaceDeletable(ns)).toMatchObject({ ok: false, reason: 'not a valid namespace name' });
  });
});

describe('nameBelongsToApp', () => {
  it('matches the app itself and its parts, not look-alikes (it used to be a substring match)', () => {
    expect(nameBelongsToApp('app', 'app')).toBe(true);
    expect(nameBelongsToApp('app-db', 'app')).toBe(true);
    expect(nameBelongsToApp('App-RDS', 'app')).toBe(true);
    for (const other of ['myapp-db', 'apple', 'webapp', 'a', 'x-app-db']) expect(nameBelongsToApp(other, 'app')).toBe(false);
    expect(nameBelongsToApp('anything', '')).toBe(false);
  });
});
