import { ConfigReader } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';

const k8sRequest = jest.fn();
jest.mock('../lib/k8sClient', () => ({
  getClusterConfig: async () => ({ server: 'https://cluster.invalid' }),
  buildApiPath: (_v: string, _k: string, ns?: string, name?: string) => `/api/v1/namespaces/${name ?? ns ?? ''}`,
  k8sRequest: (...args: unknown[]) => k8sRequest(...args),
}));
const getEntityByRef = jest.fn();
jest.mock('@backstage/catalog-client', () => ({ CatalogClient: jest.fn().mockImplementation(() => ({ getEntityByRef })) }));

import { createDeleteNamespaceAction } from './deleteNamespace';
import { createDeleteGithubRepoAction } from './deleteGithubRepo';
import { createDestroyAwsInfraAction } from './destroyAwsInfra';
import { createFetchEntityInfoAction } from './fetchEntityInfo';

/**
 * The teardown actions delete with the portal's own credentials, on targets that come from catalog annotations and form fields
 * (audit 2026-11-07). Each refusal asserts that NOTHING was deleted, and the normal path still works.
 */
const config = new ConfigReader({
  organization: { githubOwner: 'example-org', githubRepo: 'backstage-main' },
  catalog: { providers: { github: { a: { organization: 'example-org' }, b: { organization: 'example-team' } } } },
});
const run = (action: any, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const outputs: Record<string, unknown> = {};
  const ctx = { input, logger: mockServices.logger.mock(), output: (k: string, v: unknown) => { outputs[k] = v; }, getInitiatorCredentials: async () => ({}), ...extra } as any;
  return action.handler(ctx).then(() => outputs);
};

describe('kubernetes:delete-namespace', () => {
  const action = createDeleteNamespaceAction() as any;
  beforeEach(() => k8sRequest.mockReset());
  const deletes = () => k8sRequest.mock.calls.filter(c => c[1] === 'DELETE');

  it.each(['kube-system', 'default', 'backstage', 'devtroncd', 'longhorn-system', 'argocd'])('refuses %s even with the portal label, and deletes nothing', async ns => {
    k8sRequest.mockResolvedValue({ metadata: { labels: { 'managed-by': 'backstage' } } });
    await expect(run(action, { namespaces: [ns] })).rejects.toThrow(/Refusing to delete namespace/);
    expect(deletes()).toHaveLength(0);
  });

  it('refuses a namespace that is neither an app namespace nor the portal\'s, and one refusal stops the whole list before anything is deleted', async () => {
    k8sRequest.mockImplementation(async (url: string, method: string) => {
      if (method === 'GET' && url.endsWith('/team-sandbox')) return { metadata: { labels: { team: 'x' } } };
      if (method === 'GET') return { metadata: {} };
      if (method === 'DELETE') return {};
      throw Object.assign(new Error('not found'), { statusCode: 404 });
    });
    await expect(run(action, { namespaces: ['good-app-dev', 'team-sandbox'] })).rejects.toThrow(/team-sandbox.*Nothing was deleted/);
    expect(deletes()).toHaveLength(0);
  });

  it('deletes an app namespace, and a namespace the portal created', async () => {
    const gone = new Set<string>();
    k8sRequest.mockImplementation(async (url: string, method: string) => {
      const name = url.split('/').pop()!;
      if (method === 'DELETE') { gone.add(name); return {}; }
      if (gone.has(name)) throw Object.assign(new Error('gone'), { statusCode: 404 });
      return { metadata: { labels: name === 'infra-ns' ? { 'app.kubernetes.io/managed-by': 'backstage' } : {} } };
    });
    const out = await run(action, { namespaces: ['my-app-dev', 'infra-ns'], timeoutSeconds: 120 });
    expect(out.deleted).toEqual(['my-app-dev', 'infra-ns']);
    expect([...gone].sort()).toEqual(['infra-ns', 'my-app-dev']);
  });

  it('treats an already-missing namespace as done', async () => {
    k8sRequest.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    expect((await run(action, { namespaces: ['already-gone-dev'] })).deleted).toEqual(['already-gone-dev']);
    expect(deletes()).toHaveLength(0);
  });
});

describe('github:repo:delete', () => {
  const action = createDeleteGithubRepoAction({ config }) as any;
  beforeEach(() => { process.env.GITHUB_TOKEN = 'x'; });

  it.each([
    ['example-org', 'engineering-standards', /portal's own repositories/],
    ['example-org', 'backstage-main', /portal's own repositories/],
    ['example-org', 'nexus-idp', /portal's own repositories/],
    ['someone-else', 'app', /not an organization this portal manages/],
    ['example-org', '..', /not a valid GitHub name/],
    ['example-org', 'x/../../orgs/y', /not a valid GitHub name/],
  ])('refuses %s/%s before any request is made', async (owner, name, message) => {
    const https = require('https');
    const spy = jest.spyOn(https, 'request');
    await expect(run(action, { repoOwner: owner, repoName: name })).rejects.toThrow(message);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('infra:destroy-aws-repos', () => {
  const action = createDestroyAwsInfraAction({ config }) as any;
  it('checks every target before dispatching anything: one bad repo stops the run', async () => {
    delete process.env.GITHUB_TOKEN; // a refusal must come first, not the missing-token error
    const https = require('https');
    const spy = jest.spyOn(https, 'request');
    await expect(
      run(action, { repos: [{ repoOwner: 'example-org', repoName: 'app-db', resourceType: 'rds' }, { repoOwner: 'example-org', repoName: 'engineering-standards', resourceType: 'x' }] }),
    ).rejects.toThrow(/portal's own repositories/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refuses a workflow file name that is not a workflow file', async () => {
    await expect(run(action, { repos: [], workflowFile: '../../x' })).rejects.toThrow(/not a workflow file name/);
  });
});

describe('catalog:fetch-entity-info requireOwner', () => {
  const entity = (owner: string) => ({ metadata: { name: 'my-app', annotations: { 'github.com/project-slug': 'example-org/my-app' } }, spec: { owner } });
  const makeAction = (info: { userEntityRef: string; ownershipEntityRefs: string[] } | null) =>
    createFetchEntityInfoAction({
      discovery: { getBaseUrl: async () => 'http://catalog' } as any,
      auth: { getPluginRequestToken: async () => ({ token: 't' }), getOwnServiceCredentials: async () => ({}) } as any,
      userInfo: info ? ({ getUserInfo: async () => info } as any) : undefined,
    }) as any;
  const WEB = { userEntityRef: 'user:default/ann', ownershipEntityRefs: ['user:default/ann', 'group:default/web-team', 'group:default/web-lead'] };
  const OTHER = { userEntityRef: 'user:default/bob', ownershipEntityRefs: ['user:default/bob', 'group:default/cloud-team', 'group:default/cloud-lead'] };

  it('lets a member of the owning team through, and returns the entity details', async () => {
    getEntityByRef.mockResolvedValue(entity('group:default/web-team'));
    const out = await run(makeAction(WEB), { entityRef: 'component:default/my-app', requireOwner: true });
    expect(out).toMatchObject({ repoOwner: 'example-org', repoName: 'my-app', owner: 'group:default/web-team' });
  });

  it('refuses a lead of another team (leads were all it checked), whatever the form of the owner reference', async () => {
    for (const owner of ['group:default/web-team', 'web-team', 'Group:Default/Web-Team']) {
      getEntityByRef.mockResolvedValue(entity(owner));
      await expect(run(makeAction(OTHER), { entityRef: 'component:default/my-app', requireOwner: true })).rejects.toThrow(/not allowed/);
    }
  });

  it('lets platform admins and devops through whoever owns it', async () => {
    getEntityByRef.mockResolvedValue(entity('group:default/web-team'));
    for (const g of ['group:default/backstage-admins', 'group:default/devops-team']) {
      await expect(run(makeAction({ userEntityRef: 'user:default/root', ownershipEntityRefs: [g] }), { entityRef: 'component:default/my-app', requireOwner: true })).resolves.toBeTruthy();
    }
  });

  it('refuses an entity with no owner, and fails closed when it cannot tell who the caller is', async () => {
    getEntityByRef.mockResolvedValue({ metadata: { name: 'x', annotations: { 'github.com/project-slug': 'o/x' } }, spec: {} });
    await expect(run(makeAction(WEB), { entityRef: 'component:default/x', requireOwner: true })).rejects.toThrow(/owned by nobody/);
    getEntityByRef.mockResolvedValue(entity('group:default/web-team'));
    await expect(run(makeAction(null), { entityRef: 'component:default/my-app', requireOwner: true })).rejects.toThrow(/not available/);
  });

  it('compares what the user typed with the repository name on the server, not just in the form', async () => {
    getEntityByRef.mockResolvedValue(entity('group:default/web-team'));
    await expect(run(makeAction(WEB), { entityRef: 'component:default/my-app', requireOwner: true, confirmation: 'my-app' })).resolves.toBeTruthy();
    for (const typed of ['', 'my-app ', 'My-App', 'other-app', 'x']) {
      await expect(run(makeAction(WEB), { entityRef: 'component:default/my-app', requireOwner: true, confirmation: typed })).rejects.toThrow(/does not match the repository name/);
    }
  });

  it('does not check ownership unless asked (the service templates use this action too)', async () => {
    getEntityByRef.mockResolvedValue(entity('group:default/web-team'));
    await expect(run(makeAction(OTHER), { entityRef: 'component:default/my-app' })).resolves.toBeTruthy();
  });
});
